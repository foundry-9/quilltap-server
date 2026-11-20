/**
 * Which connection profile an agent run starts on before the operator picks
 * one: the surface's preferred profile when it names one that exists, else the
 * default profile if it can use tools, else the first that can, else the first.
 *
 * @module components/agent-stream/pick-tool-profile
 */

interface ToolProfile {
  id: string
  isDefault?: boolean
  allowToolUse?: boolean
}

export function pickToolProfileId(profiles: readonly ToolProfile[], preferredId?: string | null): string {
  return (
    (preferredId ? profiles.find((p) => p.id === preferredId) : undefined) ??
    profiles.find((p) => p.isDefault && p.allowToolUse) ??
    profiles.find((p) => p.allowToolUse) ??
    profiles[0]
  )?.id ?? ''
}
