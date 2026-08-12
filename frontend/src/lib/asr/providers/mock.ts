/**
 * Mock ASR provider — local development, CI, and product acceptance.
 *
 * Returns the Web Speech draft unchanged, so `asrUpgradeDistance` is 0 by
 * construction. That is the point: the entire pipeline (record → upload →
 * validate → provider → replace → metrics) runs for real, with no vendor
 * account and no spend. If the draft comes back, the plumbing works.
 *
 * It still requires non-empty audio, so a broken recorder fails here rather than
 * silently "succeeding".
 */
import type { AsrInput, AsrProvider, AsrResult } from "../types";
import { AsrError } from "../types";

/** Simulated latency, so the 「正在优化转写…」 state and its abort edges are observable. */
const DELAY_MS = Number(process.env.ASR_MOCK_DELAY_MS ?? 0) || 0;

/**
 * Perturb the returned text so the upgrade-succeeded path can be verified.
 *
 * Needed because the transcript 👍/👎 control only appears when the cloud
 * actually changed something — with a faithful mock that branch is unreachable
 * and untestable. Off by default; never set in production.
 */
const MUTATE = process.env.ASR_MOCK_MUTATE === "1";

function mutate(draft: string): string {
  if (!draft) return draft;
  // Insert punctuation the way a real cloud ASR would, plus one visible marker
  // so it's obvious in the UI which path produced the text.
  return draft.replace(/([。！？])?$/, "。").replace(/^/, "「已优化」");
}

export const mockProvider: AsrProvider = {
  name: "mock",
  providerClass: "mock",

  async transcribe(input: AsrInput, signal: AbortSignal): Promise<AsrResult> {
    if (input.audio.byteLength === 0) {
      throw new AsrError("unsupported_media", "empty audio buffer");
    }

    if (DELAY_MS > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, DELAY_MS);
        signal.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(new AsrError("timeout", "aborted"));
          },
          { once: true }
        );
      });
    }
    if (signal.aborted) throw new AsrError("timeout", "aborted");

    return {
      text: MUTATE ? mutate(input.draft) : input.draft,
      providerClass: "mock",
    };
  },
};
