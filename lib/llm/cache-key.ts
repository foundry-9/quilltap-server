/**
 * Provider prompt-cache keys.
 *
 * Generates the `prompt_cache_key` (OpenAI / Grok) used to pin sticky routing
 * to the same machine that has the cache hot. Without this, requests above
 * ~15 RPM/key shard across servers and degrade hit rate; on Grok, every
 * request round-robins.
 *
 * The key is scoped to the chat (option 2 from the design plan): a single
 * key per conversation so group chats reuse cache across speaker switches —
 * speaker identity lives in the dynamic tail, not in the cache key.
 *
 * `projectVersion` invalidates caches on intentional structural changes
 * (tool-schema, system-prompt structure, persona block format). Bump
 * policy: see docs/developer/features/llm_api_costs_breakdown.md.
 *
 * @module llm/cache-key
 */

// Major version of the cacheable prompt structure. Bump when you change
// anything that should reset all provider caches: tool-schema shape, the
// system-prompt builder layout, persona-block format, or memory-pool format.
// Wording fixes and content edits don't require a bump.
//
// 1 — initial structure (post-commit 68a9eba6: two-system-message split,
//     off-scene Host announcements, static identity reinforcement)
export const PROMPT_CACHE_STRUCTURE_VERSION = 1

export function buildPromptCacheKey(chatId: string | undefined): string | undefined {
  if (!chatId) return undefined
  return `quilltap:chat:${chatId}:v${PROMPT_CACHE_STRUCTURE_VERSION}`
}
