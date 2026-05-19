import { computeRequestPrefixHashes } from '@/lib/llm/cache-prefix-hashes'
import type { LLMMessage } from '@/lib/llm'

describe('computeRequestPrefixHashes', () => {
  it('produces stable hashes for equivalent inputs', () => {
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are an assistant.' },
      { role: 'system', content: 'Stay in character.' },
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello' },
      { role: 'user', content: 'New turn' },
    ]
    const tools = [
      { type: 'function', function: { name: 'foo', description: 'd', parameters: {} } },
    ]
    const a = computeRequestPrefixHashes(messages, tools)
    const b = computeRequestPrefixHashes(messages, tools)
    expect(a).toEqual(b)
    expect(a.systemBlock1Hash).toBeDefined()
    expect(a.systemBlock2Hash).toBeDefined()
    expect(a.toolsArrayHash).toBeDefined()
    expect(a.historyTailHash).toBeDefined()
  })

  it('detects drift in system block 1', () => {
    const base: LLMMessage[] = [
      { role: 'system', content: 'You are an assistant.' },
      { role: 'user', content: 'Hi' },
      { role: 'user', content: 'Now' },
    ]
    const drifted: LLMMessage[] = [
      { role: 'system', content: 'You are an assistant!' }, // changed
      { role: 'user', content: 'Hi' },
      { role: 'user', content: 'Now' },
    ]
    const a = computeRequestPrefixHashes(base, undefined)
    const b = computeRequestPrefixHashes(drifted, undefined)
    expect(a.systemBlock1Hash).not.toBe(b.systemBlock1Hash)
  })

  it('history tail hash excludes the trailing user message', () => {
    const turn1: LLMMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
    ]
    const turn2: LLMMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'one' },
      { role: 'assistant', content: 'two' },
      { role: 'user', content: 'three' },
      { role: 'assistant', content: 'four' },
      { role: 'user', content: 'five' }, // new tail; frozen history grew
    ]
    const a = computeRequestPrefixHashes(turn1, undefined)
    const b = computeRequestPrefixHashes(turn2, undefined)
    // turn1's frozen history is the empty prefix; turn2's frozen history includes more
    expect(a.historyTailHash).not.toBe(b.historyTailHash)
  })

  it('omits hashes for absent tiers', () => {
    const messages: LLMMessage[] = [
      { role: 'user', content: 'just one msg' },
    ]
    const result = computeRequestPrefixHashes(messages, undefined)
    expect(result.systemBlock1Hash).toBeUndefined()
    expect(result.systemBlock2Hash).toBeUndefined()
    expect(result.toolsArrayHash).toBeUndefined()
    expect(result.historyTailHash).toBeUndefined()
  })
})
