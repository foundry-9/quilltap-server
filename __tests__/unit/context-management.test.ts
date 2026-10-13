/**
 * Unit Tests for Context Management System
 * Sprint 5: Context Management
 */

import {
  estimateTokens,
  countMessageTokens,
  countMessagesTokens,
  formatTokenCount,
  truncateToTokenLimit,
} from '@/lib/tokens/token-counter'

import {
  getModelContextLimit,
  getSafeInputLimit,
  hasExtendedContext,
  getRecommendedContextAllocation,
  resolveContextWindow,
  computeSafeInputLimit,
  shouldSummarizeConversation,
  calculateRecentMessageCount,
} from '@/lib/llm/model-context-data'

import {
  calculateContextBudget,
  buildSystemPrompt,
  formatSummaryForContext,
  selectRecentMessages,
  willExceedContextLimit,
  filterMessagesByHistoryAccess,
  getParticipantName,
  attributeMessagesForCharacter,
  buildOtherParticipantsInfo,
  buildIdentityReinforcement,
  buildContext,
  type MessageWithParticipant,
} from '@/lib/chat/context-manager'
import { INFORM_BLOCK_HEADER } from '@/lib/chat/context/inform-block'
import { resetFrozenArchiveCacheForTests } from '@/lib/memory/recall/archive'
import type { ChatParticipantBase, Character, Memory } from '@/lib/schemas/types'
import { searchRecall } from '@/lib/memory/recall/search'
import { getRepositories } from '@/lib/repositories/factory'
import { buildCommonplaceLLMContext } from '@/lib/services/commonplace-notifications/writer'
import { collectUnalertedMail, markAlerted } from '@/lib/post-office/mailbox'
import { buildSuparnaMailLLMContext, postSuparnaMailWhisper } from '@/lib/services/suparna-notifications/writer'
import * as coreWhisper from '@/lib/services/aurora-notifications/core-whisper'
import * as coreWhisperTrigger from '@/lib/chat/context/core-whisper-trigger'
import * as progressionsSection from '@/lib/progressions/prompt-section'
import * as narrationAnchor from '@/lib/chat/context/user-narration-anchor'

// Pass-through by default; the bug-199 tests stand in a fixed recall text.
jest.mock('@/lib/services/commonplace-notifications/writer', () => {
  const actual = jest.requireActual('@/lib/services/commonplace-notifications/writer')
  return { ...actual, buildCommonplaceLLMContext: jest.fn(actual.buildCommonplaceLLMContext) }
})

// Recall's search stage stands still (each test says what it finds); the query
// stage embeds nothing, so the search would take the text strategy.
jest.mock('@/lib/memory/recall/search', () => ({
  searchRecall: jest.fn(),
}))
jest.mock('@/lib/embedding/embedding-service', () => ({
  ...jest.requireActual('@/lib/embedding/embedding-service'),
  generateEmbeddingForUser: jest.fn().mockRejectedValue(new Error('no embedding profile in these tests')),
}))

jest.mock('@/lib/post-office/mailbox', () => ({
  ...jest.requireActual('@/lib/post-office/mailbox'),
  collectUnalertedMail: jest.fn().mockResolvedValue([]),
  markAlerted: jest.fn().mockResolvedValue(undefined),
}))

jest.mock('@/lib/services/suparna-notifications/writer', () => ({
  ...jest.requireActual('@/lib/services/suparna-notifications/writer'),
  postSuparnaMailWhisper: jest.fn().mockResolvedValue(null),
}))

// Pass-through mocks: the real implementations run unless a test overrides
// them, so the whole-tail ordering test can make every section fire at once.
jest.mock('@/lib/services/aurora-notifications/core-whisper', () => {
  const actual = jest.requireActual('@/lib/services/aurora-notifications/core-whisper')
  return {
    ...actual,
    resolveCoreWhisperConfig: jest.fn(actual.resolveCoreWhisperConfig),
    assembleCorePacket: jest.fn(actual.assembleCorePacket),
    buildCoreWhisperLLMContext: jest.fn(actual.buildCoreWhisperLLMContext),
    buildCoreWhisperContent: jest.fn(actual.buildCoreWhisperContent),
    buildCoreWhisperOpaqueContent: jest.fn(actual.buildCoreWhisperOpaqueContent),
    postCoreWhisper: jest.fn(actual.postCoreWhisper),
  }
})
jest.mock('@/lib/chat/context/core-whisper-trigger', () => {
  const actual = jest.requireActual('@/lib/chat/context/core-whisper-trigger')
  return { ...actual, shouldFireCoreWhisper: jest.fn(actual.shouldFireCoreWhisper) }
})
jest.mock('@/lib/progressions/prompt-section', () => {
  const actual = jest.requireActual('@/lib/progressions/prompt-section')
  return { ...actual, buildProgressionsSection: jest.fn(actual.buildProgressionsSection) }
})
jest.mock('@/lib/chat/context/user-narration-anchor', () => {
  const actual = jest.requireActual('@/lib/chat/context/user-narration-anchor')
  return { ...actual, buildUserNarrationAnchor: jest.fn(actual.buildUserNarrationAnchor) }
})

const mockedSearchRecall = searchRecall as jest.MockedFunction<typeof searchRecall>
/** A search that found nothing. */
const noRecall = { candidates: [], strategy: 'text' as const, trace: [] }
const mockedCollectUnalertedMail = collectUnalertedMail as jest.MockedFunction<typeof collectUnalertedMail>
const mockedMarkAlerted = markAlerted as jest.MockedFunction<typeof markAlerted>
const mockedGetRepositories = getRepositories as jest.MockedFunction<typeof getRepositories>

beforeEach(() => {
  mockedSearchRecall.mockResolvedValue(noRecall)
})

afterEach(() => {
  mockedSearchRecall.mockReset()
  mockedSearchRecall.mockResolvedValue(noRecall)
  mockedGetRepositories.mockReset()
  mockedCollectUnalertedMail.mockReset()
  mockedCollectUnalertedMail.mockResolvedValue([])
  mockedMarkAlerted.mockReset()
  mockedMarkAlerted.mockResolvedValue(undefined)
})

describe('Token Counter', () => {
  describe('estimateTokens', () => {
    it('should return 0 for empty string', () => {
      expect(estimateTokens('')).toBe(0)
    })

    it('should estimate tokens for short text', () => {
      const tokens = estimateTokens('Hello, world!')
      expect(tokens).toBeGreaterThan(0)
      expect(tokens).toBeLessThan(20) // Should be small for short text
    })

    it('should estimate more tokens for longer text', () => {
      const shortTokens = estimateTokens('Hello')
      const longTokens = estimateTokens('Hello, this is a much longer text that should require more tokens to represent.')
      expect(longTokens).toBeGreaterThan(shortTokens)
    })

    it('should apply provider-specific estimation', () => {
      const text = 'This is a test message for token estimation.'
      const openaiTokens = estimateTokens(text, 'OPENAI')
      const googleTokens = estimateTokens(text, 'GOOGLE')
      // Google has slightly more efficient tokenizer (3.8 vs 3.5 chars/token)
      expect(googleTokens).toBeLessThanOrEqual(openaiTokens)
    })
  })

  describe('countMessageTokens', () => {
    it('should count tokens for a message with overhead', () => {
      const message = { role: 'user', content: 'Hello, how are you?' }
      const tokens = countMessageTokens(message)
      expect(tokens).toBeGreaterThan(0)
    })

    it('should include role in token count', () => {
      const shortRole = { role: 'user', content: 'Hello' }
      const longRole = { role: 'assistant', content: 'Hello' }
      // Assistant has more characters than user
      const shortTokens = countMessageTokens(shortRole)
      const longTokens = countMessageTokens(longRole)
      expect(longTokens).toBeGreaterThanOrEqual(shortTokens)
    })
  })

  describe('countMessagesTokens', () => {
    it('should return 0 for empty array', () => {
      expect(countMessagesTokens([])).toBe(0)
    })

    it('should count tokens for multiple messages', () => {
      const messages = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there!' },
      ]
      const tokens = countMessagesTokens(messages)
      expect(tokens).toBeGreaterThan(0)
    })

    it('should include conversation overhead', () => {
      const messages = [{ role: 'user', content: 'Hello' }]
      const singleTokens = countMessageTokens(messages[0])
      const totalTokens = countMessagesTokens(messages)
      // Total should include conversation overhead (3 tokens)
      expect(totalTokens).toBeGreaterThan(singleTokens)
    })
  })

  describe('formatTokenCount', () => {
    it('should format small numbers as-is', () => {
      expect(formatTokenCount(500)).toBe('500')
    })

    it('should format thousands with k suffix', () => {
      expect(formatTokenCount(1500)).toBe('1.5k')
    })

    it('should format millions with M suffix', () => {
      expect(formatTokenCount(1500000)).toBe('1.5M')
    })
  })

  describe('truncateToTokenLimit', () => {
    it('should return text unchanged if under limit', () => {
      const text = 'Short text'
      expect(truncateToTokenLimit(text, 1000)).toBe(text)
    })

    it('should truncate text exceeding limit', () => {
      const text = 'A'.repeat(10000) // Very long text
      const truncated = truncateToTokenLimit(text, 100)
      expect(truncated.length).toBeLessThan(text.length)
      expect(truncated.endsWith('...')).toBe(true)
    })

    it('should handle empty string', () => {
      expect(truncateToTokenLimit('', 100)).toBe('')
    })
  })

})

