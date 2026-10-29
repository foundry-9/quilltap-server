/**
 * PUT /api/v1/settings/chat — `coreWhisper`, and the refusal of keys the route
 * does not write.
 *
 * The route used to destructure a fixed list of keys and ignore the rest, so
 * the Core whisper card's PUT came back 200 with the old value and the toggle
 * snapped back. The repository is a stub that echoes what it was asked to write.
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

const FULL = {
  enabled: false,
  interval: 12,
  silenceThreshold: 3,
  packetTokenBudget: 4096,
  fireOnContextTransition: true,
}

beforeEach(() => mockUpdateForUser.mockClear())

describe('PUT /api/v1/settings/chat — coreWhisper', () => {
  it('writes and returns the master switch turned off', async () => {
    const res = await PUT(req({ coreWhisper: FULL }))
    expect(res.status).toBe(200)
    expect(mockUpdateForUser.mock.calls[0][1]).toEqual({ coreWhisper: FULL })
    const body = await res.json()
    expect(body.coreWhisper.enabled).toBe(false)
  })

  it('fills defaults for a partial bag', async () => {
    const res = await PUT(req({ coreWhisper: { enabled: false } }))
    expect(res.status).toBe(200)
    expect(mockUpdateForUser.mock.calls[0][1]).toEqual({ coreWhisper: FULL })
  })

  it('rejects an out-of-range interval and writes nothing', async () => {
    const res = await PUT(req({ coreWhisper: { ...FULL, interval: 1 } }))
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(mockUpdateForUser).not.toHaveBeenCalled()
  })
})

describe('PUT /api/v1/settings/chat — unknown keys', () => {
  it('refuses a key the route does not write, rather than dropping it', async () => {
    const res = await PUT(req({ notASetting: true, customTools: true }))
    expect(res.status).toBe(400)
    expect(mockUpdateForUser).not.toHaveBeenCalled()
    const body = await res.json()
    expect(JSON.stringify(body)).toContain('notASetting')
  })
})
