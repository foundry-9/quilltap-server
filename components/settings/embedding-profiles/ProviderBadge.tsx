'use client'

import type { FC } from 'react'
import { PROVIDER_BADGE_CLASSES } from './types'

interface ProviderBadgeProps {
  provider: string
}

/**
 * Badge component to display embedding provider
 * Uses qt-badge-provider-* CSS classes for theme-aware styling
 */
export const ProviderBadge: FC<ProviderBadgeProps> = ({ provider }) => {
  const badgeClass = PROVIDER_BADGE_CLASSES[provider] || 'qt-badge-secondary'

  return (
    <span className={badgeClass}>
      {provider}
    </span>
  )
}
