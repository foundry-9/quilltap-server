'use client'

import { useState } from 'react'
import MessageContent from '@/components/chat/MessageContent'

export interface PhysicalDescription {
  id: string
  name: string
  shortPrompt?: string | null
  mediumPrompt?: string | null
  longPrompt?: string | null
  completePrompt?: string | null
  fullDescription?: string | null
  createdAt: string
  updatedAt: string
}

interface PhysicalDescriptionCardProps {
  description: PhysicalDescription
  onEdit: (description: PhysicalDescription) => void
  onDelete: (id: string) => void
  isDeleting?: boolean
}

export function PhysicalDescriptionCard({
  description,
  onEdit,
  onDelete,
  isDeleting,
}: PhysicalDescriptionCardProps) {
  const [expanded, setExpanded] = useState(false)

  const promptCount = [
    description.shortPrompt,
    description.mediumPrompt,
    description.longPrompt,
    description.completePrompt,
  ].filter(Boolean).length

  const hasFullDescription = !!description.fullDescription

  return (
    <div className="qt-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="qt-text-primary truncate">
            {description.name}
          </h3>
          <div className="flex items-center gap-2 mt-1 qt-text-small">
            <span>{promptCount} prompt{promptCount !== 1 ? 's' : ''}</span>
            {hasFullDescription && (
              <>
                <span>•</span>
                <span>Full description</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-2 text-muted-foreground hover:text-foreground rounded"
            title={expanded ? 'Collapse' : 'Expand'}
          >
            <svg
              className={`w-4 h-4 transition-transform ${expanded ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          <button
            onClick={() => onEdit(description)}
            className="p-2 text-primary hover:bg-accent rounded"
            title="Edit"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={() => onDelete(description.id)}
            disabled={isDeleting}
            className="p-2 text-destructive hover:bg-destructive/10 rounded disabled:opacity-50"
            title="Delete"
          >
            {isDeleting ? (
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-4 border-t border-border pt-4">
          {description.shortPrompt && (
            <div>
              <h4 className="qt-text-label-xs uppercase tracking-wide mb-1">
                Short (≤350)
              </h4>
              <p className="qt-text-small">{description.shortPrompt}</p>
            </div>
          )}
          {description.mediumPrompt && (
            <div>
              <h4 className="qt-text-label-xs uppercase tracking-wide mb-1">
                Medium (≤500)
              </h4>
              <p className="qt-text-small">{description.mediumPrompt}</p>
            </div>
          )}
          {description.longPrompt && (
            <div>
              <h4 className="qt-text-label-xs uppercase tracking-wide mb-1">
                Long (≤750)
              </h4>
              <p className="qt-text-small">{description.longPrompt}</p>
            </div>
          )}
          {description.completePrompt && (
            <div>
              <h4 className="qt-text-label-xs uppercase tracking-wide mb-1">
                Complete (≤1000)
              </h4>
              <p className="qt-text-small">{description.completePrompt}</p>
            </div>
          )}
          {description.fullDescription && (
            <div>
              <h4 className="qt-text-label-xs uppercase tracking-wide mb-1">
                Full Description
              </h4>
              <div className="qt-text-small prose dark:prose-invert prose-sm max-w-none">
                <MessageContent content={description.fullDescription} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
