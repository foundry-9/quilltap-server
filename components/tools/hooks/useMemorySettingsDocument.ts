'use client'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { apiFetch } from '@/lib/query/fetcher'
import { readErrorText, writeErrorText } from './api-error-text'

/**
 * One instance-wide memory settings document (`/api/v1/memories?action=<name>-config`):
 * read through TanStack Query, held as local form state, and saved one patch
 * at a time. The server merges each patch over the stored value (bug 244), so
 * a section sends only what it changed.
 *
 * @module components/tools/hooks/useMemorySettingsDocument
 */
export interface MemorySettingsDocument<T> {
  config: T
  /** Replace the local form state without saving (a draft being typed). */
  setConfig: React.Dispatch<React.SetStateAction<T>>
  loading: boolean
  saving: boolean
  error: string | null
  setError: (message: string | null) => void
  /** POST one patch; resolves true when it saved. */
  save: (patch: Partial<T>) => Promise<boolean>
}

export function useMemorySettingsDocument<T extends object>(options: {
  queryKey: readonly unknown[]
  url: string
  /** A module constant: the seeding effect depends on its identity. */
  defaults: T
  /** "consolidation settings", "maintenance settings" — used in the toasts and errors. */
  noun: string
}): MemorySettingsDocument<T> {
  const { queryKey, url, defaults, noun } = options
  const queryClient = useQueryClient()
  const [config, setConfig] = useState<T>(defaults)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The key names the document; the URL is that document's one address.
  // eslint-disable-next-line @tanstack/query/exhaustive-deps
  const { data: loaded, isLoading, error: loadError } = useQuery({
    queryKey,
    queryFn: ({ signal }) => apiFetch<{ settings?: Partial<T> }>(url, { signal }),
  })

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the form is local state seeded from the query
    if (loaded?.settings) setConfig({ ...defaults, ...loaded.settings })
  }, [loaded, defaults])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- surface the read failure in the shared error line
    if (loadError) setError(readErrorText(loadError, `Failed to load ${noun}`))
  }, [loadError, noun])

  const save = async (patch: Partial<T>): Promise<boolean> => {
    setSaving(true)
    setError(null)
    try {
      const data = await apiFetch<{ settings: T }>(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      setConfig({ ...defaults, ...data.settings })
      void queryClient.invalidateQueries({ queryKey })
      showSuccessToast(`${noun.charAt(0).toUpperCase()}${noun.slice(1)} saved`)
      return true
    } catch (err) {
      const msg = writeErrorText(err, `Failed to save ${noun}`)
      setError(msg)
      showErrorToast(msg)
      return false
    } finally {
      setSaving(false)
    }
  }

  return { config, setConfig, loading: isLoading, saving, error, setError, save }
}
