'use client'

/**
 * Calliope's inspector — inspect mode, the selection and the overlay
 * (Calliope Live, Spec H, Stage 2).
 *
 * Mounted beside the theme provider, so the editor tab, the gallery tab and
 * the rest of the app agree on whether inspect mode is on and what is
 * selected.
 *
 * While on, pointer and mouse events are caught in the capture phase on the
 * document: moving outlines the nearest hooked element (classes only — no
 * stylesheet is read on pointer move), a click selects it and reaches
 * nothing in the app, and Escape turns the mode off. Anything inside
 * `[data-inspect-ignore]` — the inspector itself, the Atelier's panel — is
 * left alone. Turning the mode off removes every listener; the provider
 * never sets a class or attribute on the page.
 *
 * The overlay and the panel are portalled to the body inside an element
 * wearing the house default, so no draft can restyle or hide them.
 *
 * The editor and the gallery register bridges: the editor's `goToToken`,
 * CSS insert and the resolved draft; the gallery's way to show a hook.
 *
 * @module components/theme-inspect/InspectProvider
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTheme } from '@/components/providers/theme-provider'
import type { ResolvedTheme } from '@/lib/themes/engine/client'
import { isInspectIgnored, nearestHookedElement } from './dom'
import { hookByClass } from './model'
import { buildInspectReport, type InspectReport } from './report'
import { InspectPanel } from './InspectPanel'

/** What an open theme editor offers the inspector. */
export interface EditorBridge {
  draftName: string
  /** The draft as resolved now. */
  resolved: ResolvedTheme
  goToToken: (name: string) => boolean
  hasStylesheet: boolean
  /** Open the Custom CSS section and insert an empty rule for `selector` at the cursor. */
  writeCss: (selector: string) => void
  /** Begin a stylesheet (the draft has none); resolves whether it was begun. */
  beginStylesheet: () => Promise<boolean>
  /** Open the specimen gallery tab beside the editor. */
  openGallery: () => void
}

/** What an open specimen gallery offers the inspector. */
export interface GalleryBridge {
  /** Scroll to and focus the specimen of `className`. */
  reveal: (className: string) => void
}

interface Box {
  top: number
  left: number
  width: number
  height: number
}

interface InspectContextValue {
  active: boolean
  setActive: (on: boolean) => void
  /** Select an element (null clears); opens the panel whether or not the mode is on. */
  select: (el: Element | null) => void
  /** Select the first element carrying `className` inside `within` (the page, outside the inspector, by default). False when there is none. */
  inspectHook: (className: string, within?: ParentNode) => boolean
  /** Outline every element on the page matching `selector`, outside the gallery's stages; returns how many. */
  showMatches: (selector: string) => number
  clearMatches: () => void
  editor: EditorBridge | null
  registerEditor: (bridge: EditorBridge) => () => void
  registerGallery: (bridge: GalleryBridge) => () => void
  /** Show a hook's specimen: in the open gallery, or by opening it from the editor. False when neither is open. */
  showInGallery: (className: string) => boolean
}

const InspectContext = createContext<InspectContextValue | null>(null)

export const useInspectOptional = () => useContext(InspectContext)

const boxOf = (el: Element): Box => {
  const r = el.getBoundingClientRect()
  return { top: r.top, left: r.left, width: r.width, height: r.height }
}

const isHookClass = (c: string) => hookByClass(c) !== undefined

/** An element of the app proper: not the inspector, not the Atelier's panel, not a gallery stage. */
const outsideInspector = (el: Element) => !isInspectIgnored(el) && !el.closest('[data-specimen-stage]')

const NO_BOXES: { selected: Box | null; matches: Box[] } = { selected: null, matches: [] }

/** The events a click is made of; while inspecting, none reaches the app outside the inspector. */
const SWALLOWED = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick'] as const

