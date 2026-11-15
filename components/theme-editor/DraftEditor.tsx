'use client'

/**
 * Calliope's Atelier — editing one draft.
 *
 * Holds the draft's tokens in `useDraft`, previews them app-wide through the
 * theme provider's preview slot (the worn theme and the stored preference
 * untouched), and saves them with debounced PUTs carrying the revision they
 * were read at. A stale revision reloads the draft and says so. Leaving —
 * the back button, a draft switch or the tab closing — flushes what is
 * unsaved and clears the preview.
 *
 * @module components/theme-editor/DraftEditor
 */

import { useCallback, useDeferredValue, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { useTheme } from '@/components/providers/theme-provider'
import { useDraft } from '@/lib/hooks/use-draft'
import { ApiFetchError, apiErrorMessage } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast, showWarningToast } from '@/lib/toast'
import type { ThemeTokensDocument } from '@/lib/themes/engine/client'
import { ColorTokenRow } from './ColorTokenRow'
import { EDITOR_SECTIONS, analyse, buildPreview, primitiveRows, type EditorMode } from './model'
import {
  fetchThemeDraft,
  installThemeDraft,
  saveThemeDraft,
  type DraftDetail,
  type DraftInstallResult,
  type ThemeDraftSave,
} from './use-theme-drafts'

const SAVE_DELAY_MS = 700

const EMPTY_TOKENS: ThemeTokensDocument = { primitives: {}, tokens: {}, choices: {} } as ThemeTokensDocument

type Pending = Omit<ThemeDraftSave, 'revision'>

/**
 * The save queue for one draft: edits merge into one pending body, a timer
 * sends it, one PUT is in flight at a time, and each carries the newest
 * revision seen.
 */
function useDraftSaver(detail: DraftDetail, onConflict: (fresh: DraftDetail) => void) {
  const queryClient = useQueryClient()
  const latest = useRef(detail)
  const pending = useRef<Pending>({})
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inFlight = useRef<Promise<void> | null>(null)
  const [saving, setSaving] = useState(false)
  const onConflictRef = useRef(onConflict)

  useEffect(() => {
    onConflictRef.current = onConflict
  }, [onConflict])

  useEffect(() => {
    // A newer read (realtime refresh, our own save) carries the newer revision.
    if (detail.revision !== latest.current.revision || detail.updatedAt !== latest.current.updatedAt) {
      latest.current = detail
    }
  }, [detail])

  const send = useCallback(
    async (keepalive: boolean): Promise<void> => {
      if (inFlight.current) await inFlight.current
      const body = pending.current
      if (Object.keys(body).length === 0) return
      pending.current = {}
      const id = latest.current.id
      const run = (async () => {
        setSaving(true)
        try {
          const fresh = await saveThemeDraft(id, { ...body, revision: latest.current.revision }, { keepalive })
          latest.current = fresh
          queryClient.setQueryData(queryKeys.themeDrafts.detail(id), fresh)
          void queryClient.invalidateQueries({ queryKey: queryKeys.themeDrafts.list })
        } catch (err) {
          if (err instanceof ApiFetchError && err.status === 409) {
            try {
              const fresh = await fetchThemeDraft(id)
              latest.current = fresh
              queryClient.setQueryData(queryKeys.themeDrafts.detail(id), fresh)
              onConflictRef.current(fresh)
            } catch (reloadErr) {
              showErrorToast(apiErrorMessage(reloadErr, 'The draft changed elsewhere, and could not be fetched again.'))
            }
            showWarningToast('This draft was changed elsewhere in the meantime. The newer version is now before you; your last change was set aside.')
          } else {
            showErrorToast(apiErrorMessage(err, 'The atelier could not save the draft.'))
          }
        } finally {
          setSaving(false)
        }
      })()
      inFlight.current = run
      try {
        await run
      } finally {
        if (inFlight.current === run) inFlight.current = null
      }
    },
    [queryClient],
  )

  const queue = useCallback(
    (part: Pending) => {
      pending.current = { ...pending.current, ...part }
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        timer.current = null
        void send(false)
      }, SAVE_DELAY_MS)
    },
    [send],
  )

  const flush = useCallback(
    (keepalive = false) => {
      if (timer.current) {
        clearTimeout(timer.current)
        timer.current = null
      }
      return send(keepalive)
    },
    [send],
  )

  return { queue, flush, saving }
}

