'use client'

import { MouseEvent } from 'react'
import { Icon } from '@/components/ui/icon'
import { useTagStyles } from '@/components/providers/tag-style-provider'
import type { TagVisualStyle } from '@/lib/schemas/types'
import { mergeWithDefaultTagStyle } from '@/lib/tags/styles'

interface TagBadgeProps {
  tag: { id: string; name: string }
  onRemove?: () => void
  disabled?: boolean
  size?: 'sm' | 'md'
  className?: string
  styleOverride?: Partial<TagVisualStyle>
}

export function TagBadge({ tag, onRemove, disabled = false, size = 'md', className = '', styleOverride }: TagBadgeProps) {
  const { getStyleForTag } = useTagStyles()
  const computedStyle = styleOverride
    ? mergeWithDefaultTagStyle(styleOverride)
    : getStyleForTag(tag.id)

  const sizeClass = size === 'sm' ? 'qt-tag-badge-sm' : 'qt-tag-badge-md'

  const handleRemove = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation()
    onRemove?.()
  }

  const showEmojiOnly = computedStyle.emojiOnly && computedStyle.emoji

  const textClasses = [
    computedStyle.bold && 'font-bold',
    computedStyle.italic && 'italic',
    computedStyle.strikethrough && 'line-through',
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <span
      className={`qt-tag-badge ${sizeClass} ${textClasses} ${className}`}
      style={{
        color: computedStyle.foregroundColor,
        borderColor: computedStyle.foregroundColor,
        backgroundColor: computedStyle.backgroundColor,
      }}
      title={showEmojiOnly ? tag.name : undefined}
    >
      {computedStyle.emoji && (
        <span aria-hidden="true" className="qt-tag-badge-emoji">
          {computedStyle.emoji}
        </span>
      )}
      {!showEmojiOnly && <span>{tag.name}</span>}
      {onRemove && (
        <button
          type="button"
          onClick={handleRemove}
          disabled={disabled}
          className="qt-tag-badge-remove"
          aria-label={`Remove ${tag.name} tag`}
        >
          <Icon name="close" className="h-3 w-3" />
        </button>
      )}
    </span>
  )
}
