'use client'

/**
 * Calliope's inspector — the panel for the selected element (Calliope Live,
 * Spec H, Stage 2).
 *
 * It shows and links; it does not edit (decision 5). The hook, its variants
 * and states; the tokens that style the element, grouped by what they set,
 * with the value in force where the element is, what each follows and
 * whether the draft sets it; the same for hover, focus and press (decision
 * 8); the theme's own rules that apply. A token opens its row in the
 * editor; "Write CSS for this" inserts an empty rule for the hook's selector
 * into the Custom CSS section, offering to begin a stylesheet first when
 * there is none.
 *
 * Keyed by the selection, so a new choice starts with its own selector.
 * Rendered by the inspect provider inside an element wearing the house
 * default and marked `data-inspect-ignore`. It reads classes, attributes
 * and styles, never the text of what it inspects.
 *
 * @module components/theme-inspect/InspectPanel
 */

import { useId, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { parseColor } from '@/lib/themes/engine/client'
import type { EditorBridge } from './InspectProvider'
import type { CategoryGroup, TokenTrace } from './model'
import type { InspectReport } from './report'
import { inspectHandOffText } from '@/components/theme-editor/calliope/hand-off'

interface InspectPanelProps {
  report: InspectReport
  editor: EditorBridge | null
  canShowInGallery: boolean
  onShowInGallery: (className: string) => void
  onClose: () => void
}

type Side = 'left' | 'right'

/** The side away from the editor's panel where one is in view, so "Row" lands where it can be seen; null when none is. */
function sideAwayFromEditor(): Side | null {
  if (typeof document === 'undefined') return null
  for (const editor of Array.from(document.querySelectorAll('[data-inspect-editor]'))) {
    const box = editor.getBoundingClientRect()
    if (box.width === 0 || box.height === 0) continue
    return box.left + box.width / 2 > window.innerWidth / 2 ? 'left' : 'right'
  }
  return null
}

function sourceText(trace: TokenTrace): string {
  if (trace.setByTheme) return 'Set by this theme'
  if (trace.source?.kind === 'choice') return `Set by the ${trace.source.choiceLabel.toLowerCase()} choice`
  if (trace.source?.kind === 'unset') return 'Left unset'
  return 'The house default'
}

function TraceRow({ trace, value, readsDraft, editor, onGoToToken }: { trace: TokenTrace; value: string; readsDraft: boolean; editor: EditorBridge | null; onGoToToken: (name: string) => void }) {
  const colour = value && parseColor(value) ? value : null
  const label = trace.token?.label ?? (trace.kind === 'primitive' ? `Primitive “${trace.name.slice(4)}”` : trace.name)
  const canGo = editor !== null && trace.kind === 'token'
  return (
    <li className="flex items-start gap-2 py-1">
      {colour ? (
        <span role="img" aria-label={`${label}: ${colour}`} className="inline-block w-4 h-4 mt-0.5 rounded border qt-border-default flex-shrink-0" style={{ background: colour }} />
      ) : (
        <span className="inline-block w-4 h-4 flex-shrink-0" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1">
        <p className="qt-text-xs font-medium">{label}</p>
        <p className="qt-text-xs font-mono qt-text-secondary break-all">
          {trace.name}
          {trace.property !== trace.name && <span className="qt-text-muted"> (read as {trace.property})</span>}
        </p>
        <p className="qt-text-xs qt-text-secondary break-all">
          <span className="font-mono">{value || '—'}</span>
          {trace.follows.length > 0 && <> · follows {trace.follows.map((s) => s.label).join(' → ')}</>}
        </p>
        {trace.kind === 'unknown' ? (
          <p className="qt-text-xs qt-text-muted">Not a registry token: shown by name only.</p>
        ) : (
          readsDraft && <p className="qt-text-xs qt-text-muted">{sourceText(trace)}</p>
        )}
      </div>
      {canGo && (
        <button type="button" className="qt-button qt-button-ghost qt-button-sm flex-shrink-0" onClick={() => onGoToToken(trace.name)} aria-label={`Show the row for ${label}`}>
          <Icon name="arrow-right" className="w-3 h-3" />
          <span className="ml-1">Row</span>
        </button>
      )}
    </li>
  )
}

function Groups({ groups, report, editor, onGoToToken }: { groups: CategoryGroup[]; report: InspectReport; editor: EditorBridge | null; onGoToToken: (name: string) => void }) {
  if (groups.length === 0) return <p className="qt-text-xs qt-text-muted">No token reaches it here.</p>
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <section key={g.category} aria-label={g.label}>
          <h4 className="qt-text-label-xs">{g.label}</h4>
          <ul className="space-y-1">
            {g.uses.map((use) => (
              <li key={use.property} className="border-t qt-border-default pt-1">
                <p className="qt-text-xs font-mono">
                  {use.property}
                  {use.fromCustomCss && <span className="qt-badge qt-badge-info ml-2">your own CSS</span>}
                </p>
                <ul>
                  {use.traces.map((t) => (
                    <TraceRow key={t.property} trace={t} value={report.computed[t.property] ?? ''} readsDraft={report.readsDraft} editor={editor} onGoToToken={onGoToToken} />
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function InspectPanel({ report, editor, canShowInGallery, onShowInGallery, onClose }: InspectPanelProps) {
  const headingId = useId()
  const selectorId = useId()
  const { match } = report
  const [selector, setSelector] = useState(match?.selector.selector ?? '')
  const [beginning, setBeginning] = useState(false)
  const [written, setWritten] = useState<string | null>(null)
  const [side, setSide] = useState<Side>(() => sideAwayFromEditor() ?? 'right')
  const otherSide: Side = side === 'left' ? 'right' : 'left'

  // The editor may have just come to the front: step aside from it once it has.
  const stepAside = () => requestAnimationFrame(() => setSide((current) => sideAwayFromEditor() ?? current))
  const goToToken = (name: string) => {
    editor?.goToToken(name)
    stepAside()
  }

  const writeCss = async () => {
    if (!editor) return
    if (!editor.hasStylesheet) {
      setBeginning(true)
      const begun = await editor.beginStylesheet()
      setBeginning(false)
      if (!begun) return
    }
    editor.writeCss(selector)
    setWritten(selector)
    stepAside()
  }

  const askCalliope = () => {
    if (!editor) return
    editor.askCalliope(inspectHandOffText(report))
    stepAside()
  }

  return (
    <aside
      aria-labelledby={headingId}
      className="qt-card qt-bg-default qt-text p-4 space-y-4 shadow-lg"
      style={{ position: 'fixed', [side]: '1rem', bottom: '1rem', width: 'min(24rem, calc(100vw - 2rem))', maxHeight: '75vh', overflowY: 'auto', zIndex: 2147483002 }}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 id={headingId} className="qt-heading-4">The inspector</h2>
        <div className="flex items-center gap-1">
          <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={() => setSide(otherSide)} aria-label={`Move the inspector to the ${otherSide}`}>
            <Icon name={otherSide === 'left' ? 'arrow-left' : 'arrow-right'} className="w-4 h-4" />
          </button>
          <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={onClose} aria-label="Close the inspector">
            <Icon name="close" className="w-4 h-4" />
          </button>
        </div>
      </div>

      {match ? (
        <section className="space-y-1" aria-label="The hook">
          <p className="font-medium">{match.hook.label}</p>
          <p className="qt-text-xs font-mono qt-text-secondary">.{match.hook.className}</p>
          <p className="qt-text-xs qt-text-muted">{report.surfaceTitle}</p>
          {match.hook.description && <p className="qt-text-xs qt-text-secondary">{match.hook.description}</p>}
          {match.depth > 0 && (
            <p className="qt-text-xs qt-text-secondary">
              What you chose carries no hook of its own; this is the nearest above it, {match.depth} {match.depth === 1 ? 'level' : 'levels'} up.
            </p>
          )}
          {match.variants.length > 0 && (
            <p className="qt-text-xs">
              Which one:{' '}
              {match.variants.map((v) => (
                <span key={v.attribute} className="font-mono mr-2">
                  {v.attribute}=&quot;{v.value}&quot;{!v.known && ' (not in the catalogue)'}
                </span>
              ))}
            </p>
          )}
          {match.states.length > 0 && <p className="qt-text-xs">State: {match.states.map((s) => s.label).join('; ')}</p>}
          {match.alsoOn.length > 0 && <p className="qt-text-xs qt-text-secondary">Also carries: {match.alsoOn.map((h) => h.label).join(', ')}</p>}

          <div className="pt-2 space-y-2">
            {match.selectors.length > 1 && (
              <div className="flex items-center gap-2">
                <label htmlFor={selectorId} className="qt-text-xs flex-shrink-0">Selector</label>
                <select id={selectorId} className="qt-select qt-select-sm min-w-0 flex-1 font-mono" value={selector} onChange={(e) => setSelector(e.target.value)}>
                  {match.selectors.map((s) => (
                    <option key={s.selector} value={s.selector}>{s.selector}</option>
                  ))}
                </select>
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              <button type="button" className="qt-button qt-button-primary qt-button-sm" onClick={() => void writeCss()} disabled={!editor || beginning}>
                {beginning ? 'Beginning a stylesheet…' : editor && !editor.hasStylesheet ? 'Begin a stylesheet and write CSS for this' : 'Write CSS for this'}
              </button>
              {editor && (
                <button type="button" className="qt-button qt-button-secondary qt-button-sm" onClick={askCalliope}>
                  Ask Calliope about this
                </button>
              )}
              {canShowInGallery && (
                <button type="button" className="qt-button qt-button-secondary qt-button-sm" onClick={() => onShowInGallery(match.hook.className)}>
                  Show in the gallery
                </button>
              )}
            </div>
            {!editor && <p className="qt-text-xs qt-text-muted">Open a draft in the Atelier to write CSS or change a token from here.</p>}
            {written && <p className="qt-text-xs qt-text-secondary" role="status">A rule for <span className="font-mono">{written}</span> waits in the Custom CSS section.</p>}
          </div>
        </section>
      ) : (
        <p className="qt-text-small">What you chose carries no hook, and nothing above it does either. Its tokens are below all the same.</p>
      )}

      <section className="space-y-2" aria-label="Tokens that style it">
        <h3 className="qt-text-small font-medium">Tokens that style it ({report.mode})</h3>
        <Groups groups={report.base} report={report} editor={editor} onGoToToken={goToToken} />
      </section>

      {report.states.map((s) => (
        <details key={s.state} className="space-y-2">
          <summary className="qt-text-small font-medium cursor-pointer">{s.label}</summary>
          <Groups groups={s.groups} report={report} editor={editor} onGoToToken={goToToken} />
        </details>
      ))}

      {report.customRules.length > 0 && (
        <section className="space-y-1" aria-label="Your own CSS that applies">
          <h3 className="qt-text-small font-medium">Your own CSS that applies</h3>
          <ul className="space-y-0.5">
            {report.customRules.map((r) => (
              <li key={`${r.selector}|${r.state ?? ''}`} className="qt-text-xs font-mono break-all">
                {r.selector}
                {r.state && <span className="qt-text-muted"> (on {r.state})</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="qt-text-xs qt-text-muted">
        {report.readsDraft
          ? `Values are those in force on the element; sources are the draft ${editor?.draftName ?? ''}'s.`
          : 'Values are those in force on the element. Where each comes from is shown once a draft is open in the Atelier.'}
      </p>
    </aside>
  )
}