describe('Model Context Data', () => {
  describe('getModelContextLimit', () => {
    it('should return correct limit for Claude models', () => {
      expect(getModelContextLimit('ANTHROPIC', 'claude-sonnet-4-5-20250929')).toBe(200000)
    })

    it('should return correct limit for GPT-4o', () => {
      expect(getModelContextLimit('OPENAI', 'gpt-4o')).toBe(128000)
    })

    it('should return correct limit for Gemini', () => {
      expect(getModelContextLimit('GOOGLE', 'gemini-2.0-flash')).toBe(1000000)
    })

    it('should return default for unknown model', () => {
      const limit = getModelContextLimit('OPENAI', 'unknown-model')
      expect(limit).toBeGreaterThan(0)
    })
  })

  describe('getSafeInputLimit', () => {
    it('should return less than total limit', () => {
      const total = getModelContextLimit('ANTHROPIC', 'claude-sonnet-4-5-20250929')
      const safe = getSafeInputLimit('ANTHROPIC', 'claude-sonnet-4-5-20250929')
      expect(safe).toBeLessThan(total)
    })

    it('should respect custom response token reservation', () => {
      const safe1 = getSafeInputLimit('OPENAI', 'gpt-4o', 2000)
      const safe2 = getSafeInputLimit('OPENAI', 'gpt-4o', 8000)
      expect(safe2).toBeLessThan(safe1)
    })
  })

  describe('hasExtendedContext', () => {
    it('should return true for large context models', () => {
      expect(hasExtendedContext('ANTHROPIC', 'claude-sonnet-4-5-20250929')).toBe(true)
    })

    it('should return false for small context models', () => {
      expect(hasExtendedContext('OLLAMA', 'phi3:mini')).toBe(false)
    })
  })

  describe('getRecommendedContextAllocation', () => {
    it('should return allocations for large context model', () => {
      const allocation = getRecommendedContextAllocation('ANTHROPIC', 'claude-sonnet-4-5-20250929')
      expect(allocation.totalLimit).toBe(200000)
      expect(allocation.systemPrompt).toBeGreaterThan(0)
      expect(allocation.memories).toBeGreaterThan(0)
      expect(allocation.responseReserve).toBeGreaterThan(0)
    })

    it('should allocate less for smaller context models', () => {
      const largeAlloc = getRecommendedContextAllocation('ANTHROPIC', 'claude-sonnet-4-5-20250929')
      const smallAlloc = getRecommendedContextAllocation('OLLAMA', 'llama3.2:3b')
      expect(smallAlloc.memories).toBeLessThan(largeAlloc.memories)
    })

    it("should allocate from the profile's maxContext for an unrecognised model", () => {
      // An Ollama tag no table knows falls back to the 8192 provider default
      // without a profile. With one, the user's Max Context is authoritative.
      const model = 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL'
      expect(getRecommendedContextAllocation('OLLAMA', model).totalLimit).toBe(8192)
      expect(
        getRecommendedContextAllocation('OLLAMA', model, { maxContext: 65536 }).totalLimit
      ).toBe(65536)
    })
  })

  describe('computeSafeInputLimit', () => {
    it('holds back the response reserve and a 10% margin', () => {
      // 8192 − 2048 − ceil(819.2) = 5324, the figure the pre-send check has
      // always used; it is now the figure the builder packs to as well.
      expect(computeSafeInputLimit(8192, 2048)).toBe(5324)
    })

    it('floors at 1000 rather than going negative', () => {
      expect(computeSafeInputLimit(4096, 8192)).toBe(1000)
    })

    it('is the same limit the allocation exposes', () => {
      const allocation = getRecommendedContextAllocation('OLLAMA', 'llama3.2:3b')
      expect(allocation.safeInputLimit).toBe(
        computeSafeInputLimit(allocation.totalLimit, allocation.responseReserve)
      )
      expect(allocation.safetyMargin).toBe(Math.ceil(allocation.totalLimit * 0.10))
    })
  })

  describe('resolveContextWindow', () => {
    it('should prefer the profile maxContext over the table lookup', () => {
      expect(resolveContextWindow('OLLAMA', 'llama3.2:3b', { maxContext: 16384 })).toBe(16384)
    })

    it('should fall back to the table when maxContext is absent or degenerate', () => {
      expect(resolveContextWindow('OLLAMA', 'llama3.2:3b')).toBe(131072)
      expect(resolveContextWindow('OLLAMA', 'llama3.2:3b', null)).toBe(131072)
      expect(resolveContextWindow('OLLAMA', 'llama3.2:3b', { maxContext: null })).toBe(131072)
      expect(resolveContextWindow('OLLAMA', 'llama3.2:3b', { maxContext: 0 })).toBe(131072)
    })
  })

  describe('shouldSummarizeConversation', () => {
    it('should not recommend summary for short conversations', () => {
      expect(shouldSummarizeConversation(10, 5000, 200000)).toBe(false)
    })

    it('should recommend summary for long conversations', () => {
      expect(shouldSummarizeConversation(100, 150000, 200000)).toBe(true)
    })

    it('should recommend summary for many messages', () => {
      expect(shouldSummarizeConversation(60, 10000, 200000)).toBe(true)
    })
  })

  describe('calculateRecentMessageCount', () => {
    it('should calculate reasonable message count', () => {
      const count = calculateRecentMessageCount(10000, 150)
      expect(count).toBeGreaterThanOrEqual(4) // Minimum
      expect(count).toBeLessThanOrEqual(100) // Maximum
    })

    it('should return minimum for very small budget', () => {
      expect(calculateRecentMessageCount(100, 150)).toBe(4)
    })
  })
})

