'use client'

import { ProviderIcon } from '@/components/image-profiles/ProviderIcon'
import { useProviders } from '@/hooks/useProviders'

interface ProviderModelBadgeProps {
  /** Provider name (e.g., 'openai', 'anthropic') */
  provider?: string | null
  /** Model name to display (e.g., 'gpt-4o', 'claude-sonnet-4-20250514') */
  modelName?: string | null
  /** Badge size: 'xs' for under chat avatars, 'sm' for sidebar/cards */
  size?: 'xs' | 'sm'
}

const sizeConfig = {
  xs: { icon: 'h-3 w-3', text: 'text-[10px]' },
  sm: { icon: 'h-3.5 w-3.5', text: 'text-xs' },
}

/**
 * Reusable badge showing a provider icon and model name.
 * Gracefully returns null when provider is falsy (e.g., old messages or user messages).
 */
export function ProviderModelBadge({ provider, modelName, size = 'xs' }: ProviderModelBadgeProps) {
  const { getProviderIcon } = useProviders()

  if (!provider) return null

  const iconData = getProviderIcon(provider)
  const { icon: iconClass, text: textClass } = sizeConfig[size]

  return (
    <span className={`inline-flex items-center gap-1 opacity-60 ${textClass}`} title={`${provider}: ${modelName || 'unknown'}`}>
      <ProviderIcon provider={provider} iconData={iconData || undefined} className={iconClass} />
      {modelName && <span className="truncate max-w-[8rem]">{modelName}</span>}
    </span>
  )
}
