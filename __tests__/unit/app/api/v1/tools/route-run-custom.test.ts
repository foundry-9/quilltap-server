/**
 * Regression test for commit 31d9be49: `run_custom` (Pascal's custom
 * pseudo-tools) was missing from the hand-maintained catalogue behind
 * GET /api/v1/tools, so however valid a Tools/*.tool.json definition was, the
 * tool never appeared in any per-chat tool list. It is now registered under the
 * `utility` category. The catalogue has no drift guard (deferred as a
 * follow-up), so this test pins run_custom's presence explicitly.
 */

// Use global `jest` so module mocks hoist before the route import.

let mockCtx: any

jest.mock('@/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn(), child: jest.fn().mockReturnThis() },
}))

jest.mock('@/lib/api/middleware', () => ({
  createContextHandler: (handler: (req: any, ctx: any) => Promise<any>) => {
    return async (req: any) => handler(req, mockCtx)
  },
}))

jest.mock('@/lib/api/responses', () => ({
  successResponse: (data: any) => ({ __kind: 'success', data }),
  serverError: (msg: string) => ({ __kind: 'serverError', msg }),
}))

jest.mock('@/lib/plugins/tool-registry', () => ({
  toolRegistry: { getAllPlugins: jest.fn(() => []) },
}))

jest.mock('@/lib/tools/handlers/web-search-handler', () => ({
  isWebSearchConfigured: jest.fn(() => false),
}))

import { GET } from '@/app/api/v1/tools/route'

function req(search = '') {
  return { nextUrl: { searchParams: new URLSearchParams(search) } }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockCtx = {
    user: { id: 'user-1' },
    repos: {
      pluginConfigs: { findByUserId: jest.fn().mockResolvedValue([]) },
    },
  }
})

it.each(['run_custom', 'edit_custom_tool'])('lists %s as a user-toggleable built-in in the Pascal group', async (id) => {
  const res: any = await GET(req(), undefined as any)

  expect(res.__kind).toBe('success')
  const tool = res.data.tools.find((t: any) => t.id === id)
  expect(tool).toBeDefined()
  expect(tool).toMatchObject({
    source: 'built-in',
    category: 'pascal',
    userInvocable: true,
  })
})

it.each(['run_custom', 'edit_custom_tool'])('includes %s\'s parameters schema when includeSchemas=true', async (id) => {
  const res: any = await GET(req('includeSchemas=true'), undefined as any)
  const tool = res.data.tools.find((t: any) => t.id === id)
  expect(tool?.parameters).toBeDefined()
})
