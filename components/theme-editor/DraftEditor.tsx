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
 * The tokens are laid out by level and registry group (Spec E decision 1):
 * a list of sections to jump to, a search and a "changed only" filter that
 * look across every level, the choices at the top, and undo and redo for
 * the session. Rows read their own views from an editor store and mount
 * only near the viewport, so a draft of 666 tokens stays quick to edit.
 *
 * @module components/theme-editor/DraftEditor
 */

import { lazy, memo, Suspense, useCallback, useDeferredValue, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Icon } from '@/components/ui/icon'
import { useTheme } from '@/components/providers/theme-provider'
import { useDraft } from '@/lib/hooks/use-draft'
import { ApiFetchError, apiErrorMessage } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { showErrorToast, showSuccessToast, showWarningToast } from '@/lib/toast'
import { THEME_CHOICES, type ThemeTokensDocument, type TokenDef } from '@/lib/themes/engine/client'
import { jsonEqual } from '@/lib/hooks/use-draft'
import { createEditorStore, type EditorStore } from './editor-store'
import { OpenGalleryButton, paneOfTab, useOpenSpecimenGallery } from '@/components/theme-specimens/OpenGalleryButton'
import { useWorkspaceOptional } from '@/components/providers/workspace-provider'
import { useWorkspaceTabId } from '@/components/workspace/workspace-tab-context'
import { InspectToggle } from '@/components/theme-inspect/InspectToggle'
import { useInspectOptional, type EditorBridge } from '@/components/theme-inspect/InspectProvider'
import { LazyRow } from './LazyRow'
import { TokenRow, type EditFn } from './TokenRow'
import { PrimitivesPanel } from './PrimitivesPanel'
import { DraftResourcesContext } from './controls'
import { SectionJump } from '@/components/ui/SectionJump'
import { assetSectionViews, type AssetSectionView } from './assets/model'
import { DraftOperationsContext, useDraftOperationsState } from './assets/use-draft-operations'
import { FontsSection } from './assets/FontsSection'
import { ImagesSection } from './assets/ImagesSection'
import { IconsSection } from './assets/IconsSection'
import { DetailsSection } from './assets/DetailsSection'
import { FilesPanel } from './assets/FilesPanel'
import { StylesSection, type StylesStatus } from './assets/StylesSection'
import {
  EDITOR_GROUPS,
  EMPTY_HISTORY,
  analyse,
  buildPreview,
  draftResources,
  filterPrimitiveRows,
  isFiltering,
  primitiveRows,
  recordEdit,
  redoStep,
  sectionViews,
  setChoice,
  tokenLocation,
  tokenRowDomId,
  undoStep,
  type EditHistory,
  type EditorFilter,
  type EditorLevel,
  type EditorMode,
  type EditorSnapshot,
  type SectionView,
} from './model'
import {
  fetchThemeDraft,
  installThemeDraft,
  saveThemeDraft,
  themeDraftAction,
  type DraftDetail,
  type DraftInstallResult,
  type ThemeDraftSave,
} from './use-theme-drafts'
import { CHANGED_ELSEWHERE } from './assets/use-draft-operations'
import { applyChangeSet } from '@/lib/themes/assist/change-set'
import type { CalliopeProposalActions } from './calliope/CalliopePanel'
import { CalliopeAvatar } from './calliope/CalliopeAvatar'
import { CalliopeHandOffContext, type CalliopeHandOff } from './calliope/context'
import { issueHandOffText } from './calliope/hand-off'
import { keepProposal, tryProposal, type TriedProposal } from './calliope/api'

// Her panel (and the markdown it renders) loads only when she is first called for.
const CalliopePanel = lazy(() => import('./calliope/CalliopePanel').then((m) => ({ default: m.CalliopePanel })))

const SAVE_DELAY_MS = 700

const EMPTY_TOKENS: ThemeTokensDocument = { primitives: {}, tokens: {}, choices: {} } as ThemeTokensDocument

