import {
  getProviderNameSupport,
  supportsNameField,
  formatParticipantName,
  formatMessagesForProvider,
  buildMultiCharacterContextSection,
  normalizeContentBlockFormat,
} from '@/lib/llm/message-formatter'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}))

describe('message formatter utilities', () => {
  describe('provider name support', () => {
    it('returns provider specific configuration when known', () => {
      const support = getProviderNameSupport('OPENAI')
      expect(support.supportsNameField).toBe(true)
      expect(support.supportedRoles).toContain('assistant')
      expect(support.maxNameLength).toBe(64)
    })

    it('falls back to conservative defaults for unknown providers', () => {
      const support = getProviderNameSupport('UNKNOWN' as any)
      expect(support.supportsNameField).toBe(false)
      expect(support.supportedRoles).toHaveLength(0)
    })

    it('reports whether a role supports the name field', () => {
      expect(supportsNameField('OPENAI', 'user')).toBe(true)
      expect(supportsNameField('ANTHROPIC', 'assistant')).toBe(false)
    })
  })

  describe('formatParticipantName', () => {
    it('sanitizes invalid characters, collapses whitespace, and enforces max length', () => {
      const formatted = formatParticipantName('Dr. Strange@! Example Name', 10)
      expect(formatted).toBe('Dr_Strange')
    })

    it('returns fallback when name becomes empty', () => {
      const formatted = formatParticipantName('???', 5)
      expect(formatted).toBe('Unknown')
    })
  })

  describe('formatMessagesForProvider', () => {
    const messages = [
      { role: 'system' as const, content: 'Rules' },
      { role: 'user' as const, content: 'Hello', name: 'Alicia Keys' },
      { role: 'assistant' as const, content: 'Hi', name: 'Lyra', thoughtSignature: 'sig' },
    ]

    it('uses native name field when supported by provider', () => {
      const formatted = formatMessagesForProvider(messages, 'OPENAI', 'Lyra')
      expect(formatted[0]).toEqual({ role: 'system', content: 'Rules' })
      expect(formatted[1]).toMatchObject({ role: 'user', name: 'Alicia_Keys', content: 'Hello' })
      expect(formatted[2]).toMatchObject({ role: 'assistant', name: 'Lyra', content: 'Hi', thoughtSignature: 'sig' })
    })

    it('prefixes content when provider lacks name field support', () => {
      const formatted = formatMessagesForProvider(messages, 'ANTHROPIC', 'Lyra')
      expect(formatted[1]).toEqual({ role: 'user', content: '[Alicia Keys] Hello' })
      expect(formatted[2]).toEqual({ role: 'assistant', content: '[Lyra] Hi', thoughtSignature: 'sig' })
    })
  })

  describe('buildMultiCharacterContextSection', () => {
    it('lists other participants and provides guidance text', () => {
      const section = buildMultiCharacterContextSection(
        [
          { name: 'Iris', description: 'Navigator', type: 'CHARACTER' },
          { name: 'User', description: 'Curious human', type: 'CHARACTER' },
        ],
        'Lyra'
      )

      expect(section).toContain('Iris')
      expect(section).toContain('User')
      expect(section).toContain('(the user)')
      expect(section).toContain('You are Lyra')
    })
  })

  describe('normalizeContentBlockFormat', () => {
    it('returns normal text content unchanged', () => {
      const content = 'This is a normal response from an LLM.'
      expect(normalizeContentBlockFormat(content)).toBe(content)
    })

    it('returns empty string for empty input', () => {
      expect(normalizeContentBlockFormat('')).toBe('')
    })

    it('returns null/undefined unchanged', () => {
      expect(normalizeContentBlockFormat(null as unknown as string)).toBe(null)
      expect(normalizeContentBlockFormat(undefined as unknown as string)).toBe(undefined)
    })

    it('extracts text from Python-style content block format', () => {
      const wrapped = `[{'type': 'text', 'text': "This is the actual response content."}]`
      expect(normalizeContentBlockFormat(wrapped)).toBe('This is the actual response content.')
    })

    it('extracts text from JSON-style content block format', () => {
      const wrapped = `[{"type": "text", "text": "This is the actual response content."}]`
      expect(normalizeContentBlockFormat(wrapped)).toBe('This is the actual response content.')
    })

    it('handles multiline content in Python-style format', () => {
      const multiline = `[{'type': 'text', 'text': "First line.\\n\\nSecond line with [brackets].\\n\\nThird line."}]`
      expect(normalizeContentBlockFormat(multiline)).toBe('First line.\\n\\nSecond line with [brackets].\\n\\nThird line.')
    })

    it('handles content with special characters and formatting', () => {
      const wrapped = `[{'type': 'text', 'text': "[Tina] *She smiles.* \\"Hello!\\""}]`
      expect(normalizeContentBlockFormat(wrapped)).toBe('[Tina] *She smiles.* \\"Hello!\\"')
    })

    it('does not modify content that starts with [ but is not content block format', () => {
      const content = '[Character Name] This is roleplay content with a name prefix.'
      expect(normalizeContentBlockFormat(content)).toBe(content)
    })

    it('does not modify array-like content that is not content block format', () => {
      const content = '[item1, item2, item3]'
      expect(normalizeContentBlockFormat(content)).toBe(content)
    })

    it('handles whitespace around the content block', () => {
      const wrapped = `  [{'type': 'text', 'text': "Extracted content"}]  `
      expect(normalizeContentBlockFormat(wrapped)).toBe('Extracted content')
    })
  })
})
