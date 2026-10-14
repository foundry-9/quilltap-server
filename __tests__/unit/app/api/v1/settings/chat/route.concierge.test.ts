/**
 * PUT /api/v1/settings/chat — the Concierge's settings object (phase 4).
 *
 * The real `ConciergeSettingsSchema` runs; the repository is a stub that
 * echoes what it was asked to write.
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

function req(body: unknown) {
  return { json: async () => body } as never
}

beforeEach(() => mockUpdateForUser.mockClear())

describe('PUT /api/v1/settings/chat — conciergeSettings', () => {
  it('round-trips a conciergeSettings object, filling defaults', async () => {
    const res = await PUT(req({ conciergeSettings: { enabled: false, display: { mode: 'BLUR' } } }))
    expect(res.status).toBe(200)
    const written = mockUpdateForUser.mock.calls[0][1] as Record<string, any>
    expect(written.conciergeSettings).toMatchObject({
      enabled: false,
      autoSwitchAfterRefusals: 2,
      newChatsStartAs: 'moderated',
      display: { mode: 'BLUR', showWarningBadges: true },
      preScreen: { enabled: false, summaryClassification: false },
    })
    const body = await res.json()
    expect(body.conciergeSettings.enabled).toBe(false)
  })

  it('rejects a malformed conciergeSettings with 400', async () => {
    const res = await PUT(req({ conciergeSettings: { autoSwitchAfterRefusals: 99 } }))
    expect(res.status).toBe(400)
    expect(mockUpdateForUser).not.toHaveBeenCalled()
  })

  it.each([
    [{ dangerousContentSettings: { mode: 'AUTO_ROUTE' } }, 'dangerousContentSettings'],
    [{ uncensoredImageDescriptionProfileId: null }, 'uncensoredImageDescriptionProfileId'],
    [{ cheapLLMSettings: { strategy: 'PROVIDER_CHEAPEST', imagePromptProfileId: null } }, 'cheapLLMSettings.imagePromptProfileId'],
  ])('rejects the retired key %# with 400 and writes nothing', async (body, key) => {
    const res = await PUT(req(body))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(JSON.stringify(json)).toContain(key)
    expect(mockUpdateForUser).not.toHaveBeenCalled()
  })

  it('still accepts cheapLLMSettings without the crafter', async () => {
    const res = await PUT(req({ cheapLLMSettings: { strategy: 'PROVIDER_CHEAPEST' } }))
    expect(res.status).toBe(200)
  })
})
