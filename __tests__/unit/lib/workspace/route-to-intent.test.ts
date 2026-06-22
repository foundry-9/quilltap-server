/**
 * Unit tests for parseHrefToIntent — maps in-app hrefs to workspace tab intents
 * (used so in-workspace link clicks open tabs instead of navigating away).
 */

import { parseHrefToIntent } from '@/lib/navigation/route-to-intent'

describe('parseHrefToIntent', () => {
  it('maps a specific conversation to a salon tab with its chatId', () => {
    expect(parseHrefToIntent('/salon/abc123')).toEqual({
      kind: 'salon',
      payload: { chatId: 'abc123' },
    })
  })

  it('does not map the salon list or new-chat (they navigate normally)', () => {
    expect(parseHrefToIntent('/salon')).toBeNull()
    expect(parseHrefToIntent('/salon/new')).toBeNull()
  })

  it('maps the singleton surfaces', () => {
    expect(parseHrefToIntent('/')).toEqual({ kind: 'home' })
    expect(parseHrefToIntent('/aurora')).toEqual({ kind: 'aurora' })
    expect(parseHrefToIntent('/prospero')).toEqual({ kind: 'prospero' })
    expect(parseHrefToIntent('/scriptorium')).toEqual({ kind: 'scriptorium' })
    expect(parseHrefToIntent('/files')).toEqual({ kind: 'files' })
    expect(parseHrefToIntent('/photos')).toEqual({ kind: 'photos' })
    expect(parseHrefToIntent('/scenarios')).toEqual({ kind: 'scenarios' })
  })

  it('preserves settings deep-link params', () => {
    expect(parseHrefToIntent('/settings?tab=system&section=memory')).toEqual({
      kind: 'settings',
      payload: { tab: 'system', section: 'memory' },
    })
    expect(parseHrefToIntent('/settings')).toEqual({
      kind: 'settings',
      payload: { tab: undefined, section: undefined },
    })
  })

  it('tolerates trailing slashes and hash fragments', () => {
    expect(parseHrefToIntent('/aurora/')).toEqual({ kind: 'aurora' })
    expect(parseHrefToIntent('/aurora#x')).toEqual({ kind: 'aurora' })
  })

  it('returns null for unknown or external hrefs', () => {
    expect(parseHrefToIntent('/profile')).toBeNull()
    expect(parseHrefToIntent('/unlock')).toBeNull()
    expect(parseHrefToIntent('https://example.com')).toBeNull()
    expect(parseHrefToIntent('')).toBeNull()
  })
})
