'use client'

/**
 * DiagramBlock — a closed diagram fence, drawn.
 *
 * The dispatcher for every diagram engine: picks the renderer for the fence's
 * language, shows a fixed-height placeholder while it works, swaps in the SVG,
 * and adds the toolbar (view source, copy source, copy SVG, download SVG).
 * Clicking the drawing (or Enlarge) opens it in the lightbox, to zoom into and
 * copy as a PNG; closing that puts the reader back where they were.
 * A fence that cannot be drawn degrades to the ordinary code block under a
 * one-line note — never a blank space, never a stack trace.
 *
 * The SVG goes into the page as markup inside a container, never as an
 * `<img>`: "Salon Images" quick-hide swaps images for placeholders, and it
 * deliberately does not reach diagrams.
 */

import { useContext, useEffect, useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { CodeBlockWithCopy } from '@/components/chat/CodeBlockWithCopy'
import { ThemeContext } from '@/components/providers/theme/ThemeProvider'
import type { DiagramEngine, DiagramStyle } from '@/lib/markdown/diagrams'
import { renderMermaid } from './render-mermaid'
import { renderGraphviz } from './render-graphviz'
import { renderSvg } from './render-svg'
import { openDiagramLightbox } from './diagram-lightbox-host'
import type { RenderedDiagram } from './types'

export interface DiagramBlockProps {
  engine: DiagramEngine
  /** The fence's language as written (`mermaid`, `dot`, `graphviz`, `svg`). */
  language: string
  /** The diagram source — the fence's contents. */
  source: string
  /** The authoring character's style (Mermaid and Graphviz only). */
  style: DiagramStyle
  /**
   * The message is still streaming. The fence react-markdown hands us may be
   * half-received, so show it as code until the stream ends; a parse attempt
   * here would flash the error state at every token.
   */
  streaming?: boolean
}

/** The outcome of the last render this block finished, and what it was for. */
type RenderResult = { key: string; svg: string } | { key: string; error: string }

const RENDERERS: Record<
  DiagramEngine,
  (source: string, options: { style: DiagramStyle; host: Element }) => Promise<RenderedDiagram>
> = {
  mermaid: renderMermaid,
  graphviz: renderGraphviz,
  svg: (source) => renderSvg(source),
}

/**
 * Rendered SVG by (engine, style, theme, source). The Salon transcript is
 * virtualized, so rows unmount and remount as they scroll: a remount that
 * finds its drawing here shows it at once, with no placeholder and no change
 * of height under the virtualizer. Bounded, oldest first out.
 */
const RENDER_CACHE_LIMIT = 64
const renderCache = new Map<string, string>()

function cachePeek(key: string): string | null {
  return renderCache.get(key) ?? null
}

function cacheSet(key: string, svg: string): void {
  // Re-inserting moves the key to the young end.
  renderCache.delete(key)
  renderCache.set(key, svg)
  while (renderCache.size > RENDER_CACHE_LIMIT) {
    const oldest = renderCache.keys().next().value
    if (oldest === undefined) break
    renderCache.delete(oldest)
  }
}

/** Test seam: forget every cached drawing. */
export function clearDiagramRenderCache(): void {
  renderCache.clear()
}

// Each distinct theme-tokens object gets a stable number, so the theme part of
// a cache key is the same for every diagram on the page.
const tokenIds = new WeakMap<object, number>()
let nextTokenId = 1
function tokensId(tokens: object | undefined): number {
  if (!tokens) return 0
  let id = tokenIds.get(tokens)
  if (id === undefined) {
    id = nextTokenId++
    tokenIds.set(tokens, id)
  }
  return id
}

function cacheKeyFor(engine: DiagramEngine, style: DiagramStyle, themeKey: string, source: string): string {
  // Raw SVG ignores both the style and the theme.
  return engine === 'svg' ? `svg|${source}` : `${engine}|${style}|${themeKey}|${source}`
}

const BLOT_NOTE = 'The draughtsman’s pen has blotted — the diagram below could not be drawn.'

export function DiagramBlock({ engine, language, source, style, streaming = false }: DiagramBlockProps) {
  const theme = useContext(ThemeContext)
  const themeKey = `${theme?.activeThemeId ?? 'default'}|${theme?.resolvedColorMode ?? 'light'}|${tokensId(theme?.tokens)}`
  const cacheKey = cacheKeyFor(engine, style, themeKey, source)

  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const [result, setResult] = useState<RenderResult | null>(null)
  const [showSource, setShowSource] = useState(false)
  const [copied, setCopied] = useState<'source' | 'svg' | null>(null)

  // A drawing already in the cache shows at once (a remounted row). Otherwise
  // the last finished render is shown — for an older key that means the
  // previous drawing stays up while a re-render (a theme change) is under way,
  // so the row doesn't collapse to the placeholder and back.
  const cached = cachePeek(cacheKey)
  const current = result && result.key === cacheKey ? result : null
  const errorMessage = !cached && current && 'error' in current ? current.error : null
  const svg = cached ?? (result && 'svg' in result ? result.svg : null)

  useEffect(() => {
    if (streaming || cachePeek(cacheKey)) return

    let cancelled = false
    // One frame's grace: on a theme switch the new tokens land in the page's
    // CSS a moment after the context changes, and the palette is read live.
    const frame = requestAnimationFrame(() => {
      const host = stageRef.current
      if (!host) return
      console.debug('[diagrams] Rendering diagram', { engine, style, length: source.length })
      RENDERERS[engine](source, { style, host })
        .then(({ svg: drawn }) => {
          cacheSet(cacheKey, drawn)
          if (!cancelled) setResult({ key: cacheKey, svg: drawn })
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err)
          console.debug('[diagrams] Diagram could not be drawn', { engine, error: message })
          if (!cancelled) setResult({ key: cacheKey, error: message })
        })
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
    }
  }, [cacheKey, engine, source, style, streaming])

  const flashCopied = (what: 'source' | 'svg') => {
    setCopied(what)
    setTimeout(() => setCopied((shown) => (shown === what ? null : shown)), 2000)
  }

  const handleCopySource = async () => {
    try {
      await navigator.clipboard.writeText(source)
      flashCopied('source')
    } catch (err) {
      console.error('Failed to copy diagram source', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleCopySvg = async () => {
    if (!svg) return
    try {
      await navigator.clipboard.writeText(svg)
      flashCopied('svg')
    } catch (err) {
      console.error('Failed to copy diagram SVG', { error: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleDownloadSvg = () => {
    if (!svg) return
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `${engine}-diagram.svg`
    document.body.appendChild(link)
    link.click()
    link.remove()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }

  const kind = engine === 'svg' ? 'Drawing' : 'Diagram'

  const handleOpen = () => {
    const trigger = canvasRef.current
    if (!svg || !trigger) return
    openDiagramLightbox({ svg, label: `${kind}, enlarged`, trigger })
  }

  const handleCanvasClick = () => {
    // A drag across a label to copy its words is not a request to enlarge.
    const selection = window.getSelection()
    if (selection && !selection.isCollapsed && selection.toString().trim() !== '') return
    handleOpen()
  }

  const handleCanvasKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      handleOpen()
    }
  }

  if (streaming) {
    return <CodeBlockWithCopy code={source} language={language} />
  }

  if (errorMessage !== null) {
    return (
      <div className="qt-diagram-error" data-diagram-engine={engine}>
        <p className="qt-diagram-error-note" title={errorMessage}>
          {BLOT_NOTE}
        </p>
        <details className="qt-diagram-error-details">
          <summary>What the {engine === 'graphviz' ? 'Graphviz' : engine === 'mermaid' ? 'Mermaid' : 'SVG'} engine said</summary>
          <pre>{errorMessage}</pre>
        </details>
        <CodeBlockWithCopy code={source} language={language} />
      </div>
    )
  }

  return (
    <div className="qt-diagram" data-diagram-engine={engine} data-diagram-style={engine === 'svg' ? undefined : style}>
      {svg ? (
        <>
          <div className="qt-diagram-toolbar" role="toolbar" aria-label="Diagram actions">
            <button
              type="button"
              className="qt-diagram-toolbar-button"
              onClick={() => setShowSource((v) => !v)}
              aria-pressed={showSource}
              title={showSource ? 'Hide source' : 'View source'}
            >
              <Icon name="code" className="w-3.5 h-3.5" />
              <span>{showSource ? 'Hide source' : 'View source'}</span>
            </button>
            <button type="button" className="qt-diagram-toolbar-button" onClick={handleOpen} title="Enlarge — zoom, and copy as PNG">
              <Icon name="expand" className="w-3.5 h-3.5" />
              <span>Enlarge</span>
            </button>
            <button type="button" className="qt-diagram-toolbar-button" onClick={handleCopySource} title="Copy source">
              <Icon name={copied === 'source' ? 'check' : 'copy'} className="w-3.5 h-3.5" />
              <span>{copied === 'source' ? 'Copied' : 'Copy source'}</span>
            </button>
            <button type="button" className="qt-diagram-toolbar-button" onClick={handleCopySvg} title="Copy SVG">
              <Icon name={copied === 'svg' ? 'check' : 'copy'} className="w-3.5 h-3.5" />
              <span>{copied === 'svg' ? 'Copied' : 'Copy SVG'}</span>
            </button>
            <button type="button" className="qt-diagram-toolbar-button" onClick={handleDownloadSvg} title="Download SVG">
              <Icon name="download" className="w-3.5 h-3.5" />
              <span>Download SVG</span>
            </button>
          </div>
          <div
            ref={canvasRef}
            className="qt-diagram-canvas"
            role="button"
            tabIndex={0}
            aria-label={`${kind} — open to zoom and copy`}
            title="Click to enlarge"
            onClick={handleCanvasClick}
            onKeyDown={handleCanvasKeyDown}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        </>
      ) : (
        <div className="qt-diagram-placeholder" role="status" aria-live="polite">
          Sketching the diagram…
        </div>
      )}
      {showSource && <CodeBlockWithCopy code={source} language={language} />}
      {/* Scratch space a renderer may lay a drawing out in (offscreen). React
          never puts children here, so a renderer's temporary nodes are safe. */}
      <div ref={stageRef} className="qt-diagram-stage" aria-hidden="true" />
    </div>
  )
}
