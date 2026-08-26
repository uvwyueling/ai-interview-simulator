/**
 * iFlytek (讯飞) OST provider — 极速录音转写.
 *
 * ─── Logging discipline (read before touching ANY catch in this file) ──────
 * This file is more dangerous than the route it serves. The `/v2/ost/query`
 * response body contains the FULL TRANSCRIPT of what the user said. A single
 * `console.error(err)` or a logged response body is an incident, not a debug
 * aid. Log ONLY: an error's `name`, the vendor `code`, and an HTTP status.
 * Never a body, never the assembled text, never the audio.
 *
 * ─── Node runtime only ─────────────────────────────────────────────────────
 * Uses node:crypto for the request signature, so /api/transcribe must keep
 * `runtime = "nodejs"`. It cannot be moved to edge without replacing the
 * signing with WebCrypto.
 *
 * ─── Shape ─────────────────────────────────────────────────────────────────
 * Structurally unlike providers/openai.ts: OST is an ASYNC TASK API, so one
 * transcribe() call runs three phases — upload the file, create a task, then
 * poll for the result — rather than a single blocking request.
 *
 * Endpoints, signature scheme, parameter names, result shape and error codes
 * were all settled against the live service by a throwaway probe before this
 * file was written; none of it is inferred from documentation alone.
 */
import { createHash, createHmac, randomUUID } from "node:crypto";
import type { AsrInput, AsrProvider, AsrResult } from "../types";
import { AsrError } from "../types";

const UPLOAD_HOST = "upload-ost-api.xfyun.cn";
const API_HOST = "ost-api.xfyun.cn";
const UPLOAD_PATH = "/file/upload";
const CREATE_PATH = "/v2/ost/pro_create";
const QUERY_PATH = "/v2/ost/query";

/** Measured: 22s of audio finished in 2 polls, 112s in 4. */
const POLL_INTERVAL_MS = 1_000;
/** Safety net only — the AbortSignal from the route normally ends this first. */
const MAX_POLLS = 30;
/** The docs state no `dhw` limit, so impose one rather than send unbounded input. */
const MAX_DHW_CHARS = 200;

/** Vendor codes worth distinguishing. Everything else collapses to `upstream`. */
const MEDIA_ERROR_CODES = new Set([
  20304, // 静音 or format mismatch
  10043, // audio decode failure
  10107, // `encoding` field invalid
]);

export function isXfyunConfigured(): boolean {
  return !!(
    process.env.XFYUN_APP_ID &&
    process.env.XFYUN_API_KEY &&
    process.env.XFYUN_API_SECRET
  );
}

/**
 * Signature per the OST scheme (NOT the `signa`/HmacSHA1 one used by 讯飞's
 * other transcription product, lfasr — they are different APIs).
 *
 * `digest` is the SHA-256 of the exact request body, which is why multipart
 * bodies are assembled by hand below: FormData gives no stable serialised bytes
 * to hash.
 */
function signedHeaders(
  host: string,
  path: string,
  body: Buffer,
  contentType: string
): Record<string, string> {
  const key = process.env.XFYUN_API_KEY;
  const secret = process.env.XFYUN_API_SECRET;
  if (!key || !secret) throw new AsrError("auth", "XFYUN credentials missing");

  const date = new Date().toUTCString(); // RFC1123, GMT
  const digest = "SHA-256=" + createHash("sha256").update(body).digest("base64");
  const sigStr = `host: ${host}\ndate: ${date}\nPOST ${path} HTTP/1.1\ndigest: ${digest}`;
  const signature = createHmac("sha256", secret).update(sigStr).digest("base64");

  return {
    host,
    date,
    digest,
    authorization:
      `api_key="${key}", algorithm="hmac-sha256", ` +
      `headers="host date request-line digest", signature="${signature}"`,
    "Content-Type": contentType,
  };
}

type Envelope = { code?: number; message?: string; data?: Record<string, unknown> };

function mapVendorCode(code: number, status?: number): AsrError {
  const kind = MEDIA_ERROR_CODES.has(code) ? "unsupported_media" : "upstream";
  return new AsrError(kind, `vendor code ${code}`, status);
}

