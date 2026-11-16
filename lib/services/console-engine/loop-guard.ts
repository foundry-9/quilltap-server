/**
 * Console engine — the stuck-loop guard's call signature.
 *
 * Shared by the console engine's streaming loop (`./engine.ts`) and the
 * in-memory one-shot loop (`lib/services/agent-loop/one-shot-loop.ts`).
 *
 * @module lib/services/console-engine/loop-guard
 */

/**
 * Normalize a batch of tool calls into a stable signature for loop detection.
 * String argument values (notably SQL) are whitespace-collapsed and lowercased
 * so cosmetic reformatting — extra spaces, a trailing semicolon's surrounding
 * whitespace, case changes — does not read as a "different" call. Semantic
 * variation still differs (that is what the stale-result signal catches).
 */
export function normalizeToolCallSignature(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
): string {
  const normalizeValue = (value: unknown): unknown =>
    typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().toLowerCase() : value
  return JSON.stringify(
    toolCalls.map(tc => ({
      name: tc.name,
      arguments: Object.fromEntries(
        Object.entries(tc.arguments)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, value]) => [key, normalizeValue(value)]),
      ),
    })),
  )
}
