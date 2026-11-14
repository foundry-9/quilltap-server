/**
 * PUT /api/v1/settings/chat validates through one patch schema
 * (`ChatSettingsPutSchema`, `patchSchemaOf(ChatSettingsSchema)` and strict).
 *
 * It replaced a 36-argument hand validator that chose 400 or 500 by whether the
 * error text contained "Invalid", so "allowCheapFallback must be a boolean" was
 * a 500 (#166), and nested objects were stored as sent.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  logger.child = jest.fn(() => logger)
  return { logger }
})

const mockUpdateForUser = jest.fn(async (_userId: string, data: Record<string, unknown>) => ({ userId: 'user-1', ...data }))
const mockFindTemplate = jest.fn(async (id: string) => (id === '11111111-1111-4111-8111-111111111111' ? { id } : null))

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler:
    (handler: (req: any, ctx: any) => Promise<any>) =>
    async (req: any) => {
      try {
        return await handler(req, {
          user: { id: 'user-1' },
          repos: { chatSettings: { updateForUser: mockUpdateForUser }, roleplayTemplates: { findById: mockFindTemplate } },
        })
      } catch (error) {
        const { z } = jest.requireActual('zod')
        if (error instanceof z.ZodError) return jest.requireActual('@/lib/api/responses').validationError(error)
        throw error
      }
    },
}))

import { PUT } from '@/app/api/v1/settings/chat/route'

function req(body: unknown) {
  return { json: async () => body } as never
}

beforeEach(() => {
  mockUpdateForUser.mockClear()
  mockFindTemplate.mockClear()
})

describe('PUT /api/v1/settings/chat — patch schema', () => {
  it('writes only the key it was sent (no sidebarWidth default rides along)', async () => {
    const res = await PUT(req({ avatarDisplayMode: 'NEVER' }))
    expect(res.status).toBe(200)
    expect(mockUpdateForUser.mock.calls[0][1]).toEqual({ avatarDisplayMode: 'NEVER' })
  })

  it('answers a non-boolean allowCheapFallback with 400, not 500 (#166)', async () => {
    const res = await PUT(req({ cheapLLMSettings: { strategy: 'USER_DEFINED', allowCheapFallback: 'yes' } }))
    expect(res.status).toBe(400)
    expect(mockUpdateForUser).not.toHaveBeenCalled()
  })

  it('fills a partial nested object to its full sub-schema and drops unknown nested keys', async () => {
    const res = await PUT(req({ cheapLLMSettings: { strategy: 'USER_DEFINED', bogus: 1 } }))
    expect(res.status).toBe(200)
    expect(mockUpdateForUser.mock.calls[0][1]).toEqual({
      cheapLLMSettings: {
        strategy: 'USER_DEFINED',
        fallbackToLocal: true,
        embeddingProvider: 'OPENAI',
        allowCheapFallback: false,
      },
    })
  })

  it.each([
    [{ avatarDisplayStyle: 'HEXAGONAL' }],
    [{ sidebarWidth: 9000 }],
    [{ cheapLLMSettings: null }],
    [{ contextCompressionSettings: { enabled: 'on', windowSize: 5 } }],
    [{ autonomousRoomSettings: { dailyTokenBudget: -5 } }],
    [{ memoryCascadePreferences: { onMessageDelete: 'SHRED' } }],
  ])('rejects %j with 400 and writes nothing', async (body) => {
    const res = await PUT(req(body))
    expect(res.status).toBe(400)
    expect(mockUpdateForUser).not.toHaveBeenCalled()
  })

  it('refuses a default roleplay template that does not exist', async () => {
    const res = await PUT(req({ defaultRoleplayTemplateId: '22222222-2222-4222-8222-222222222222' }))
    expect(res.status).toBe(400)
    expect(mockUpdateForUser).not.toHaveBeenCalled()
  })

  it('accepts an existing template and clearing it', async () => {
    expect((await PUT(req({ defaultRoleplayTemplateId: '11111111-1111-4111-8111-111111111111' }))).status).toBe(200)
    expect((await PUT(req({ defaultRoleplayTemplateId: null }))).status).toBe(200)
    expect(mockFindTemplate).toHaveBeenCalledTimes(1)
  })

  it('does not let a client write server-owned columns', async () => {
    const res = await PUT(req({ userId: '33333333-3333-4333-8333-333333333333' }))
    expect(res.status).toBe(400)
  })
})
