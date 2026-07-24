/**
 * Server-side data sink for analytics events (Supabase / Postgres).
 *
 * All database access is isolated in this file. If the storage backend ever
 * changes (e.g. SQLite, another Postgres host), only this file needs to be
 * rewritten — the /api/track route and the rest of the app stay untouched.
 *
 * Security
 * ────────
 *   Uses the SERVICE ROLE key, which bypasses Row-Level Security. This key is
 *   read from server-only env (no NEXT_PUBLIC_ prefix) and is ONLY ever used
 *   inside server-side API routes — it must never reach the client bundle.
 *
 * Graceful degradation
 * ────────────────────
 *   If env vars are missing (e.g. a fresh clone without .env.local), the client
 *   is null and inserts become no-ops. Analytics must never break the app.
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

let _client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null;
  if (!_client) {
    _client = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

export type AnalyticsEventRow = {
  event: string;
  anon_id: string;
  session_id: string;
  props: Record<string, unknown>;
  ts: number;
};

/** Insert one analytics event. Returns true on success, false on any failure. */
export async function insertEvent(row: AnalyticsEventRow): Promise<boolean> {
  const client = getClient();
  if (!client) return false;
  const { error } = await client.from("events").insert(row);
  if (error) {
    console.error("[db] insertEvent failed:", error.message);
    return false;
  }
  return true;
}

// ── User-submitted free-text (contact info / downvote reasons) ───────────────
// Kept in a separate table from `events` so PII never mixes into analytics.
// One row per submission. Join on session_id / anon_id when you need the
// submitter's full funnel path.

export type FeedbackSubmissionRow = {
  session_id: string;
  anon_id: string;
  kind: "contact" | "downvote_reason";
  contact: string | null;       // wechat / email / xhs — only for kind='contact'
  message: string | null;       // optional note (contact) or the reason text (downvote)
  context: Record<string, unknown>; // e.g. { target, index, followupDepth } for downvote
  tz: string | null;            // IANA tz from Intl.DateTimeFormat().resolvedOptions()
};

/** Insert one PII submission. Returns true on success, false on any failure. */
export async function insertSubmission(row: FeedbackSubmissionRow): Promise<boolean> {
  const client = getClient();
  if (!client) return false;
  const { error } = await client.from("feedback_submissions").insert(row);
  if (error) {
    console.error("[db] insertSubmission failed:", error.message);
    return false;
  }
  return true;
}

/** Aggregate event counts grouped by event name (for dev verification). */
export async function eventCounts(): Promise<Record<string, number> | null> {
  const client = getClient();
  if (!client) return null;
  const { data, error } = await client.from("events").select("event");
  if (error) {
    console.error("[db] eventCounts failed:", error.message);
    return null;
  }
  const counts: Record<string, number> = {};
  for (const r of data as { event: string }[]) {
    counts[r.event] = (counts[r.event] ?? 0) + 1;
  }
  return counts;
}

/** Whether the sink is configured (used by the route to report 503 vs success). */
export function isConfigured(): boolean {
  return !!(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY);
}
