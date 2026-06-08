import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { insertEvent, eventCounts, isConfigured } from "@/lib/db";

// SQLite/Supabase write needs the Node runtime (not Edge); force dynamic so it
// is never statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ─── Schema ─────────────────────────────────────────────────────────────────
// props is intentionally constrained to a flat-ish record — and by contract
// (enforced client-side) must NEVER contain resume / JD / answer raw text.

const EventSchema = z.object({
  event: z.string().min(1).max(64),
  anonId: z.string().min(1).max(64),
  sessionId: z.string().min(1).max(64),
  props: z.record(z.string(), z.unknown()).optional(),
  ts: z.number().optional(),
});

// ─── POST: ingest one event ───────────────────────────────────────────────────

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Parsing / validation failures should never surface to the user — analytics
  // is best-effort. We still return 200 so the fire-and-forget client is happy.
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" });
  }

  const parsed = EventSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid" });
  }

  const { event, anonId, sessionId, props, ts } = parsed.data;

  const ok = await insertEvent({
    event,
    anon_id: anonId,
    session_id: sessionId,
    props: props ?? {},
    ts: ts ?? Date.now(),
  });

  return NextResponse.json({ ok });
}

// ─── GET: aggregate counts (dev verification only) ─────────────────────────────
// ⚠️ Returns only per-event counts (no rows, no props, no PII). Convenient for
// confirming ingestion works. Consider protecting or removing before a public
// launch, since it exposes usage volume.

export async function GET(): Promise<NextResponse> {
  if (!isConfigured()) {
    return NextResponse.json(
      { ok: false, reason: "Supabase 未配置，请在 .env.local 设置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY" },
      { status: 503 }
    );
  }
  const counts = await eventCounts();
  return NextResponse.json({ ok: true, counts });
}
