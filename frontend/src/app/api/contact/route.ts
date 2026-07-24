import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { insertSubmission } from "@/lib/db";
import { rateLimit, getClientIp } from "@/lib/rateLimit";

// Writes to Supabase → Node runtime; never statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Schema ─────────────────────────────────────────────────────────────────
//
// Free-text fields are capped at parse time — over-length input is truncated
// client-side, but we defend server-side too. `context` is a small flat record
// used to attach downvote target info (e.g. { target: "feedback", index: 2 }).

const SubmissionSchema = z.object({
  kind: z.enum(["contact", "downvote_reason"]),
  contact: z.string().max(200).optional().nullable(),
  message: z.string().max(2000).optional().nullable(),
  context: z.record(z.string(), z.unknown()).optional(),
  tz: z.string().max(64).optional().nullable(),
  anonId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(64),
});

// ─── POST ─────────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Tighter than /api/track — this is a real user action, not fire-and-forget.
  const rl = rateLimit(`contact:${getClientIp(request)}`, 10, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "提交过于频繁，请稍后再试" },
      { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "请求格式错误" }, { status: 400 });
  }

  const parsed = SubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "内容格式不正确" }, { status: 400 });
  }

  const { kind, contact, message, context, tz, anonId, sessionId } = parsed.data;

  // Semantic guard: 'contact' needs at least one of contact/message; a downvote
  // reason needs some message. Empty submissions are just noise.
  const trimmedContact = contact?.trim() || null;
  const trimmedMessage = message?.trim() || null;
  if (kind === "contact" && !trimmedContact && !trimmedMessage) {
    return NextResponse.json({ ok: false, error: "请留下联系方式或留言" }, { status: 400 });
  }
  if (kind === "downvote_reason" && !trimmedMessage) {
    return NextResponse.json({ ok: false, error: "请写下你的原因" }, { status: 400 });
  }

  const ok = await insertSubmission({
    session_id: sessionId,
    anon_id: anonId,
    kind,
    contact: trimmedContact,
    message: trimmedMessage,
    context: context ?? {},
    tz: tz?.trim() || null,
  });

  if (!ok) {
    // Wrap raw DB errors — never let users see them (红线2).
    return NextResponse.json(
      { ok: false, error: "提交失败，请稍后再试" },
      { status: 503 }
    );
  }

  return NextResponse.json({ ok: true });
}
