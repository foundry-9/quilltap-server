import {
  describeRetryRefusal,
  isLanternBackgroundRefusal,
  retryUncensoredTurnUrl,
} from '@/app/salon/[id]/concierge-retry'

describe('concierge-retry helpers', () => {
  it('builds the narrated retry URL', () => {
    expect(retryUncensoredTurnUrl('c1', 'm1')).toBe('/api/v1/chats/c1/messages/m1?action=retry-uncensored&stream=1')
  })

  it('words the two refusals and nothing else', () => {
    expect(describeRetryRefusal('no-understudy')).toBe(
      'There is no uncensored desk to send this to — appoint one under Settings → The Concierge.',
    )
    expect(describeRetryRefusal('locked')).toMatch(/Locked/)
    expect(describeRetryRefusal('something else')).toBeNull()
    expect(describeRetryRefusal(undefined)).toBeNull()
  })

  it('recognises the Lantern\'s refused backdrop', () => {
    expect(isLanternBackgroundRefusal({ systemSender: 'lantern', systemKind: 'background-refused' })).toBe(true)
    expect(isLanternBackgroundRefusal({ systemSender: 'lantern', systemKind: 'background' })).toBe(false)
    expect(isLanternBackgroundRefusal({ systemSender: 'concierge', systemKind: 'background-refused' })).toBe(false)
  })
})
