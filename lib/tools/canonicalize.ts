/**
 * Tool canonicalization.
 *
 * Produces byte-stable serialization of `UniversalTool` arrays so the
 * provider-side cache prefix remains identical across turns. Sorts the array
 * by tool name alphabetically and recursively sorts JSON-Schema object keys
 * inside `function.parameters`.
 *
 * Without canonicalization:
 *   - Tool registration via Map insertion-order is non-deterministic
 *   - JSON Schema key order varies by source-file authoring order
 * Either of those drifts breaks Anthropic/OpenAI/Grok prefix caching.
 *
 * @module tools/canonicalize
 */

import type { UniversalTool } from '@/lib/plugins/interfaces/tool-plugin'

function sortKeysDeep<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    return value
  }
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep) as unknown as T
  }
  const obj = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(obj).sort()) {
    sorted[key] = sortKeysDeep(obj[key])
  }
  return sorted as T
}

export function canonicalizeUniversalTool(tool: UniversalTool): UniversalTool {
  return {
    type: tool.type,
    function: {
      name: tool.function.name,
      description: tool.function.description,
      parameters: sortKeysDeep(tool.function.parameters),
    },
  }
}

export function canonicalizeUniversalTools(tools: UniversalTool[]): UniversalTool[] {
  return [...tools]
    .map(canonicalizeUniversalTool)
    .sort((a, b) => a.function.name.localeCompare(b.function.name))
}