describe('Context Manager', () => {
  describe('calculateContextBudget', () => {
    it('should return valid budget for Claude', () => {
      const budget = calculateContextBudget('ANTHROPIC', 'claude-sonnet-4-5-20250929')
      expect(budget.totalLimit).toBe(200000)
      expect(budget.systemPromptBudget).toBeGreaterThan(0)
      expect(budget.memoryBudget).toBeGreaterThan(0)
      expect(budget.summaryBudget).toBeGreaterThan(0)
      expect(budget.recentMessagesBudget).toBeGreaterThan(0)
      expect(budget.responseReserve).toBeGreaterThan(0)
    })

    it('should budget against the profile window, not the provider default', () => {
      // Regression: the budget used to come from a model-name lookup only, so a
      // 64k Ollama profile on an unrecognised tag was budgeted as 8192 — and the
      // recent-message trimmer silently dropped history to fit it, while the
      // compression trigger (which does read the profile) saw the real window.
      const model = 'hf.co/unsloth/Qwen3.8-27B-GGUF:UD-Q4_K_XL'
      const budget = calculateContextBudget('OLLAMA', model, { maxContext: 65536 })

      expect(budget.totalLimit).toBe(65536)
      expect(budget.responseReserve).toBe(4096)
      expect(budget.totalLimit - budget.responseReserve).toBeGreaterThan(
        calculateContextBudget('OLLAMA', model).totalLimit
      )
    })

    it('exposes the one ceiling the builder and the validator share', () => {
      const budget = calculateContextBudget('OLLAMA', 'llama3.2:3b')

      expect(budget.safeInputLimit).toBe(
        budget.totalLimit - budget.responseReserve - budget.safetyMargin
      )
      // Strictly below the old builder-side ceiling: that gap is precisely what
      // used to be packed with history and then reported as an overage.
      expect(budget.safeInputLimit).toBeLessThan(budget.totalLimit - budget.responseReserve)
    })
  })

  describe('buildSystemPrompt', () => {
    const now = new Date().toISOString()
    const character = {
      id: 'test-char-id',
      userId: 'test-user-id',
      name: 'Test Character',
      systemPrompts: [{
        id: 'prompt-1',
        name: 'Default',
        content: 'You are a helpful assistant.',
        isDefault: true,
        createdAt: now,
        updatedAt: now,
      }],
      personality: 'Friendly and helpful',
      scenarios: [{ id: 'test-scenario-id', title: 'Default', content: 'A typical chat scenario', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }],
      exampleDialogues: 'User: Hello\nAssistant: Hi there!',
      createdAt: now,
      updatedAt: now,
    }

    it('should build prompt from character data', () => {
      const prompt = buildSystemPrompt({ character: character as any })
      expect(prompt).toContain('You are a helpful assistant')
      expect(prompt).toContain('Friendly and helpful')
    })

    it('does not inline persona/user-character info into the system prompt (moved to Host whisper in Phase C)', () => {
      const persona = { name: 'John', description: 'A curious user' }
      const prompt = buildSystemPrompt({ character: character as any, userCharacter: persona })
      expect(prompt).not.toContain('John')
      expect(prompt).not.toContain('curious user')
    })

    it('processes template variables across roleplay and persona sections', () => {
      const persona = { name: 'Alex', description: 'A curious tester' }
      const roleplayTemplate = { systemPrompt: 'Stay in {{char}} mindset when talking to {{user}}.' }
      const toolInstructions = 'Tools should mention {{char}} assisting {{user}}.'
      const prompt = buildSystemPrompt({
        character: {
          ...character,
          personality: '{{char}} is thoughtful',
          scenarios: [{ id: 'test-scenario-id', title: 'Default', content: '{{char}} meets {{user}} under the stars', createdAt: '2024-01-01T00:00:00.000Z', updatedAt: '2024-01-01T00:00:00.000Z' }],
          exampleDialogues: '{{char}}: Hello {{user}}',
        } as any,
        userCharacter: persona,
        roleplayTemplate,
        toolInstructions,
      })

      expect(prompt).toContain('Stay in Test Character mindset when talking to Alex.')
      expect(prompt).toContain('Test Character is thoughtful')
      expect(prompt).toContain('Tools should mention Test Character assisting Alex.')
      // Phase C: scenario text is no longer inlined into the system prompt — it
      // ships as a Host whisper now — so 'meets Alex under the stars' will not
      // appear here.
      expect(prompt).not.toContain('meets Alex under the stars')
      expect(prompt).not.toContain('{{char}}')
      expect(prompt).not.toContain('{{user}}')
    })

    it('uses the selected system prompt when provided and processes templates', () => {
      const persona = { name: 'Jordan', description: 'An analyst' }
      const multiPromptCharacter = {
        ...character,
        systemPrompts: [
          {
            id: 'prompt-default',
            name: 'Default',
            content: 'Default prompt for {{char}}',
            isDefault: true,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: 'prompt-alt',
            name: 'Battle Plan',
            content: '{{char}} must protect {{user}} at all costs.',
            isDefault: false,
            createdAt: now,
            updatedAt: now,
          },
        ],
      }

      const prompt = buildSystemPrompt({
        character: multiPromptCharacter as any,
        userCharacter: persona,
        roleplayTemplate: null,
        selectedSystemPromptId: 'prompt-alt',
      })

      expect(prompt).toContain('Test Character must protect Jordan at all costs.')
      expect(prompt).not.toContain('Default prompt')
    })

    it('uses precompiledIdentityStack verbatim and skips the rebuild', () => {
      const prompt = buildSystemPrompt({
        character: character as any,
        precompiledIdentityStack: '## Frozen Identity\nThis is a precompiled stack.',
      })
      expect(prompt).toContain('## Frozen Identity')
      expect(prompt).toContain('This is a precompiled stack.')
      // The character's actual prompt content should NOT be rebuilt when a
      // precompiled stack is supplied.
      expect(prompt).not.toContain('You are a helpful assistant')
      expect(prompt).not.toContain('Friendly and helpful')
    })

    it('falls back to a fresh build when precompiledIdentityStack is empty', () => {
      const prompt = buildSystemPrompt({
        character: character as any,
        precompiledIdentityStack: '',
      })
      // Empty cache → rebuild. The character's prompt content is restored.
      expect(prompt).toContain('You are a helpful assistant')
      expect(prompt).toContain('Friendly and helpful')
    })

    it('appends roleplay template, tool instructions, and tool reinforcement after the identity stack', () => {
      const prompt = buildSystemPrompt({
        character: character as any,
        precompiledIdentityStack: '## Frozen Identity\nstatic.',
        roleplayTemplate: { systemPrompt: 'Format: bullet points.' },
        toolInstructions: 'Tools available: foo, bar.',
      })
      const idx = prompt.indexOf('## Frozen Identity')
      const rpIdx = prompt.indexOf('Format: bullet points.')
      const toolIdx = prompt.indexOf('Tools available: foo, bar.')
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(rpIdx).toBeGreaterThan(idx)
      expect(toolIdx).toBeGreaterThan(rpIdx)
      // Tool reinforcement addresses the character directly — no pronoun lookup,
      // so no "they CALLS them" disagreement on the no-pronouns default path.
      expect(prompt).toContain('When you use workspace tools, you CALL them')
      expect(prompt).not.toContain('CALLS them')
    })
  })

  describe('formatSummaryForContext', () => {
    it('should format summary with header', () => {
      const summary = 'This is a conversation summary.'
      const { content } = formatSummaryForContext(summary, 1000, 'OPENAI')
      expect(content).toContain('## Previous Conversation Summary')
      expect(content).toContain(summary)
    })

    it('should return empty for empty summary', () => {
      const { content } = formatSummaryForContext('', 1000, 'OPENAI')
      expect(content).toBe('')
    })

    it('should truncate long summaries', () => {
      const longSummary = 'A'.repeat(10000)
      const { tokenCount } = formatSummaryForContext(longSummary, 100, 'OPENAI')
      expect(tokenCount).toBeLessThanOrEqual(100)
    })

    it('should truncate oversized summaries so content is shorter than the input — regression for dynamic-require bug', () => {
      // Before fix(chat) ea152d27, formatSummaryForContext called
      //   const { truncateToTokenLimit } = require('@/lib/tokens/token-counter')
      // which silently returned undefined in the Next.js webpack ESM bundle,
      // causing a TypeError mid-turn on any chat with accumulated summary text.
      // This test exercises the truncation path and verifies that content is
      // actually shortened, confirming truncateToTokenLimit is reachable.
      const longSummary = 'word '.repeat(3000).trim() // ~3000 tokens
      const { content, tokenCount } = formatSummaryForContext(longSummary, 200, 'OPENAI')
      // The result must be shorter than the input
      expect(content.length).toBeLessThan(longSummary.length)
      // Token count must respect the budget
      expect(tokenCount).toBeLessThanOrEqual(200)
      // The header must still be present
      expect(content).toContain('## Previous Conversation Summary')
    })
  })

  describe('selectRecentMessages', () => {
    const messages = [
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
      { role: 'user', content: 'How are you?' },
      { role: 'assistant', content: 'I am doing well, thank you for asking!' },
    ]

    it('should select all messages when under limit', () => {
      const { messages: selected, truncated } = selectRecentMessages(messages, 10000, 'OPENAI')
      expect(selected.length).toBe(messages.length)
      expect(truncated).toBe(false)
    })

    it('should select recent messages when over limit', () => {
      const { messages: selected, truncated } = selectRecentMessages(messages, 30, 'OPENAI')
      expect(selected.length).toBeLessThan(messages.length)
      expect(truncated).toBe(true)
    })

    it('should always include at least one message', () => {
      const { messages: selected } = selectRecentMessages(messages, 1, 'OPENAI')
      expect(selected.length).toBeGreaterThanOrEqual(1)
    })

    it('should return empty for empty input', () => {
      const { messages: selected, truncated } = selectRecentMessages([], 1000, 'OPENAI')
      expect(selected.length).toBe(0)
      expect(truncated).toBe(false)
    })
  })

  describe('willExceedContextLimit', () => {
    it('should detect when context will exceed', () => {
      const messages = Array(100).fill({ content: 'A'.repeat(1000) })
      const result = willExceedContextLimit(messages, 'Hello', 'OLLAMA', 'phi3:mini')
      expect(result.willExceed).toBe(true)
    })

    it('should return false for small context', () => {
      const messages = [{ content: 'Hello' }]
      const result = willExceedContextLimit(messages, 'Hi', 'ANTHROPIC', 'claude-sonnet-4-5-20250929')
      expect(result.willExceed).toBe(false)
    })

    it('should calculate percentage used', () => {
      const messages = [{ content: 'Hello' }]
      const result = willExceedContextLimit(messages, 'Hi', 'OPENAI', 'gpt-4o')
      expect(result.percentUsed).toBeGreaterThan(0)
      expect(result.percentUsed).toBeLessThan(100)
    })
  })

  describe('filterMessagesByHistoryAccess', () => {
    const participant: ChatParticipantBase = {
      id: 'char-1',
      type: 'CHARACTER',
      characterId: 'char-1',
      connectionProfileId: null,
      imageProfileId: null,

      displayOrder: 0,
      isActive: true,
      hasHistoryAccess: false,
      joinScenario: null,
      createdAt: '2024-01-05T00:00:00.000Z',
      updatedAt: '2024-01-05T00:00:00.000Z',
    }

    const messages: MessageWithParticipant[] = [
      { role: 'USER', content: 'Earlier', participantId: 'user-1', createdAt: '2024-01-01T00:00:00.000Z' },
      { role: 'ASSISTANT', content: 'Welcome!', participantId: 'char-1', createdAt: '2024-01-06T00:00:00.000Z' },
    ]

    it('returns all messages when participant has history access', () => {
      const withAccess = { ...participant, hasHistoryAccess: true }
      const result = filterMessagesByHistoryAccess(messages, withAccess)
      expect(result).toHaveLength(2)
    })

    it('filters out messages that happened before the participant joined', () => {
      const result = filterMessagesByHistoryAccess(messages, participant)
      expect(result).toEqual([messages[1]])
    })
  })

  describe('participant attribution helpers', () => {
    const createdAt = new Date().toISOString()
    const charParticipant: ChatParticipantBase = {
      id: 'p-char',
      type: 'CHARACTER',
      characterId: 'char-1',
      controlledBy: 'llm',
      connectionProfileId: null,
      imageProfileId: null,

      displayOrder: 0,
      isActive: true,
      hasHistoryAccess: true,
      joinScenario: null,
      createdAt,
      updatedAt: createdAt,
    }
    const otherCharParticipant: ChatParticipantBase = { ...charParticipant, id: 'p-char-2', characterId: 'char-2' }
    const userCharParticipant: ChatParticipantBase = {
      id: 'p-user',
      type: 'CHARACTER',
      characterId: 'char-user',
      controlledBy: 'user',
      connectionProfileId: null,
      imageProfileId: null,

      displayOrder: 0,
      isActive: true,
      hasHistoryAccess: true,
      joinScenario: null,
      createdAt,
      updatedAt: createdAt,
    }

    const characterMap = new Map<string, Character>([
      ['char-1', {
        id: 'char-1',
        userId: 'user',
        name: 'Lyra',
        title: 'Navigator',
        description: null,
        personality: null,
        scenarios: [],
        firstMessage: null,
        exampleDialogues: null,
        systemPrompts: [],
        avatarUrl: null,
        defaultImageId: null,
        defaultConnectionProfileId: null,
        sillyTavernData: null,
        isFavorite: false,
        talkativeness: 0.5,
        partnerLinks: [],
        tags: [],
        avatarOverrides: [],
        physicalDescriptions: [],
        createdAt,
        updatedAt: createdAt,
      }],
      ['char-2', {
        id: 'char-2',
        userId: 'user',
        name: 'Iris',
        title: null,
        description: 'Strategist',
        personality: null,
        scenarios: [],
        firstMessage: null,
        exampleDialogues: null,
        systemPrompts: [],
        avatarUrl: null,
        defaultImageId: null,
        defaultConnectionProfileId: null,
        sillyTavernData: null,
        isFavorite: false,
        talkativeness: 0.5,
        partnerLinks: [],
        tags: [],
        avatarOverrides: [],
        physicalDescriptions: [],
        createdAt,
        updatedAt: createdAt,
      }],
      ['char-user', {
        id: 'char-user',
        userId: 'user',
        name: 'Alex',
        title: null,
        description: 'Curious human',
        personality: null,
        scenarios: [],
        firstMessage: null,
        exampleDialogues: null,
        systemPrompts: [],
        avatarUrl: null,
        defaultImageId: null,
        defaultConnectionProfileId: null,
        sillyTavernData: null,
        isFavorite: false,
        talkativeness: 0.5,
        partnerLinks: [],
        tags: [],
        avatarOverrides: [],
        physicalDescriptions: [],
        createdAt,
        updatedAt: createdAt,
      }],
    ])

    const allParticipants = [charParticipant, otherCharParticipant, userCharParticipant]

    it('returns friendly names for all character participants', () => {
      expect(getParticipantName('p-char', characterMap, allParticipants)).toBe('Lyra')
      expect(getParticipantName('p-user', characterMap, allParticipants)).toBe('Alex')
      expect(getParticipantName('missing', characterMap, allParticipants)).toBeUndefined()
    })

    it('attributes messages to the responding character perspective', () => {
      const messages: MessageWithParticipant[] = [
        { role: 'USER', content: 'Hello', participantId: 'p-user' },
        { role: 'ASSISTANT', content: 'Hi there', participantId: 'p-char-2' },
        { role: 'ASSISTANT', content: 'My turn', participantId: 'p-char' },
      ]

      const attributed = attributeMessagesForCharacter(messages, 'p-char', characterMap, allParticipants)
      expect(attributed[0]).toMatchObject({ role: 'user', name: 'Alex' })
      expect(attributed[1]).toMatchObject({ role: 'user', name: 'Iris' })
      expect(attributed[2]).toMatchObject({ role: 'assistant', name: 'Lyra' })
    })

    it('describes other participants for the system prompt', () => {
      const info = buildOtherParticipantsInfo('p-char', allParticipants, characterMap)
      expect(info).toEqual([
        expect.objectContaining({ name: 'Iris', type: 'CHARACTER' }),
        expect.objectContaining({ name: 'Alex', type: 'CHARACTER' }),
      ])
    })
  })

  describe('buildContext multi-character integration', () => {
    const timestamp = new Date().toISOString()
    const participantA: ChatParticipantBase = {
      id: 'participant-a',
      type: 'CHARACTER',
      characterId: 'char-a',
      controlledBy: 'llm',
      connectionProfileId: null,
      imageProfileId: null,

      displayOrder: 0,
      isActive: true,
      hasHistoryAccess: true,
      joinScenario: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const participantB: ChatParticipantBase = { ...participantA, id: 'participant-b', characterId: 'char-b' }
    const userParticipant: ChatParticipantBase = {
      id: 'participant-user',
      type: 'CHARACTER',
      characterId: 'char-user',
      controlledBy: 'user',
      connectionProfileId: null,
      imageProfileId: null,

      displayOrder: 0,
      isActive: true,
      hasHistoryAccess: true,
      joinScenario: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const characterA: Character = {
      id: 'char-a',
      userId: 'user',
      name: 'Lyra',
      title: null,
      description: null,
      personality: null,
      scenario: null,
      firstMessage: null,
      exampleDialogues: null,
      systemPrompts: [{
        id: 'prompt-a',
        name: 'Default',
        content: 'Stay focused',
        isDefault: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
      avatarUrl: null,
      defaultImageId: null,
      defaultConnectionProfileId: null,
      sillyTavernData: null,
      isFavorite: false,
      talkativeness: 0.6,
      partnerLinks: [],
      tags: [],
      avatarOverrides: [],
      physicalDescriptions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    const characterB: Character = { ...characterA, id: 'char-b', name: 'Iris', talkativeness: 0.4 }
    const characterUser: Character = {
      id: 'char-user',
      userId: 'user',
      name: 'Alex',
      title: null,
      description: 'Curious',
      personality: null,
      scenario: null,
      firstMessage: null,
      exampleDialogues: null,
      systemPrompts: [],
      avatarUrl: null,
      defaultImageId: null,
      defaultConnectionProfileId: null,
      sillyTavernData: null,
      isFavorite: false,
      talkativeness: 0.5,
      partnerLinks: [],
      tags: [],
      avatarOverrides: [],
      physicalDescriptions: [],
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    const participantCharacters = new Map<string, Character>([
      ['char-a', characterA],
      ['char-b', characterB],
      ['char-user', characterUser],
    ])
    const allParticipants = [participantA, participantB, userParticipant]

    const memory: Memory = {
      id: 'mem-1',
      characterId: 'char-a',
      aboutCharacterId: 'char-b',
      chatId: 'chat-1',
      content: 'Detailed history',
      summary: 'Lyra respects Iris',
      keywords: [],
      tags: [],
      importance: 0.8,
      embedding: null,
      source: 'MANUAL',
      sourceMessageId: null,
      lastAccessedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }

    it('retrieves inter-character memories and injects them into context', async () => {
      const repoMock = {
        memories: {
          findByCharacterAboutCharacters: jest.fn().mockResolvedValue([memory]),
          findHotDigests: jest.fn().mockResolvedValue([]),
        },
        // buildContext always asks for this seat's pending informs; an empty
        // answer is what "no inform block this turn" looks like.
        chatInforms: {
          findPendingForParticipant: jest.fn().mockResolvedValue([]),
          findConsumedByMessages: jest.fn().mockResolvedValue([]),
        },
      }
      mockedGetRepositories.mockReturnValue(repoMock as any)
      mockedSearchRecall.mockResolvedValue(noRecall)

      const messagesWithParticipants: MessageWithParticipant[] = [
        { role: 'USER', content: 'Hello', participantId: 'participant-user', createdAt: timestamp },
        { role: 'ASSISTANT', content: 'Greetings', participantId: 'participant-b', createdAt: timestamp },
      ]

      const result = await buildContext({
        provider: 'OPENAI',
        modelName: 'gpt-4o',
        userId: 'user',
        character: characterA,
        userCharacter: { name: 'Alex', description: 'Curious' },
        chat: {
          id: 'chat-1',
          userId: 'user',
          participants: allParticipants,
          title: 'Test Chat',
          contextSummary: null,
          sillyTavernMetadata: null,
          tags: [],
          messageCount: 2,
          lastMessageAt: timestamp,
          lastRenameCheckInterchange: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        existingMessages: [
          { role: 'USER', content: 'Hello', id: 'm1' },
          { role: 'ASSISTANT', content: 'Greetings', id: 'm2' },
        ],
        newUserMessage: 'Ready for the next task?',
  
        embeddingProfileId: null,
        skipMemories: false,
        maxMemories: 1,
        minMemoryImportance: 0.3,
        respondingParticipant: participantA,
        allParticipants,
        participantCharacters,
        messagesWithParticipants,
      })

      expect(repoMock.memories.findByCharacterAboutCharacters).toHaveBeenCalledWith(
        'char-a',
        expect.arrayContaining(['char-b', 'char-user']),
        expect.any(Number),
      )
      // Phase B: inter-character memories now ride inline on the new user
      // message body (plain "you also recall about the others present" framing
      // for the LLM) rather than concatenated onto the system prompt. The
      // Commonplace Book persona-voiced version is persisted separately.
      const userMsg = result.messages[result.messages.length - 1]
      expect(userMsg.role).toBe('user')
      expect(userMsg.content).toContain('You also recall about the others present')
      expect(userMsg.content).toContain('## Memories About Other Characters')
    })

    it('does not repeat an archive digest in the inter-character section (bug 224)', async () => {
      resetFrozenArchiveCacheForTests()
      const digest: Memory = {
        ...memory,
        id: 'digest-b',
        content: 'Lyra and Iris crossed the Shivering Bridge together',
        summary: 'Lyra and Iris crossed the Shivering Bridge together',
        importance: 0.9,
        source: 'CONSOLIDATED' as Memory['source'],
      }
      const partitionOnly: Memory = {
        ...memory,
        id: 'mem-partition',
        content: 'Iris hums when she is nervous',
        summary: 'Iris hums when she is nervous',
      }
      const repoMock = {
        memories: {
          findByCharacterAboutCharacters: jest.fn().mockResolvedValue([digest, partitionOnly]),
          findHotDigests: jest.fn().mockImplementation(async (_holder: string, about: string) =>
            about === 'char-b' ? [digest] : [],
          ),
          findMostImportant: jest.fn().mockResolvedValue([]),
        },
        characters: {
          findNamesByIds: jest.fn().mockResolvedValue(new Map([['char-b', 'Iris'], ['char-a', 'Lyra']])),
        },
        chatInforms: {
          findPendingForParticipant: jest.fn().mockResolvedValue([]),
          findConsumedByMessages: jest.fn().mockResolvedValue([]),
        },
      }
      mockedGetRepositories.mockReturnValue(repoMock as any)
      mockedSearchRecall.mockResolvedValue(noRecall)

      const result = await buildContext({
        provider: 'OPENAI',
        modelName: 'gpt-4o',
        userId: 'user',
        character: characterA,
        userCharacter: { name: 'Alex', description: 'Curious' },
        chat: {
          id: 'chat-224',
          userId: 'user',
          participants: allParticipants,
          title: 'Test Chat',
          contextSummary: null,
          sillyTavernMetadata: null,
          tags: [],
          messageCount: 2,
          lastMessageAt: timestamp,
          lastRenameCheckInterchange: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        existingMessages: [
          { role: 'USER', content: 'Hello', id: 'm1' },
          { role: 'ASSISTANT', content: 'Greetings', id: 'm2' },
        ],
        newUserMessage: 'Ready for the next task?',
        embeddingProfileId: null,
        skipMemories: false,
        maxMemories: 1,
        minMemoryImportance: 0.3,
        respondingParticipant: participantA,
        allParticipants,
        participantCharacters,
        messagesWithParticipants: [
          { role: 'USER', content: 'Hello', participantId: 'participant-user', createdAt: timestamp },
          { role: 'ASSISTANT', content: 'Greetings', participantId: 'participant-b', createdAt: timestamp },
        ],
      })

      const everything = result.messages
        .map(m => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
        .join('\n')
      // The digest is in the archive, so it appears exactly once.
      expect(everything.split('Shivering Bridge').length - 1).toBe(1)
      // The inter-character section still carries what the archive does not.
      expect(everything).toContain('You also recall about the others present')
      expect(everything).toContain('Iris hums when she is nervous')
    })

    // Anti-committee §9: the chained-turn scene note. A chained turn carries no
    // new user message, so the human's narration sits mid-history; the note
    // rides first in the trailing user message and is absent otherwise.
    describe('user narration anchor (chained turns)', () => {
      const chainedRepos = () => ({
        memories: { findByCharacterAboutCharacters: jest.fn().mockResolvedValue([]) },
        chatInforms: {
          findPendingForParticipant: jest.fn().mockResolvedValue([]),
          findConsumedByMessages: jest.fn().mockResolvedValue([]),
        },
      })
      const chat = {
        id: 'chat-1',
        userId: 'user',
        participants: allParticipants,
        title: 'Test Chat',
        contextSummary: null,
        sillyTavernMetadata: null,
        tags: [],
        messageCount: 2,
        lastMessageAt: timestamp,
        lastRenameCheckInterchange: 0,
        createdAt: timestamp,
        updatedAt: timestamp,
      }
      const history: MessageWithParticipant[] = [
        { role: 'USER', content: '((The engine stalls.))', id: 'u1', participantId: 'participant-user', createdAt: timestamp },
        { role: 'ASSISTANT', content: 'The engine is running fine.', id: 'a1', participantId: 'participant-b', createdAt: timestamp },
      ]
      const run = (overrides: Record<string, unknown>) =>
        buildContext({
          provider: 'OPENAI',
          modelName: 'gpt-4o',
          userId: 'user',
          character: characterA,
          userCharacter: { name: 'Alex', description: 'Curious' },
          chat,
          existingMessages: history.map(m => ({ role: m.role, content: m.content, id: m.id })),
          embeddingProfileId: null,
          skipMemories: true,
          respondingParticipant: participantA,
          allParticipants,
          participantCharacters,
          messagesWithParticipants: history,
          ...overrides,
        } as any)

      it('pushes the scene note as the trailing message on a chained turn', async () => {
        mockedGetRepositories.mockReturnValue(chainedRepos() as any)
        const result = await run({ humanTurnMessageIds: new Set(['u1']) })
        const tail = result.messages[result.messages.length - 1]
        expect(tail.role).toBe('user')
        expect(tail.content.startsWith("Scene note: Alex's most recent message is the current state of the scene.")).toBe(true)
      })

      it('leads the trailing message, ahead of the turn-skip note', async () => {
        mockedGetRepositories.mockReturnValue(chainedRepos() as any)
        const result = await run({
          humanTurnMessageIds: new Set(['u1']),
          turnSkip: { offerSkip: true, recentlyAddressed: false, characterName: 'Lyra' },
        })
        const tail = result.messages[result.messages.length - 1].content
        expect(tail.startsWith('Scene note:')).toBe(true)
        expect(tail).toContain('\n\n---\n\n')
        expect(tail.indexOf('Scene note:')).toBeLessThan(tail.indexOf('[NOTHING TO ADD]'))
      })

      it('is byte-identical to no anchor when the human has not spoken', async () => {
        mockedGetRepositories.mockReturnValue(chainedRepos() as any)
        const withIds = await run({ humanTurnMessageIds: new Set(['not-in-window']) })
        mockedGetRepositories.mockReturnValue(chainedRepos() as any)
        const without = await run({})
        expect(withIds.messages).toEqual(without.messages)
        expect(without.messages.some(m => typeof m.content === 'string' && m.content.includes('Scene note:'))).toBe(false)
      })

      it('never fires on the first responder, who has the new user message', async () => {
        mockedGetRepositories.mockReturnValue(chainedRepos() as any)
        const withIds = await run({ humanTurnMessageIds: new Set(['u1']), newUserMessage: 'Onward.' })
        mockedGetRepositories.mockReturnValue(chainedRepos() as any)
        const without = await run({ newUserMessage: 'Onward.' })
        expect(withIds.messages).toEqual(without.messages)
      })
    })

    it('ignores summary/system messages when scanning off-scene mentions', async () => {
      const offSceneCharacter: Character = {
        ...characterA,
        id: 'char-c',
        name: 'Morgan',
      }
      const repoMock = {
        chatInforms: {
          findPendingForParticipant: jest.fn().mockResolvedValue([]),
          findConsumedByMessages: jest.fn().mockResolvedValue([]),
        },
        characters: {
          findByUserId: jest.fn().mockResolvedValue([characterA, characterB, characterUser, offSceneCharacter]),
        },
        chats: {
          getMessages: jest.fn().mockResolvedValue([
            {
              type: 'message',
              role: 'ASSISTANT',
              systemSender: 'commonplaceBook',
              content: 'Morgan should help here.',
              createdAt: timestamp,
            },
            {
              type: 'message',
              role: 'USER',
              content: 'Let us keep going.',
              createdAt: timestamp,
            },
          ]),
          addMessage: jest.fn(),
        },
        memories: {
          findByCharacterAboutCharacters: jest.fn().mockResolvedValue([]),
          findHotDigests: jest.fn().mockResolvedValue([]),
        },
      }
      mockedGetRepositories.mockReturnValue(repoMock as any)
      mockedSearchRecall.mockResolvedValue(noRecall)

      const result = await buildContext({
        provider: 'OPENAI',
        modelName: 'gpt-4o',
        userId: 'user',
        character: characterA,
        userCharacter: { name: 'Alex', description: 'Curious' },
        chat: {
          id: 'chat-1',
          userId: 'user',
          participants: allParticipants,
          title: 'Test Chat',
          contextSummary: 'Morgan was discussed in summary text only.',
          sillyTavernMetadata: null,
          tags: [],
          messageCount: 2,
          lastMessageAt: timestamp,
          lastRenameCheckInterchange: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        },
        existingMessages: [
          { role: 'USER', content: 'Hello', id: 'm1' },
          { role: 'ASSISTANT', content: 'Greetings', id: 'm2' },
        ],
        newUserMessage: 'Ready for the next task?',
        embeddingProfileId: null,
        skipMemories: true,
        maxMemories: 1,
        minMemoryImportance: 0.3,
        respondingParticipant: participantA,
        allParticipants,
        participantCharacters,
        messagesWithParticipants: [
          { role: 'USER', content: 'Hello', participantId: 'participant-user', createdAt: timestamp },
          { role: 'ASSISTANT', content: 'Greetings', participantId: 'participant-b', createdAt: timestamp },
        ],
      })

      expect(repoMock.chats.getMessages).toHaveBeenCalledTimes(1)
      expect(repoMock.chats.addMessage).not.toHaveBeenCalled()
      expect(result.messages.some(m => m.role === 'assistant' && m.content.includes('Off-Scene Character Mentioned'))).toBe(false)
    })

    // Bug 172: the unseated persona (the system-wide sole user-controlled
    // character, which `{{user}}` resolves to) is the voice of USER messages in
    // a Salon chat, so it is never "off scene" there. In an autonomous room
    // nobody types as them, and the cast addressing them must get the Host's
    // not-present introduction like anyone else.
    describe('unseated persona (bug 172)', () => {
      const persona: Character = { ...characterUser, id: 'char-charlie', name: 'Charlie' }
      const seatedWithoutPersona = [participantA, participantB]

      const buildReposFor = () => ({
        chatInforms: {
          findPendingForParticipant: jest.fn().mockResolvedValue([]),
          findConsumedByMessages: jest.fn().mockResolvedValue([]),
        },
        characters: {
          findByUserId: jest.fn().mockResolvedValue([characterA, characterB, persona]),
          findById: jest.fn().mockResolvedValue(null),
        },
        chats: {
          findById: jest.fn().mockResolvedValue({ id: 'chat-1', participants: seatedWithoutPersona }),
          getMessages: jest.fn().mockResolvedValue([
            {
              type: 'message',
              role: 'ASSISTANT',
              participantId: 'participant-b',
              content: 'Charlie, you have not answered anything for an hour.',
              createdAt: timestamp,
            },
          ]),
          addMessage: jest.fn(),
        },
        memories: {
          findByCharacterAboutCharacters: jest.fn().mockResolvedValue([]),
          findHotDigests: jest.fn().mockResolvedValue([]),
        },
      })

      const runFor = (chatType: 'salon' | 'autonomous') =>
        buildContext({
          provider: 'OPENAI',
          modelName: 'gpt-4o',
          userId: 'user',
          character: characterA,
          userCharacter: { name: 'Charlie', description: 'The proprietor' },
          chat: {
            id: 'chat-1',
            userId: 'user',
            chatType,
            participants: seatedWithoutPersona,
            title: 'Test Chat',
            contextSummary: null,
            sillyTavernMetadata: null,
            tags: [],
            messageCount: 1,
            lastMessageAt: timestamp,
            lastRenameCheckInterchange: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          } as any,
          existingMessages: [
            { role: 'ASSISTANT', content: 'Charlie, you have not answered anything for an hour.', id: 'm1' },
          ],
          embeddingProfileId: null,
          skipMemories: true,
          maxMemories: 1,
          minMemoryImportance: 0.3,
          respondingParticipant: participantA,
          allParticipants: seatedWithoutPersona,
          participantCharacters,
          messagesWithParticipants: [
            { role: 'ASSISTANT', content: 'Charlie, you have not answered anything for an hour.', participantId: 'participant-b', createdAt: timestamp },
          ],
        })

      it('introduces the persona as off scene in an autonomous room', async () => {
        const repoMock = buildReposFor()
        mockedGetRepositories.mockReturnValue(repoMock as any)

        await runFor('autonomous')

        expect(repoMock.chats.addMessage).toHaveBeenCalledTimes(1)
        const [, posted] = repoMock.chats.addMessage.mock.calls[0]
        expect(posted.systemKind).toBe('off-scene-characters')
        expect(posted.hostEvent).toEqual({ introducedCharacterIds: ['char-charlie'] })
        expect(posted.content).toContain('### Charlie')
      })

      it('still treats the persona as present in a Salon chat', async () => {
        const repoMock = buildReposFor()
        mockedGetRepositories.mockReturnValue(repoMock as any)

        await runFor('salon')

        expect(repoMock.chats.addMessage).not.toHaveBeenCalled()
      })
    })

    // ------------------------------------------------------------------
    // The inform block — the one sanctioned turn-variable system block.
    // ------------------------------------------------------------------

    const buildWithInforms = async (pendingRows: unknown[], newUserMessage: string | null = 'Ready for the next task?', character: Character = characterA) => {
      mockedGetRepositories.mockReturnValue({
        memories: { findByCharacterAboutCharacters: jest.fn().mockResolvedValue([]) },
        chatInforms: {
          findPendingForParticipant: jest.fn().mockResolvedValue(pendingRows),
          findConsumedByMessages: jest.fn().mockResolvedValue([]),
        },
      } as any)
      mockedSearchRecall.mockResolvedValue(noRecall)

      return buildContext({
        provider: 'OPENAI',
        modelName: 'gpt-4o',
        userId: 'user',
        character,
        userCharacter: { name: 'Alex', description: 'Curious' },
        chat: {
          id: 'chat-1',
          userId: 'user',
          participants: allParticipants,
          title: 'Test Chat',
          contextSummary: null,
          sillyTavernMetadata: null,
          tags: [],
          messageCount: 2,
          lastMessageAt: timestamp,
          lastRenameCheckInterchange: 0,
          createdAt: timestamp,
          updatedAt: timestamp,
        } as any,
        existingMessages: [
          { role: 'USER', content: 'Hello', id: 'm1' },
          { role: 'ASSISTANT', content: 'Greetings', id: 'm2' },
        ],
        newUserMessage: newUserMessage ?? undefined,
        skipMemories: true,
        respondingParticipant: participantA,
        allParticipants,
        participantCharacters,
        messagesWithParticipants: [
          { role: 'USER', content: 'Hello', participantId: 'participant-user', createdAt: timestamp },
          { role: 'ASSISTANT', content: 'Greetings', participantId: 'participant-b', createdAt: timestamp },
        ],
      } as any)
    }

    const informRow = (id: string, contentMarkdown: string) => ({
      id,
      chatId: 'chat-1',
      batchId: `batch-${id}`,
      participantId: 'participant-a',
      contentMarkdown,
      recordMessageId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      consumedAt: null,
      consumedByMessageId: null,
    })

    it('adds nothing at all when the seat is owed no inform', async () => {
      const result = await buildWithInforms([])

      // Empty-is-absent: with nothing pending the builder must add NOTHING —
      // no empty section, no stray rule. This is what keeps an ordinary turn
      // byte-identical to one assembled before Inform existed.
      expect(result.informRowIds).toEqual([])
      const systemBlocks = result.messages.filter(m => m.role === 'system')
      expect(systemBlocks).toHaveLength(2)
      expect(systemBlocks[1].content).toContain('## Identity Reminder')
      expect(result.messages[result.messages.length - 1].content).toBe('Ready for the next task?')
    })

    it('rides the new user message as a trailing section, under its header', async () => {
      const withoutInform = await buildWithInforms([])
      const withInform = await buildWithInforms([
        informRow('row-1', 'You notice the clock has stopped.'),
      ])

      // The system prefix — the cacheable region — is untouched.
      expect(withInform.messages.filter(m => m.role === 'system')).toEqual(
        withoutInform.messages.filter(m => m.role === 'system'),
      )

      // Only the last message changed, and only by the appended section: the
      // operator's words verbatim under the one vouching header, last in line.
      expect(withInform.messages.slice(0, -1)).toEqual(withoutInform.messages.slice(0, -1))
      const last = withInform.messages[withInform.messages.length - 1]
      expect(last.role).toBe('user')
      expect(last.content).toBe(
        `Ready for the next task?\n\n---\n\n${INFORM_BLOCK_HEADER}\n\nYou notice the clock has stopped.`,
      )

      expect(withInform.informRowIds).toEqual(['row-1'])
    })

    it('rides its own trailing user message on a turn with no new user message', async () => {
      // Chained, nudged and autonomous turns run without a new user message;
      // the inform must still reach them, last in line.
      const result = await buildWithInforms([informRow('row-1', 'The lamp gutters.')], null)

      const last = result.messages[result.messages.length - 1]
      expect(last.role).toBe('user')
      expect(last.content).toBe(`${INFORM_BLOCK_HEADER}\n\nThe lamp gutters.`)
      expect(result.informRowIds).toEqual(['row-1'])
    })

    // ------------------------------------------------------------------
    // The trailing sections keep one order on both kinds of turn.
    // ------------------------------------------------------------------

    describe('trailing sections on a turn with and without a new user message', () => {
      const CORE = 'CORE-WHISPER-SECTION'
      const PROGRESSIONS = 'PROGRESSIONS-SECTION'
      const ANCHOR = 'SCENE-NOTE-SECTION'
      const letter = {
        path: 'Mail/2026-10-12-from-iris.md',
        from: 'Iris',
        sentAt: timestamp,
        body: 'Meet me at the lighthouse.',
        alerted: false,
        inReplyTo: null,
      }

      const enable = (sections: { core?: boolean; everything?: boolean }) => {
        ;(coreWhisper.resolveCoreWhisperConfig as jest.Mock).mockReturnValue({
          enabled: true, interval: 12, silenceThreshold: 3, packetTokenBudget: 4096, fireOnContextTransition: true,
        })
        ;(coreWhisperTrigger.shouldFireCoreWhisper as jest.Mock).mockReturnValue({ fire: true, reason: 'periodic' })
        ;(coreWhisper.assembleCorePacket as jest.Mock).mockResolvedValue({ entries: [] })
        ;(coreWhisper.buildCoreWhisperContent as jest.Mock).mockReturnValue('persona')
        ;(coreWhisper.buildCoreWhisperOpaqueContent as jest.Mock).mockReturnValue('opaque')
        ;(coreWhisper.buildCoreWhisperLLMContext as jest.Mock).mockReturnValue(CORE)
        ;(coreWhisper.postCoreWhisper as jest.Mock).mockResolvedValue(null)
        if (sections.everything) {
          ;(progressionsSection.buildProgressionsSection as jest.Mock).mockResolvedValue(PROGRESSIONS)
          ;(narrationAnchor.buildUserNarrationAnchor as jest.Mock).mockReturnValue(ANCHOR)
          mockedCollectUnalertedMail.mockResolvedValue([letter])
        }
      }

      afterEach(() => {
        const restore = (mod: string, mocked: Record<string, unknown>, names: string[]) => {
          const actual = jest.requireActual(mod)
          for (const name of names) (mocked[name] as jest.Mock).mockReset().mockImplementation(actual[name])
        }
        restore('@/lib/services/aurora-notifications/core-whisper', coreWhisper as any, [
          'resolveCoreWhisperConfig', 'assembleCorePacket', 'buildCoreWhisperLLMContext',
          'buildCoreWhisperContent', 'buildCoreWhisperOpaqueContent', 'postCoreWhisper',
        ])
        restore('@/lib/chat/context/core-whisper-trigger', coreWhisperTrigger as any, ['shouldFireCoreWhisper'])
        restore('@/lib/progressions/prompt-section', progressionsSection as any, ['buildProgressionsSection'])
        restore('@/lib/chat/context/user-narration-anchor', narrationAnchor as any, ['buildUserNarrationAnchor'])
      })

      const build = async (opts: { newUserMessage: string | null; recall: boolean; inform: boolean; offerSkip: boolean }) => {
        mockedGetRepositories.mockReturnValue({
          memories: {
            findByCharacterAboutCharacters: jest.fn().mockResolvedValue(opts.recall ? [memory] : []),
            findHotDigests: jest.fn().mockResolvedValue([]),
          },
          chatInforms: {
            findPendingForParticipant: jest.fn().mockResolvedValue(opts.inform ? [{
              id: 'row-1', chatId: 'chat-1', batchId: 'batch-1', participantId: 'participant-a',
              contentMarkdown: 'The lamp gutters.', recordMessageId: null,
              createdAt: timestamp, updatedAt: timestamp, consumedAt: null, consumedByMessageId: null,
            }] : []),
            findConsumedByMessages: jest.fn().mockResolvedValue([]),
          },
          chatSettings: { findByUserId: jest.fn().mockResolvedValue(null) },
          chats: { getMessages: jest.fn().mockResolvedValue([]) },
        } as any)

        return buildContext({
          provider: 'OPENAI',
          modelName: 'gpt-4o',
          userId: 'user',
          character: { ...characterA, characterDocumentMountPointId: 'vault-a' } as any,
          userCharacter: { name: 'Alex', description: 'Curious' },
          chat: {
            id: 'chat-1', userId: 'user', participants: allParticipants, title: 'Test Chat',
            contextSummary: null, sillyTavernMetadata: null, tags: [], messageCount: 2,
            lastMessageAt: timestamp, lastRenameCheckInterchange: 0, createdAt: timestamp, updatedAt: timestamp,
          } as any,
          existingMessages: [
            { role: 'USER', content: 'Hello', id: 'm1' },
            { role: 'ASSISTANT', content: 'Greetings', id: 'm2' },
          ],
          newUserMessage: opts.newUserMessage ?? undefined,
          embeddingProfileId: null,
          skipMemories: !opts.recall,
          maxMemories: 1,
          minMemoryImportance: 0.3,
          respondingParticipant: participantA,
          allParticipants,
          participantCharacters,
          messagesWithParticipants: [
            { role: 'USER', content: 'Hello', participantId: 'participant-user', createdAt: timestamp },
            { role: 'ASSISTANT', content: 'Greetings', participantId: 'participant-b', createdAt: timestamp },
          ],
          turnSkip: opts.offerSkip ? { offerSkip: true, characterName: 'Lyra', recentlyAddressed: false } : undefined,
        } as any)
      }

      it('delivers the Core whisper on a turn with no new user message', async () => {
        enable({ core: true })
        const result = await build({ newUserMessage: null, recall: false, inform: false, offerSkip: false })

        const last = result.messages[result.messages.length - 1]
        expect(last.role).toBe('user')
        expect(last.content).toBe(CORE)
      })

      it('keeps every section in the same order on both paths, with the scene note leading the no-message tail', async () => {
        enable({ everything: true })
        const withMessage = await build({ newUserMessage: 'Onward.', recall: true, inform: true, offerSkip: true })
        const withMessageTail = withMessage.messages[withMessage.messages.length - 1].content as string
        expect(withMessageTail.startsWith('Onward.\n\n---\n\n')).toBe(true)
        const sections = withMessageTail.slice('Onward.\n\n---\n\n'.length).split('\n\n---\n\n')

        enable({ everything: true })
        const withoutMessage = await build({ newUserMessage: null, recall: true, inform: true, offerSkip: true })
        const withoutMessageTail = withoutMessage.messages[withoutMessage.messages.length - 1].content as string

        // Same sections, same order; the scene note is the only addition and leads.
        expect(withoutMessageTail).toBe([ANCHOR, ...sections].join('\n\n---\n\n'))

        // And that order is the documented one.
        const at = (needle: string) => {
          const index = withoutMessageTail.indexOf(needle)
          expect(index).toBeGreaterThanOrEqual(0)
          return index
        }
        const order = [
          at(ANCHOR),
          at(CORE),
          at('You also recall about the others present'),
          at('Suparṇā of the Post Office has delivered new mail to you'),
          at(PROGRESSIONS),
          at(INFORM_BLOCK_HEADER),
          at('[NOTHING TO ADD]'),
        ]
        expect([...order].sort((a, b) => a - b)).toEqual(order)
      })
    })

    // ------------------------------------------------------------------
    // Suparṇā's mail on a turn with no new user message (bugs 199, 227).
    // ------------------------------------------------------------------

    describe('mail on a turn with no new user message (bugs 199, 227)', () => {
      const letter = {
        path: 'Mail/2026-10-12-from-iris.md',
        from: 'Iris',
        sentAt: timestamp,
        body: 'Meet me at the lighthouse.',
        alerted: false,
        inReplyTo: null,
      }

      const buildWithMail = async (newUserMessage: string | null, regenerationOfMessageIds?: string[]) => {
        mockedGetRepositories.mockReturnValue({
          memories: { findByCharacterAboutCharacters: jest.fn().mockResolvedValue([]) },
          chatInforms: {
            findPendingForParticipant: jest.fn().mockResolvedValue([]),
            findConsumedByMessages: jest.fn().mockResolvedValue([]),
          },
        } as any)
        mockedCollectUnalertedMail.mockResolvedValue([letter])

        return buildContext({
          provider: 'OPENAI',
          modelName: 'gpt-4o',
          userId: 'user',
          character: { ...characterA, characterDocumentMountPointId: 'vault-a' } as any,
          userCharacter: { name: 'Alex', description: 'Curious' },
          chat: {
            id: 'chat-1',
            userId: 'user',
            participants: allParticipants,
            title: 'Test Chat',
            contextSummary: null,
            sillyTavernMetadata: null,
            tags: [],
            messageCount: 2,
            lastMessageAt: timestamp,
            lastRenameCheckInterchange: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          } as any,
          existingMessages: [
            { role: 'USER', content: 'Hello', id: 'm1' },
            { role: 'ASSISTANT', content: 'Greetings', id: 'm2' },
          ],
          newUserMessage: newUserMessage ?? undefined,
          skipMemories: true,
          respondingParticipant: participantA,
          allParticipants,
          participantCharacters,
          messagesWithParticipants: [
            { role: 'USER', content: 'Hello', participantId: 'participant-user', createdAt: timestamp },
            { role: 'ASSISTANT', content: 'Greetings', participantId: 'participant-b', createdAt: timestamp },
          ],
          regenerationOfMessageIds,
        } as any)
      }

      it('rides its own trailing user message', async () => {
        const result = await buildWithMail(null)

        const last = result.messages[result.messages.length - 1]
        expect(last.role).toBe('user')
        expect(last.content).toBe(buildSuparnaMailLLMContext([letter]))
      })

      it('owes the alerted flip to delivery instead of marking it here', async () => {
        const result = await buildWithMail(null)

        // Context building has not made the call yet: a provider failure must
        // leave the letter unalerted, so the flip is handed to the finalizer.
        expect(mockedMarkAlerted).not.toHaveBeenCalled()
        expect(result.mailAlertsOwed).toEqual({ vaultId: 'vault-a', paths: [letter.path] })
      })

      it('skips the mail check on a swipe', async () => {
        ;(postSuparnaMailWhisper as jest.Mock).mockClear()
        const result = await buildWithMail(null, ['m2'])

        // A re-roll of a line already spoken gets no new letter, posts no
        // whisper and owes nothing — the swipe path never reaches the finalizer.
        expect(mockedCollectUnalertedMail).not.toHaveBeenCalled()
        expect(postSuparnaMailWhisper).not.toHaveBeenCalled()
        expect(result.mailAlertsOwed).toBeNull()
        const last = result.messages[result.messages.length - 1]
        expect(last.content ?? '').not.toContain('Suparṇā')
      })

      it('still rides the new user message as a trailing section when there is one', async () => {
        const result = await buildWithMail('Any post today?')

        const last = result.messages[result.messages.length - 1]
        expect(last.role).toBe('user')
        expect(last.content).toBe(`Any post today?\n\n---\n\n${buildSuparnaMailLLMContext([letter])}`)
      })
    })

    // Bug 199: a continue / chained turn computed recall, posted the whisper and
    // stamped the rows accessed, but the trailing-only message left the recall
    // text out — the model was shown nothing.
    describe('recall on a turn with no new user message (bug 199)', () => {
      const mockedRecall = buildCommonplaceLLMContext as jest.MockedFunction<typeof buildCommonplaceLLMContext>
      afterEach(() => {
        mockedRecall.mockImplementation(jest.requireActual('@/lib/services/commonplace-notifications/writer').buildCommonplaceLLMContext)
      })

      it('carries the recall text in the trailing user message', async () => {
        mockedRecall.mockReturnValue('You remember the lighthouse.')
        const result = await buildWithInforms([], null)

        const last = result.messages[result.messages.length - 1]
        expect(last.role).toBe('user')
        expect(last.content).toBe('You remember the lighthouse.')
      })

      it('puts recall before the inform block, as on an ordinary turn', async () => {
        mockedRecall.mockReturnValue('You remember the lighthouse.')
        const result = await buildWithInforms([informRow('row-1', 'The lamp gutters.')], null)

        const last = result.messages[result.messages.length - 1]
        expect(last.content).toBe(
          `You remember the lighthouse.\n\n---\n\n${INFORM_BLOCK_HEADER}\n\nThe lamp gutters.`,
        )
      })

      it('carries new mail too, and owes the letters their alerted flip (bug 227)', async () => {
        const letter = { path: 'Mail/from-the-lighthouse.md', from: 'The Keeper', sentAt: timestamp, body: 'The lamp is lit.', alerted: false, inReplyTo: null }
        ;(collectUnalertedMail as jest.Mock).mockResolvedValueOnce([letter])
        ;(markAlerted as jest.Mock).mockResolvedValue(undefined)
        ;(postSuparnaMailWhisper as jest.Mock).mockResolvedValueOnce(null)
        mockedRecall.mockReturnValue('You remember the lighthouse.')

        const result = await buildWithInforms([], null, { ...characterA, characterDocumentMountPointId: 'vault-a' } as Character)

        const last = result.messages[result.messages.length - 1]
        expect(last.role).toBe('user')
        expect(last.content).toBe(
          `You remember the lighthouse.\n\n---\n\n${buildSuparnaMailLLMContext([letter])}`,
        )
        // Marked only once the turn is delivered (the finalizer), never here.
        expect(markAlerted).not.toHaveBeenCalled()
        expect(result.mailAlertsOwed).toEqual({ vaultId: 'vault-a', paths: [letter.path] })
      })

      it('delivers the head on a continue turn: stamped, in the ring, in the debug record', async () => {
        resetFrozenArchiveCacheForTests()
        const headMemory: Memory = {
          ...memory,
          id: 'mem-head',
          aboutCharacterId: null,
          summary: 'Lyra lit the lighthouse lamp at dusk',
          content: 'Lyra lit the lighthouse lamp at dusk',
        }
        const repoMock = {
          memories: {
            findByCharacterAboutCharacters: jest.fn().mockResolvedValue([]),
            findHotDigests: jest.fn().mockResolvedValue([]),
            findMostImportant: jest.fn().mockResolvedValue([]),
            updateAccessTimeBulk: jest.fn().mockResolvedValue(1),
          },
          characters: { findNamesByIds: jest.fn().mockResolvedValue(new Map()) },
          chats: { update: jest.fn().mockResolvedValue(null), getMessages: jest.fn().mockResolvedValue([]) },
          chatInforms: {
            findPendingForParticipant: jest.fn().mockResolvedValue([]),
            findConsumedByMessages: jest.fn().mockResolvedValue([]),
          },
        }
        mockedGetRepositories.mockReturnValue(repoMock as any)
        mockedSearchRecall.mockResolvedValue({
          candidates: [{ memory: headMemory, score: 0.8, usedEmbedding: false, salience: 0.5 }],
          strategy: 'text',
          trace: [],
        } as any)

        const result = await buildContext({
          provider: 'OPENAI',
          modelName: 'gpt-4o',
          userId: 'user',
          character: characterA,
          chat: {
            id: 'chat-continue',
            userId: 'user',
            participants: allParticipants,
            title: 'Test Chat',
            contextSummary: null,
            sillyTavernMetadata: null,
            tags: [],
            messageCount: 2,
            lastMessageAt: timestamp,
            lastRenameCheckInterchange: 0,
            createdAt: timestamp,
            updatedAt: timestamp,
          } as any,
          existingMessages: [
            { role: 'USER', content: 'Hello', id: 'm1' },
            { role: 'ASSISTANT', content: 'Greetings', id: 'm2' },
          ],
          isContinueMode: true,
          skipMemories: false,
          respondingParticipant: participantA,
          allParticipants,
          participantCharacters,
          messagesWithParticipants: [],
        } as any)

        const last = result.messages[result.messages.length - 1]
        expect(last.role).toBe('user')
        expect(last.content).toContain('Lyra lit the lighthouse lamp at dusk')
        expect(repoMock.memories.updateAccessTimeBulk).toHaveBeenCalledWith('char-a', ['mem-head'])
        expect(repoMock.chats.update).toHaveBeenCalledWith('chat-continue', { commonplaceRecallHistory: { turns: [['mem-head']] } })
        expect(result.recallDebugLog).toContain('[Recall:ring] mem-head')
      })

      it('rides the new user message, not a second one, when there is one', async () => {
        mockedRecall.mockReturnValue('You remember the lighthouse.')
        const result = await buildWithInforms([])

        const last = result.messages[result.messages.length - 1]
        expect(last.content).toBe('Ready for the next task?\n\n---\n\nYou remember the lighthouse.')
        expect(result.messages.filter(m => m.role === 'user' && m.content === 'You remember the lighthouse.')).toHaveLength(0)
      })
    })

    it('stacks several pending passages in posting order, rule-separated', async () => {
      const result = await buildWithInforms([
        informRow('row-1', 'First thing.'),
        informRow('row-2', 'Second thing.'),
      ])

      const last = result.messages[result.messages.length - 1]
      expect(last.content).toContain(`${INFORM_BLOCK_HEADER}\n\nFirst thing.\n\n---\n\nSecond thing.`)
      expect(result.informRowIds).toEqual(['row-1', 'row-2'])
    })
  })

  describe('buildIdentityReinforcement', () => {
    it('produces a reminder anchored on the character name', () => {
      const result = buildIdentityReinforcement('Artemis')
      expect(result).toContain('## Identity Reminder')
      expect(result).toContain('You are Artemis')
      expect(result).toContain('Respond as Artemis and no one else.')
      expect(result).not.toContain('{{char}}')
      expect(result).not.toContain('{{user}}')
    })

    it('uses a fully static "any other character" phrasing — no inline list', () => {
      // The reminder is now emitted as a separate, fully-static second system
      // message. It must NOT name individual participants (those used to live
      // here as a comma-separated list and bisected provider prompt caching);
      // participant attribution comes from Host roster announcements + each
      // history message's `name` field instead.
      const result = buildIdentityReinforcement('Artemis')
      expect(result).toContain('any other character')
      // Still static — must not interpolate a comma-separated participant list.
      expect(result).not.toMatch(/(?:on behalf of|as|for) [A-Z][a-z]+,/)
    })

    it('produces byte-identical output across calls for the same character', () => {
      const a = buildIdentityReinforcement('Friday')
      const b = buildIdentityReinforcement('Friday')
      expect(a).toBe(b)
    })

    it('instructs LLM not to prefix response with character name', () => {
      const result = buildIdentityReinforcement('Friday')
      expect(result).toContain('Do not prefix or label your response with your own name')
      expect(result).toContain('[Friday]')
      expect(result).toContain('Friday:')
    })
  })
})
