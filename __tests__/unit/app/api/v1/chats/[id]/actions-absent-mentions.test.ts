/**
 * `GET ?action=absent-mentions` adds each mentioned character's portrait URL
 * (`avatarUrl`) for the chat sidebar's Concepts Named card, resolved through
 * `resolveCharacterAvatar`; a missing or unresolvable portrait is null and
 * never fails the read.
 */

const mockFind = jest.fn()
const mockResolveAvatar = jest.fn()

jest.mock('@/lib/logger', () => ({ logger: { debug: jest.fn(), warn: jest.fn(), info: jest.fn(), error: jest.fn() } }))
jest.mock('@/lib/chat/absent-mentions', () => ({
  findAbsentMentions: (...a: unknown[]) => mockFind(...a),
  presenceOf: () => () => false,
}))
jest.mock('@/lib/services/chat-message/user-identity-resolver.service', () => ({
  resolveUserIdentity: async () => ({ name: 'Charlie' }),
}))
jest.mock('@/lib/photos/resolve-character-avatar', () => ({
  resolveCharacterAvatar: (...a: unknown[]) => mockResolveAvatar(...a),
}))

import { handleGetAbsentMentions } from '@/app/api/v1/chats/[id]/actions/absent-mentions'

function ctx() {
  return {
    user: { id: 'u1' },
    repos: {
      chats: {
        findById: async () => ({ id: 'chat-1', participants: [], chatType: 'salon' }),
        getMessages: async () => [],
      },
      characters: {
        findByUserId: async () => [
          { id: 'riya', name: 'Riya', defaultImageId: 'link-riya' },
          { id: 'lorian', name: 'Lorian', defaultImageId: null },
          { id: 'sam', name: 'Sam', defaultImageId: 'link-gone' },
        ],
      },
    },
  } as any
}

describe('GET /api/v1/chats/[id]?action=absent-mentions', () => {
  beforeEach(() => {
    mockFind.mockReset().mockReturnValue([
      { messageId: 'm1', characterId: 'riya', text: 'Riya', card: { name: 'Riya' } },
      { messageId: 'm2', characterId: 'lorian', text: 'Lorian', card: { name: 'Lorian' } },
      { messageId: 'm3', characterId: 'sam', text: 'Sam', card: { name: 'Sam' } },
    ])
    mockResolveAvatar.mockReset().mockImplementation(async (id: string) => {
      if (id === 'link-riya') return { url: '/api/v1/mount-points/mp/blobs/images/riya.webp' }
      throw new Error('vault unreadable')
    })
  })

  it("adds each character's portrait URL, null when there is none or it cannot be resolved", async () => {
    const res: any = await handleGetAbsentMentions('chat-1', ctx())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.mentions.map((m: any) => [m.characterId, m.avatarUrl])).toEqual([
      ['riya', '/api/v1/mount-points/mp/blobs/images/riya.webp'],
      ['lorian', null],
      ['sam', null],
    ])
    expect(mockResolveAvatar).toHaveBeenCalledTimes(2)
  })
})
