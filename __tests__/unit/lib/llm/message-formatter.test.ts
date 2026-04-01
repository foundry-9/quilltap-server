import {
  getProviderNameSupport,
  supportsNameField,
  formatParticipantName,
  formatMessagesForProvider,
  buildMultiCharacterContextSection,
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
          { name: 'Alex', description: 'Curious human', type: 'PERSONA' },
        ],
        'Lyra'
      )

      expect(section).toContain('Iris')
      expect(section).toContain('(the user)')
      expect(section).toContain('You are Lyra')
    })
  })
})
