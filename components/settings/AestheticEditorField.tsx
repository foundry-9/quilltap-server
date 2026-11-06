'use client'

/**
 * A Lexical Markdown editor wired to a document-store-backed endpoint.
 *
 * Used by the three "default aesthetic" / depiction-guidelines surfaces:
 *   - Images settings tab  → /api/v1/system/image-aesthetics?kind=…
 *   - Project image settings → /api/v1/projects/[id]?action=aesthetic&kind=…
 *   - Character page        → /api/v1/characters/[id]?action=depiction-guidelines
 *
 * The endpoint's GET returns `{ content }` and its PUT accepts `{ content }`
 * (an empty body deletes the underlying file — restoring any fallback). The
 * file on disk is the source of truth; this field is just a convenience view.
 *
 * `autosave` drops the Save button: the field saves itself after a pause in
 * typing and when focus leaves it (the character page's save model), running
 * each write through the caller's wrapper so the page's status reports it.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import MarkdownLexicalEditor from '@/components/markdown-editor/MarkdownLexicalEditor'

interface AestheticEditorFieldProps {
  label: string
  description?: string
  /** GET returns `{ content }`. */
  loadUrl: string
  /** PUT accepts `{ content }`. Defaults to `loadUrl`. */
  saveUrl?: string
  /** Unique Lexical namespace (avoids cross-editor state bleed). */
  namespace: string
  /** When set, the editor is suppressed and this hint is shown instead. */
  disabledHint?: string
  /**
   * Save without a button: after `idleMs` of quiet and on blur. `run` wraps
   * each write (and must re-throw, or resolve undefined, on failure).
   */
  autosave?: { run: <T>(fn: () => Promise<T>) => Promise<T | undefined>; idleMs?: number }
}

export function AestheticEditorField({
  label,
  description,
  loadUrl,
  saveUrl,
  namespace,
  disabledHint,
  autosave,
}: AestheticEditorFieldProps) {
  const url = saveUrl ?? loadUrl
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [dirty, setDirty] = useState(false)
  // Bumped after a load so the Lexical composer remounts and re-parses the
  // freshly fetched content (MarkdownBridge only reads initialMarkdown once).
  const [remountKey, setRemountKey] = useState(0)
  // The latest text, for the autosave timer and blur, which fire outside render.
  const contentRef = useRef(content)
  const dirtyRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Autosave ignores the editor's change events until it has been focused, so
  // a Markdown normalisation on mount never writes on its own.
  const interactedRef = useRef(false)

  useEffect(() => {
    // When disabled, the hint renders regardless of `loading`, so there's no
    // need to touch state here (and doing so synchronously trips a lint rule).
    if (disabledHint) {
      return
    }
    let cancelled = false
    fetch(loadUrl)
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load (${res.status})`)
        const data = await res.json()
        if (cancelled) return
        const loaded = typeof data?.content === 'string' ? data.content : ''
        contentRef.current = loaded
        setContent(loaded)
        setRemountKey((k) => k + 1)
        setError(null)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadUrl, disabledHint])


  const put = useCallback(
    async (body: string) => {
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: body }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data?.error || `Failed to save (${res.status})`)
      }
      return true
    },
    [url],
  )

  const handleSave = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    const body = contentRef.current
    setSaving(true)
    setError(null)
    try {
      const ok = autosave ? await autosave.run(() => put(body)) : await put(body)
      if (!ok) throw new Error('Failed to save')
      if (contentRef.current === body) {
        dirtyRef.current = false
        setDirty(false)
      }
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }, [autosave, put])

  const handleChange = useCallback(
    (value: string) => {
      if (autosave && !interactedRef.current) return
      contentRef.current = value
      setContent(value)
      dirtyRef.current = true
      setDirty(true)
      setSaved(false)
      if (autosave) {
        if (timerRef.current) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => void handleSave(), autosave.idleMs ?? 1500)
      }
    },
    [autosave, handleSave],
  )

  // Leaving the page with a pending edit still sends it.
  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (autosave && dirtyRef.current) void put(contentRef.current).catch(() => undefined)
    },
    [autosave, put],
  )

  return (
    <div className="space-y-2">
      <div>
        <label className="qt-label">{label}</label>
        {description && <p className="qt-text-small qt-text-muted">{description}</p>}
      </div>

      {disabledHint ? (
        <p className="qt-text-small qt-text-warning">{disabledHint}</p>
      ) : loading ? (
        <div className="qt-text-secondary qt-text-small py-4">Loading…</div>
      ) : (
        <>
          <div
            onFocus={() => {
              interactedRef.current = true
            }}
            onBlur={(e) => {
              if (autosave && dirtyRef.current && !e.currentTarget.contains(e.relatedTarget as Node | null)) {
                void handleSave()
              }
            }}
          >
            <MarkdownLexicalEditor
              value={content}
              onChange={handleChange}
              remountKey={remountKey}
              namespace={namespace}
              ariaLabel={label}
              minHeight="8rem"
            />
          </div>
          {autosave ? (
            error && <p className="qt-text-small qt-text-destructive" role="alert">{error}</p>
          ) : (
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="qt-button qt-button-primary qt-button-sm"
              onClick={handleSave}
              disabled={saving || !dirty}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
            {saved && !dirty && <span className="qt-text-small qt-text-success">Saved</span>}
            {error && <span className="qt-text-small qt-text-destructive">{error}</span>}
          </div>
          )}
        </>
      )}
    </div>
  )
}

export default AestheticEditorField
