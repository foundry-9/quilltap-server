/**
 * #176 — a chat field sent at the top level of the update request was
 * stripped silently, so "Announce Generated Images" never saved. The request
 * schema is strict: a misplaced key is a 400 (a ZodError the route maps).
 */
import { chatUpdateRequestSchema } from '@/app/api/v1/chats/[id]/schemas'

describe('chatUpdateRequestSchema is strict (#176)', () => {
  it('refuses a chat field at the top level', () => {
    const result = chatUpdateRequestSchema.safeParse({ alertCharactersOfLanternImages: true })
    expect(result.success).toBe(false)
  })

  it('accepts the same field under `chat`', () => {
    const result = chatUpdateRequestSchema.safeParse({ chat: { alertCharactersOfLanternImages: true } })
    expect(result.success).toBe(true)
    expect(result.data?.chat?.alertCharactersOfLanternImages).toBe(true)
  })

  it('accepts the documented top-level writes', () => {
    expect(chatUpdateRequestSchema.safeParse({ roleplayTemplateId: null }).success).toBe(true)
    expect(chatUpdateRequestSchema.safeParse({ conciergeState: 'locked' }).success).toBe(true)
    expect(chatUpdateRequestSchema.safeParse({ turnMode: 'rotation' }).success).toBe(true)
  })
})
