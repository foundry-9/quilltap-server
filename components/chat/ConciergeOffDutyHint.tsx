'use client'

/**
 * The one sentence shown beneath a per-chat Concierge select when the
 * Concierge is off duty globally (`conciergeSettings.enabled === false`).
 * The select is disabled rather than hidden, so whoever finds it learns
 * where the switch lives. Shared by the Salon sidebar and the New Chat form.
 */

import Link from 'next/link'

export const CONCIERGE_OFF_DUTY_SETTINGS_URL = '/settings?tab=concierge&section=on-duty'

export function ConciergeOffDutyHint({ className }: { className?: string }) {
  return (
    <span className={className}>
      The Concierge is off duty — turn him on in{' '}
      <Link href={CONCIERGE_OFF_DUTY_SETTINGS_URL} className="qt-link">
        Settings → The Concierge
      </Link>
      .
    </span>
  )
}