function mapHttpStatus(status: number): AsrError {
  const code =
    status === 401 || status === 403
      ? "auth"
      : status === 429
        ? "rate_limit"
        : status === 413 || status === 415
          ? "unsupported_media"
          : "upstream";
  // Status only — never the body, which echoes the transcript.
  return new AsrError(code, `upstream ${status}`, status);
}

async function post(
  host: string,
  path: string,
  body: Buffer,
  contentType: string,
  signal: AbortSignal
): Promise<Envelope> {
  let res: Response;
  try {
    res = await fetch(`https://${host}${path}`, {
      method: "POST",
      headers: signedHeaders(host, path, body, contentType),
      body: new Uint8Array(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw new AsrError("timeout", "aborted");
    if (err instanceof AsrError) throw err;
    // Only the NAME: a fetch error can carry the request body, i.e. the audio.
    throw new AsrError("upstream", err instanceof Error ? err.name : "fetch failed");
  }

  // A failed call still carries the vendor code in its BODY — the probe saw
  // HTTP 400 with {"code":20304}. Classifying on status alone would file
  // "the user recorded silence" under the same code as "the vendor is down",
  // which is both the wrong message and a corrupted failure-rate metric.
  // Parsed for its numeric code only; the body is never logged.
  if (!res.ok) {
    let code: unknown;
    try {
      code = ((await res.json()) as Envelope).code;
    } catch {
      /* no usable body — fall through to status-based mapping */
    }
    if (typeof code === "number" && code !== 0) throw mapVendorCode(code, res.status);
    throw mapHttpStatus(res.status);
  }

  let env: Envelope;
  try {
    env = (await res.json()) as Envelope;
  } catch {
    throw new AsrError("upstream", "malformed response");
  }
  return env;
}

/**
 * A non-zero `code` is a failure even when `task_status` says "4" (回调完成) —
 * the probe saw exactly that pairing for an unsupported format. Checking status
 * alone reads a failure as a success.
 */
function expectOk(env: Envelope): Envelope {
  if (env.code !== 0) throw mapVendorCode(typeof env.code === "number" ? env.code : -1);
  return env;
}

/** Interruptible sleep — same idiom as providers/mock.ts. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new AsrError("timeout", "aborted"));
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(new AsrError("timeout", "aborted"));
      },
      { once: true }
    );
  });
}

/** Build multipart by hand so the exact bytes can be hashed for `digest`. */
function multipart(
  fields: Record<string, string>,
  fileName: string,
  file: Buffer,
  fileType: string
): { body: Buffer; contentType: string } {
  const boundary = "----echo" + randomUUID().replace(/-/g, "");
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`)
    );
  }
  parts.push(
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="data"; filename="${fileName}"\r\n` +
        `Content-Type: ${fileType}\r\n\r\n`
    )
  );
  parts.push(file);
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`));
  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`,
  };
}

/**
 * Hotwords: Chinese only.
 *
 * The 2026-08-16 probe showed Latin hotwords produce no improvement at all,
 * while a Chinese one flipped 买点 → 埋点. Filtering here rather than in
 * extractHints keeps the wire format unchanged — rebalancing the extractor's
 * quotas is a separate piece of work.
 */
function buildDhw(hints: string[]): string {
  let out = "";
  for (const h of hints) {
    if (!/[一-龥]/.test(h)) continue;
    const next = out ? `${out},${h}` : h;
    if (next.length > MAX_DHW_CHARS) break;
    out = next;
  }
  return out;
}

/** `encoding` per the vendor's vocabulary; anything else it cannot read. */
function encodingFor(mime: string): "lame" | "raw" {
  const base = mime.split(";")[0];
  if (base === "audio/mpeg") return "lame";
  if (base === "audio/wav") return "raw";
  // Reject BEFORE uploading — otherwise we pay an upload only to be refused.
  throw new AsrError("unsupported_media", `mime ${base}`);
}