type Pending = Omit<ThemeDraftSave, 'revision' | 'manifestRevision' | 'stylesRevision'>

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
    if (
      detail.revision !== latest.current.revision ||
      detail.manifestRevision !== latest.current.manifestRevision ||
      detail.updatedAt !== latest.current.updatedAt
    ) {
      latest.current = detail
    }
  }, [detail])

  const send = useCallback(
    async (keepalive: boolean): Promise<void> => {
      if (inFlight.current) await inFlight.current
      const body = { ...pending.current }
      pending.current = {}
      // A stylesheet removed since the edit was queued has nothing to save it to.
      if (body.css !== undefined && !latest.current.styles) delete body.css
      if (Object.keys(body).length === 0) return
      const id = latest.current.id
      const run = (async () => {
        setSaving(true)
        try {
          const fresh = await saveThemeDraft(
            id,
            {
              ...body,
              revision: latest.current.revision,
              manifestRevision: latest.current.manifestRevision,
              stylesRevision: latest.current.styles?.revision,
            },
            { keepalive },
          )
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
            showWarningToast(CHANGED_ELSEWHERE)
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

  /** The newest draft seen: what an operation reads its manifest revision from. */
  const current = useCallback(() => latest.current, [])
  /** Take a draft an operation returned as the newest, ahead of the render that shows it. */
  const adopt = useCallback(
    (fresh: DraftDetail) => {
      latest.current = fresh
      queryClient.setQueryData(queryKeys.themeDrafts.detail(fresh.id), fresh)
      void queryClient.invalidateQueries({ queryKey: queryKeys.themeDrafts.list })
    },
    [queryClient],
  )

  return { queue, flush, saving, current, adopt }
}

export type DraftSaver = ReturnType<typeof useDraftSaver>

/**
 * The editing state around the draft's tokens: the store rows read, the one
 * `edit` every row calls, and undo and redo. An edit is a function from the
 * snapshot to a tokens document; it is recorded in the history (successive
 * edits of one key, a colour drag, as one step) and becomes the draft.
 */
function useEditing(tokens: ThemeTokensDocument, setTokens: (next: ThemeTokensDocument) => void, mode: EditorMode) {
  const { resolved, findings } = useMemo(() => analyse(tokens), [tokens])
  const snapshot = useMemo<EditorSnapshot>(() => ({ tokens, resolved, findings, mode }), [tokens, resolved, findings, mode])
  const [store] = useState<EditorStore>(() => createEditorStore(snapshot))
  const [history, setHistory] = useState<EditHistory>(EMPTY_HISTORY)

  // What the latest edit produced, ahead of the render that shows it (a colour drag outruns renders).
  const current = useRef<{ tokens: ThemeTokensDocument; history: EditHistory }>({ tokens, history })
  useLayoutEffect(() => {
    current.current = { tokens, history }
    store.set(snapshot)
  }, [tokens, history, snapshot, store])

  const apply = useCallback(
    (next: ThemeTokensDocument, nextHistory: EditHistory) => {
      current.current = { tokens: next, history: nextHistory }
      setHistory(nextHistory)
      setTokens(next)
    },
    [setTokens],
  )

  const edit = useCallback<EditFn>(
    (key, change) => {
      const before = current.current.tokens
      const shown = store.get()
      const base = shown.tokens === before ? shown : { ...shown, tokens: before, ...analyse(before) }
      const after = change(base)
      if (after === before || jsonEqual(after, before)) return
      apply(after, recordEdit(current.current.history, before, key, Date.now()))
    },
    [store, apply],
  )

  const undo = useCallback(() => {
    const step = undoStep(current.current.history, current.current.tokens)
    if (step) apply(step.doc, step.history)
  }, [apply])
  const redo = useCallback(() => {
    const step = redoStep(current.current.history, current.current.tokens)
    if (step) apply(step.doc, step.history)
  }, [apply])
  const forget = useCallback(() => {
    current.current = { ...current.current, history: EMPTY_HISTORY }
    setHistory(EMPTY_HISTORY)
  }, [])

  return {
    store,
    resolved,
    findings,
    edit,
    undo,
    redo,
    forget,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
  }
}

/** Whether a key press belongs to a field with its own undo (text being typed). */
function hasOwnUndo(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable || target instanceof HTMLTextAreaElement) return true
  if (!(target instanceof HTMLInputElement)) return false
  return !['button', 'checkbox', 'color', 'radio', 'range', 'reset', 'submit', 'file', 'image'].includes(target.type)
}

/** The section open when a draft is first shown: the first with essentials. */
const FIRST_SECTION = EDITOR_GROUPS.find((g) => g.essential.length > 0)?.id

const sectionDomId = (prefix: string, id: string) => `${prefix}-section-${id}`

/** The id of the list item that holds a token's row, mounted or not. */
const tokenRowSlotId = (name: string) => `${tokenRowDomId(name)}-slot`

/** Frames "Write CSS for this" waits for the stylesheet editor to mount before it gives up. */
const WRITE_CSS_FRAMES = 60

/** Frames `goToToken` waits for a row to mount before it gives up. */
const GO_TO_TOKEN_FRAMES = 30

/** What other parts of the Atelier (the inspector, Spec H) may ask of an open editor. */
export interface EditorNavigator {
  /**
   * Open the level and section that hold `name`'s row, scroll to it and
   * focus it. False when the name has no row (not a registry token).
   */
  goToToken: (name: string) => boolean
}

/** The estimated height of a row before it is first drawn. */
const rowEstimate = (token: TokenDef) => (token.type === 'color' ? 190 : 150)

/**
 * A section's rows. Memoised: unfiltered, `tokens` is the registry group's own
 * array and `store` and `edit` never change, so an edit re-renders no list —
 * only the rows whose view changed, through the store.
 */
const RowList = memo(function RowList({ tokens, store, edit, label }: { tokens: readonly TokenDef[]; store: EditorStore; edit: EditFn; label: string }) {
  return (
    <ul className="px-4 pb-2" aria-label={label}>
      {tokens.map((token) => (
        <LazyRow key={token.name} id={tokenRowSlotId(token.name)} estimate={rowEstimate(token)}>
          <TokenRow token={token} store={store} edit={edit} />
        </LazyRow>
      ))}
    </ul>
  )
})

interface AssetCardProps {
  section: AssetSectionView
  domId: string
  open: boolean
  onToggle: (open: boolean) => void
  children: ReactNode
}

/** One asset section (Spec F): fonts, images, icons, details or files. Nothing is mounted while closed. */
function AssetCard({ section, domId, open, onToggle, children }: AssetCardProps) {
  return (
    <details
      id={domId}
      className="qt-card scroll-mt-4"
      open={open}
      onToggle={(e) => {
        if (e.currentTarget.open !== open) onToggle(e.currentTarget.open)
      }}
    >
      <summary className="p-4 cursor-pointer">
        <span className="qt-heading-4">{section.label}</span>
        <p className="qt-text-xs qt-text-secondary mt-1">{section.description}</p>
      </summary>
      {open && children}
    </details>
  )
}

interface SectionCardProps {
  section: SectionView
  domId: string
  open: boolean
  advancedOpen: boolean
  onToggle: (open: boolean) => void
  onToggleAdvanced: (open: boolean) => void
  store: EditorStore
  edit: EditFn
}

/** One registry group: its rows, then its advanced rows behind a disclosure. Nothing is mounted while closed. */
function SectionCard({ section, domId, open, advancedOpen, onToggle, onToggleAdvanced, store, edit }: SectionCardProps) {
  const isOpen = section.forced || open
  const isAdvancedOpen = section.forced || advancedOpen
  const count = section.rows.length + section.advanced.length
  return (
    <details
      id={domId}
      className="qt-card scroll-mt-4"
      open={isOpen}
      onToggle={(e) => {
        if (!section.forced && e.currentTarget.open !== open) onToggle(e.currentTarget.open)
      }}
    >
      <summary className="p-4 cursor-pointer">
        <span className="qt-heading-4">{section.label}</span>
        <span className="qt-text-xs qt-text-muted ml-2">
          {count} {count === 1 ? 'token' : 'tokens'}
          {section.changed > 0 && `, ${section.changed} set by this theme`}
        </span>
        {section.description && <p className="qt-text-xs qt-text-secondary mt-1">{section.description}</p>}
      </summary>
      {isOpen && (
        <>
          {section.rows.length > 0 && <RowList tokens={section.rows} store={store} edit={edit} label={section.label} />}
          {section.advanced.length > 0 && (
            <details
              className="mx-4 mb-4 border-t qt-border-default"
              open={isAdvancedOpen}
              onToggle={(e) => {
                if (!section.forced && e.currentTarget.open !== advancedOpen) onToggleAdvanced(e.currentTarget.open)
              }}
            >
              <summary className="py-3 cursor-pointer qt-text-small font-medium">
                Advanced <span className="qt-text-xs qt-text-muted">({section.advanced.length} rarely set)</span>
              </summary>
              {isAdvancedOpen && (
                <RowList tokens={section.advanced} store={store} edit={edit} label={`${section.label}, advanced`} />
              )}
            </details>
          )}
        </>
      )}
    </details>
  )
}

/** The registry's choices, each a group of radio buttons. */
function ChoicesCard({ tokens, edit }: { tokens: ThemeTokensDocument; edit: EditFn }) {
  const baseId = useId()
  return (
    <section className="qt-card p-4 space-y-3" aria-labelledby={`${baseId}-heading`}>
      <h3 id={`${baseId}-heading`} className="qt-heading-4">Choices</h3>
      {THEME_CHOICES.map((choice) => {
        const value = tokens.choices[choice.name] ?? choice.default
        return (
          <fieldset key={choice.name} aria-describedby={`${baseId}-${choice.name}-help`}>
            <legend className="font-medium qt-text">{choice.label}</legend>
            <p id={`${baseId}-${choice.name}-help`} className="qt-text-xs qt-text-secondary">{choice.description}</p>
            <div className="flex gap-4 flex-wrap mt-1">
              {choice.options.map((option) => (
                <label key={option} className="qt-text-small flex items-center gap-1">
                  <input
                    type="radio"
                    name={`${baseId}-${choice.name}`}
                    value={option}
                    checked={value === option}
                    onChange={() => edit(`choice:${choice.name}`, (s) => setChoice(s.tokens, choice.name, option))}
                  />
                  {option}
                  {option === choice.default && <span className="qt-text-xs qt-text-muted">(the house default)</span>}
                </label>
              ))}
            </div>
          </fieldset>
        )
      })}
    </section>
  )
}

interface DraftEditorProps {
  detail: DraftDetail
  /** The mode edited and shown in this tab (the panel wears it too). */
  mode: EditorMode
  onModeChange: (mode: EditorMode) => void
  onBack: () => void
  /** Filled with the editor's navigator while it is mounted. */
  navigatorRef?: MutableRefObject<EditorNavigator | null>
}

export function DraftEditor({ detail, mode, onModeChange, onBack, navigatorRef }: DraftEditorProps) {
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
  // The stylesheet as edited (Spec G): the code editor owns the keystrokes and hands its text up after a pause.
  const serverCss = detail.styles?.text ?? ''
  const [css, setCss] = useDraft<string>(serverCss, Object.is)
  const [cssConflict, setCssConflict] = useState(false)
  const cssRef = useRef(css)
  useLayoutEffect(() => {
    cssRef.current = css
  }, [css])
  /** The code editor's flush, while the Custom CSS section is open. */
  const cssFlushRef = useRef<(() => void) | null>(null)

  // The JSON last queued or adopted, so an adopted server value is never sent back.
  const lastTokensJson = useRef(JSON.stringify(serverTokens))
  const editing = useEditing(tokens, setTokens, mode)
  const { store, edit, forget } = editing

  const sectionsId = useId()
  const searchId = useId()
  const [level, setLevel] = useState<EditorLevel>('essentials')
  const [query, setQuery] = useState('')
  const [changedOnly, setChangedOnly] = useState(false)
  const [openSections, setOpenSections] = useState<ReadonlySet<string>>(() => new Set(FIRST_SECTION ? [FIRST_SECTION] : []))
  const [openAdvanced, setOpenAdvanced] = useState<ReadonlySet<string>>(() => new Set())
  const deferredQuery = useDeferredValue(query)
  const filter = useMemo<EditorFilter>(() => ({ query: deferredQuery, changedOnly }), [deferredQuery, changedOnly])

  const onConflict = useCallback(
    (fresh: DraftDetail) => {
      const freshTokens = fresh.tokens ?? EMPTY_TOKENS
      lastTokensJson.current = JSON.stringify(freshTokens)
      setTokens(freshTokens)
      forget()
      setName(typeof fresh.manifest?.name === 'string' ? fresh.manifest.name : fresh.id)
      setDescription(typeof fresh.manifest?.description === 'string' ? fresh.manifest.description : '')
      const freshCss = fresh.styles?.text ?? ''
      if (freshCss !== cssRef.current) setCssConflict(true)
      setCss(freshCss)
    },
    [setTokens, setName, setDescription, setCss, forget],
  )
  const saver = useDraftSaver(detail, onConflict)
  const { queue, flush: flushSaves, current: currentDraft, adopt: adoptDraft } = saver
  /** Everything unsaved, the stylesheet's pending keystrokes included, sent now. */
  const flushAll = useCallback(
    (keepalive = false) => {
      cssFlushRef.current?.()
      return flushSaves(keepalive)
    },
    [flushSaves],
  )
  const operationSaver = useMemo(() => ({ flush: () => flushAll(), current: currentDraft, adopt: adoptDraft }), [flushAll, currentDraft, adoptDraft])
  const onCssChange = useCallback(
    (text: string) => {
      setCss(text)
      setCssConflict(false)
      queue({ css: text })
    },
    [setCss, queue],
  )
  const cssStatus: StylesStatus = saver.saving ? 'saving' : cssConflict ? 'conflict' : css !== serverCss ? 'unsaved' : 'saved'
  const operations = useDraftOperationsState(operationSaver, onConflict)

  // Queue a save when the tokens differ from both the server's and what was last queued.
  useEffect(() => {
    if (!detail.tokens) return
    const json = JSON.stringify(tokens)
    if (json === lastTokensJson.current) return
    lastTokensJson.current = json
    if (json === JSON.stringify(detail.tokens)) return
    queue({ tokens })
  }, [tokens, detail.tokens, queue])

  // The analysis follows the tokens (useEditing); the preview a deferred copy of them.
  const { findings } = editing
  const deferredTokens = useDeferredValue(tokens)
  // While the draft has errors the server compiles nothing, so the preview keeps the last good compile (Spec G decision 1).
  const draftHasErrors = detail.issues.some((i) => i.severity === 'error')
  const [goodCompiled, setGoodCompiled] = useState(detail.compiled)
  if (!draftHasErrors && detail.compiled !== goodCompiled) setGoodCompiled(detail.compiled)
  const compiled = draftHasErrors ? goodCompiled : detail.compiled
  // A proposal being tried (Spec J Stage 3): the preview wears its result — its
  // tokens and its stylesheet as the server scoped it — and the draft is untouched.
  const [tried, setTried] = useState<TriedProposal | null>(null)
  const preview = useMemo(
    () =>
      detail.tokens
        ? tried
          ? buildPreview({ id: detail.id, version: detail.version, compiled: { ...compiled, custom: tried.custom }, subsystems: detail.subsystems }, tried.tokens)
          : buildPreview({ id: detail.id, version: detail.version, compiled, subsystems: detail.subsystems }, deferredTokens)
        : null,
    [detail.id, detail.version, compiled, detail.subsystems, detail.tokens, deferredTokens, tried],
  )

  useEffect(() => {
    setPreview(previewing ? preview : null)
  }, [previewing, preview, setPreview])

  // Leaving: flush, then let the worn theme back.
  const flushRef = useRef(flushAll)
  useEffect(() => {
    flushRef.current = flushAll
  }, [flushAll])
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
  const primitives = useMemo(() => filterPrimitiveRows(primitiveRows(tokens), filter).map((p) => p.name), [tokens, filter])
  const primitiveCount = Object.keys(tokens.primitives).length
  const resources = useMemo(() => draftResources(detail.manifest, detail.images ?? []), [detail.manifest, detail.images])
  const filtering = isFiltering(filter)
  const sections = useMemo(() => sectionViews(level, filter, tokens), [level, filter, tokens])
  const assetSections = useMemo(() => assetSectionViews(filter), [filter])
  const isSectionOpen = (id: string) => openSections.has(id)
  const toggle = (set: ReadonlySet<string>, id: string, open: boolean) => {
    const next = new Set(set)
    if (open) next.add(id)
    else next.delete(id)
    return next
  }
  const setSectionOpen = (id: string, open: boolean) => setOpenSections((prev) => toggle(prev, id, open))
  const openAll = () => {
    setOpenSections(new Set([...sections.map((sec) => sec.id), ...assetSections.map((sec) => sec.id)]))
    setOpenAdvanced(new Set(sections.map((sec) => sec.id)))
  }
  const closeAll = () => {
    setOpenSections(new Set())
    setOpenAdvanced(new Set())
  }
  const goToSection = (id: string) => {
    if (!isSectionOpen(id)) setSectionOpen(id, true)
    requestAnimationFrame(() => {
      const el = document.getElementById(sectionDomId(sectionsId, id))
      el?.scrollIntoView({ block: 'start' })
      el?.querySelector('summary')?.focus()
    })
  }

  const goToToken = useCallback((name: string): boolean => {
    const where = tokenLocation(name)
    if (!where) return false
    const add = (prev: ReadonlySet<string>) => (prev.has(where.sectionId) ? prev : new Set([...prev, where.sectionId]))
    setQuery('')
    setChangedOnly(false)
    setLevel(where.level)
    setOpenSections(add)
    if (where.advanced) setOpenAdvanced(add)
    // The row mounts once its section is open and its slot comes near the viewport (LazyRow).
    let frames = 0
    const seek = () => {
      const row = document.getElementById(tokenRowDomId(name))
      if (row) {
        row.scrollIntoView({ block: 'start' })
        row.focus({ preventScroll: true })
        return
      }
      document.getElementById(tokenRowSlotId(name))?.scrollIntoView({ block: 'center' })
      if (++frames < GO_TO_TOKEN_FRAMES) requestAnimationFrame(seek)
    }
    requestAnimationFrame(seek)
    return true
  }, [])
  // What the inspector may ask of the editor (Spec H, Stage 2): a token's row, a rule in the stylesheet, the gallery.
  const inspect = useInspectOptional()
  const registerEditor = inspect?.registerEditor
  const cssInsertRef = useRef<((text: string) => void) | null>(null)
  const openGallery = useOpenSpecimenGallery()
  // A request from the inspector brings this editor's tab to the front of its pane first (the gallery may be over it).
  const workspace = useWorkspaceOptional()
  const tabId = useWorkspaceTabId()
  const editorPane = workspace ? paneOfTab(workspace.state, tabId) : null
  const editorTabHidden = editorPane !== null && workspace?.state.panes[editorPane]?.activeTabId !== tabId
  const setActiveTab = workspace?.setActive
  const bringForward = useCallback(() => {
    if (editorPane && tabId && editorTabHidden) setActiveTab?.(editorPane, tabId)
  }, [editorPane, tabId, editorTabHidden, setActiveTab])
  const goToTokenFromInspector = useCallback(
    (name: string) => {
      bringForward()
      return goToToken(name)
    },
    [bringForward, goToToken],
  )
  const writeCss = useCallback((selector: string) => {
    bringForward()
    setQuery('')
    setChangedOnly(false)
    setOpenSections((prev) => (prev.has('asset-styles') ? prev : new Set([...prev, 'asset-styles'])))
    let frames = 0
    const seek = () => {
      const insert = cssInsertRef.current
      if (insert) {
        document.getElementById(sectionDomId(sectionsId, 'asset-styles'))?.scrollIntoView({ block: 'start' })
        insert(`\n${selector} {\n  \n}\n`)
        return
      }
      if (++frames < WRITE_CSS_FRAMES) requestAnimationFrame(seek)
    }
    requestAnimationFrame(seek)
  }, [sectionsId, bringForward])
  const beginStylesheet = useCallback(async () => {
    const result = await operations.run((manifestRevision, id) =>
      themeDraftAction<{ draft: DraftDetail; path: string; created: boolean }>(id, 'set-styles-file', { manifestRevision }),
    )
    return result.ok
  }, [operations])
  const hasStylesheet = Boolean(detail.styles)

  // Calliope (Spec J Stage 3): her panel, what is handed to her, and what her proposals do to the draft.
  const [calliopeOpen, setCalliopeOpen] = useState(false)
  const [calliopeSeed, setCalliopeSeed] = useState<{ text: string; nonce: number } | null>(null)
  const askCalliope = useCallback(
    (text: string) => {
      bringForward()
      setCalliopeOpen(true)
      setCalliopeSeed({ text, nonce: Date.now() })
    },
    [bringForward, setCalliopeOpen, setCalliopeSeed],
  )
  const handOff = useMemo<CalliopeHandOff>(() => ({ ask: askCalliope }), [askCalliope])
  const stopTrying = useCallback(() => setTried(null), [])
  const proposalActions = useMemo<CalliopeProposalActions>(
    () => ({
      tryingId: tried?.proposalId ?? null,
      onStopTrying: stopTrying,
      onTry: async (chatId, proposal) => {
        // She judged the saved draft: send what is typed first.
        await flushAll()
        try {
          setTried(await tryProposal(chatId, proposal.id))
          setPreviewing(true)
        } catch (err) {
          showErrorToast(apiErrorMessage(err, 'The proposal could not be tried.'))
        }
      },
      onKeep: async (chatId, proposal) => {
        await flushAll()
        let operations
        try {
          operations = (await keepProposal(chatId, proposal.id)).operations
        } catch (err) {
          showErrorToast(apiErrorMessage(err, 'The proposal could not be kept.'))
          return
        }
        setTried(null)
        const css = hasStylesheet ? cssRef.current : null
        const applied = applyChangeSet({ tokens: editing.store.get().tokens, css }, { operations })
        if (!applied.ok) {
          showErrorToast(`The proposal could not be applied: ${applied.reason}`)
          return
        }
        // Tokens, primitives and choices: one edit, so one undo step.
        if (applied.tokensChanged) {
          edit(`calliope:${proposal.id}`, (snapshot) => {
            const again = applyChangeSet({ tokens: snapshot.tokens, css }, { operations })
            return again.ok ? again.tokens : snapshot.tokens
          })
        }
        // The stylesheet: through its own save (begun first when the draft has none).
        if (applied.cssChanged && applied.css !== null) {
          if (!hasStylesheet && !(await beginStylesheet())) {
            showErrorToast('The proposal\u2019s stylesheet could not be begun; its tokens were kept.')
            return
          }
          onCssChange(applied.css)
        }
        showSuccessToast(`Kept \u201c${proposal.title}\u201d.`)
      },
    }),
    [tried, stopTrying, flushAll, hasStylesheet, editing.store, edit, beginStylesheet, onCssChange],
  )

  const bridge = useMemo<EditorBridge>(
    () => ({ draftName: manifestName, resolved: editing.resolved, goToToken: goToTokenFromInspector, hasStylesheet, writeCss, beginStylesheet, openGallery, askCalliope }),
    [manifestName, editing.resolved, goToTokenFromInspector, hasStylesheet, writeCss, beginStylesheet, openGallery, askCalliope],
  )
  useEffect(() => registerEditor?.(bridge), [registerEditor, bridge])

  useEffect(() => {
    if (!navigatorRef) return
    navigatorRef.current = { goToToken }
    return () => {
      navigatorRef.current = null
    }
  }, [navigatorRef, goToToken])

  const onEditorKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || hasOwnUndo(e.target)) return
    const key = e.key.toLowerCase()
    if (key === 'z' && !e.shiftKey) {
      e.preventDefault()
      editing.undo()
    } else if ((key === 'z' && e.shiftKey) || (key === 'y' && !e.shiftKey)) {
      e.preventDefault()
      editing.redo()
    }
  }
  const convertedCount = installed ? Object.keys(installed.conversion.converted).length : 0
  const fontsConvertedCount = installed ? Object.keys(installed.fontConversion ?? {}).length : 0
  const renderAssetBody = (section: AssetSectionView) => {
    switch (section.kind) {
      case 'fonts':
        return <FontsSection detail={detail} tokens={tokens} previewing={previewing} onShowFontTokens={() => goToSection('fonts')} />
      case 'images':
        return <ImagesSection detail={detail} />
      case 'icons':
        return <IconsSection detail={detail} />
      case 'styles':
        return (
          <StylesSection
            detail={detail}
            value={css}
            onChange={onCssChange}
            status={cssStatus}
            flushRef={cssFlushRef}
            insertRef={cssInsertRef}
            tokens={tokens}
            resolved={editing.resolved}
            mode={mode}
          />
        )
      case 'details':
        return <DetailsSection detail={detail} />
      case 'files':
        return <FilesPanel detail={detail} />
    }
  }

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
      await flushAll()
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
    await flushAll()
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
    <DraftOperationsContext.Provider value={operations}>
    <DraftResourcesContext.Provider value={resources}>
    <CalliopeHandOffContext.Provider value={handOff}>
      <div className={`${calliopeOpen ? 'max-w-7xl' : 'max-w-5xl'} mx-auto p-4 space-y-4`}>
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
                if (previewing) void flushAll()
                setPreviewing((p) => !p)
              }}
            >
              <Icon name={previewing ? 'eye-off' : 'eye'} className="w-4 h-4" />
              <span className="ml-1">{previewing ? 'Stop preview' : 'Resume preview'}</span>
            </button>
            <OpenGalleryButton />
            <InspectToggle />
            <button
              type="button"
              aria-pressed={calliopeOpen}
              className={`qt-button qt-button-sm ${calliopeOpen ? 'qt-button-primary' : 'qt-button-secondary'}`}
              onClick={() => setCalliopeOpen((o) => !o)}
            >
              <CalliopeAvatar className="w-5 h-5" />
              <span className="ml-1">Calliope</span>
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
            The author, licence, tags, dark mode and what the subsystems are called live under{' '}
            <button type="button" className="underline" onClick={() => goToSection('asset-details')}>
              Subsystems and details
            </button>
            .
          </p>
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
                <li key={i}>
                  {e.message}{' '}
                  <button type="button" className="underline qt-text-xs" onClick={() => askCalliope(issueHandOffText(e))}>
                    Ask Calliope
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {warnings.length > 0 && (
          <details className="qt-card p-3">
            <summary className="qt-text-small cursor-pointer">
              {warnings.length} {warnings.length === 1 ? 'warning' : 'warnings'} at the last save
            </summary>
            <ul className="list-disc pl-5 mt-2 qt-text-small space-y-1">
              {warnings.map((w, i) => (
                <li key={i} className="break-words">
                  {w.message}{' '}
                  <button type="button" className="underline qt-text-xs" onClick={() => askCalliope(issueHandOffText(w))}>
                    Ask Calliope
                  </button>
                </li>
              ))}
            </ul>
          </details>
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
              {fontsConvertedCount > 0 && `${convertedCount > 0 ? ' and' : ', with'} ${fontsConvertedCount} font${fontsConvertedCount === 1 ? '' : 's'} converted to WOFF2`}
              . The draft carries on at {installed.draftVersion}, keeping its originals.
              {installed.leftOut.length > 0 && ` Left out as unused: ${installed.leftOut.join(', ')}.`}
            </p>
            <button type="button" className="qt-button qt-button-primary qt-button-sm" onClick={wear}>
              Wear it now
            </button>
          </div>
        )}

        <div
          className="qt-card p-3 flex items-center gap-3 flex-wrap sticky top-0 z-10"
          role="toolbar"
          aria-label="Finding and undoing"
        >
          <div role="group" aria-label="Level" className="flex">
            {(
              [
                ['essentials', 'Essentials'],
                ['components', 'Components'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                type="button"
                aria-pressed={level === value}
                disabled={filtering}
                className={`qt-button qt-button-sm ${level === value ? 'qt-button-primary' : 'qt-button-secondary'}`}
                onClick={() => setLevel(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <label htmlFor={searchId} className="sr-only">Search the tokens</label>
            <input
              id={searchId}
              type="search"
              className="qt-input qt-text-small min-w-0 flex-1"
              placeholder="Search by name, label or description"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <label className="qt-text-small flex items-center gap-1">
            <input type="checkbox" checked={changedOnly} onChange={(e) => setChangedOnly(e.target.checked)} />
            Changed only
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              className="qt-button qt-button-ghost qt-button-sm"
              onClick={editing.undo}
              disabled={!editing.canUndo}
              aria-keyshortcuts="Control+Z Meta+Z"
            >
              Undo
            </button>
            <button
              type="button"
              className="qt-button qt-button-ghost qt-button-sm"
              onClick={editing.redo}
              disabled={!editing.canRedo}
              aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z Control+Y"
            >
              Redo
            </button>
          </div>
          <div className="flex items-center gap-1">
            <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={openAll} disabled={filtering}>
              Open all
            </button>
            <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={closeAll} disabled={filtering}>
              Close all
            </button>
          </div>
        </div>
        <p className="sr-only" aria-live="polite">
          {filtering
            ? `${sections.reduce((n, sec) => n + sec.rows.length + sec.advanced.length, 0)} tokens in ${sections.length} sections answer.`
            : ''}
        </p>

        <ChoicesCard tokens={tokens} edit={edit} />

        {/* With Calliope open: beside the sections when the pane is wide, in their place when it is narrow. */}
        <div className="@container">
        <div className={calliopeOpen ? 'grid gap-4 @4xl:grid-cols-[minmax(0,1fr)_26rem] items-start' : undefined}>
        <div className={calliopeOpen ? 'hidden @4xl:block min-w-0 @container' : '@container'}>
        <div className="grid gap-4 @2xl:grid-cols-[13rem_minmax(0,1fr)] items-start">
          <SectionJump
            className="qt-card p-2 @2xl:hidden"
            label="Go to a section"
            emptyText="No section answers."
            options={[
              ...sections.map((section) => ({
                id: section.id,
                label: section.label,
                note: section.changed > 0 ? `${section.changed} set by this theme` : undefined,
              })),
              ...assetSections.map((section) => ({ id: section.id, label: section.label })),
            ]}
            onJump={goToSection}
          />
          <nav aria-label="Sections" className="qt-card p-2 hidden @2xl:block @2xl:sticky @2xl:top-20 @2xl:max-h-[calc(100cqh-6rem)] @2xl:overflow-y-auto">
            {sections.length === 0 && assetSections.length === 0 ? (
              <p className="qt-text-xs qt-text-muted p-2">No section answers.</p>
            ) : (
              <ul className="space-y-0.5">
                {sections.map((section) => (
                  <li key={section.id}>
                    <button
                      type="button"
                      className="qt-button qt-button-ghost qt-button-sm w-full justify-between text-left"
                      onClick={() => goToSection(section.id)}
                    >
                      <span className="truncate">{section.label}</span>
                      {section.changed > 0 && (
                        <span className="qt-badge-secondary ml-2" aria-label={`${section.changed} set by this theme`}>
                          {section.changed}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
                {assetSections.length > 0 && (
                  <li role="presentation" className="border-t qt-border-default my-1" aria-hidden="true" />
                )}
                {assetSections.map((section) => (
                  <li key={section.id}>
                    <button
                      type="button"
                      className="qt-button qt-button-ghost qt-button-sm w-full justify-between text-left"
                      onClick={() => goToSection(section.id)}
                    >
                      <span className="truncate">{section.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </nav>

          <div className="space-y-4 min-w-0 @container" onKeyDown={onEditorKeyDown}>
            {filtering && sections.length === 0 && assetSections.length === 0 && (
              <p className="qt-card p-4 qt-text-small qt-text-muted">
                {changedOnly && !query.trim()
                  ? 'This theme has changed nothing yet; every token stands at the house default.'
                  : 'Nothing in the registry answers to that description.'}
              </p>
            )}
            {sections.map((section) => (
              <SectionCard
                key={section.id}
                section={section}
                domId={sectionDomId(sectionsId, section.id)}
                open={isSectionOpen(section.id)}
                advancedOpen={openAdvanced.has(section.id)}
                onToggle={(open) => setSectionOpen(section.id, open)}
                onToggleAdvanced={(open) => setOpenAdvanced((prev) => toggle(prev, section.id, open))}
                store={store}
                edit={edit}
              />
            ))}
            <PrimitivesPanel names={primitives} total={primitiveCount} filtering={filtering} store={store} edit={edit} />
            {assetSections.map((section) => (
              <AssetCard
                key={section.id}
                section={section}
                domId={sectionDomId(sectionsId, section.id)}
                open={filtering || isSectionOpen(section.id)}
                onToggle={(open) => setSectionOpen(section.id, open)}
              >
                {renderAssetBody(section)}
              </AssetCard>
            ))}
          </div>
        </div>
        </div>
        {calliopeOpen && (
          <Suspense fallback={<div className="qt-card p-4 qt-text-small qt-text-secondary" role="status">Summoning Calliope…</div>}>
            <CalliopePanel
              draftId={detail.id}
              draftName={name.trim() || manifestName}
              seed={calliopeSeed}
              actions={proposalActions}
              onClose={() => setCalliopeOpen(false)}
            />
          </Suspense>
        )}
        </div>
        </div>
      </div>
    </CalliopeHandOffContext.Provider>
    </DraftResourcesContext.Provider>
    </DraftOperationsContext.Provider>
  )
}
