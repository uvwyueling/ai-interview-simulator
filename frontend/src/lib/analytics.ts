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
  LANDED: "landed", // page loaded at the URL (top of funnel)
  APP_VIEWED: "app_viewed", // upload UI actually rendered (i.e. past any invite wall)
  FIRST_INTERACTION: "first_interaction", // first real user gesture → "this is a human"
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

const SRC_KEY = "echo_src";
const LANDED_AT_KEY = "echo_landed_at";
const APP_VIEWED_KEY = "echo_app_viewed";

/**
 * Acquisition source from the landing URL's `?src=` (e.g. douban / xhs).
 * First-touch + persisted (sessionStorage) so it sticks to every event for the
 * whole visit, even after the param drops off the URL (SPA navigation). No
 * param → "direct". Auto-injected into every event by track().
 */
function getSource(): string {
  if (typeof window === "undefined") return "direct";
  try {
    const stored = sessionStorage.getItem(SRC_KEY);
    if (stored) return stored;
    const fromUrl = new URLSearchParams(window.location.search).get("src");
    const clean = fromUrl?.trim().slice(0, 32) || "direct"; // untrusted → cap length
    sessionStorage.setItem(SRC_KEY, clean);
    return clean;
  } catch {
    return "direct";
  }
}

/** ms since the visit's first landing, computed at call time (no running timer). */
function timeSinceLanded(): number | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    const v = sessionStorage.getItem(LANDED_AT_KEY);
    return v ? Date.now() - Number(v) : undefined;
  } catch {
    return undefined;
  }
}

export function track(event: EventName, props: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  try {
    const tsl = timeSinceLanded();
    const body = JSON.stringify({
      event,
      props: {
        ...props,
        env: APP_ENV,
        src: getSource(),
        ...(tsl !== undefined ? { time_since_landed_ms: tsl } : {}),
      },
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

// Fires once per page load (module flag also de-dups React StrictMode's double
// effect invoke in dev). Refreshes produce a new `landed` — dedupe by anonId.
let landedFired = false;

/** Call on app mount: anchors the visit clock and records the landing. */
export function trackLanded(): void {
  if (typeof window === "undefined" || landedFired) return;
  landedFired = true;
  try {
    // Anchor once per visit so time_since_landed_ms stays continuous across refreshes.
    if (!sessionStorage.getItem(LANDED_AT_KEY)) {
      sessionStorage.setItem(LANDED_AT_KEY, String(Date.now()));
    }
  } catch {
    /* ignore */
  }
  // src is auto-injected by track(); these live only on `landed`.
  // `webdriver` is a cheap bot signal (true under most automation tooling).
  track(EVENTS.LANDED, {
    viewport_width: window.innerWidth,
    referrer: document.referrer || "",
    webdriver: navigator.webdriver === true,
  });
}

/** Call when the upload UI is actually shown. Fires once per visit (survives refresh). */
export function trackAppViewed(): void {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(APP_VIEWED_KEY)) return;
    sessionStorage.setItem(APP_VIEWED_KEY, "1");
  } catch {
    /* ignore — fall through and still fire once for this render */
  }
  track(EVENTS.APP_VIEWED);
}

// The strongest "this is a real human" signal: any genuine user gesture. Headless
// bots/crawlers usually never produce one. Fires once per visit (survives refresh).
// Used as the funnel-denoise filter (a session with no first_interaction ≈ bot).
const FIRST_INTERACTION_KEY = "echo_first_interaction";
let firstInteractionFired = false;

export function trackFirstInteraction(): void {
  if (typeof window === "undefined" || firstInteractionFired) return;
  try {
    if (sessionStorage.getItem(FIRST_INTERACTION_KEY)) {
      firstInteractionFired = true;
      return;
    }
    sessionStorage.setItem(FIRST_INTERACTION_KEY, "1");
  } catch {
    /* private mode — module flag still guards within this load */
  }
  firstInteractionFired = true;
  track(EVENTS.FIRST_INTERACTION);
}
