/**
 * Cache prefix hashing utilities.
 *
 * Computes per-tier hashes (SHA-256 truncated to 16 hex chars) of the cacheable
 * regions of an LLM request: the two system blocks, the tools array, and the
 * append-only history tail (everything except the last message). Used by
 * llm-logging to verify that the cacheable prefix is byte-stable across turns.
 * A drift in any tier's hash signals that the cache will miss.
 *
 * @module llm/cache-prefix-hashes
 */

import { createHash } from 'crypto'
import type { LLMMessage } from './base'
import type { LLMLogRequestHashes } from '@/lib/schemas/types'

const HASH_LENGTH = 16

function hashString(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, HASH_LENGTH)
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return '[' + value.map(stableStringify).join(',') + ']'
  }
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])).join(',') + '}'
}

/**
 * Compute per-tier prefix hashes for an LLM request.
 *
 * - systemBlock1Hash: first system message content (the long stable identity stack)
 * - systemBlock2Hash: second system message content (static identity reminder)
 * - toolsArrayHash: stable-stringified tools array
 * - historyTailHash: stable-stringified all non-system messages except the last
 *   (i.e. the frozen history). Mid-history mutation between turns shows up as
 *   a hash drift here.
 */
export function computeRequestPrefixHashes(
  messages: LLMMessage[],
  tools: unknown[] | undefined,
): LLMLogRequestHashes {
  const result: LLMLogRequestHashes = {}

  const systemBlocks: LLMMessage[] = []
  for (const m of messages) {
    if (m.role === 'system' && typeof m.content === 'string') {
      systemBlocks.push(m)
    }
  }
  if (systemBlocks.length >= 1 && typeof systemBlocks[0].content === 'string') {
    result.systemBlock1Hash = hashString(systemBlocks[0].content)
  }
  if (systemBlocks.length >= 2 && typeof systemBlocks[1].content === 'string') {
    result.systemBlock2Hash = hashString(systemBlocks[1].content)
  }

  if (tools && tools.length > 0) {
    result.toolsArrayHash = hashString(stableStringify(tools))
  }

  const nonSystem = messages.filter(m => m.role !== 'system')
  if (nonSystem.length > 1) {
    const frozen = nonSystem.slice(0, -1)
    result.historyTailHash = hashString(stableStringify(frozen.map(m => ({
      role: m.role,
      content: m.content,
      name: m.name,
      toolCallId: m.toolCallId,
      toolCalls: m.toolCalls,
    }))))
  }

  return result
}
