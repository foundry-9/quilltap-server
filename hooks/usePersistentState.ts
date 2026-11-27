'use client'

/**
 * usePersistentState — a `useState` mirrored to one `localStorage` key and
 * kept in step with other browser tabs.
 *
 * - The first render uses `initial`; the stored value is read after hydration
 *   (a lazy initializer would mismatch the server render).
 * - Once that read has happened, every value is written back under `key`.
 * - A `storage` event for `key` from another tab replaces the value.
 *
 * `codec.parse` turns the stored text into a value, or `undefined` to ignore
 * it (malformed, or the wrong shape) and keep what is there. For per-viewer
 * conveniences only: a private window or blocked storage just keeps `initial`.
 *
 * @module hooks/usePersistentState
 */

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

export interface PersistentStateCodec<T> {
  parse: (raw: string) => T | undefined
  serialize: (value: T) => string
}

/** `'true'` / `'false'`. */
export const booleanCodec: PersistentStateCodec<boolean> = {
  parse: (raw) => raw === 'true',
  serialize: (value) => (value ? 'true' : 'false'),
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function usePersistentState<T>(
  key: string,
  initial: T,
  codec: PersistentStateCodec<T>,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(initial)
  const [storageReady, setStorageReady] = useState(false)
  const { parse, serialize } = codec

  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const raw = window.localStorage.getItem(key)
      const parsed = raw === null ? undefined : parse(raw)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the stored value is read after hydration (see module comment)
      if (parsed !== undefined) setValue(parsed)
    } catch (error) {
      console.warn('Unable to load stored preference', { key, error: errorMessage(error) })
    } finally {
      setStorageReady(true)
    }
  }, [key, parse])

  useEffect(() => {
    if (!storageReady || typeof window === 'undefined') return
    try {
      window.localStorage.setItem(key, serialize(value))
    } catch (error) {
      console.warn('Unable to persist stored preference', { key, error: errorMessage(error) })
    }
  }, [key, serialize, value, storageReady])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handler = (event: StorageEvent) => {
      if (event.key !== key || event.newValue === null) return
      let parsed: T | undefined
      try {
        parsed = parse(event.newValue)
      } catch {
        return
      }
      if (parsed !== undefined) setValue(parsed)
    }
    window.addEventListener('storage', handler)
    return () => window.removeEventListener('storage', handler)
  }, [key, parse])

  return [value, setValue]
}
