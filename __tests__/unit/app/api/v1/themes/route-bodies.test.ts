/**
 * @jest-environment node
 *
 * The themes collection route's POST actions: each JSON body is read against
 * its schema (a body that is not an object, or lacks a field, is a 400 in the
 * route's own words, never a 500), and an uploaded bundle is written under
 * the last segment of its filename only — the name is the caller's, and must
 * never steer the write out of the temporary directory.
 */

jest.mock('@/lib/logger', () => {
  const mock: Record<string, unknown> = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  mock.child = jest.fn(() => mock)
  return { logger: mock }
})

jest.mock('@/lib/startup/plugin-initialization', () => ({
  isPluginSystemInitialized: jest.fn(() => true),
  initializePlugins: jest.fn(),
}))

jest.mock('@/lib/themes/theme-registry', () => ({ themeRegistry: {} }))

jest.mock('@/lib/themes/hot-load', () => ({ hotLoadInstalledTheme: jest.fn() }))

jest.mock('@/lib/themes/bundle-loader', () => ({
  installThemeBundle: jest.fn(),
  installThemeBundleFromUrl: jest.fn(),
}))

jest.mock('@/lib/themes/registry-client', () => ({
  addSource: jest.fn(),
  removeSource: jest.fn(),
  installFromRegistry: jest.fn(),
}))

import os from 'os'
import path from 'path'
import { NextRequest } from 'next/server'
import { POST } from '@/app/api/v1/themes/route'
import { installThemeBundle, installThemeBundleFromUrl } from '@/lib/themes/bundle-loader'
import { addSource, installFromRegistry, removeSource } from '@/lib/themes/registry-client'

const installMock = installThemeBundle as jest.Mock
const installFromUrlMock = installThemeBundleFromUrl as jest.Mock
const addSourceMock = addSource as jest.Mock
const removeSourceMock = removeSource as jest.Mock
const installFromRegistryMock = installFromRegistry as jest.Mock

function post(action: string, body: unknown, raw = false): Promise<Response> {
  return POST(
    new NextRequest(`http://localhost/api/v1/themes?action=${action}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: raw ? (body as string) : JSON.stringify(body),
    })
  )
}

async function errorOf(res: Response): Promise<string> {
  return ((await res.json()) as { error: string }).error
}

describe('POST /api/v1/themes — JSON bodies', () => {
  beforeEach(() => jest.clearAllMocks())

  it.each(['install-from-url', 'add-source', 'remove-source', 'install-registry'])(
    '%s answers unparseable JSON with a 400',
    async (action) => {
      const res = await post(action, '{nope', true)
      expect(res.status).toBe(400)
      expect(await errorOf(res)).toBe('Invalid JSON body')
    }
  )

  it.each(['install-from-url', 'add-source', 'remove-source', 'install-registry'])(
    '%s answers a body that is not an object with a 400, not a 500',
    async (action) => {
      const res = await post(action, null)
      expect(res.status).toBe(400)
    }
  )

  it('install-from-url names a missing url, and a url that is not one', async () => {
    expect(await errorOf(await post('install-from-url', {}))).toBe('Missing or invalid "url" field')
    expect(await errorOf(await post('install-from-url', { url: 7 }))).toBe('Missing or invalid "url" field')
    expect(await errorOf(await post('install-from-url', { url: 'not a url' }))).toBe('Invalid URL format')
    expect(installFromUrlMock).not.toHaveBeenCalled()
  })

  it('install-from-url hands a valid url to the installer', async () => {
    installFromUrlMock.mockResolvedValue({ success: true, themeId: 'tidy', version: '1.0.0' })
    const res = await post('install-from-url', { url: 'https://example.com/tidy.qtap-theme' })
    expect(res.status).toBe(201)
    expect(installFromUrlMock).toHaveBeenCalledWith('https://example.com/tidy.qtap-theme')
  })

  it('add-source names the source after its host when no name is given', async () => {
    addSourceMock.mockResolvedValue({ name: 'example.com' })
    const res = await post('add-source', { url: 'https://example.com/index.json', publicKey: 'k' })
    expect(res.status).toBe(201)
    expect(addSourceMock).toHaveBeenCalledWith({
      name: 'example.com',
      url: 'https://example.com/index.json',
      publicKey: 'k',
    })
  })

  it('add-source refuses a missing or malformed url', async () => {
    expect(await errorOf(await post('add-source', { name: 'x' }))).toBe('Missing or invalid "url" field')
    expect(await errorOf(await post('add-source', { url: '::' }))).toBe('Invalid URL format')
    expect(addSourceMock).not.toHaveBeenCalled()
  })

  it('remove-source needs a name', async () => {
    expect(await errorOf(await post('remove-source', { name: '' }))).toBe('Missing or invalid "name" field')
    expect(removeSourceMock).not.toHaveBeenCalled()

    removeSourceMock.mockResolvedValue(true)
    expect((await post('remove-source', { name: 'mine' })).status).toBe(200)
    expect(removeSourceMock).toHaveBeenCalledWith('mine')
  })

  it('install-registry needs both fields', async () => {
    expect(await errorOf(await post('install-registry', { registryUrl: 'u' }))).toBe('Missing or invalid "themeId" field')
    expect(await errorOf(await post('install-registry', { themeId: 't' }))).toBe('Missing or invalid "registryUrl" field')
    expect(installFromRegistryMock).not.toHaveBeenCalled()
  })

  it('refuses an unknown action', async () => {
    expect((await post('obliterate', {})).status).toBe(400)
  })
})

describe('POST /api/v1/themes?action=install — the upload filename', () => {
  beforeEach(() => jest.clearAllMocks())

  async function upload(filename: string): Promise<string> {
    installMock.mockResolvedValue({ success: true, themeId: 'tidy', version: '1.0.0' })
    const form = new FormData()
    form.append('theme', new File([new Uint8Array([1, 2, 3])], filename))
    const res = await POST(
      new NextRequest('http://localhost/api/v1/themes?action=install', { method: 'POST', body: form })
    )
    expect(res.status).toBe(201)
    return installMock.mock.calls[0][0] as string
  }

  function expectInsideUploadDir(written: string): void {
    const dir = path.dirname(written)
    expect(path.basename(dir)).toMatch(/^qtap-theme-upload-/)
    expect(path.resolve(path.dirname(dir))).toBe(path.resolve(os.tmpdir()))
  }

  it('keeps an ordinary filename', async () => {
    const written = await upload('art-deco.qtap-theme')
    expect(path.basename(written)).toBe('art-deco.qtap-theme')
    expectInsideUploadDir(written)
  })

  it.each(['../../escape.qtap-theme', '/etc/escape.qtap-theme', 'a/b/../../../escape.qtap-theme'])(
    'keeps only the last segment of %s',
    async (name) => {
      const written = await upload(name)
      expect(path.basename(written)).toBe('escape.qtap-theme')
      expectInsideUploadDir(written)
    }
  )

  it.each(['..', '.'])('falls back to a fixed name for %s', async (name) => {
    const written = await upload(name)
    expect(path.basename(written)).toBe('theme.qtap-theme')
    expectInsideUploadDir(written)
  })
})
