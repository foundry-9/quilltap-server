/**
 * Error translation drives the user-facing recovery: every failure rolls back
 * the optimistic SVAR change, the cross-storage refusal offers "copy instead",
 * the mtime/dest-exists cases are flagged as conflicts, and an unrecognized
 * response still degrades to a sensible verdict via HTTP status.
 */

import { translateMountOpError } from '@/components/files/svar/error-translation'

describe('translateMountOpError', () => {
  it('offers copy on the cross-storage UNSUPPORTED refusal', () => {
    const v = translateMountOpError({ status: 400, code: 'UNSUPPORTED' })
    expect(v.suggestCopy).toBe(true)
    expect(v.rollback).toBe(true)
    expect(v.message).toMatch(/copy/i)
  })

  it('flags DEST_EXISTS and CONFLICT as conflicts (not copy offers)', () => {
    expect(translateMountOpError({ status: 409, code: 'DEST_EXISTS' }).conflict).toBe(true)
    const c = translateMountOpError({ status: 409, code: 'CONFLICT' })
    expect(c.conflict).toBe(true)
    expect(c.suggestCopy).toBe(false)
    expect(c.message).toMatch(/changed on disk/i)
  })

  it('handles the database-store codes (NOT_EMPTY / NOT_FOUND / INVALID)', () => {
    expect(translateMountOpError({ code: 'NOT_EMPTY' }).message).toMatch(/empty/i)
    expect(translateMountOpError({ code: 'NOT_FOUND' }).rollback).toBe(true)
    expect(translateMountOpError({ code: 'INVALID' }).suggestCopy).toBe(false)
  })

  it('always rolls back, even for an unrecognized failure', () => {
    expect(translateMountOpError({ status: 500 }).rollback).toBe(true)
  })

  it('falls back on HTTP status when no code is present', () => {
    expect(translateMountOpError({ status: 409 }).conflict).toBe(true)
    expect(translateMountOpError({ status: 404 }).message).toMatch(/can’t lay hands/i)
    expect(translateMountOpError({ status: 400 }).suggestCopy).toBe(false)
  })

  it('prefers the body code over the status', () => {
    // 400 status but UNSUPPORTED code → still the copy offer.
    expect(translateMountOpError({ status: 400, code: 'UNSUPPORTED' }).suggestCopy).toBe(true)
  })
})
