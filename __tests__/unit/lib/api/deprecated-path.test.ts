/**
 * Old route paths answer for one release through `deprecatedPath`, which
 * runs the same handler, warns once, and names the replacement in headers.
 */

const mockWarn = jest.fn()
jest.mock('@/lib/logger', () => ({ logger: { warn: (...a: unknown[]) => mockWarn(...a), debug: jest.fn(), info: jest.fn(), error: jest.fn() } }))

import { deprecatedPath } from '@/lib/api/deprecated-path'

describe('deprecatedPath', () => {
  it('runs the handler and marks the response with its successor', async () => {
    const handler = jest.fn(async (n: number) => new Response(JSON.stringify({ n }), { status: 201 }))
    const wrapped = deprecatedPath('/api/v1/old', '/api/v1/new?action=x', handler)

    const res = await wrapped(7)

    expect(handler).toHaveBeenCalledWith(7)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ n: 7 })
    expect(res.headers.get('Deprecation')).toBe('true')
    expect(res.headers.get('Link')).toBe('</api/v1/new?action=x>; rel="successor-version"')
  })

  it('warns once per old path, not once per call', async () => {
    mockWarn.mockClear()
    const wrapped = deprecatedPath('/api/v1/once', '/api/v1/new', async () => new Response('ok'))
    await wrapped()
    await wrapped()
    expect(mockWarn).toHaveBeenCalledTimes(1)
    expect(mockWarn.mock.calls[0][1]).toMatchObject({ oldPath: '/api/v1/once', replacement: '/api/v1/new' })
  })
})
