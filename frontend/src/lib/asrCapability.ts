/**
 * "Can the server actually do a high-accuracy transcript right now?"
 *
 * Asked of the server rather than read from a build-time flag: a flag asserts
 * intent, not reality, and would happily claim the option exists while the key
 * is missing or ASR_PROVIDER is misspelled — the user would discover that only
 * after speaking for two minutes. The endpoint derives its answer from
 * isAsrConfigured(), so it cannot disagree with what POST will do.
 *
 * Fails CLOSED: any error, timeout, or malformed body means unavailable, which
 * degrades to browser-only. Never fail open on a question about uploading audio.
 */
import { fetchWithTimeout } from "./fetchWithTimeout";
import { CAPABILITY_TIMEOUT_MS } from "./asr/limits";

export type AsrCapability = { available: boolean; providerClass: "mock" | "cloud" | null };

const UNAVAILABLE: AsrCapability = { available: false, providerClass: null };

/**
 * Module-level promise latch, the same idiom analytics.ts uses for its
 * once-per-load flags: React StrictMode invokes effects twice in dev, and one
 * probe per page load is the intent.
 */
let inflight: Promise<AsrCapability> | null = null;

export function getAsrCapability(): Promise<AsrCapability> {
  if (typeof window === "undefined") return Promise.resolve(UNAVAILABLE); // SSR guard
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const res = await fetchWithTimeout("/api/transcribe", { method: "GET" }, CAPABILITY_TIMEOUT_MS);
      if (!res.ok) return UNAVAILABLE;
      const data = (await res.json()) as Partial<AsrCapability>;
      return data.available === true
        ? { available: true, providerClass: data.providerClass ?? null }
        : UNAVAILABLE;
    } catch {
      return UNAVAILABLE; // network / timeout / bad JSON — assume no upload path
    }
  })();

  return inflight;
}