interface DraftEditorProps {
  detail: DraftDetail
  /** The mode edited and shown in this tab (the panel wears it too). */
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
  onBack: () => void
}

export function DraftEditor({ detail, mode, onModeChange, onBack }: DraftEditorProps) {
  const { setPreview, refreshThemes, setTheme } = useTheme()
  const queryClient = useQueryClient()
  const [previewing, setPreviewing] = useState(true)
  const [installing, setInstalling] = useState(false)
  const [installErrors, setInstallErrors] = useState<string[] | null>(null)
  const [installed, setInstalled] = useState<DraftInstallResult | null>(null)
  const nameId = useId()
  const descriptionId = useId()

  const serverTokens = detail.tokens ?? EMPTY_TOKENS
  const [tokens, setTokens] = useDraft<ThemeTokensDocument>(serverTokens)
  const manifestName = typeof detail.manifest?.name === 'string' ? detail.manifest.name : detail.id
  const manifestDescription = typeof detail.manifest?.description === 'string' ? detail.manifest.description : ''
  const [name, setName] = useDraft(manifestName)
  const [description, setDescription] = useDraft(manifestDescription)

  // The JSON last queued or adopted, so an adopted server value is never sent back.
  const lastTokensJson = useRef(JSON.stringify(serverTokens))

  const onConflict = useCallback(
    (fresh: DraftDetail) => {
      const freshTokens = fresh.tokens ?? EMPTY_TOKENS
      lastTokensJson.current = JSON.stringify(freshTokens)
      setTokens(freshTokens)
      setName(typeof fresh.manifest?.name === 'string' ? fresh.manifest.name : fresh.id)
      setDescription(typeof fresh.manifest?.description === 'string' ? fresh.manifest.description : '')
    },
    [setTokens, setName, setDescription],
  )
  const saver = useDraftSaver(detail, onConflict)
  const { queue } = saver

  // Queue a save when the tokens differ from both the server's and what was last queued.
  useEffect(() => {
    if (!detail.tokens) return
    const json = JSON.stringify(tokens)
    if (json === lastTokensJson.current) return
    lastTokensJson.current = json
    if (json === JSON.stringify(detail.tokens)) return
    queue({ tokens })
  }, [tokens, detail.tokens, queue])

  // The analysis follows the tokens; the preview a deferred copy of them.
  const { resolved, findings } = useMemo(() => analyse(tokens), [tokens])
  const deferredTokens = useDeferredValue(tokens)
  const preview = useMemo(
    () =>
      detail.tokens
        ? buildPreview({ id: detail.id, version: detail.version, compiled: detail.compiled, subsystems: detail.subsystems }, deferredTokens)
        : null,
    [detail.id, detail.version, detail.compiled, detail.subsystems, detail.tokens, deferredTokens],
  )

  useEffect(() => {
    setPreview(previewing ? preview : null)
  }, [previewing, preview, setPreview])

  // Leaving: flush, then let the worn theme back.
  const flushRef = useRef(saver.flush)
  useEffect(() => {
    flushRef.current = saver.flush
  }, [saver.flush])
  useEffect(
    () => () => {
      void flushRef.current(true)
      setPreview(null)
    },
    [setPreview],
  )

  const errors = detail.issues.filter((i) => i.severity === 'error')
  const warnings = detail.issues.filter((i) => i.severity === 'warning')
  const contrastFails = findings.filter((f) => f.status === 'fail' && f.mode === mode).length
  const primitives = primitiveRows(tokens)
  const convertedCount = installed ? Object.keys(installed.conversion.converted).length : 0

  const commitName = () => {
    const next = name.trim()
    if (!next) {
      setName(manifestName)
      return
    }
    if (next !== manifestName) saver.queue({ name: next })
  }
  const commitDescription = () => {
    if (description !== manifestDescription) saver.queue({ description })
  }

  const install = async () => {
    setInstalling(true)
    setInstallErrors(null)
    setInstalled(null)
    try {
      await saver.flush()
      const result = await installThemeDraft(detail.id)
      setInstalled(result)
      void queryClient.invalidateQueries({ queryKey: queryKeys.themeDrafts.all })
      await refreshThemes()
      showSuccessToast(`“${name.trim() || manifestName}” is installed, version ${result.version}.`)
    } catch (err) {
      if (err instanceof ApiFetchError && err.status === 422) {
        const details = (err.info as { details?: { errors?: unknown } } | undefined)?.details
        setInstallErrors(Array.isArray(details?.errors) ? details.errors.map(String) : [apiErrorMessage(err, 'The draft has errors.')])
      } else {
        showErrorToast(apiErrorMessage(err, 'The atelier could not install the theme.'))
      }
    } finally {
      setInstalling(false)
    }
  }

  const wear = async () => {
    if (!installed) return
    await setTheme(installed.themeId)
    showSuccessToast('Worn with pride.')
  }

  const back = async () => {
    await saver.flush()
    onBack()
  }

  if (!detail.tokens) {
    return (
      <div className="max-w-4xl mx-auto p-4 space-y-4">
        <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={onBack}>
          <Icon name="arrow-left" className="w-4 h-4" />
          <span className="ml-1">All drafts</span>
        </button>
        <div className="qt-alert-error" role="alert">
          <p className="font-medium">This draft&rsquo;s tokens cannot be read, so there is nothing to edit.</p>
          <ul className="list-disc pl-5 mt-2 qt-text-small">
            {detail.issues.map((issue, i) => (
              <li key={i}>{issue.message}</li>
            ))}
          </ul>
          <p className="qt-text-small mt-2">Mend the files at <span className="font-mono">{detail.uri}</span> and they will be read afresh.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={back}>
          <Icon name="arrow-left" className="w-4 h-4" />
          <span className="ml-1">All drafts</span>
        </button>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="qt-text-xs qt-text-muted" aria-live="polite">
            {saver.saving ? 'Saving…' : 'All changes saved'}
          </span>
          <div role="group" aria-label="Mode to edit and show in this tab" className="flex">
            {(['light', 'dark'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                className={`qt-button qt-button-sm ${mode === m ? 'qt-button-primary' : 'qt-button-secondary'}`}
                onClick={() => onModeChange(m)}
              >
                <Icon name={m === 'light' ? 'sun' : 'moon'} className="w-4 h-4" />
                <span className="ml-1">{m === 'light' ? 'Light' : 'Dark'}</span>
              </button>
            ))}
          </div>
          <button
            type="button"
            className="qt-button qt-button-secondary qt-button-sm"
            onClick={() => {
              if (previewing) void saver.flush()
              setPreviewing((p) => !p)
            }}
          >
            <Icon name={previewing ? 'eye-off' : 'eye'} className="w-4 h-4" />
            <span className="ml-1">{previewing ? 'Stop preview' : 'Resume preview'}</span>
          </button>
          <button
            type="button"
            className="qt-button qt-button-primary qt-button-sm"
            onClick={install}
            disabled={installing || errors.length > 0}
            aria-describedby={errors.length > 0 ? `${nameId}-errors` : undefined}
          >
            <Icon name="download" className="w-4 h-4" />
            <span className="ml-1">{installing ? 'Installing…' : 'Install'}</span>
          </button>
        </div>
      </div>

      <div className="qt-card p-4 space-y-3">
        <div>
          <label htmlFor={nameId} className="qt-label">Name</label>
          <input
            id={nameId}
            className="qt-input w-full"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onBlur={commitName}
          />
        </div>
        <div>
          <label htmlFor={descriptionId} className="qt-label">Description</label>
          <textarea
            id={descriptionId}
            className="qt-textarea qt-input w-full"
            rows={2}
            value={description}
            maxLength={2000}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={commitDescription}
          />
        </div>
        <p className="qt-text-xs qt-text-secondary">
          {errors.length} {errors.length === 1 ? 'error' : 'errors'}, {warnings.length}{' '}
          {warnings.length === 1 ? 'warning' : 'warnings'} at the last save; {contrastFails} contrast{' '}
          {contrastFails === 1 ? 'pair falls' : 'pairs fall'} short in {mode}.{' '}
          {previewing
            ? 'The rest of Quilltap is wearing this draft; this panel keeps the house default so you can read it.'
            : 'The preview is paused; Quilltap is wearing its usual theme.'}
        </p>
      </div>

      {errors.length > 0 && (
        <div id={`${nameId}-errors`} className="qt-alert-error" role="status">
          <p className="font-medium">Install waits until these are mended:</p>
          <ul className="list-disc pl-5 mt-1 qt-text-small">
            {errors.map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}
      {installErrors && (
        <div className="qt-alert-error" role="alert">
          <p className="font-medium">The install was refused:</p>
          <ul className="list-disc pl-5 mt-1 qt-text-small">
            {installErrors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
      )}
      {installed && (
        <div className="qt-alert-success flex items-center justify-between gap-3 flex-wrap" role="status">
          <p>
            Installed as version {installed.version}
            {convertedCount > 0 && `, with ${convertedCount} image${convertedCount === 1 ? '' : 's'} converted to WebP`}
            . The draft carries on at {installed.draftVersion}.
          </p>
          <button type="button" className="qt-button qt-button-primary qt-button-sm" onClick={wear}>
            Wear it now
          </button>
        </div>
      )}

      {EDITOR_SECTIONS.map((section, index) => (
        <details key={section.id} className="qt-card" open={index === 0}>
          <summary className="p-4 cursor-pointer">
            <span className="qt-heading-4">{section.label}</span>
            <span className="qt-text-xs qt-text-muted ml-2">{section.tokens.length} colours</span>
            {section.description && <p className="qt-text-xs qt-text-secondary mt-1">{section.description}</p>}
          </summary>
          <ul className="px-4 pb-2">
            {section.tokens.map((token) => (
              <ColorTokenRow
                key={token.name}
                token={token}
                tokens={tokens}
                resolved={resolved}
                findings={findings}
                mode={mode}
                onChange={setTokens}
              />
            ))}
          </ul>
        </details>
      ))}

      <details className="qt-card">
        <summary className="p-4 cursor-pointer">
          <span className="qt-heading-4">Primitives</span>
          <span className="qt-text-xs qt-text-muted ml-2">{primitives.length} defined, read only</span>
          <p className="qt-text-xs qt-text-secondary mt-1">
            The theme&rsquo;s own named values. A token that follows one shows it above; editing that token writes a colour of its own in its place.
          </p>
        </summary>
        {primitives.length === 0 ? (
          <p className="px-4 pb-4 qt-text-small qt-text-muted">This theme defines none.</p>
        ) : (
          <table className="w-full qt-text-xs mx-4 mb-4">
            <thead>
              <tr className="text-left qt-text-secondary">
                <th scope="col" className="py-1 pr-3">Variable</th>
                <th scope="col" className="py-1 pr-3">Type</th>
                <th scope="col" className="py-1 pr-3">Value</th>
                <th scope="col" className="py-1 pr-3">Dark</th>
              </tr>
            </thead>
            <tbody>
              {primitives.map((p) => (
                <tr key={p.name} className="border-t qt-border-default">
                  <td className="py-1 pr-3 font-mono">{p.variable}</td>
                  <td className="py-1 pr-3">{p.type}</td>
                  <td className="py-1 pr-3 font-mono break-all">{p.value}</td>
                  <td className="py-1 pr-3 font-mono break-all">{p.dark ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>
    </div>
  )
}
