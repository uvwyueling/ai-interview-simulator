/**
 * Centralised model routing for the AI Interview Simulator.
 *
 * Change a model here and every route picks it up automatically.
 *
 * Strategy
 * ────────
 *   lightweight  haiku   – high-frequency, speed-critical, low-complexity tasks
 *                          (binary follow-up decisions, tiny JSON output)
 *   standard     sonnet  – one-off structured generation that shapes the whole session
 *                          (question tailoring requires deep resume+JD comprehension)
 *   quality      sonnet  – the product's primary value delivery
 *                          (multi-source evaluation with grounded bullet evidence)
 *
 * Cost estimate per session (worst-case: 3 main Qs × 3 follow-ups):
 *   generate-followup  ×9  @ haiku  ≈ $0.027
 *   generate-questions ×1  @ sonnet ≈ $0.010
 *   generate-feedback  ×3  @ sonnet ≈ $0.135
 *   ─────────────────────────────────────────
 *   Total                            ≈ $0.172 / session
 */
export const MODELS = {
  /** generate-followup: binary yes/no + optional short follow-up question */
  lightweight: "claude-haiku-4-5",
  /** generate-questions: 3 tailored questions from resume + JD */
  standard: "claude-sonnet-4-6",
  /** generate-feedback: deep multi-dimensional evaluation (main deliverable) */
  quality: "claude-sonnet-4-6",
} as const;
