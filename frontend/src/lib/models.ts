/**
 * Centralised model routing — DeepSeek (via its Anthropic-compatible endpoint).
 *
 * We keep the @anthropic-ai/sdk and only repoint the backend (see lib/llmClient).
 * Each route picks a model id + whether to run in "thinking" mode.
 *
 * Routing (per product decision):
 *   generate-questions : deepseek-v4-flash · non-thinking  (structured 3-question output)
 *   generate-followup  : deepseek-v4-flash · thinking      (reason about whether to probe)
 *   generate-feedback  : deepseek-v4-pro   · non-thinking  (deep multi-dimensional eval)
 *
 * Notes:
 *   - "thinking" is toggled via the `thinking` field; DeepSeek ignores budget_tokens.
 *   - cache_control is ignored by DeepSeek (it does context caching automatically).
 */

export const MODELS = {
  questions: { id: "deepseek-v4-flash", thinking: false },
  followup: { id: "deepseek-v4-flash", thinking: true },
  feedback: { id: "deepseek-v4-pro", thinking: false },
} as const;

/** Build the Anthropic-SDK `thinking` param. budget_tokens is ignored by DeepSeek
 *  but the SDK type requires it when enabled; keep it < the call's max_tokens. */
export function thinkingParam(enabled: boolean) {
  return enabled
    ? ({ type: "enabled", budget_tokens: 1024 } as const)
    : ({ type: "disabled" } as const);
}
