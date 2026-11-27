import {
  describeRetryFailure,
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

  it('words a failed retry request: the 409 reason, else the server error, else the fallback', async () => {
    const res = (status: number, body: unknown) => ({
      status,
      json: async () => {
        if (body === undefined) throw new Error('not json')
        return body
      },
    }) as unknown as Response
    await expect(describeRetryFailure(res(409, { error: 'locked' }), 'fb')).resolves.toMatch(/Locked/)
    await expect(describeRetryFailure(res(409, { error: 'other' }), 'fb')).resolves.toBe('other')
    await expect(describeRetryFailure(res(500, { error: 'locked' }), 'fb')).resolves.toBe('locked')
    await expect(describeRetryFailure(res(500, undefined), 'fb')).resolves.toBe('fb')
  })
})