/**
 * Walk the lattice and concatenate recognised words.
 *
 * `json_1best` comes back as an object here, but is a JSON-encoded STRING in
 * other 讯飞 products; tolerating both costs two lines and removes a whole class
 * of breakage if they ever align the shapes.
 */
function assembleText(result: unknown): string {
  const lattice = (result as { lattice?: unknown[] } | undefined)?.lattice;
  if (!Array.isArray(lattice)) return "";
  let out = "";
  for (const seg of lattice) {
    let best = (seg as { json_1best?: unknown })?.json_1best;
    if (typeof best === "string") {
      try {
        best = JSON.parse(best);
      } catch {
        continue;
      }
    }
    const rt = (best as { st?: { rt?: unknown[] } })?.st?.rt;
    if (!Array.isArray(rt)) continue;
    for (const r of rt) {
      for (const ws of (r as { ws?: unknown[] })?.ws ?? []) {
        for (const cw of (ws as { cw?: unknown[] })?.cw ?? []) {
          const w = (cw as { w?: unknown })?.w;
          if (typeof w === "string") out += w;
        }
      }
    }
  }
  return out;
}

export const xfyunProvider: AsrProvider = {
  name: "xfyun",
  providerClass: "cloud",

  async transcribe(input: AsrInput, signal: AbortSignal): Promise<AsrResult> {
    if (!isXfyunConfigured()) throw new AsrError("auth", "XFYUN credentials missing");
    const appId = process.env.XFYUN_APP_ID as string;

    const encoding = encodingFor(input.mimeType); // throws before any upload
    const audio = Buffer.from(input.audio);
    // A fresh UUID per task and nothing else: this endpoint is deliberately not
    // correlatable to a person, so no anonId/sessionId may be sent here.
    const requestId = randomUUID();

    // ── 1. upload ────────────────────────────────────────────────────────────
    const form = multipart(
      { app_id: appId, request_id: requestId },
      encoding === "lame" ? "answer.mp3" : "answer.wav",
      audio,
      input.mimeType
    );
    const upload = expectOk(
      await post(UPLOAD_HOST, UPLOAD_PATH, form.body, form.contentType, signal)
    );
    const audioUrl = upload.data?.url;
    if (typeof audioUrl !== "string" || !audioUrl) {
      throw new AsrError("upstream", "upload returned no url");
    }

    // ── 2. create task ───────────────────────────────────────────────────────
    const dhw = buildDhw(input.hints);
    const createBody = Buffer.from(
      JSON.stringify({
        common: { app_id: appId },
        business: {
          request_id: requestId,
          language: "zh_cn",
          domain: "pro_ost_ed",
          accent: "mandarin",
          ...(dhw ? { dhw } : {}),
        },
        data: {
          audio_url: audioUrl,
          audio_src: "http",
          format: "audio/L16;rate=16000",
          encoding,
          audio_size: audio.byteLength,
        },
      })
    );
    const created = expectOk(
      await post(API_HOST, CREATE_PATH, createBody, "application/json", signal)
    );
    const taskId = created.data?.task_id;
    if (typeof taskId !== "string" || !taskId) {
      throw new AsrError("upstream", "create returned no task_id");
    }

    // ── 3. poll ──────────────────────────────────────────────────────────────
    const queryBody = Buffer.from(
      JSON.stringify({ common: { app_id: appId }, business: { task_id: taskId, request_id: requestId } })
    );
    for (let i = 0; i < MAX_POLLS; i++) {
      await sleep(POLL_INTERVAL_MS, signal); // throws on abort
      const q = expectOk(await post(API_HOST, QUERY_PATH, queryBody, "application/json", signal));
      // The vendor returns these as strings ("2"/"3"/"4"); accept numbers too.
      const status = String((q.data as { task_status?: unknown })?.task_status ?? "");
      if (status === "3" || status === "4") {
        const text = assembleText((q.data as { result?: unknown })?.result).trim();
        // Refuse to hand back an empty upgrade — the draft is strictly better.
        if (!text) throw new AsrError("upstream", "empty result");
        return { text, providerClass: "cloud" };
      }
    }
    throw new AsrError("timeout", "poll limit reached");
  },
};
