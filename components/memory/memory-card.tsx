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
  createdAt: string
  updatedAt: string
}

interface MemoryCardProps {
  memory: Memory
  onEdit?: (memory: Memory) => void
  onDelete?: (memoryId: string) => void
  isDeleting?: boolean
}

export function MemoryCard({ memory, onEdit, onDelete, isDeleting = false }: MemoryCardProps) {
  const [expanded, setExpanded] = useState(false)

  const importanceColor = memory.importance >= 0.7
    ? 'text-destructive'
    : memory.importance >= 0.4
      ? 'text-yellow-600'
      : 'text-muted-foreground'

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
    <div className="bg-card border border-border rounded-lg p-4 shadow-sm hover:shadow-md transition-shadow">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm text-foreground font-medium line-clamp-2">
            {memory.summary}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={`text-xs font-medium ${importanceColor}`} title={`Importance: ${(memory.importance * 100).toFixed(0)}%`}>
            {importanceLabel}
          </span>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            memory.source === 'AUTO'
              ? 'bg-blue-100/80 text-blue-700'
              : 'bg-green-100/80 text-green-700'
          }`}>
            {memory.source === 'AUTO' ? 'Auto' : 'Manual'}
          </span>
        </div>
      </div>

      {/* Content Preview / Full Content */}
      <div className="mb-3">
        <p className={`text-sm text-muted-foreground ${expanded ? '' : 'line-clamp-3'}`}>
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
              className="text-xs px-2 py-0.5 bg-accent text-muted-foreground rounded"
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
      <div className="flex items-center justify-between pt-2 border-t border-border">
        <span className="text-xs text-muted-foreground">
          {formatDate(memory.createdAt)}
        </span>
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
              className="text-xs text-destructive hover:underline disabled:opacity-50"
            >
              {isDeleting ? 'Deleting...' : 'Delete'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
