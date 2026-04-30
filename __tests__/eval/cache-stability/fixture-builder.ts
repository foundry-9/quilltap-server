/**
 * Programmatic fixture builder for cache-stability eval.
 *
 * Synthesizes a sequence of `LLMMessage[]` arrays representing successive
 * turns of a hypothetical chat. Used by the eval harness to assert that a
 * given prompt-builder produces byte-stable cacheable prefixes across turns.
 */

import type { LLMMessage } from '@/lib/llm'

export interface SyntheticChatOptions {
  systemBlock1: string
  systemBlock2: string
  turns: number
  participants?: string[]
}

/**
 * Build the message array as it would be passed to the provider on turn N
 * (1-indexed). A turn is one user-input + one assistant-output pair, except
 * the last turn which has no assistant response yet.
 */
export function buildTurnMessages(
  options: SyntheticChatOptions,
  turn: number,
): LLMMessage[] {
  const { systemBlock1, systemBlock2, turns } = options
  if (turn < 1 || turn > turns) {
    throw new Error(`Turn ${turn} out of range [1, ${turns}]`)
  }

  const messages: LLMMessage[] = [
    { role: 'system', content: systemBlock1 },
    { role: 'system', content: systemBlock2 },
  ]

  for (let t = 1; t <= turn; t++) {
    messages.push({ role: 'user', content: `User message ${t}` })
    if (t < turn) {
      messages.push({ role: 'assistant', content: `Assistant reply ${t}` })
    }
  }

  return messages
}
