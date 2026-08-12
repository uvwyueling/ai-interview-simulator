/**
 * OpenAI transcription provider — INTERNAL TESTING ONLY.
 *
 * This is NOT the shipping vendor. It exists so the pipeline can be exercised
 * against a real service before one is chosen, and it is reachable only by
 * setting ASR_PROVIDER=openai. Nothing above lib/asr/provider.ts names it.
 *
 * Deliberately plain `fetch` + FormData rather than the OpenAI SDK: adding a
 * vendor SDK to package.json is exactly the hard-wiring this layer exists to
 * avoid, and the multipart call is a dozen lines.
 */
import type { AsrInput, AsrProvider, AsrResult } from "../types";
import { AsrError } from "../types";
import { MAX_HINTS_CHARS } from "../limits";

const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "whisper-1";

function extFor(mime: string): string {
  const base = mime.split(";")[0];
  return (
    { "audio/webm": "webm", "audio/ogg": "ogg", "audio/mp4": "mp4", "audio/mpeg": "mp3", "audio/wav": "wav" }[
      base
    ] ?? "webm"
  );
}

/**
 * Whisper-family bias is a free-text `prompt`, token-capped around 224 — the
 * char cap is load-bearing: an over-long prompt is silently truncated, dropping
 * whichever hints happen to sort last rather than erroring.
 */
function buildPrompt(hints: string[]): string {
  let out = "";
  for (const h of hints) {
    const next = out ? `${out}、${h}` : h;
    if (next.length > MAX_HINTS_CHARS) break;
    out = next;
  }
  return out;
}

export function isOpenAiConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

export const openAiProvider: AsrProvider = {
  name: "openai",
  providerClass: "cloud",

  async transcribe(input: AsrInput, signal: AbortSignal): Promise<AsrResult> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new AsrError("auth", "OPENAI_API_KEY missing");

    const form = new FormData();
    form.append(
      "file",
      new Blob([input.audio], { type: input.mimeType }),
      `answer.${extFor(input.mimeType)}`
    );
    form.append("model", MODEL);
    form.append("language", "zh");
    form.append("response_format", "json");
    const prompt = buildPrompt(input.hints);
    if (prompt) form.append("prompt", prompt);

    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
        signal,
      });
    } catch (err) {
      if (signal.aborted) throw new AsrError("timeout", "aborted");
      // Only the error's NAME — a fetch error can carry the request body, which
      // here is the user's audio.
      throw new AsrError("upstream", err instanceof Error ? err.name : "fetch failed");
    }

    if (!res.ok) {
      const code =
        res.status === 401 || res.status === 403
          ? "auth"
          : res.status === 429
            ? "rate_limit"
            : res.status === 413 || res.status === 415
              ? "unsupported_media"
              : "upstream";
      // Status only — never the response body, which echoes the transcript.
      throw new AsrError(code, `upstream ${res.status}`, res.status);
    }

    const data = (await res.json()) as { text?: unknown };
    if (typeof data.text !== "string") {
      throw new AsrError("upstream", "malformed response");
    }
    return { text: data.text.trim(), providerClass: "cloud" };
  },
};
