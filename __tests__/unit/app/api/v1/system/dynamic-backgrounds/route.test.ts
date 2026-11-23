/**
 * @jest-environment node
 *
 * GET /api/v1/system/dynamic-backgrounds — strict query validation, the
 * setting's off switch and the floor, and the rule that the uncensored
 * decision is never read from the query (spec §3.2).
 */

jest.mock('@/lib/api/middleware', () => {
  const { z } = jest.requireActual('zod')
  const { badRequest } = jest.requireActual('@/lib/api/responses')
  return {
    createContextHandler:
      (handler: (req: any, ctx: any) => Promise<any>) =>
      async (req: any, ctx: any) => {
        try {
          return await handler(req, ctx)
        } catch (error) {
          if (error instanceof z.ZodError) return badRequest('Invalid query')
          throw error
        }
      },
  }
})

jest.mock('@/lib/dynamic-backgrounds/pools', () => {
  const actual = jest.requireActual('@/lib/dynamic-backgrounds/pools')
  return { ...actual, loadCollagePool: jest.fn() }
})
jest.mock('@/lib/dynamic-backgrounds/compose', () => ({ composeCollage: jest.fn() }))
jest.mock('@/lib/file-storage/manager', () => ({ fileStorageManager: { downloadFile: jest.fn() } }))
jest.mock('@/lib/repositories/factory', () => ({ getRepositories: jest.fn() }))

import { NextRequest } from 'next/server'
import { GET } from '@/app/api/v1/system/dynamic-backgrounds/route'
import { CollageScopeNotFoundError, loadCollagePool } from '@/lib/dynamic-backgrounds/pools'
import { composeCollage } from '@/lib/dynamic-backgrounds/compose'
import { clearCollageCache } from '@/lib/dynamic-backgrounds'

const loadPool = loadCollagePool as jest.MockedFunction<typeof loadCollagePool>
const compose = composeCollage as jest.MockedFunction<typeof composeCollage>

const PROJECT = '11111111-1111-4111-8111-111111111111'

function pool(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    fileId: `f${i}`,
    sha256: String(i).padStart(64, '0'),
    width: 1600,
    height: 900,
    file: { id: `f${i}` } as never,
  }))
}

function ctx(dynamicBackgrounds: Record<string, unknown> | undefined) {
  return {
    user: { id: 'user-1' },
    repos: { chatSettings: { findByUserId: jest.fn(async () => ({ dynamicBackgrounds })) } },
  } as never
}

const ON = { enabled: true, allowUncensored: false, refreshMinutes: 3 }

function get(query: string, c = ctx(ON)) {
  return GET(new NextRequest(`http://localhost/api/v1/system/dynamic-backgrounds?${query}`), c)
}

beforeEach(() => {
  jest.clearAllMocks()
  clearCollageCache()
})

describe('query validation', () => {
  it.each([
    ['an unknown scope', 'scope=salon'],
    ['home with an id', `scope=home&id=${PROJECT}`],
    ['project without an id', 'scope=project'],
    ['a non-uuid id', 'scope=project&id=nope'],
    ['an unknown orientation', 'scope=home&orientation=square'],
    ['an extra parameter', 'scope=home&allowUncensored=true'],
    ['an image without a seed', 'action=image&scope=home'],
    ['an unknown action', 'action=delete&scope=home'],
  ])('refuses %s with 400', async (_label, query) => {
    loadPool.mockResolvedValue(pool(5))
    const res = await get(query)
    expect(res.status).toBe(400)
  })
})

describe('status', () => {
  it('answers url: null without reading a pool when the setting is off', async () => {
    const res = await get('scope=home', ctx({ enabled: false }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ enabled: false, available: false, url: null })
    expect(loadPool).not.toHaveBeenCalled()
  })

  it('answers available: false below the floor', async () => {
    loadPool.mockResolvedValue(pool(2) as never)
    const body = await (await get('scope=home')).json()
    expect(body).toMatchObject({ enabled: true, available: false, count: 2, url: null })
  })

  it('mints a fresh image URL on every call', async () => {
    loadPool.mockResolvedValue(pool(5) as never)
    const a = await (await get(`scope=project&id=${PROJECT}&orientation=portrait`)).json()
    const b = await (await get(`scope=project&id=${PROJECT}&orientation=portrait`)).json()
    expect(a).toMatchObject({ enabled: true, available: true, count: 5, refreshMinutes: 3 })
    expect(a.url).toMatch(/action=image&scope=project&id=.+&orientation=portrait&seed=[0-9a-f]+$/)
    expect(a.url).not.toBe(b.url)
  })

  it('is a 404 for an unknown project', async () => {
    loadPool.mockRejectedValue(new CollageScopeNotFoundError('project', PROJECT))
    expect((await get(`scope=project&id=${PROJECT}`)).status).toBe(404)
  })
})

describe('image', () => {
  it('is a 404 when the setting is off', async () => {
    const res = await get('action=image&scope=home&seed=abc123', ctx({ enabled: false }))
    expect(res.status).toBe(404)
    expect(compose).not.toHaveBeenCalled()
  })

  it('is a 404 below the floor', async () => {
    loadPool.mockResolvedValue(pool(2) as never)
    expect((await get('action=image&scope=home&seed=abc123')).status).toBe(404)
  })

  it('is a 404 when too few pictures could be read', async () => {
    loadPool.mockResolvedValue(pool(4) as never)
    compose.mockResolvedValue(null)
    expect((await get('action=image&scope=home&seed=abc123')).status).toBe(404)
  })

  it('serves the WebP inline with the stored-bytes headers, and reuses it for the same URL', async () => {
    loadPool.mockResolvedValue(pool(4) as never)
    compose.mockResolvedValue(Buffer.from('RIFFxxxxWEBP'))
    const res = await get('action=image&scope=home&seed=abc123')
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('content-disposition')).toMatch(/^inline/)
    await get('action=image&scope=home&seed=abc123')
    expect(compose).toHaveBeenCalledTimes(1)
  })

  it('takes the uncensored rule from the stored settings, never the query', async () => {
    loadPool.mockResolvedValue(pool(4) as never)
    compose.mockResolvedValue(Buffer.from('x'))
    await get('action=image&scope=home&seed=abc123', ctx({ ...ON, allowUncensored: true }))
    expect(loadPool.mock.calls[0][1]).toMatchObject({ allowUncensored: true })
    await get('action=image&scope=home&seed=abc124', ctx(ON))
    expect(loadPool.mock.calls[1][1]).toMatchObject({ allowUncensored: false })
  })
})