export function InspectProvider({ children }: { children: ReactNode }) {
  const { resolvedColorMode, themeRevision } = useTheme()
  const [active, setActiveState] = useState(false)
  const [selected, setSelected] = useState<Element | null>(null)
  const [selectionKey, setSelectionKey] = useState(0)
  const [report, setReport] = useState<InspectReport | null>(null)
  const [hover, setHover] = useState<{ box: Box; label: string } | null>(null)
  const [matches, setMatches] = useState<Element[]>([])
  const [boxes, setBoxes] = useState<{ selected: Box | null; matches: Box[] }>({ selected: null, matches: [] })
  const [editor, setEditor] = useState<EditorBridge | null>(null)
  const galleryRef = useRef<GalleryBridge | null>(null)
  const [galleryOpen, setGalleryOpen] = useState(false)
  const pendingRef = useRef<string | null>(null)

  const setActive = useCallback((on: boolean) => {
    setActiveState(on)
    if (!on) setHover(null)
  }, [])

  const select = useCallback((el: Element | null) => {
    setSelected(el)
    setSelectionKey((k) => k + 1)
    setMatches([])
    if (!el) setReport(null)
  }, [])

  // The report is built after the commit that changed the selection, the draft or the injected CSS,
  // so the computed values it reads are the ones on screen. Never on pointer move.
  const resolved = editor?.resolved ?? null
  useEffect(() => {
    if (!selected) return
    const frame = requestAnimationFrame(() => {
      if (!selected.isConnected) {
        setSelected(null)
        setReport(null)
        return
      }
      setReport(buildInspectReport(selected, resolved))
    })
    return () => cancelAnimationFrame(frame)
  }, [selected, resolved, themeRevision])

  // Pointer capture while inspect mode is on.
  useEffect(() => {
    if (!active) return
    let frame = 0
    let lastTarget: Element | null = null
    const onMove = (e: PointerEvent) => {
      lastTarget = e.target instanceof Element ? e.target : null
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        const target = lastTarget
        if (!target || isInspectIgnored(target)) {
          setHover(null)
          return
        }
        const hooked = nearestHookedElement(target, isHookClass)
        const el = hooked ?? target
        const hook = hooked ? Array.from(hooked.classList).map(hookByClass).find(Boolean) : undefined
        setHover({ box: boxOf(el), label: hook ? `${hook.label} · .${hook.className}` : 'No hook here' })
      })
    }
    const swallow = (e: Event) => {
      const target = e.target instanceof Element ? e.target : null
      if (!target || isInspectIgnored(target)) return
      e.preventDefault()
      e.stopPropagation()
      e.stopImmediatePropagation()
      if (e.type === 'click') select(target)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setActive(false)
    }
    // On the window, in capture: ahead of every document-level capture listener (the workspace's link interceptor among them).
    window.addEventListener('pointermove', onMove, true)
    for (const type of SWALLOWED) window.addEventListener(type, swallow, true)
    window.addEventListener('keydown', onKey, true)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('pointermove', onMove, true)
      for (const type of SWALLOWED) window.removeEventListener(type, swallow, true)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [active, select, setActive])

  // Keep the selection's and the matches' outlines on their elements as the page scrolls or resizes.
  useEffect(() => {
    if (!selected && matches.length === 0) return
    // The hooked element the report reads is the one outlined; until it is built, the one clicked.
    const outlined = report && report.target ? report.target : selected
    let frame = 0
    const measure = () => {
      frame = 0
      setBoxes({
        selected: outlined?.isConnected ? boxOf(outlined) : null,
        matches: matches.filter((m) => m.isConnected).map(boxOf),
      })
    }
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure)
    }
    schedule()
    window.addEventListener('scroll', schedule, true)
    window.addEventListener('resize', schedule)
    return () => {
      if (frame) cancelAnimationFrame(frame)
      window.removeEventListener('scroll', schedule, true)
      window.removeEventListener('resize', schedule)
    }
  }, [selected, matches, report])

  const inspectHook = useCallback(
    (className: string, within?: ParentNode) => {
      const root = within ?? document
      const found = Array.from(root.querySelectorAll(`.${CSS.escape(className)}`)).find((el) => (within ? true : outsideInspector(el)))
      if (!found) return false
      select(found)
      found.scrollIntoView?.({ block: 'nearest' })
      return true
    },
    [select],
  )

  const showMatches = useCallback((selector: string) => {
    let found: Element[] = []
    try {
      found = Array.from(document.querySelectorAll(selector)).filter(outsideInspector)
    } catch {
      found = []
    }
    setMatches(found)
    return found.length
  }, [])

  const clearMatches = useCallback(() => setMatches([]), [])

  const registerEditor = useCallback((bridge: EditorBridge) => {
    setEditor(bridge)
    return () => setEditor((current) => (current === bridge ? null : current))
  }, [])

  const registerGallery = useCallback((bridge: GalleryBridge) => {
    galleryRef.current = bridge
    setGalleryOpen(true)
    // A gallery opened by "Show in the gallery" reveals the hook it was opened for.
    const pending = pendingRef.current
    pendingRef.current = null
    if (pending) requestAnimationFrame(() => bridge.reveal(pending))
    return () => {
      if (galleryRef.current !== bridge) return
      galleryRef.current = null
      setGalleryOpen(false)
    }
  }, [])

  const showInGallery = useCallback(
    (className: string) => {
      if (galleryRef.current) {
        galleryRef.current.reveal(className)
        return true
      }
      if (!editor) return false
      pendingRef.current = className
      editor.openGallery()
      return true
    },
    [editor],
  )


  const value = useMemo<InspectContextValue>(
    () => ({
      active,
      setActive,
      select,
      inspectHook,
      showMatches,
      clearMatches,
      editor,
      registerEditor,
      registerGallery,
      showInGallery,
    }),
    [active, setActive, select, inspectHook, showMatches, clearMatches, editor, registerEditor, registerGallery, showInGallery],
  )

  // Outlines are drawn only while there is something to outline; the last measurement may be stale.
  const shownBoxes = selected || matches.length > 0 ? boxes : NO_BOXES
  const showLayer = active || report !== null || shownBoxes.matches.length > 0
  const mode = resolvedColorMode === 'dark' ? 'dark' : 'light'

  return (
    <InspectContext.Provider value={value}>
      {children}
      {showLayer &&
        typeof document !== 'undefined' &&
        createPortal(
          <div data-theme="default" className={mode} data-inspect-ignore="" data-testid="inspect-layer">
            {active && hover && <Outline box={hover.box} label={hover.label} kind="hover" />}
            {shownBoxes.selected && <Outline box={shownBoxes.selected} kind="selected" />}
            {shownBoxes.matches.map((b, i) => (
              <Outline key={i} box={b} kind="match" />
            ))}
            {active && (
              <p role="status" className="qt-card qt-text-xs px-3 py-1" style={{ position: 'fixed', top: '0.5rem', left: '50%', transform: 'translateX(-50%)', zIndex: 2147483001 }}>
                Inspecting: point at anything, click to choose it. Escape stops.
              </p>
            )}
            {report && (
              <InspectPanel
                key={selectionKey}
                report={report}
                editor={editor}
                canShowInGallery={editor !== null || galleryOpen}
                onShowInGallery={showInGallery}
                onClose={() => select(null)}
              />
            )}
          </div>,
          document.body,
        )}
    </InspectContext.Provider>
  )
}

function Outline({ box, label, kind }: { box: Box; label?: string; kind: 'hover' | 'selected' | 'match' }) {
  const colour = kind === 'match' ? 'var(--color-warning)' : 'var(--color-primary)'
  return (
    <div
      aria-hidden="true"
      style={{
        position: 'fixed',
        top: box.top,
        left: box.left,
        width: box.width,
        height: box.height,
        outline: `2px ${kind === 'hover' ? 'dashed' : 'solid'} ${colour}`,
        outlineOffset: 1,
        pointerEvents: 'none',
        zIndex: 2147483000,
      }}
    >
      {label && (
        <span
          className="qt-text-xs"
          style={{ position: 'absolute', top: box.top > 24 ? -22 : box.height + 2, left: 0, whiteSpace: 'nowrap', padding: '1px 6px', borderRadius: 4, background: colour, color: 'var(--color-primary-foreground)' }}
        >
          {label}
        </span>
      )}
    </div>
  )
}
