/**
 * Hybrid-ASR constants. Pure config — no env, no I/O, imported by BOTH the
 * browser (recorder settings) and the route (validation), so the two can never
 * drift. Same shape as lib/models.ts.
 */

/**
 * MediaRecorder bitrate, set explicitly — the browser default for webm/opus is
 * ~128kbps.
 *
 * ⚠️ Its ORIGINAL justification no longer binds. This was 24k to keep the
 * request body under Vercel's 4.5MB limit, but the upload is now a transcoded
 * MP3 (see MP3_BITS_PER_SECOND), so the size on the wire is set by that stage,
 * not this one. What this value now controls is how clean the input to the
 * decoder is — and there are two lossy stages stacked (opus → decode → mp3), so
 * the argument points UP rather than down.
 *
 * Left at 24k deliberately: changing it now would be an unmeasured guess. The
 * value gets set from data by the 16/24/32/48 comparison against the real
 * provider (see TODO 「码率实测再锁定」).
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

/**
 * Two jobs, one number — read carefully before changing it.
 *
 * In capture.ts it caps the RAW webm held in memory while recording (~900KB at
 * 24kbps/300s), i.e. it bounds RAM and the encoder's input.
 * On the route it caps the UPLOADED body, which is now MP3 (~1.2MB at
 * 32kbps/300s). Both stay comfortably under Vercel's 4.5MB body limit.
 */
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

/**
 * Polling used to detect that Web Speech has finished flushing its last result
 * after stop(). Typical settle is two ticks; the cap bounds the wait when the
 * finalisation never arrives at all.
 */
export const SETTLE_TICK_MS = 120;
export const SETTLE_MAX_TICKS = 6;

/** Fallback if `onend` never arrives — never block the upgrade forever on it. */
export const SPEECH_END_CAP_MS = 2_000;

// ── MP3 transcode ─────────────────────────────────────────────────────────────
// Required, not an optimisation: the cloud provider accepts wav/pcm/mp3 while
// Chrome's MediaRecorder only produces webm/opus — the two sets do not
// intersect. WAV is ruled out by size (16k/16bit/mono is ~9.6MB at 300s, twice
// Vercel's body limit); MP3 at 32kbps mono is 1.20MB, measured, not estimated.

export const MP3_SAMPLE_RATE = 16_000;
/** kbps, the unit lamejs takes. 300s → 1,200,384 bytes (measured). */
export const MP3_KBPS = 32;
/** One MPEG frame. Fixed by the format, not a tunable. */
export const MP3_FRAME_SAMPLES = 1152;
/**
 * Yield to the event loop every N frames so the 「正在优化转写…」 spinner keeps
 * animating through the encode.
 *
 * Measured (108s of audio, one machine): not yielding blocks for 1987ms; every
 * 10 frames caps the worst block at 23ms and costs nothing measurable in total
 * time — the yield must go through MessageChannel for that to hold, since
 * setTimeout is clamped (to ~4ms nested, and to ~1s in a background tab).
 */
export const ENCODE_YIELD_EVERY_FRAMES = 10;
