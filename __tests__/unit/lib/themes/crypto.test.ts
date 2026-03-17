import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    child: jest.fn(() => ({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    })),
  },
}))

import {
  generateKeyPair,
  signData,
  verifySignature,
  verifyRegistryIndex,
  signBundleDirectory,
  verifyBundleSignature,
} from '@/lib/themes/crypto'

async function createBundleDir(): Promise<string> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qtap-crypto-test-'))
  await fs.writeFile(
    path.join(tempDir, 'theme.json'),
    JSON.stringify({
      format: 'qtap-theme',
      formatVersion: 1,
      id: 'test-theme',
      name: 'Test Theme',
      version: '1.0.0',
    }, null, 2)
  )
  await fs.mkdir(path.join(tempDir, 'assets'), { recursive: true })
  await fs.writeFile(path.join(tempDir, 'assets', 'styles.css'), 'body { color: red; }')
  return tempDir
}

describe('theme crypto', () => {
  let tempDirs: string[]

  beforeEach(() => {
    tempDirs = []
  })

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })))
  })

  it('signs and verifies data with prefixed and unprefixed keys', () => {
    const { publicKey, privateKey } = generateKeyPair()

    const signature = signData('registry payload', privateKey)

    expect(signature.startsWith('ed25519:')).toBe(true)
    expect(verifySignature('registry payload', signature, publicKey)).toBe(true)
    expect(
      verifySignature(
        'registry payload',
        signature.replace(/^ed25519:/, ''),
        publicKey.replace(/^ed25519:/, '')
      )
    ).toBe(true)
  })

  it('rejects tampered data and malformed keys', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const signature = signData('bundle hash data', privateKey)

    expect(verifySignature('tampered bundle hash data', signature, publicKey)).toBe(false)
    expect(verifySignature('bundle hash data', signature, 'not-a-real-key')).toBe(false)
  })

  it('verifies registry signatures against the serialized themes list', () => {
    const { publicKey, privateKey } = generateKeyPair()
    const themes = [
      { id: 'art-deco', version: '1.0.0' },
      { id: 'rains', version: '1.2.0' },
    ]
    const signature = signData(JSON.stringify(themes), privateKey)

    expect(verifyRegistryIndex({ themes, signature }, publicKey)).toBe(true)
    expect(
      verifyRegistryIndex({
        themes: [...themes, { id: 'old-school', version: '1.0.0' }],
        signature,
      }, publicKey)
    ).toBe(false)
    expect(verifyRegistryIndex({ themes }, publicKey)).toBe(false)
  })

  it('signs and verifies a bundle directory', async () => {
    const { publicKey, privateKey } = generateKeyPair()
    const bundleDir = await createBundleDir()
    tempDirs.push(bundleDir)

    const signature = await signBundleDirectory(bundleDir, privateKey, publicKey)
    const result = await verifyBundleSignature(bundleDir, signature, publicKey)

    expect(signature.algorithm).toBe('ed25519')
    expect(signature.publicKey).toBe(publicKey)
    expect(signature.fileHashes).toEqual(
      expect.objectContaining({
        'theme.json': expect.any(String),
        'assets/styles.css': expect.any(String),
      })
    )
    expect(result).toEqual({ valid: true, errors: [] })
  })

  it('detects modified and unexpected files in a signed bundle', async () => {
    const { publicKey, privateKey } = generateKeyPair()
    const bundleDir = await createBundleDir()
    tempDirs.push(bundleDir)

    const signature = await signBundleDirectory(bundleDir, privateKey, publicKey)

    await fs.writeFile(path.join(bundleDir, 'assets', 'styles.css'), 'body { color: blue; }')
    await fs.writeFile(path.join(bundleDir, 'notes.txt'), 'unexpected file')

    const result = await verifyBundleSignature(bundleDir, signature, publicKey)

    expect(result.valid).toBe(false)
    expect(result.errors).toEqual(
      expect.arrayContaining([
        'Modified file: assets/styles.css',
        'Unexpected file: notes.txt',
      ])
    )
  })
})