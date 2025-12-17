'use client'

import type { FC } from 'react'
import { PROVIDER_COLORS } from './types'

interface ProviderBadgeProps {
  provider: string
}

/**
 * Badge component to display embedding provider
 */
export const ProviderBadge: FC<ProviderBadgeProps> = ({ provider }) => {
  return (
    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${PROVIDER_COLORS[provider] || 'bg-muted text-foreground'}`}>
      {provider}
    </span>
  )
}
