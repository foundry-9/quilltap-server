'use client'

/**
 * One card of a character-page section: a heading that names the question it
 * answers, an optional line of explanation, optional controls on the heading
 * row, and the body.
 *
 * A `collapsible` card starts shut: its heading becomes a disclosure button
 * (with an optional `summary` beside it, e.g. a count) and the body mounts only
 * when opened, so a long list does no work until asked. A stat link to its
 * anchor opens it (`useAnchorReveal`).
 *
 * @module app/aurora/[id]/components/SectionCard
 */

import { useId, useState, type ReactNode } from 'react'
import { Icon } from '@/components/ui/icon'
import { useAnchorReveal } from '@/hooks/useAnchorReveal'

export interface SectionCardProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  /** Anchor id, so a stat link can scroll to this card. */
  anchor?: string
  /** Start collapsed behind a disclosure heading; the body mounts when opened. */
  collapsible?: boolean
  /** Shown beside a collapsible card's title (a count, say). */
  summary?: ReactNode
}

export function SectionCard({ title, description, actions, children, anchor, collapsible, summary }: SectionCardProps) {
  const headingId = useId()
  const bodyId = useId()
  const [expanded, setExpanded] = useState(!collapsible)
  useAnchorReveal(collapsible ? anchor : undefined, () => setExpanded(true))
  const open = !collapsible || expanded

  return (
    <section id={anchor} aria-labelledby={headingId} className="qt-card scroll-mt-48 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="qt-heading-4 qt-text">
            {collapsible ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                aria-expanded={expanded}
                aria-controls={bodyId}
                className="inline-flex items-center gap-2 text-left"
              >
                <Icon name={expanded ? 'chevron-down' : 'chevron-right'} className="h-4 w-4 qt-text-secondary" />
                <span>{title}</span>
                {summary != null && <span className="qt-text-label-xs font-normal">{summary}</span>}
              </button>
            ) : (
              title
            )}
          </h2>
          {description && <p className="qt-text-small mt-1">{description}</p>}
        </div>
        {actions && open && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {collapsible ? (
        open && (
          <div id={bodyId} className="space-y-4">
            {children}
          </div>
        )
      ) : (
        children
      )}
    </section>
  )
}
