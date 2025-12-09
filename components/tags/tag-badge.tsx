'use client'

import { MouseEvent } from 'react'
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
          <svg
            className="h-3 w-3"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      )}
    </span>
  )
}
