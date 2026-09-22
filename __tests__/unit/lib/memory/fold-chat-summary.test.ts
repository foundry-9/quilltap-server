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
      { priorSummary: null, newTurns: [{ speaker: 'Charlie', role: 'user', content: 'hi' }] },
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
      {
        priorSummary: null,
        newTurns: [
          { speaker: 'Charlie', role: 'user', content: 'hi' },
          { speaker: 'Friday', role: 'assistant', content: 'hello' },
        ],
      },
      fakeSelection,
      'user-1',
    )

    const [, llmMessages] = executeCheapLLMTask.mock.calls[0]
    const userMsg = (llmMessages as any[]).find(m => m.role === 'user')
    expect(userMsg.content).toContain('Prior summary')
    expect(userMsg.content).toMatch(/this is the first fold/i)
    expect(userMsg.content).toContain('Charlie: hi')
    expect(userMsg.content).toContain('Friday: hello')
    expect(userMsg.content).not.toContain('USER:')
    expect(userMsg.content).not.toContain('ASSISTANT:')
  })

  it('embeds the prior summary verbatim when present', async () => {
    await foldChatSummary(
      {
        priorSummary: 'Active threads: chase scene through London streets.',
        newTurns: [{ speaker: 'Charlie', role: 'user', content: 'next' }],
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
      { priorSummary: null, newTurns: [{ speaker: 'Charlie', role: 'user', content: 'hi' }] },
      fakeSelection,
      'user-1',
      'chat-123',
    )

    const args = executeCheapLLMTask.mock.calls[0]
    expect(args[4]).toBe('fold-chat-summary')
    expect(args[5]).toBe('chat-123')
  })

  it('renders an unresolvable seat by its role fallback label, not its role', async () => {
    await foldChatSummary(
      {
        priorSummary: null,
        newTurns: [
          { speaker: 'User', role: 'user', content: 'who is there' },
          { speaker: 'Character', role: 'assistant', content: 'nobody' },
        ],
      },
      fakeSelection,
      'user-1',
    )

    const [, llmMessages] = executeCheapLLMTask.mock.calls[0]
    const userMsg = (llmMessages as any[]).find(m => m.role === 'user')
    expect(userMsg.content).toContain('User: who is there')
    expect(userMsg.content).toContain('Character: nobody')
    expect(userMsg.content).not.toContain('USER:')
    expect(userMsg.content).not.toContain('ASSISTANT:')
  })

  it('tells the model to keep a role label rather than invent a name (bug 161)', async () => {
    await foldChatSummary(
      { priorSummary: null, newTurns: [{ speaker: 'Charlie', role: 'user', content: 'hi' }] },
      fakeSelection,
      'user-1',
    )

    const [, llmMessages] = executeCheapLLMTask.mock.calls[0]
    const systemMsg = (llmMessages as any[]).find(m => m.role === 'system')
    expect(systemMsg.content).toContain('Refer to each speaker by the name on their turns')
    expect(systemMsg.content).toMatch(/never invent a name for anyone/i)
    expect(systemMsg.content).not.toContain('Use character names, not roles.')
  })
})
