'use client'

/**
 * Calliope's specimen gallery — every catalogued hook, in each of its
 * variants and states, wearing the theme being shown (Calliope Live, Spec H,
 * Stage 1).
 *
 * Each instance is drawn on a *stage*: an element carrying `data-theme` for
 * the shown theme (the draft being edited, or the theme worn) and the mode's
 * class, so the tokens resolve afresh there and the gallery can show light
 * and dark side by side whatever the window's own mode. A stage contains
 * layout and paint, so a fixed overlay or a full-height shell stays inside
 * it. The gallery's own words — section and hook headings, class names,
 * instance labels — stay outside the stages, in the house default, so no
 * draft can make them unreadable.
 *
 * Specimens make no request and write nothing; a link inside a stage goes
 * nowhere.
 *
 * @module components/theme-specimens/SpecimenGallery
 */

import { memo, useRef, useState, type MouseEvent, type RefObject } from 'react'
import type { HookDef } from '@/lib/themes/hooks'
import { useInspectOptional } from '@/components/theme-inspect/InspectProvider'
import { hookGroups } from '@/components/theme-editor/assets/styles-model'
import { hookElementProps, isDense, specimenInstances, type SpecimenInstance } from './instances'
import { SPECIMENS } from './registry'

export type GalleryMode = 'light' | 'dark'

export interface StageTheme {
  /** The theme the stages wear. */
  themeId: string
  /** The choice attributes the root carries (`data-qt-density`, …), copied so a stage resolves as the page does. */
  choiceAttributes: Readonly<Record<string, string>>
}

interface SpecimenGalleryProps {
  query: string
  /** The modes each instance is drawn in: one, or both side by side. */
  modes: readonly GalleryMode[]
  stage: StageTheme
  /** Id prefix for section anchors (the gallery's navigation). */
  idPrefix: string
}

export const surfaceDomId = (prefix: string, surface: string) => `${prefix}-surface-${surface}`

/** The id of a hook's specimen heading, which takes focus when the inspector reveals it. */
export const specimenHeadingId = (className: string) => `specimen-${className}`

/** "Inspect this" and "Show on this page", when the inspector is about. */
function SpecimenActions({ hook, articleRef }: { hook: HookDef; articleRef: RefObject<HTMLElement | null> }) {
  const inspect = useInspectOptional()
  const [said, setSaid] = useState('')
  if (!inspect) return null
  const inspectHere = () => {
    const stage = articleRef.current?.querySelector('[data-specimen-stage]') ?? undefined
    setSaid(inspect.inspectHook(hook.className, stage) ? '' : 'Nothing to inspect here.')
  }
  const showOnPage = () => {
    const count = inspect.showMatches(`.${hook.className}`)
    setSaid(
      count === 0
        ? 'Nothing on the page outside the gallery wears it just now.'
        : `${count} ${count === 1 ? 'element' : 'elements'} on the page ${count === 1 ? 'wears' : 'wear'} it, outlined.`,
    )
  }
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button type="button" className="qt-button qt-button-secondary qt-button-sm" onClick={inspectHere}>
        Inspect this
      </button>
      <button type="button" className="qt-button qt-button-ghost qt-button-sm" onClick={showOnPage}>
        Show on this page
      </button>
      <span role="status" className="qt-text-xs qt-text-secondary">{said}</span>
    </div>
  )
}

/** A click on a link inside a stage goes nowhere. */
function stopLinks(e: MouseEvent<HTMLElement>) {
  if ((e.target as Element).closest?.('a[href]')) e.preventDefault()
}

function Stage({ hook, instance, mode, stage }: { hook: HookDef; instance: SpecimenInstance; mode: GalleryMode; stage: StageTheme }) {
  const def = SPECIMENS[hook.className]
  return (
    <div
      {...stage.choiceAttributes}
      data-theme={stage.themeId}
      data-specimen-stage={mode}
      data-inspect-target=""
      className={`${mode} qt-bg-default qt-text rounded border qt-border-default p-3`}
      style={{ contain: 'layout paint', position: 'relative', overflow: 'auto', maxHeight: '20rem' }}
    >
      {def ? def.render({ el: hookElementProps(hook, instance), instance }) : null}
    </div>
  )
}

const HookSpecimen = memo(function HookSpecimen({ hook, modes, stage }: { hook: HookDef; modes: readonly GalleryMode[]; stage: StageTheme }) {
  const def = SPECIMENS[hook.className]
  const instances = specimenInstances(hook)
  const dense = isDense(instances) && modes.length === 1
  const headingId = specimenHeadingId(hook.className)
  const articleRef = useRef<HTMLElement>(null)
  return (
    <article
      ref={articleRef}
      className="qt-card p-4 space-y-3"
      aria-labelledby={headingId}
      data-specimen-for={hook.className}
      style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 16rem' }}
    >
      <header className="space-y-1">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <h3 id={headingId} tabIndex={-1} className="qt-heading-4 scroll-mt-24">{hook.label}</h3>
          <span className="qt-text-xs qt-text-muted">{def?.component ? `The real ${def.component}` : 'Markup'}</span>
        </div>
        <p className="qt-text-xs font-mono qt-text-secondary">.{hook.className}</p>
        {hook.description && <p className="qt-text-xs qt-text-secondary">{hook.description}</p>}
        {def?.note && <p className="qt-text-xs qt-text-muted">{def.note}</p>}
        <SpecimenActions hook={hook} articleRef={articleRef} />
      </header>
      {!def ? (
        <p className="qt-text-small qt-text-destructive" role="note">No specimen has been drawn for this hook yet.</p>
      ) : (
        <ul
          className={dense ? 'grid gap-3' : 'space-y-3'}
          style={dense ? { gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 16rem), 1fr))' } : undefined}
          aria-label={`${hook.label}: instances`}
        >
          {instances.map((instance) => (
            <li key={instance.key} className="space-y-1 min-w-0" data-specimen-instance={instance.key}>
              <p className="qt-text-xs qt-text-secondary">
                {instance.label}
                {instance.kind !== 'base' && <span className="font-mono qt-text-muted"> · {instance.selector}</span>}
              </p>
              <div
                className={modes.length > 1 ? 'grid gap-2' : undefined}
                style={modes.length > 1 ? { gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 20rem), 1fr))' } : undefined}
              >
                {modes.map((mode) => (
                  <Stage key={mode} hook={hook} instance={instance} mode={mode} stage={stage} />
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  )
})

/** The gallery's sections: one per surface, in catalogue order, narrowed by `query`. */
export function SpecimenGallery({ query, modes, stage, idPrefix }: SpecimenGalleryProps) {
  const groups = hookGroups(query)
  if (groups.length === 0) {
    return <p className="qt-card p-4 qt-text-small qt-text-muted">No hook answers to that description.</p>
  }
  return (
    <div className="space-y-8" onClickCapture={stopLinks}>
      {groups.map((group) => (
        <section key={group.surface} id={surfaceDomId(idPrefix, group.surface)} aria-labelledby={`${surfaceDomId(idPrefix, group.surface)}-h`} className="space-y-4 scroll-mt-4">
          <h2 id={`${surfaceDomId(idPrefix, group.surface)}-h`} tabIndex={-1} className="qt-heading-3">
            {group.title} <span className="qt-text-small qt-text-muted">({group.hooks.length})</span>
          </h2>
          {group.hooks.map((hook) => (
            <HookSpecimen key={hook.className} hook={hook} modes={modes} stage={stage} />
          ))}
        </section>
      ))}
    </div>
  )
}
