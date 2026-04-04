'use client'

import { useState } from 'react'
import { TagBadge } from '@/components/tags/tag-badge'

interface Tag {
  id: string
  name: string
}

interface Memory {
  id: string
  characterId: string
  content: string
  summary: string
  keywords: string[]
  tags: string[]
  tagDetails?: Tag[]
  importance: number
  source: 'AUTO' | 'MANUAL'
  /** Source message ID for auto-created memories (memory provenance) */
  sourceMessageId?: string | null
  /** Chat ID where the source message resides */
  chatId?: string | null
  createdAt: string
  updatedAt: string
}

interface MemoryCardProps {
  memory: Memory
  onEdit?: (memory: Memory) => void
  onDelete?: (memoryId: string) => void
  /** Called when user clicks "Source" link to navigate to the source message */
  onNavigateToSource?: (chatId: string, messageId: string) => void
  isDeleting?: boolean
}

export function MemoryCard({ memory, onEdit, onDelete, onNavigateToSource, isDeleting = false }: MemoryCardProps) {
  const [expanded, setExpanded] = useState(false)

  const importanceColor = memory.importance >= 0.7
    ? 'qt-text-destructive'
    : memory.importance >= 0.4
      ? 'qt-text-warning'
      : 'qt-text-secondary'

  const importanceLabel = memory.importance >= 0.7
    ? 'High'
    : memory.importance >= 0.4
      ? 'Medium'
      : 'Low'

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className="qt-card">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="qt-text-label line-clamp-2">
            {memory.summary}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`qt-text-label-xs ${importanceColor}`} title={`Importance: ${(memory.importance * 100).toFixed(0)}%`}>
            {importanceLabel}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            memory.source === 'AUTO'
              ? 'qt-bg-info/10 qt-text-info'
              : 'qt-bg-success/10 qt-text-success'
          }`}>
            {memory.source === 'AUTO' ? 'Auto' : 'Manual'}
          </span>
        </div>
      </div>

      {/* Content Preview / Full Content */}
      <div className="mb-3">
        <p className={`qt-text-small ${expanded ? '' : 'line-clamp-3'}`}>
          {memory.content}
        </p>
        {memory.content.length > 150 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-xs text-primary hover:underline mt-1"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>

      {/* Keywords */}
      {memory.keywords.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {memory.keywords.map((keyword, index) => (
            <span
              key={index}
              className="qt-text-xs px-2 py-0.5 bg-accent rounded"
            >
              {keyword}
            </span>
          ))}
        </div>
      )}

      {/* Tags */}
      {memory.tagDetails && memory.tagDetails.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {memory.tagDetails.map((tag) => (
            <TagBadge key={tag.id} tag={tag} size="sm" />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between pt-2 border-t qt-border-default">
        <div className="flex items-center gap-2">
          <span className="qt-text-xs">
            {formatDate(memory.createdAt)}
          </span>
          {/* Source link for AUTO memories */}
          {memory.source === 'AUTO' && memory.sourceMessageId && memory.chatId && onNavigateToSource && (
            <button
              onClick={() => onNavigateToSource(memory.chatId!, memory.sourceMessageId!)}
              className="text-xs text-primary hover:underline flex items-center gap-1"
              title="View source message"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"
                />
              </svg>
              Source
            </button>
          )}
        </div>
        <div className="flex gap-2">
          {onEdit && (
            <button
              onClick={() => onEdit(memory)}
              className="text-xs text-primary hover:underline"
            >
              Edit
            </button>
          )}
          {onDelete && (
            <button
              onClick={() => onDelete(memory.id)}
              disabled={isDeleting}
              className="text-xs qt-text-destructive hover:underline disabled:opacity-50"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
