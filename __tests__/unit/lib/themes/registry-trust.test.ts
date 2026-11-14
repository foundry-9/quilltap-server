/**
 * @jest-environment node
 */

/**
 * Registry trust: an index that fails verification under its source's key is
 * refused (fresh or cached), a cached index is re-verified rather than
 * trusted by its stored flag, and a signed bundle must verify before install.
 */

import { execFileSync } from 'child_process'
import crypto from 'crypto'
import fs from 'fs'
import os from 'os'
import path from 'path'

jest.mock('@/lib/logger', () => {
  const l: any = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  l.child = jest.fn(() => l)
  return { logger: l }
})

let themesDir = ''
jest.mock('@/lib/paths', () => ({
  getThemesDir: jest.fn(() => themesDir),
}))

const mockSafeFetch = jest.fn()
jest.mock('@/lib/net/safe-fetch', () => ({
  safeFetch: (...args: unknown[]) => mockSafeFetch(...args),
  SafeFetchError: class SafeFetchError extends Error { code = 'X' },
}))

const mockInstallThemeBundle = jest.fn()
jest.mock('@/lib/themes/bundle-loader', () => ({
  installThemeBundle: (...args: unknown[]) => mockInstallThemeBundle(...args),
}))

import { generateKeyPair, signData, hashBuffer } from '@/lib/themes/crypto'
import { checkBundleSignature, RegistryVerificationError } from '@/lib/themes/registry-trust'
import { fetchRegistryIndex, installFromRegistry, saveSources } from '@/lib/themes/registry-client'
import type { RegistrySource } from '@/lib/themes/types'

const REGISTRY_URL = 'https://registry.example.com/index.json'

function themeEntry(sha256 = 'abc') {
  return {
    id: 'test-theme',
    name: 'Test Theme',
    version: '1.0.0',
    author: 'Someone',
    supportsDarkMode: true,
    downloadUrl: 'https://registry.example.com/test-theme.qtap-theme',
    sha256,
    publishedAt: '2026-01-01T00:00:00.000Z',
  }
}

function makeIndex(themes: unknown[], privateKey?: string) {
  return {
    registry: { name: 'Example', url: REGISTRY_URL, version: 1 as const },
    themes,
    ...(privateKey ? { signature: signData(JSON.stringify(themes), privateKey) } : {}),
  }
}

function source(publicKey?: string): RegistrySource {
  return {
    name: 'Example',
    url: REGISTRY_URL,
    enabled: true,
    publicKey,
    trusted: false,
    addedAt: '2026-01-01T00:00:00.000Z',
    lastFetched: null,
  }
}

function jsonResponse(body: unknown) {
  const buf = Buffer.from(JSON.stringify(body))
  return { ok: true, status: 200, body: buf, json: () => JSON.parse(buf.toString()) }
}

function bundleZip(files: Record<string, string>): Buffer {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-bundle-src-'))
  for (const [name, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true })
    fs.writeFileSync(path.join(dir, name), content)
  }
  const zipPath = `${dir}.zip`
  execFileSync('zip', ['-r', zipPath, '.'], { cwd: dir, stdio: 'ignore' })
  const buf = fs.readFileSync(zipPath)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.rmSync(zipPath, { force: true })
  return buf
}

const sha = (s: string) => crypto.createHash('sha256').update(s).digest('hex')

beforeEach(() => {
  themesDir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-themes-'))
  mockSafeFetch.mockReset()
  mockInstallThemeBundle.mockReset()
})

afterEach(() => {
  fs.rmSync(themesDir, { recursive: true, force: true })
})

describe('fetchRegistryIndex', () => {
  it('uses an index that verifies under the source key', async () => {
    const { publicKey, privateKey } = generateKeyPair()
    mockSafeFetch.mockResolvedValue(jsonResponse(makeIndex([themeEntry()], privateKey)))
    const result = await fetchRegistryIndex(source(publicKey))
    expect(result.verified).toBe(true)
  })

  it('refuses an index that fails verification when the source has a key, and caches nothing', async () => {
    const { publicKey } = generateKeyPair()
    const other = generateKeyPair()
    mockSafeFetch.mockResolvedValue(jsonResponse(makeIndex([themeEntry()], other.privateKey)))
    await expect(fetchRegistryIndex(source(publicKey))).rejects.toBeInstanceOf(RegistryVerificationError)
    expect(fs.existsSync(path.join(themesDir, '.cache', 'Example.json'))).toBe(false)
  })

  it('refuses an unsigned index when the source has a key', async () => {
    const { publicKey } = generateKeyPair()
    mockSafeFetch.mockResolvedValue(jsonResponse(makeIndex([themeEntry()])))
    await expect(fetchRegistryIndex(source(publicKey))).rejects.toBeInstanceOf(RegistryVerificationError)
  })

  it('accepts an unsigned index from a source without a key, as unverified', async () => {
    mockSafeFetch.mockResolvedValue(jsonResponse(makeIndex([themeEntry()])))
    const result = await fetchRegistryIndex(source())
    expect(result.verified).toBe(false)
  })

  it('re-verifies a cached index instead of trusting its stored flag', async () => {
    const { publicKey } = generateKeyPair()
    // A cache entry claiming verification, but carrying no valid signature.
    fs.mkdirSync(path.join(themesDir, '.cache'), { recursive: true })
    fs.writeFileSync(
      path.join(themesDir, '.cache', 'Example.json'),
      JSON.stringify({ index: makeIndex([themeEntry()]), verified: true })
    )
    // The refetch also fails, so the call must throw rather than use the cache.
    mockSafeFetch.mockResolvedValue(jsonResponse(makeIndex([themeEntry()])))
    await expect(fetchRegistryIndex(source(publicKey))).rejects.toBeInstanceOf(RegistryVerificationError)
    expect(mockSafeFetch).toHaveBeenCalledTimes(1)
  })

  it('reports a cached index from a keyless source as unverified, whatever the stored flag says', async () => {
    fs.mkdirSync(path.join(themesDir, '.cache'), { recursive: true })
    fs.writeFileSync(
      path.join(themesDir, '.cache', 'Example.json'),
      JSON.stringify({ index: makeIndex([themeEntry()]), verified: true })
    )
    const result = await fetchRegistryIndex(source())
    expect(result.verified).toBe(false)
    expect(mockSafeFetch).not.toHaveBeenCalled()
  })
})

