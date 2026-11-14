/**
 * Tool fixtures for the provider-failover suites.
 *
 * One tool, `search`, in two provider shapes: Anthropic's (`name` +
 * `input_schema`) and OpenAI's (`type: 'function'` + `function`). A failover
 * test hands the primary's array as `actualTools` and `formatToolsForFixture`
 * as `formatToolsFor`, so a substitute on another provider should receive its
 * own shape — never the primary's (#181).
 */

import type { ConnectionProfile } from '@/lib/schemas/types'
import type { ProfileToolFormat } from '@/lib/services/chat-message/types'

const SEARCH_PARAMETERS = {
  type: 'object',
  properties: { query: { type: 'string' } },
  required: ['query'],
}

export const ANTHROPIC_TOOLS = [
  { name: 'search', description: 'Search the stores', input_schema: SEARCH_PARAMETERS },
]

export const OPENAI_TOOLS = [
  { type: 'function', function: { name: 'search', description: 'Search the stores', parameters: SEARCH_PARAMETERS } },
]

/** The tools in `provider`'s shape (Anthropic, else OpenAI-compatible). */
export function toolsShapedFor(provider: string): unknown[] {
  return provider === 'ANTHROPIC' ? ANTHROPIC_TOOLS : OPENAI_TOOLS
}

/**
 * `TurnToolSlate.formatToolsFor` for the suites: native tools in the
 * profile's own shape, or a text protocol when the profile's
 * `pseudoToolMode` asks for one.
 */
export async function formatToolsForFixture(
  profile: Pick<ConnectionProfile, 'provider'> & { pseudoToolMode?: string | null },
): Promise<ProfileToolFormat> {
  const mode = profile.pseudoToolMode === 'simple-json' || profile.pseudoToolMode === 'text-block'
    ? profile.pseudoToolMode
    : 'native'
  return {
    actualTools: mode === 'native' ? toolsShapedFor(profile.provider) : [],
    resolvedToolMode: mode,
    useTextBlockTools: mode !== 'native',
    useNativeWebSearch: false,
    stopSequences: undefined,
  }
}
