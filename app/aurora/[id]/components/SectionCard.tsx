'use client'

/**
 * One card of a character-page section: a heading that names the question it
 * answers, an optional line of explanation, optional controls on the heading
 * row, and the body.
 *
 * @module app/aurora/[id]/components/SectionCard
 */

import { useId, type ReactNode } from 'react'

export interface SectionCardProps {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  /** Anchor id, so a stat link can scroll to this card. */
  anchor?: string
}

export function SectionCard({ title, description, actions, children, anchor }: SectionCardProps) {
  const headingId = useId()
  return (
    <section id={anchor} aria-labelledby={headingId} className="qt-card scroll-mt-48 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="qt-heading-4 text-foreground">
            {title}
          </h2>
          {description && <p className="qt-text-small mt-1">{description}</p>}
        </div>
        {actions && <div className="flex flex-shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  )
}
