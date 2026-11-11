/**
 * The API-key routes validate through `lib/api-keys/api-key-input.ts`; the
 * messages are the ones the hand checks used, now delivered by the
 * middleware's 400.
 */

import {
  ApiKeyCreateSchema,
  ApiKeyUpdateSchema,
  ApiKeyExportSchema,
  ApiKeyImportSchema,
  ApiKeyImportPreviewSchema,
} from '@/lib/api-keys/api-key-input'

const file = {
  format: 'quilltap-apikeys',
  version: 1,
  exportedAt: '2026-01-01T00:00:00.000Z',
  keyCount: 1,
  encryption: { algorithm: 'aes-256-gcm', kdf: 'pbkdf2', kdfIterations: 600000, salt: 's' },
  payload: { ciphertext: 'c', iv: 'i', authTag: 'a' },
  signature: 'sig',
}

const firstMessage = (r: { success: boolean; error?: { issues: { message: string }[] } }) => r.error?.issues[0]?.message

describe('ApiKeyCreateSchema', () => {
  it('trims provider and label, keeps the key as sent', () => {
    expect(ApiKeyCreateSchema.parse({ provider: ' OPENAI ', label: ' Work ', apiKey: ' sk-1 ' })).toEqual({
      provider: 'OPENAI', label: 'Work', apiKey: ' sk-1 ',
    })
  })

  it.each([
    [{ provider: '', label: 'x', apiKey: 'k' }, 'Invalid provider'],
    [{ provider: 'P', label: '  ', apiKey: 'k' }, 'Label is required'],
    [{ provider: 'P', label: 'x' }, 'API key is required'],
  ])('refuses %j with %s', (body, message) => {
    expect(firstMessage(ApiKeyCreateSchema.safeParse(body))).toBe(message)
  })

  it('refuses an unknown key', () => {
    expect(ApiKeyCreateSchema.safeParse({ provider: 'P', label: 'x', apiKey: 'k', isActive: false }).success).toBe(false)
  })
})

describe('ApiKeyUpdateSchema', () => {
  it('takes any subset', () => {
    expect(ApiKeyUpdateSchema.parse({ isActive: false })).toEqual({ isActive: false })
    expect(ApiKeyUpdateSchema.parse({})).toEqual({})
  })

  it('refuses a string isActive and a blank label', () => {
    expect(firstMessage(ApiKeyUpdateSchema.safeParse({ isActive: 'no' }))).toBe('isActive must be a boolean')
    expect(firstMessage(ApiKeyUpdateSchema.safeParse({ label: '' }))).toBe('Label must be a non-empty string')
  })
})

describe('export and import bodies', () => {
  it('holds the passphrase to its minimum', () => {
    expect(firstMessage(ApiKeyExportSchema.safeParse({ passphrase: 'short' }))).toBe('Passphrase must be at least 8 characters')
    expect(ApiKeyExportSchema.safeParse({ passphrase: 'long enough' }).success).toBe(true)
  })

  it('defaults duplicate handling to skip and refuses an unknown one', () => {
    expect(ApiKeyImportSchema.parse({ file, passphrase: 'p' }).duplicateHandling).toBe('skip')
    expect(firstMessage(ApiKeyImportSchema.safeParse({ file, passphrase: 'p', duplicateHandling: 'merge' }))).toBe(
      'Invalid duplicate handling option',
    )
  })

  it.each([
    [{ ...file, format: 'other' }, 'Invalid file format'],
    [{ ...file, version: 9 }, 'Unsupported file version: 9'],
    [{ ...file, payload: { ciphertext: 'c', iv: '', authTag: 'a' } }, 'Invalid file structure'],
  ])('refuses a bad file (%#) with %s', (bad, message) => {
    expect(firstMessage(ApiKeyImportPreviewSchema.safeParse({ file: bad, passphrase: 'p' }))).toBe(message)
  })

  it('reads a file written before the iteration count was recorded', () => {
    const { kdfIterations: _omit, ...encryption } = file.encryption
    expect(ApiKeyImportPreviewSchema.safeParse({ file: { ...file, encryption }, passphrase: 'p' }).success).toBe(true)
  })
})
