/**
 * Client-side analytics. Fire-and-forget POST to /api/track.
 *
 * Design rules:
 *   1. NEVER throws — analytics must not break the product. All paths swallow errors.
 *   2. NEVER sends PII — only derived metadata (lengths, scores, durations, flags,
 *      categories). Resume / JD / answer raw text must not appear in `props`.
 *   3. Uses `keepalive` so events fired right before navigation/unload still send.
 */
import { getAnonId, getSessionId } from "./identity";

/** Canonical event names — use these constants, never raw strings, to avoid typos. */
export const EVENTS = {
  INPUT_COMPLETED: "input_completed",
  QUESTIONS_GENERATED: "questions_generated",
  INTERVIEW_STARTED: "interview_started",
  ANSWER_SUBMITTED: "answer_submitted",
  FOLLOWUP_TRIGGERED: "followup_triggered",
  FOLLOWUP_DEGRADED: "followup_degraded", // followup API failed → advanced without it
  INTERVIEW_COMPLETED: "interview_completed",
  FEEDBACK_VIEWED: "feedback_viewed",
  FEEDBACK_GENERATED: "feedback_generated", // success + latency (counterpart to _failed)
  FEEDBACK_FAILED: "feedback_failed",
  FEEDBACK_RATED: "feedback_rated", // 👍/👎 on feedback quality or follow-up usefulness
  REPORT_EXPORTED: "report_exported",
} as const;

export type EventName = (typeof EVENTS)[keyof typeof EVENTS];

// "prod" for the deployed Vercel build (next build), "dev" for local `next dev`.
// NODE_ENV is inlined at build time, so this is a static, zero-config signal.
// Auto-injected into every event's props → filter with: props->>'env' = 'prod'.
const APP_ENV: "prod" | "dev" =
  process.env.NODE_ENV === "production" ? "prod" : "dev";

export function track(event: EventName, props: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  try {
    const body = JSON.stringify({
      event,
      props: { ...props, env: APP_ENV },
      anonId: getAnonId(),
      sessionId: getSessionId(),
      ts: Date.now(),
    });
    void fetch("/api/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true, // survive page unload / navigation
    }).catch(() => {
      /* swallow — never break the app over analytics */
    });
  } catch {
    /* swallow */
  }
}
