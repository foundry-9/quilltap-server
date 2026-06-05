/**
 * Best-effort extraction of a provider's reported finish reason from the raw
 * response object yielded on the final `done` stream chunk.
 *
 * The shape differs per provider; we sniff the well-known ones and fall back
 * to `null` for anything unrecognized. Result is the raw provider string —
 * callers shouldn't assume any normalization.
 */
export function extractFinishReason(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  // OpenAI Chat Completions, Z.AI, OpenRouter chat, OpenAI-compatible
  const choices = r.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const first = choices[0] as Record<string, unknown> | undefined;
    const fr = first?.finish_reason;
    if (typeof fr === 'string') return fr;
  }

  // Anthropic
  if (typeof r.stop_reason === 'string') return r.stop_reason;

  // Google
  const candidates = r.candidates;
  if (Array.isArray(candidates) && candidates.length > 0) {
    const first = candidates[0] as Record<string, unknown> | undefined;
    const fr = first?.finishReason;
    if (typeof fr === 'string') return fr;
  }

  // OpenAI Responses API, Grok Responses
  if (typeof r.status === 'string') return r.status;

  return null;
}
