'use client'

import { ProviderModelBadge } from '@/components/ui/ProviderModelBadge'
import {
  ROUTE_OUTCOME_GLYPH,
  collapseRouteTrail,
  describeRouteAttempt,
  routeOutcomeLabel,
} from '@/lib/chat/route-trail-display'
import type { RouteAttempt } from '@/lib/schemas/chat.types'

interface RouteTrailBadgeProps {
  /** The turn's route trail, oldest attempt first. Never empty — callers fall
   *  back to a plain `ProviderModelBadge` when there is no trail. */
  routeTrail: RouteAttempt[]
  /** Badge size, passed straight through to each row's ProviderModelBadge. */
  size?: 'xs' | 'sm'
}

/**
 * The call sheet under an assistant avatar: every connection profile tried for
 * the turn, first asked at the top, the one that answered at the bottom.
 *
 * A row that fell over on its own is struck through and marked ❌; one that
 * declined on content grounds is struck through and marked 🚫. The row that
 * answered wears neither, so a one-row trail is indistinguishable from the
 * plain badge it replaces.
 *
 * Theme authors: this list has no `qt-*` hook of its own yet — target it
 * through `[aria-label="Models tried for this reply"]`.
 */
export function RouteTrailBadge({ routeTrail, size = 'xs' }: RouteTrailBadgeProps) {
  const rows = collapseRouteTrail(routeTrail)
  if (rows.length === 0) return null

  return (
    <ul className="flex flex-col items-center gap-0.5" aria-label="Models tried for this reply">
      {rows.map((row, index) => {
        const title = describeRouteAttempt(row)
        const badge = (
          <ProviderModelBadge
            provider={row.provider}
            modelName={row.modelName}
            size={size}
            title={title}
          />
        )

        if (row.outcome === 'answered') {
          return (
            <li key={`${row.profileId}-${index}`} className="inline-flex items-center gap-1">
              {badge}
            </li>
          )
        }

        return (
          <li key={`${row.profileId}-${index}`} className="inline-flex items-center gap-1">
            <span role="img" aria-label={routeOutcomeLabel(row.outcome)} className="text-[10px] leading-none">
              {ROUTE_OUTCOME_GLYPH[row.outcome]}
            </span>
            <s className="inline-flex items-center">{badge}</s>
          </li>
        )
      })}
    </ul>
  )
}
