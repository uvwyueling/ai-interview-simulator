/**
 * Google Ads conversion reporting.
 *
 * Deliberately separate from `lib/analytics.ts`. That module is our own funnel:
 * ~25 events, rich props, into Supabase, read by a human. This one carries a
 * single high-value signal to Google's bidding algorithm. Keeping them apart
 * means a funnel tweak can never quietly change what the ad campaign is paying
 * to optimise for.
 *
 * Same two rules as analytics:
 *   1. NEVER throws — ad tracking must not break the product.
 *   2. NEVER sends PII — no resume / JD / answer text, ever.
 */

/**
 * The Google Ads measurement ID. Not a secret — it ships to every visitor in
 * the page source. Lives here rather than in an env var so a missing host
 * config can't silently kill tracking for a campaign that's already spending.
 * `app/layout.tsx` imports this to build the gtag.js snippet.
 */
export const GOOGLE_ADS_ID = "AW-18389654749";

/**
 * Conversion label for the 「完成一次面试」 conversion action.
 *
 * Where to get it: Google Ads → 目标 → 转化 → 转化操作 → 点开「完成一次面试」→
 * 「使用 Google 代码管理器安装」/「自行安装代码」，给出的片段形如
 *   gtag('event', 'conversion', { send_to: 'AW-18389654749/AbC-D_efGhIjKl' });
 * 斜杠后面那一段就是这里要填的值。
 *
 * Empty string = not configured yet → `reportInterviewCompleted()` no-ops
 * instead of sending a malformed `send_to` that Google would silently discard.
 */
const CONVERSION_LABEL = "";

const IS_PROD = process.env.NODE_ENV === "production";

declare global {
  interface Window {
    // Defined by the inline gtag snippet in app/layout.tsx. It exists as soon
    // as that snippet runs — before gtag.js finishes loading — because calls
    // queue into dataLayer and gtag.js drains them on arrival.
    gtag?: (...args: unknown[]) => void;
  }
}

/**
 * Report one completed interview to Google Ads.
 *
 * No local de-duplication on purpose: this is called from exactly one place, in
 * a user-initiated handler (not an effect), so React can't double-fire it. A
 * visitor who genuinely completes a second interview *is* a second completion —
 * whether that should count once or twice belongs in Google Ads'
 * 「转化次数统计方式」 setting, not hard-coded here.
 */
export function reportInterviewCompleted(): void {
  if (typeof window === "undefined") return;

  // Localhost would otherwise post fake conversions into the live campaign and
  // skew bidding. Log instead, so the wiring is still verifiable in dev.
  if (!IS_PROD) {
    console.info("[gtag] dev — conversion suppressed (would fire: 完成一次面试)");
    return;
  }

  if (!CONVERSION_LABEL) {
    // Loud on purpose: silence here looks identical to a working tag, and the
    // difference only shows up as an empty conversion column weeks later.
    console.warn("[gtag] CONVERSION_LABEL 未配置，转化未上报（见 lib/gtag.ts）");
    return;
  }

  try {
    window.gtag?.("event", "conversion", {
      send_to: `${GOOGLE_ADS_ID}/${CONVERSION_LABEL}`,
    });
  } catch {
    /* swallow — never break the app over ad tracking */
  }
}
