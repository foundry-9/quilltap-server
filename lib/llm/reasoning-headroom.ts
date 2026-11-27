/**
 * Room for reasoning on top of the answer a call wants.
 *
 * Models that think by default (Anthropic's Haiku 5.5, Sonnet 5.x, Opus 5.x
 * and others) count their thinking against `max_tokens`. A cap sized for the
 * answer alone — 300 or 500 tokens for a short classification or cleanup —
 * can be spent on thinking before any answer is written, which comes back as
 * an empty reply with finish reason `max_tokens`. The cap is a ceiling, not a
 * charge, so the headroom costs nothing on a model that does not think.
 */

/** Tokens added to an answer budget for a model's own reasoning. */
export const REASONING_HEADROOM_TOKENS = 4000

/**
 * The `maxTokens` to send for a call whose answer needs `answerTokens`.
 *
 * `ceiling` is the model's own output limit, when known. The headroom never
 * pushes past it: a caller that already asks for a profile's whole output
 * budget (128k on a DeepSeek-class profile) would otherwise send 132k to a
 * provider that refuses anything over 131,072, and every call fails with a
 * 400. The ceiling only trims the headroom — it never cuts below the answer
 * budget the caller asked for.
 */
export function withReasoningHeadroom(answerTokens: number, ceiling?: number): number {
  const padded = answerTokens + REASONING_HEADROOM_TOKENS
  if (ceiling == null || !Number.isFinite(ceiling) || ceiling <= 0) return padded
  return Math.max(answerTokens, Math.min(padded, ceiling))
}
