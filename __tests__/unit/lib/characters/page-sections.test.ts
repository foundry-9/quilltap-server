/**
 * The character page's sections and the retired pages' redirects (§5 of the
 * unification spec): every old `?tab=` lands in the section that holds it now.
 */

import {
  characterPageHref,
  isCharacterPageSection,
  resolveCharacterPageSection,
} from '@/lib/characters/page-sections'
import { legacyCharacterRedirectTarget } from '@/lib/navigation/legacy-character-redirect'

describe('resolveCharacterPageSection', () => {
  it.each([
    ['details', 'details'],
    ['tags', 'details'],
    ['system-prompts', 'prompts'],
    ['conversations', 'history'],
    ['memories', 'history'],
    ['rename', 'history'],
    ['wardrobe', 'appearance'],
    ['gallery', 'appearance'],
    ['descriptions', 'appearance'],
    ['defaults', 'chat-defaults'],
  ])('maps the retired ?tab=%s to %s', (tab, section) => {
    expect(resolveCharacterPageSection(undefined, tab)).toBe(section)
  })

  it('prefers a current ?section= and ignores unknowns', () => {
    expect(resolveCharacterPageSection('abilities', 'conversations')).toBe('abilities')
    expect(resolveCharacterPageSection('nonsense', undefined)).toBeUndefined()
    expect(resolveCharacterPageSection(undefined, 'nonsense')).toBeUndefined()
    expect(resolveCharacterPageSection(undefined, 'prompts')).toBe('prompts')
  })

  it('knows its six sections', () => {
    expect(isCharacterPageSection('chat-defaults')).toBe(true)
    expect(isCharacterPageSection('system-prompts')).toBe(false)
  })
})

describe('characterPageHref', () => {
  it('omits the default section and carries an action', () => {
    expect(characterPageHref('c1')).toBe('/aurora/c1')
    expect(characterPageHref('c1', { section: 'details' })).toBe('/aurora/c1')
    expect(characterPageHref('c1', { section: 'history', action: 'chat' })).toBe('/aurora/c1?section=history&action=chat')
  })
})

describe('legacyCharacterRedirectTarget', () => {
  it('sends the old view/edit URLs to /aurora/[id] with the section mapped', () => {
    expect(legacyCharacterRedirectTarget('c1', {})).toBe('/aurora/c1')
    expect(legacyCharacterRedirectTarget('c1', { tab: 'system-prompts' })).toBe('/aurora/c1?section=prompts')
    expect(legacyCharacterRedirectTarget('c1', { tab: 'defaults', action: 'chat' })).toBe(
      '/aurora/c1?section=chat-defaults&action=chat',
    )
    expect(legacyCharacterRedirectTarget('c1', { tab: ['a', 'b'] })).toBe('/aurora/c1')
  })
})
