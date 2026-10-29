/**
 * PUT /api/v1/settings/chat — `customToolIntervention`, the roll-intervention toggle.
 *
 * The repository is a stub that echoes what it was asked to write.
 */

jest.mock('@/lib/logger', () => {
  const logger: Record<string, unknown> = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
  logger.child = jest.fn(() => logger)
  return { logger }
})

const mockUpdateForUser = jest.fn(async (_userId: string, data: Record<string, unknown>) => ({ userId: 'user-1', ...data }))

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler:
    (handler: (req: any, ctx: any) => Promise<any>) =>
    async (req: any) =>
      handler(req, { user: { id: 'user-1' }, repos: { chatSettings: { updateForUser: mockUpdateForUser } } }),
}))

import { PUT } from '@/app/api/v1/settings/chat/route'
import { ChatSettingsSchema } from '@/lib/schemas/settings.types'

function req(body: unknown) {
  return { json: async () => body } as never
}

beforeEach(() => mockUpdateForUser.mockClear())

describe('PUT /api/v1/settings/chat — customToolIntervention', () => {
  it.each([true, false])('writes and returns %s', async (value) => {
    const res = await PUT(req({ customToolIntervention: value }))
    expect(res.status).toBe(200)
    expect(mockUpdateForUser.mock.calls[0][1]).toMatchObject({ customToolIntervention: value })
    const body = await res.json()
    expect(body.customToolIntervention).toBe(value)
  })

  it('rejects a non-boolean and writes nothing', async () => {
    const res = await PUT(req({ customToolIntervention: 'yes' }))
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(mockUpdateForUser).not.toHaveBeenCalled()
  })

  it('defaults to on', () => {
    expect(ChatSettingsSchema.shape.customToolIntervention.parse(undefined)).toBe(true)
  })
})
