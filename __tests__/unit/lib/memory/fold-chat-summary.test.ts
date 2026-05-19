/**
 * Tests for the rolling-window fold prompt. Validates that the prompt sent
 * to the cheap LLM has the four-section update-style framing, that prior
 * summary is included when present, and that the placeholder fires on the
 * first fold.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals'

const executeCheapLLMTask = jest.fn<(...args: any[]) => any>()

jest.mock('@/lib/memory/cheap-llm-tasks/core-execution', () => ({
  executeCheapLLMTask: (...args: any[]) => executeCheapLLMTask(...args),
}))

const { foldChatSummary } = require('@/lib/memory/cheap-llm-tasks/chat-tasks') as typeof import('@/lib/memory/cheap-llm-tasks/chat-tasks')

const fakeSelection: any = { provider: 'anthropic', modelName: 'claude-haiku-4-5-20251001' }

describe('foldChatSummary prompt', () => {
  beforeEach(() => {
    executeCheapLLMTask.mockReset()
    executeCheapLLMTask.mockResolvedValue({ success: true, result: 'updated', usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 } })
  })

  it('includes the four-section structure in the system message', async () => {
    await foldChatSummary(
      { priorSummary: null, newTurns: [{ role: 'user', content: 'hi' }] },
      fakeSelection,
      'user-1',
    )

    const [, llmMessages] = executeCheapLLMTask.mock.calls[0]
    const systemMsg = (llmMessages as any[]).find(m => m.role === 'system')
    expect(systemMsg).toBeTruthy()
    expect(systemMsg.content).toContain('Active threads')
    expect(systemMsg.content).toContain('Resolved decisions')
    expect(systemMsg.content).toContain('Emotional state')
    expect(systemMsg.content).toContain('Open questions')
    expect(systemMsg.content).toMatch(/Carry forward/i)
  })

  it('uses placeholder text when no prior summary exists', async () => {
    await foldChatSummary(
      { priorSummary: null, newTurns: [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'hello' }] },
      fakeSelection,
      'user-1',
    )

    const [, llmMessages] = executeCheapLLMTask.mock.calls[0]
    const userMsg = (llmMessages as any[]).find(m => m.role === 'user')
    expect(userMsg.content).toContain('Prior summary')
    expect(userMsg.content).toMatch(/this is the first fold/i)
    expect(userMsg.content).toContain('USER: hi')
    expect(userMsg.content).toContain('ASSISTANT: hello')
  })

  it('embeds the prior summary verbatim when present', async () => {
    await foldChatSummary(
      {
        priorSummary: 'Active threads: chase scene through London streets.',
        newTurns: [{ role: 'user', content: 'next' }],
      },
      fakeSelection,
      'user-1',
    )

    const [, llmMessages] = executeCheapLLMTask.mock.calls[0]
    const userMsg = (llmMessages as any[]).find(m => m.role === 'user')
    expect(userMsg.content).toContain('Active threads: chase scene through London streets.')
    expect(userMsg.content).not.toMatch(/this is the first fold/i)
  })

  it('passes the task name "fold-chat-summary" so logs are filterable', async () => {
    await foldChatSummary(
      { priorSummary: null, newTurns: [{ role: 'user', content: 'hi' }] },
      fakeSelection,
      'user-1',
      'chat-123',
    )

    const args = executeCheapLLMTask.mock.calls[0]
    expect(args[4]).toBe('fold-chat-summary')
    expect(args[5]).toBe('chat-123')
  })
})