describe('checkBundleSignature', () => {
  const files = { 'theme.json': '{"id":"test-theme"}', 'styles.css': 'body{}' }

  function libraryFormat(privateKey: string, publicKey: string, hashes: Record<string, string>) {
    const hashData = Object.entries(hashes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([f, h]) => `${f}:${h}`)
      .join('\n')
    return { algorithm: 'ed25519', signature: signData(hashData, privateKey), manifestHash: hashes['theme.json'], fileHashes: hashes, signedAt: 'x', publicKey }
  }

  function cliFormat(privateKey: string, hashes: Record<string, string>) {
    const hashData = Object.keys(hashes).sort().map((f) => `${hashes[f]}  ${f}`).join('\n')
    return { version: 1, algorithm: 'ed25519', signature: signData(hashData, privateKey), files: hashes, signedAt: 'x' }
  }

  const hashes = Object.fromEntries(Object.entries(files).map(([f, c]) => [f, sha(c)]))

  it('passes an unsigned bundle as unsigned', async () => {
    const { publicKey } = generateKeyPair()
    const result = await checkBundleSignature(bundleZip(files), source(publicKey))
    expect(result).toMatchObject({ ok: true, signed: false })
  })

  it('verifies a library-format signature under the source key', async () => {
    const { publicKey, privateKey } = generateKeyPair()
    const zip = bundleZip({ ...files, 'signature.json': JSON.stringify(libraryFormat(privateKey, publicKey, hashes)) })
    expect(await checkBundleSignature(zip, source(publicKey))).toMatchObject({ ok: true, verified: true })
  })

  it('verifies a CLI-format signature inside a wrapping folder', async () => {
    const { publicKey, privateKey } = generateKeyPair()
    const wrapped = Object.fromEntries(Object.entries(files).map(([f, c]) => [`root/${f}`, c]))
    const zip = bundleZip({ ...wrapped, 'root/signature.json': JSON.stringify(cliFormat(privateKey, hashes)) })
    expect(await checkBundleSignature(zip, source(publicKey))).toMatchObject({ ok: true, verified: true })
  })

  it('refuses a signature made by another key', async () => {
    const { publicKey } = generateKeyPair()
    const other = generateKeyPair()
    const zip = bundleZip({ ...files, 'signature.json': JSON.stringify(cliFormat(other.privateKey, hashes)) })
    expect(await checkBundleSignature(zip, source(publicKey))).toMatchObject({ ok: false, signed: true })
  })

  it('refuses a bundle whose files differ from the signed set', async () => {
    const { publicKey, privateKey } = generateKeyPair()
    const zip = bundleZip({
      ...files,
      'extra.css': 'x',
      'signature.json': JSON.stringify(cliFormat(privateKey, hashes)),
    })
    const result = await checkBundleSignature(zip, source(publicKey))
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('Unexpected file: extra.css')
  })
})

describe('installFromRegistry', () => {
  it('refuses to install a bundle whose signature fails', async () => {
    const { publicKey, privateKey } = generateKeyPair()
    const other = generateKeyPair()
    const files = { 'theme.json': '{"id":"test-theme"}' }
    const hashes = { 'theme.json': sha(files['theme.json']) }
    const hashData = `${hashes['theme.json']}  theme.json`
    const zip = bundleZip({
      ...files,
      'signature.json': JSON.stringify({ version: 1, algorithm: 'ed25519', signature: signData(hashData, other.privateKey), files: hashes }),
    })
    await saveSources({ version: 1, sources: [source(publicKey)] })
    mockSafeFetch.mockImplementation(async (url: string) =>
      url === REGISTRY_URL
        ? jsonResponse(makeIndex([themeEntry(hashBuffer(zip))], privateKey))
        : { ok: true, status: 200, body: zip }
    )

    const result = await installFromRegistry('test-theme', REGISTRY_URL)

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/signature/i)
    expect(mockInstallThemeBundle).not.toHaveBeenCalled()
  })

  it('refuses to install from a source whose index fails verification', async () => {
    const { publicKey } = generateKeyPair()
    await saveSources({ version: 1, sources: [source(publicKey)] })
    mockSafeFetch.mockResolvedValue(jsonResponse(makeIndex([themeEntry()])))

    const result = await installFromRegistry('test-theme', REGISTRY_URL)

    expect(result.success).toBe(false)
    expect(mockInstallThemeBundle).not.toHaveBeenCalled()
  })
})
