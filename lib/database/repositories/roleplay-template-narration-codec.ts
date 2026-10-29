/**
 * Storage codec for `roleplay_templates.narrationDelimiters`.
 *
 * The field is a string, an `[open, close]` pair, or `null` (unmarked prose).
 * A string-or-tuple union is not a JSON column to the schema classifier, so the
 * SQLite layer stored a pair as JSON text and handed it back as that *string*
 * (Quilltap RP's `["[","]"]` reached the composer as one eight-character
 * delimiter), and a `null` came back as `undefined`, which the schema default
 * then turned into `'*'`. The repository therefore writes the field as JSON text
 * itself and decodes it on every read.
 *
 * Decoding accepts legacy rows too: a raw delimiter string (`*`, `+`) that is not
 * JSON is returned as-is.
 *
 * @module database/repositories/roleplay-template-narration-codec
 */

import type { NarrationDelimiters } from '@/lib/schemas/template.types'

function isPair(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((v) => typeof v === 'string' && v.length > 0)
  )
}

/** Encode a narration value as the JSON text the column stores. */
export function encodeNarrationDelimiters(value: NarrationDelimiters | null): string {
  return JSON.stringify(value)
}

/**
 * Decode a stored narration value. `undefined` (a NULL column on a legacy row)
 * reads as the historical default `'*'`.
 */
export function decodeNarrationDelimiters(stored: unknown): NarrationDelimiters | null {
  if (stored === null) return null
  if (isPair(stored)) return stored
  if (typeof stored !== 'string' || stored.length === 0) return '*'
  try {
    const parsed: unknown = JSON.parse(stored)
    if (parsed === null) return null
    if (typeof parsed === 'string' && parsed.length > 0) return parsed
    if (isPair(parsed)) return parsed
  } catch {
    // Not JSON — a legacy raw delimiter string.
  }
  return stored
}
