/**
 * Hybrid-ASR constants. Pure config — no env, no I/O, imported by BOTH the
 * browser (recorder settings) and the route (validation), so the two can never
 * drift. Same shape as lib/models.ts.
 */

/**
 * MediaRecorder bitrate, set explicitly — the browser default for webm/opus is
 * ~128kbps, which would put the longest answer we've actually measured (257s)
 * at ~4.1MB, right against Vercel's 4.5MB request-body limit.
 *
 * 24k, not 16k: size was never the binding constraint (257s here is ~770KB),
 * and a bitrate low enough to hurt the audio would mean the accuracy numbers
 * measure our own compression instead of the provider. Treat this as PROVISIONAL
 * — 16/24/32 are to be compared against a real provider before it's locked.
 */
export const AUDIO_BITS_PER_SECOND = 24_000;

/**
 * Hard stop for one recording segment.
 *
 * 300s covers all 49 voice answers observed in production (median 108s, P75
 * 174s, P90 220s, max 257s) with nothing clipped. A capped segment cannot be
 * used to replace the draft — the cloud only transcribed the part it received,
 * so substituting it would silently delete the tail of the user's answer.
 */
export const MAX_SEGMENT_MS = 300_000;

/** ~900KB at 24kbps/300s; the ceiling leaves room under Vercel's 4.5MB body limit. */
export const MAX_AUDIO_BYTES = 3_500_000;

/** Below these, treat as silence and skip the call rather than pay for nothing. */
export const MIN_AUDIO_BYTES = 2_000;
export const MIN_AUDIO_MS = 1_500;

/** Chunk interval, so bytes can be tallied while recording and capped mid-flight. */
export const RECORDER_TIMESLICE_MS = 1_000;

/** Accepted on the route (compared against the base type, `;codecs=` stripped). */
export const ALLOWED_AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
] as const;

/** Tried in order; first one MediaRecorder supports wins. */
export const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
] as const;

// ── Hotword hints ─────────────────────────────────────────────────────────────
// Caps are load-bearing, not cosmetic: Whisper-family `prompt` bias is capped
// around 224 tokens, and an over-long hint list silently degrades rather than
// erroring.
export const MAX_HINTS = 30;
export const MAX_HINT_LEN = 24;
export const MAX_HINTS_CHARS = 400;

/** Guards the route's Zod check on the draft field. */
export const MAX_DRAFT_CHARS = 4_000;

/**
 * A "successful" cloud result shorter than this fraction of the draft is treated
 * as suspicious and discarded in favour of the draft. Protects against the worst
 * failure mode — a truncated result wiping most of an answer — at the cost of
 * occasionally rejecting a legitimately terse transcript. A constant so it can
 * be tuned from real data.
 */
export const MIN_CLOUD_DRAFT_RATIO = 0.5;

/** Above this draft length the ratio guard applies; below it, noise dominates. */
export const RATIO_GUARD_MIN_DRAFT_LEN = 40;

// ── Timeouts ──────────────────────────────────────────────────────────────────
// Server budget is strictly under the client's so the server always gets to
// return a clean, classified shape instead of the client aborting first.
export const CLIENT_TRANSCRIBE_TIMEOUT_MS = 20_000;
export const SERVER_PROVIDER_TIMEOUT_MS = 18_000;
export const CAPABILITY_TIMEOUT_MS = 3_000;
