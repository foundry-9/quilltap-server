/**
 * Tests for buildHelpChatSystemPrompt
 */

import { buildHelpChatSystemPrompt } from '@/lib/help-chat/system-prompt-builder'
import { createMockCharacter } from '../fixtures/test-factories'

jest.mock('@/lib/logger', () => ({
  logger: { child: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) }
}))

jest.mock('@/lib/templates/processor', () => ({
  processTemplate: (template: string, ctx: Record<string, string>) => {
    let result = template
    for (const [key, value] of Object.entries(ctx)) {
      result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
    }
    return result
  },
}))

jest.mock('@/lib/chat/context/system-prompt-builder', () => ({
  buildIdentityReinforcement: (charName: string) =>
    `[Identity reinforcement for ${charName}]`,
}))

describe('buildHelpChatSystemPrompt', () => {
  it('includes Character Identity section', () => {
    const character = createMockCharacter({ name: 'Aria' })
    const result = buildHelpChatSystemPrompt({ character })
    expect(result).toContain('## Character Identity')
  })

  it('includes character name in identity section', () => {
    const character = createMockCharacter({ name: 'Aria' })
    const result = buildHelpChatSystemPrompt({ character })
    expect(result).toContain('You are Aria')
  })

  it('includes Help Assistant Role section', () => {
    const character = createMockCharacter()
    const result = buildHelpChatSystemPrompt({ character })
    expect(result).toContain('## Help Assistant Role')
  })

  it('includes character name in help assistant role', () => {
    const character = createMockCharacter({ name: 'Victor' })
    const result = buildHelpChatSystemPrompt({ character })
    expect(result).toContain(`as ${character.name}`)
  })

  it('uses persona name as userName when persona provided', () => {
    const character = createMockCharacter()
    const persona = { name: 'Alice', description: 'A curious user' }
    const result = buildHelpChatSystemPrompt({ character, userCharacter: persona })
    expect(result).toContain('Alice')
  })

  it('uses User as default userName when no persona', () => {
    const character = createMockCharacter()
    const result = buildHelpChatSystemPrompt({ character })
    expect(result).toContain('[Identity reinforcement for')
  })

  it('includes personality section when character has personality', () => {
    const character = createMockCharacter({ personality: 'Witty and sarcastic' })
    const result = buildHelpChatSystemPrompt({ character })
    expect(result).toContain('## Character Personality')
    expect(result).toContain('Witty and sarcastic')
  })

  it('excludes personality section when character has no personality', () => {
    const character = createMockCharacter({ personality: null })
    const result = buildHelpChatSystemPrompt({ character })
    expect(result).not.toContain('## Character Personality')
  })

  it('includes pronouns section when character has pronouns', () => {
    const character = createMockCharacter({
      pronouns: { subject: 'she', object: 'her', possessive: 'her' }
    })
    const result = buildHelpChatSystemPrompt({ character })
    expect(result).toContain('## Character Pronouns')
    expect(result).toContain('she/her/her')
  })

  it('excludes pronouns section when no pronouns', () => {
    const character = createMockCharacter({ pronouns: undefined })
    const result = buildHelpChatSystemPrompt({ character })
    expect(result).not.toContain('## Character Pronouns')
  })

  it('includes tool instructions when provided', () => {
    const character = createMockCharacter()
    const toolInstructions = '## Tools\nYou have access to help_search'
    const result = buildHelpChatSystemPrompt({ character, toolInstructions })
    expect(result).toContain('## Tools')
    expect(result).toContain('help_search')
  })

  it('includes tool reinforcement when toolInstructions provided', () => {
    const character = createMockCharacter({ pronouns: { subject: 'they', object: 'them', possessive: 'their' } })
    const toolInstructions = '## Tools\nYou have tools'
    const result = buildHelpChatSystemPrompt({ character, toolInstructions })
    expect(result).toContain('tool_use block')
  })

  it('excludes tool instructions when not provided', () => {
    const character = createMockCharacter()
    const result = buildHelpChatSystemPrompt({ character })
    expect(result).not.toContain('## Tools')
  })

  it('includes page context with title and URL', () => {
    const character = createMockCharacter()
    const pageContext = { title: 'Characters Guide', url: '/aurora', content: 'Learn about characters' }
    const result = buildHelpChatSystemPrompt({ character, pageContext })
    expect(result).toContain('## Current Page Context')
    expect(result).toContain('Characters Guide')
    expect(result).toContain('/aurora')
  })

  it('includes page content in documentation section', () => {
    const character = createMockCharacter()
    const pageContext = { title: 'Help', url: '/help', content: 'This is help content' }
    const result = buildHelpChatSystemPrompt({ character, pageContext })
    expect(result).toContain('### Page Documentation')
    expect(result).toContain('This is help content')
  })

  it('excludes page context when null', () => {
    const character = createMockCharacter()
    const result = buildHelpChatSystemPrompt({ character, pageContext: null })
    expect(result).not.toContain('## Current Page Context')
  })

  it('includes additional page contexts', () => {
    const character = createMockCharacter()
    const additionalPageContexts = [
      { title: 'Sidebar', url: '/sidebar', content: 'Sidebar help' },
      { title: 'Search', url: '/search', content: 'Search help' }
    ]
    const result = buildHelpChatSystemPrompt({ character, additionalPageContexts })
    expect(result).toContain('### Additional Context: Sidebar')
    expect(result).toContain('Sidebar help')
    expect(result).toContain('### Additional Context: Search')
    expect(result).toContain('Search help')
  })

  it('includes persona info section when persona provided', () => {
    const character = createMockCharacter()
    const persona = { name: 'Bob', description: 'An experienced writer' }
    const result = buildHelpChatSystemPrompt({ character, userCharacter: persona })
    expect(result).toContain('## User Character')
    expect(result).toContain('Bob')
    expect(result).toContain('An experienced writer')
  })

  it('excludes persona section when no persona', () => {
    const character = createMockCharacter()
    const result = buildHelpChatSystemPrompt({ character, userCharacter: null })
    expect(result).not.toContain('## User Character')
  })

  it('includes other characters section when multiple names provided', () => {
    const character = createMockCharacter()
    const otherCharacterNames = ['Iris', 'Marcus']
    const result = buildHelpChatSystemPrompt({ character, otherCharacterNames })
    expect(result).toContain('## Other Help Characters')
    expect(result).toContain('Iris')
    expect(result).toContain('Marcus')
  })

  it('excludes other characters section when empty', () => {
    const character = createMockCharacter()
    const result = buildHelpChatSystemPrompt({ character, otherCharacterNames: [] })
    expect(result).not.toContain('## Other Help Characters')
  })

  it('excludes other characters section when undefined', () => {
    const character = createMockCharacter()
    const result = buildHelpChatSystemPrompt({ character })
    expect(result).not.toContain('## Other Help Characters')
  })

  it('contains identity reinforcement bookend', () => {
    const character = createMockCharacter({ name: 'Sage' })
    const result = buildHelpChatSystemPrompt({ character })
    expect(result).toContain('[Identity reinforcement for Sage]')
  })

  it('result is trimmed', () => {
    const character = createMockCharacter()
    const result = buildHelpChatSystemPrompt({ character })
    expect(result).toBe(result.trim())
  })

  it('all sections separated by double newlines', () => {
    const character = createMockCharacter({ personality: 'Bold' })
    const result = buildHelpChatSystemPrompt({ character })
    // Count sections and verify separation pattern
    const sections = result.split('\n\n')
    expect(sections.length).toBeGreaterThan(3)
    expect(sections.every((s: string) => s.length > 0)).toBe(true)
  })

  it('complex example with all options', () => {
    const character = createMockCharacter({
      name: 'Echo',
      personality: 'Thoughtful',
      pronouns: { subject: 'they', object: 'them', possessive: 'their' }
    })
    const persona = { name: 'Writer', description: 'Creative person' }
    const pageContext = { title: 'Guide', url: '/guide', content: 'Guide content' }
    const additionalPageContexts = [{ title: 'Sidebar', url: '/sidebar', content: 'More' }]
    const otherCharacterNames = ['Helper']
    const toolInstructions = '## Tools\nAvailable tools'

    const result = buildHelpChatSystemPrompt({
      character,
      userCharacter: persona,
      pageContext,
      additionalPageContexts,
      otherCharacterNames,
      toolInstructions
    })

    expect(result).toContain('Echo')
    expect(result).toContain('Thoughtful')
    expect(result).toContain('they/them/their')
    expect(result).toContain('Writer')
    expect(result).toContain('Guide')
    expect(result).toContain('Sidebar')
    expect(result).toContain('Helper')
    expect(result).toContain('Available tools')
  })
})
