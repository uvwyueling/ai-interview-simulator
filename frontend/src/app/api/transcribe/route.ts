import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import { getAsrProvider, isAsrConfigured, asrProviderClass } from "@/lib/asr/provider";
import { AsrError } from "@/lib/asr/types";
import {
  ALLOWED_AUDIO_TYPES,
  MAX_AUDIO_BYTES,
  MAX_DRAFT_CHARS,
  MAX_HINTS,
  MAX_HINT_LEN,
  MAX_SEGMENT_MS,
  MIN_AUDIO_BYTES,
  MIN_AUDIO_MS,
  SERVER_PROVIDER_TIMEOUT_MS,
} from "@/lib/asr/limits";

// formData() / arrayBuffer() need the Node runtime; never cache a request that
// carries audio.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * High-accuracy re-transcription of one answer segment.
 *
 * ─── Audio handling contract ───────────────────────────────────────────────
 * The audio exists ONLY as an in-memory ArrayBuffer for the life of this
 * request. It is never written to object storage, a database, a file, or a log;
 * the body is never cached; and it falls out of scope when the handler returns.
 *
 * ─── Logging discipline (read before touching any catch) ───────────────────
 * Every catch logs ONLY `err.name`, an AsrError `code`, and an upstream HTTP
 * status. NEVER `console.error(err)` on a provider/fetch error: those objects
 * routinely carry the request body, which here is the user's audio and the
 * transcript of what they said. Never log `draft`, `hints`, byte contents, or
 * the returned text. "Improving" the logging here is how this feature becomes
 * an incident.
 *
 * There is deliberately NO anonId / sessionId field — nothing about this
 * endpoint needs to be correlatable to a person. Metrics are computed in the
 * browser and reported through /api/track.
 */

// ─── Schema (metadata only; the audio is validated separately) ───────────────

const MetaSchema = z.object({
  draft: z.string().max(MAX_DRAFT_CHARS),
  durationMs: z.number().int().min(MIN_AUDIO_MS).max(MAX_SEGMENT_MS),
  hints: z.array(z.string().min(1).max(MAX_HINT_LEN)).max(MAX_HINTS),
  lang: z.literal("zh-CN"),
});

type Fail = { status: number; code: string; error: string };

function fail({ status, code, error }: Fail): NextResponse {
  return NextResponse.json(
    { ok: false, code, error },
    { status, headers: { "Cache-Control": "no-store" } }
  );
}

function ok(body: Record<string, unknown>): NextResponse {
  return NextResponse.json(
    { ok: true, ...body },
    { headers: { "Cache-Control": "no-store" } }
  );
}

function parseHints(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return []; // hints are an optimisation — malformed ones are dropped, not fatal
  }
}

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Own bucket, NOT the shared `llm:` one: this endpoint bills per second of
  // audio and carries bodies ~100× larger, so it must not compete with question
  // generation for budget. 20/min covers a 12-answer interview with retries.
  const rl = rateLimit(`transcribe:${getClientIp(request)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, code: "rate_limited", error: "请求过于频繁，请稍后重试" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec), "Cache-Control": "no-store" } }
    );
  }

  if (!request.headers.get("content-type")?.includes("multipart/form-data")) {
    return fail({ status: 415, code: "bad_content_type", error: "请求格式错误" });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail({ status: 400, code: "bad_form", error: "请求格式错误" });
  }

  const audio = form.get("audio");
  if (!(audio instanceof File)) {
    return fail({ status: 400, code: "no_audio", error: "未收到音频" });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return fail({ status: 413, code: "too_large", error: "录音过长，已保留浏览器转写结果" });
  }

  const draft = String(form.get("draft") ?? "");

  // Too small to contain speech: don't pay for it. Returned as a SUCCESS with
  // upgraded:false so the client keeps a single happy-path shape.
  if (audio.size < MIN_AUDIO_BYTES) {
    return ok({ text: draft, upgraded: false, code: "too_short" });
  }

  const baseType = (audio.type || "").split(";")[0];
  if (!ALLOWED_AUDIO_TYPES.includes(baseType as (typeof ALLOWED_AUDIO_TYPES)[number])) {
    return fail({ status: 415, code: "unsupported_media", error: "音频格式不受支持，已保留浏览器转写结果" });
  }

  const parsed = MetaSchema.safeParse({
    draft,
    durationMs: Number(form.get("durationMs")),
    hints: parseHints(form.get("hints") as string | null),
    lang: String(form.get("lang") ?? "zh-CN"),
  });
  if (!parsed.success) {
    return fail({ status: 400, code: "bad_meta", error: "内容格式不正确" });
  }

  const provider = getAsrProvider();
  if (!provider) {
    // Soft fallback, not an error the user should see as a failure.
    return fail({ status: 503, code: "unavailable", error: "高准确转写暂不可用，已保留浏览器转写结果" });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_PROVIDER_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const buf = await audio.arrayBuffer();
    const result = await provider.transcribe(
      {
        audio: buf,
        mimeType: baseType,
        durationMs: parsed.data.durationMs,
        language: "zh-CN",
        hints: parsed.data.hints,
        draft: parsed.data.draft,
      },
      controller.signal
    );
    return ok({
      text: result.text,
      upgraded: true,
      providerClass: result.providerClass,
      latencyMs: Date.now() - startedAt,
    });
  } catch (err) {
    const code = err instanceof AsrError ? err.code : "unknown";
    const status = err instanceof AsrError ? err.status : undefined;
    // Code + status + error NAME only. See the logging discipline above.
    console.error(
      "[transcribe] provider failed:",
      code,
      status ?? "",
      err instanceof Error ? err.name : typeof err
    );

    switch (code) {
      case "auth":
        return fail({ status: 500, code, error: "转写服务配置有误，已保留浏览器转写结果" });
      case "rate_limit":
        return fail({ status: 429, code, error: "转写服务繁忙，已保留浏览器转写结果" });
      case "unsupported_media":
        return fail({ status: 415, code, error: "音频格式不受支持，已保留浏览器转写结果" });
      case "timeout":
        return fail({ status: 504, code, error: "转写超时，已保留浏览器转写结果" });
      default:
        return fail({ status: 502, code, error: "转写服务暂时不可用，已保留浏览器转写结果" });
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─── GET · capability probe ───────────────────────────────────────────────────
//
// The client asks the server what is actually possible instead of trusting a
// build-time flag, which could claim high-accuracy is available while the key is
// missing or ASR_PROVIDER is misspelled — the user would find out only after
// speaking for two minutes. Derived from isAsrConfigured(), so it cannot
// disagree with what POST will do.

export async function GET(request: NextRequest): Promise<NextResponse> {
  // Separate bucket so capability pings can't eat the POST budget.
  if (!rateLimit(`asrcap:${getClientIp(request)}`, 60, 60_000).ok) {
    return NextResponse.json({ ok: false, available: false }, { status: 429 });
  }
  return NextResponse.json(
    {
      ok: true,
      available: isAsrConfigured(),
      // Coarse on purpose — never the vendor name.
      providerClass: asrProviderClass(),
      limits: {
        maxSeconds: Math.floor(MAX_SEGMENT_MS / 1000),
        maxBytes: MAX_AUDIO_BYTES,
        mimeTypes: ALLOWED_AUDIO_TYPES,
      },
    },
    { headers: { "Cache-Control": "private, max-age=300" } }
  );
}
