/**
 * Scenario text composition
 *
 * Combines a resolved preset scenario body (character / project / group /
 * general) with the user's free-text scenario notes from the New Chat dialog.
 * The single combined string is what gets persisted into `chat.scenarioText`.
 *
 * Rules:
 *   - Preset body keeps its leading whitespace; only its trailing whitespace is
 *     trimmed before joining. Free text is fully trimmed.
 *   - When only one side is present, the result is just that side (no stray
 *     separator). When a preset is present, the free text is appended beneath
 *     it with a single blank line.
 *   - When both sides are empty, the result is `undefined` (so the caller stores
 *     `scenarioText` as `null`, as before).
 */
export function combineScenarioText(
  presetBody: string | null | undefined,
  freeText: string | null | undefined,
): string | undefined {
  const base = presetBody?.trimEnd()
  const extra = freeText?.trim()
  const parts = [base, extra].filter((s): s is string => Boolean(s && s.length > 0))
  return parts.length > 0 ? parts.join('\n\n') : undefined
}
