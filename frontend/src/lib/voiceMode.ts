/**
 * Which speech pipeline the user chose.
 *
 *   "browser" — Web Speech only. Audio is handled by the browser's own speech
 *               service (Chrome → Google); nothing reaches our servers.
 *   "cloud"   — the above, PLUS a compressed copy of the audio sent to a
 *               high-precision service for a better transcript.
 *
 * localStorage, not sessionStorage: this is the one kind of value that SHOULD
 * survive a visit (see identity.ts — `echo_anon_id` is the only other one).
 * Re-asking in every tab would be pure friction.
 */

export type VoiceMode = "browser" | "cloud";

/**
 * Ships dark. Until the vendor is chosen and named in the privacy page, the
 * honest default is the mode that uploads nothing. Flip this only together with
 * publishing the vendor name AND bumping the storage key below.
 */
export const DEFAULT_VOICE_MODE: VoiceMode = "browser";

/**
 * The version suffix is load-bearing, not decoration.
 *
 * Bumped v1 → v2 on 2026-08-27, when the vendor was named and the disclosure
 * was corrected. Under v1 the copy said the audio was held in memory only and
 * never used for training — but 讯飞's API requires uploading the file to their
 * servers, keeps the transcript there for 7 days, and documents neither how long
 * the audio is kept nor whether it trains anything. Anyone who picked
 * "high accuracy" agreed to a description that was not true, so their answer
 * cannot be carried over: re-ask rather than silently reinterpret past consent.
 *
 * Bump again on any future change of this kind — a new vendor, or flipping the
 * default to "cloud". Do not "clean up" the suffix.
 */
const VOICE_MODE_KEY = "echo_voice_mode_v2";

function isVoiceMode(v: unknown): v is VoiceMode {
  return v === "browser" || v === "cloud";
}

/** null = never chosen → show the mode dialog. */
export function readVoiceMode(): VoiceMode | null {
  if (typeof window === "undefined") return null; // SSR guard
  try {
    const raw = window.localStorage.getItem(VOICE_MODE_KEY);
    return isVoiceMode(raw) ? raw : null;
  } catch {
    return null; // private mode / storage disabled — ask again, never assume consent
  }
}

export function writeVoiceMode(mode: VoiceMode): void {
  if (typeof window === "undefined") return; // SSR guard
  try {
    window.localStorage.setItem(VOICE_MODE_KEY, mode);
  } catch {
    /* quota / private browsing — the in-memory choice still holds for this session */
  }
}
