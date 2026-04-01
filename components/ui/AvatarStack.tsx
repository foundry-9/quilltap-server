'use client'

/**
 * AvatarStack Component
 *
 * Displays a stack of overlapping avatars for multi-character contexts.
 * Used in chat lists and recent chats to show all participants.
 *
 * Features:
 * - Single avatar display when only one entity
 * - Stacked/overlapping avatars for multiple entities (max 4 displayed)
 * - Empty state fallback
 * - Supports circular and rectangular styles
 */

import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'
import { getAvatarSrc, type AvatarImageSource, type AvatarStyle } from './Avatar'

export interface AvatarStackEntity {
  id: string
  name: string
  defaultImage?: {
    id?: string
    filepath: string
    url?: string | null
  } | null
  avatarUrl?: string | null
}

export interface AvatarStackProps {
  /** Array of entities to display */
  entities: AvatarStackEntity[]
  /** Maximum number of avatars to show (default 4) */
  maxDisplay?: number
  /** Size variant */
  size?: 'sm' | 'md' | 'lg'
  /** Override the global avatar style setting */
  styleOverride?: AvatarStyle
  /** Additional CSS classes */
  className?: string
}

// Size configurations
const SIZE_CONFIGS = {
  sm: {
    singleWidth: 48,
    stackWidth: 32,
    height: 60,
    circularHeight: 48,
    overlapOffset: -8,
    textSize: 'text-sm',
    stackTextSize: 'text-xs',
  },
  md: {
    singleWidth: 64,
    stackWidth: 40,
    height: 80,
    circularHeight: 64,
    overlapOffset: -10,
    textSize: 'text-lg',
    stackTextSize: 'text-sm',
  },
  lg: {
    singleWidth: 80,
    stackWidth: 48,
    height: 100,
    circularHeight: 80,
    overlapOffset: -12,
    textSize: 'text-2xl',
    stackTextSize: 'text-base',
  },
}

export function AvatarStack({
  entities,
  maxDisplay = 4,
  size = 'lg',
  styleOverride,
  className = '',
}: AvatarStackProps) {
  const { style: globalStyle } = useAvatarDisplay()
  const style = styleOverride ?? globalStyle
  const config = SIZE_CONFIGS[size]

  // Empty state
  if (entities.length === 0) {
    const width = config.singleWidth
    const height = style === 'CIRCULAR' ? config.circularHeight : config.height

    return (
      <div
        className={`qt-bg-muted flex items-center justify-center flex-shrink-0 ${style === 'CIRCULAR' ? 'rounded-full' : ''} ${className}`}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          aspectRatio: style === 'RECTANGULAR' ? '4/5' : undefined,
        }}
      >
        <span className={`font-bold qt-text-secondary ${config.textSize}`}>?</span>
      </div>
    )
  }

  // Single entity
  if (entities.length === 1) {
    const entity = entities[0]
    const avatarSrc = getAvatarSrc(entity as AvatarImageSource)
    const width = config.singleWidth
    const height = style === 'CIRCULAR' ? config.circularHeight : config.height

    return (
      <div
        className={`overflow-hidden bg-muted flex items-center justify-center flex-shrink-0 ${style === 'CIRCULAR' ? 'rounded-full' : ''} ${className}`}
        style={{
          width: `${width}px`,
          height: `${height}px`,
          aspectRatio: style === 'RECTANGULAR' ? '4/5' : undefined,
        }}
      >
        {avatarSrc ? (
           
          <img
            src={avatarSrc}
            alt={entity.name}
            className="w-full h-full object-cover"
          />
        ) : (
          <span className={`font-bold text-muted-foreground ${config.textSize}`}>
            {entity.name.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
    )
  }

  // Multi-entity: stacked/overlapping avatars
  // Use same height as single avatar, calculate width to maintain aspect ratio
  const displayEntities = entities.slice(0, maxDisplay)
  const stackHeight = style === 'CIRCULAR' ? config.circularHeight : config.height
  // For rectangular (4:5 ratio), width = height * 0.8; for circular, width = height
  const stackWidth = style === 'CIRCULAR' ? stackHeight : Math.round(stackHeight * 0.8)
  const overlapOffset = style === 'CIRCULAR' ? config.overlapOffset : Math.round(stackWidth * -0.25)

  return (
    <div
      className={`flex items-stretch h-full ${className}`}
      style={{ marginRight: `${Math.abs(overlapOffset) * (displayEntities.length - 1)}px` }}
    >
      {displayEntities.map((entity, index) => {
        const avatarSrc = getAvatarSrc(entity as AvatarImageSource)
        const zIndex = displayEntities.length - index
        const marginLeft = index === 0 ? 0 : overlapOffset

        return (
          <div
            key={entity.id}
            className={`overflow-hidden bg-muted flex items-center justify-center flex-shrink-0 border-2 border-card ${style === 'CIRCULAR' ? 'rounded-full' : ''}`}
            style={{
              width: `${stackWidth}px`,
              height: `${stackHeight}px`,
              zIndex,
              marginLeft: `${marginLeft}px`,
              borderRadius: style === 'RECTANGULAR' ? 'var(--radius-sm)' : undefined,
            }}
          >
            {avatarSrc ? (
               
              <img
                src={avatarSrc}
                alt={entity.name}
                className="w-full h-full object-cover"
              />
            ) : (
              <span className={`font-bold text-muted-foreground ${config.stackTextSize}`}>
                {entity.name.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default AvatarStack
