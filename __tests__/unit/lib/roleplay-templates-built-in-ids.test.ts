/**
 * Built-in roleplay templates have the same id on every instance (#190).
 */
import { describe, it, expect } from '@jest/globals'
import { createHash } from 'crypto'
import {
  uuidV5,
  builtInRoleplayTemplateId,
  BUILT_IN_ROLEPLAY_TEMPLATE_IDS,
  BUILT_IN_ROLEPLAY_TEMPLATE_NAMES,
  isBuiltInRoleplayTemplateId,
} from '@/lib/roleplay-templates/built-in-ids'

/** Reference UUIDv5 over Node's own SHA-1. */
function referenceV5(name: string, namespace: string): string {
  const ns = Buffer.from(namespace.replace(/-/g, ''), 'hex')
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(name, 'utf8')])).digest().subarray(0, 16)
  hash[6] = (hash[6] & 0x0f) | 0x50
  hash[8] = (hash[8] & 0x3f) | 0x80
  const hex = hash.toString('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

describe('built-in roleplay template ids', () => {
  it('matches the RFC 4122 v5 test vector (DNS namespace, python.org)', () => {
    expect(uuidV5('python.org', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d')
  })

  it('agrees with a reference implementation for each built-in and for long names', () => {
    for (const name of [...BUILT_IN_ROLEPLAY_TEMPLATE_NAMES, 'x'.repeat(200), 'Ünïcødé']) {
      expect(uuidV5(name, '5d0c2f7e-3b8a-4c61-9e4f-7a2b1c9d8e60')).toBe(referenceV5(name, '5d0c2f7e-3b8a-4c61-9e4f-7a2b1c9d8e60'))
    }
  })

  it('is stable and distinct per built-in', () => {
    expect(builtInRoleplayTemplateId('Standard')).toBe(builtInRoleplayTemplateId('Standard'))
    expect(BUILT_IN_ROLEPLAY_TEMPLATE_IDS.size).toBe(BUILT_IN_ROLEPLAY_TEMPLATE_NAMES.length)
    expect(isBuiltInRoleplayTemplateId(builtInRoleplayTemplateId('Novel'))).toBe(true)
    expect(isBuiltInRoleplayTemplateId('00000000-0000-4000-8000-000000000000')).toBe(false)
    expect(isBuiltInRoleplayTemplateId(null)).toBe(false)
  })
})
