/**
 * hrefForTabIntent — the href a workspace tab stands for, the inverse of
 * parseHrefToIntent. The help chat reads the page the user is on through it
 * (#247).
 */

import { hrefForTabIntent, parseHrefToIntent } from '@/lib/navigation/route-to-intent'
import { TAB_KINDS, type TabKind } from '@/lib/workspace/types'

describe('hrefForTabIntent', () => {
  it.each<[TabKind, unknown]>([
    ['home', undefined],
    ['salon', { chatId: 'c1' }],
    ['salon-list', undefined],
    ['aurora', undefined],
    ['aurora', { groupId: 'g1' }],
    ['character-new', undefined],
    ['character', { characterId: 'ch1' }],
    ['character', { characterId: 'ch1', section: 'prompts' }],
    ['prospero', { projectId: 'p1' }],
    ['scriptorium', { storeId: 's1' }],
    ['settings', { section: 'api-keys' }],
    ['settings', { group: 'connections' }],
    ['settings-wizard', undefined],
    ['files', undefined],
    ['photos', undefined],
    ['scenarios', undefined],
    ['profile', undefined],
    ['about', undefined],
    ['generate-image', undefined],
    ['custom-tools', undefined],
    ['theme-editor', { draftId: 'd1' }],
    ['theme-specimens', undefined],
  ])('round-trips %s %j through parseHrefToIntent', (kind, payload) => {
    const intent = parseHrefToIntent(hrefForTabIntent(kind, payload))
    expect(intent?.kind).toBe(kind)
    if (payload) expect(intent?.payload).toMatchObject(payload as object)
  })

  it('answers a Salon child tab with its conversation', () => {
    expect(hrefForTabIntent('terminal', { chatId: 'c1', sessionId: 't' })).toBe('/salon/c1')
    expect(hrefForTabIntent('document', { chatId: 'c1', chatDocumentId: 'd' })).toBe('/salon/c1')
  })

  it('gives every tab kind an in-app href', () => {
    for (const kind of TAB_KINDS) {
      expect(hrefForTabIntent(kind).startsWith('/')).toBe(true)
    }
  })
})
