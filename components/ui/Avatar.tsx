'use client'

/**
 * Avatar Component
 *
 * A unified avatar display component used across the application.
 * Supports:
 * - Size variants (xs, sm, md, lg, xl, or custom dimensions)
 * - Style variants (circular, rectangular with 4:5 aspect ratio)
 * - Image display with fallback to initial letter
 * - Optional name and title display below
 * - Active state ring indicator
 * - Queue position badge overlay
 */

import { useAvatarDisplay } from '@/hooks/useAvatarDisplay'

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'chat'
export type AvatarStyle = 'CIRCULAR' | 'RECTANGULAR'

export interface AvatarImageSource {
  defaultImage?: {
    id?: string
    filepath: string
    url?: string | null
  } | null
  avatarUrl?: string | null
}

export interface AvatarProps {
  /** Name of the entity (used for fallback initial and alt text) */
  name: string
  /** Optional title/subtitle */
  title?: string | null
  /** Image source - can be a direct URL string or an object with defaultImage/avatarUrl */
  src?: string | AvatarImageSource | null
  /** Size preset or 'chat' for the large chat message avatar */
  size?: AvatarSize
  /** Custom width in pixels (overrides size preset) */
  customWidth?: number
  /** Custom height in pixels (overrides size preset) */
  customHeight?: number
  /** Override the global avatar style setting */
  styleOverride?: AvatarStyle
  /** Show ring indicator (e.g., for current turn) */
  isActive?: boolean
  /** Queue position badge (0 or undefined = no badge) */
  queuePosition?: number
  /** Show name below avatar */
  showName?: boolean
  /** Show title below name */
  showTitle?: boolean
  /** Additional CSS classes for the wrapper */
  className?: string
  /** Click handler */
  onClick?: () => void
}

// Size configurations in pixels
const SIZE_CONFIGS: Record<AvatarSize, { width: number; height: number; textSize: string }> = {
  xs: { width: 32, height: 32, textSize: 'text-xs' },
  sm: { width: 40, height: 40, textSize: 'text-sm' },
  md: { width: 48, height: 60, textSize: 'text-lg' },
  lg: { width: 80, height: 100, textSize: 'text-3xl' },
  xl: { width: 128, height: 160, textSize: 'text-5xl' },
  chat: { width: 120, height: 150, textSize: 'text-4xl' },
}

/**
 * Extract the actual image URL from various source formats
 */
export function getAvatarSrc(src: string | AvatarImageSource | null | undefined): string | null {
  if (!src) return null

  // Direct URL string
  if (typeof src === 'string') {
    return src.startsWith('/') ? src : `/${src}`
  }

  // Object with defaultImage or avatarUrl
  if (src.defaultImage) {
    const filepath = src.defaultImage.url || src.defaultImage.filepath
    return filepath.startsWith('/') ? filepath : `/${filepath}`
  }

  if (src.avatarUrl) {
    return src.avatarUrl.startsWith('/') ? src.avatarUrl : src.avatarUrl
  }

  return null
}

export function Avatar({
  name,
  title,
  src,
  size = 'md',
  customWidth,
  customHeight,
  styleOverride,
  isActive = false,
  queuePosition,
  showName = false,
  showTitle = false,
  className = '',
  onClick,
}: AvatarProps) {
  const { style: globalStyle } = useAvatarDisplay()
  const style = styleOverride ?? globalStyle

  // Get dimensions
  const sizeConfig = SIZE_CONFIGS[size]
  const width = customWidth ?? sizeConfig.width
  const baseHeight = customHeight ?? sizeConfig.height

  // For rectangular style, apply 4:5 aspect ratio unless custom dimensions provided
  const height = style === 'RECTANGULAR' && !customHeight
    ? Math.round(width * 1.25)
    : baseHeight

  // For circular style, ensure equal width/height unless custom provided
  const finalHeight = style === 'CIRCULAR' && !customHeight && !customWidth
    ? width
    : height

  const avatarSrc = getAvatarSrc(src)
  const initial = name.charAt(0).toUpperCase()

  // Build wrapper classes
  const wrapperClasses = [
    'relative flex-shrink-0',
    className,
  ].filter(Boolean).join(' ')

  // Build image container classes
  const containerClasses = [
    'overflow-hidden bg-muted flex items-center justify-center',
    style === 'CIRCULAR' ? 'rounded-full' : '',
    isActive ? 'ring-2 ring-primary ring-offset-1 ring-offset-card' : '',
  ].filter(Boolean).join(' ')

  const containerStyle: React.CSSProperties = {
    width: `${width}px`,
    height: `${finalHeight}px`,
    borderRadius: style === 'RECTANGULAR' ? 'var(--radius-md)' : undefined,
  }

  const avatarElement = (
    <div className={containerClasses} style={containerStyle}>
      {avatarSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarSrc}
          alt={name}
          className="w-full h-full object-cover"
        />
      ) : (
        <span className={`font-bold text-muted-foreground ${sizeConfig.textSize}`}>
          {initial}
        </span>
      )}
    </div>
  )

  // Queue position badge
  const badgeElement = queuePosition && queuePosition > 0 ? (
    <div className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-info text-info-foreground text-xs font-bold flex items-center justify-center shadow-md z-10">
      {queuePosition}
    </div>
  ) : null

  // Name and title display
  const nameElement = (showName || showTitle) ? (
    <div className="text-center mt-1">
      {showName && (
        <div className="text-sm font-semibold text-foreground line-clamp-2">
          {name}
        </div>
      )}
      {showTitle && title && (
        <div className="text-xs italic text-muted-foreground line-clamp-2">
          {title}
        </div>
      )}
    </div>
  ) : null

  // If clickable, wrap in button
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={wrapperClasses}
      >
        {badgeElement}
        {avatarElement}
        {nameElement}
      </button>
    )
  }

  return (
    <div className={wrapperClasses}>
      {badgeElement}
      {avatarElement}
      {nameElement}
    </div>
  )
}

export default Avatar
