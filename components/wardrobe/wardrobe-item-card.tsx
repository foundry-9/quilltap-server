'use client'

import { useState } from 'react'
import MessageContent from '@/components/chat/MessageContent'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types'

interface WardrobeItemCardProps {
  item: WardrobeItem
  onEdit: (item: WardrobeItem) => void
  onDelete: (id: string) => void
  onArchive: (id: string, archive: boolean) => Promise<void>
  isDeleting?: boolean
  /** Whether this is a shared/archetype item */
  isShared?: boolean
}

const TYPE_BADGE_CLASSES: Record<WardrobeItemType, string> = {
  top: 'qt-badge-wardrobe-top',
  bottom: 'qt-badge-wardrobe-bottom',
  footwear: 'qt-badge-wardrobe-footwear',
  accessories: 'qt-badge-wardrobe-accessories',
}

export function WardrobeItemCard({
  item,
  onEdit,
  onDelete,
  onArchive,
  isDeleting,
  isShared,
}: WardrobeItemCardProps) {
  const [expanded, setExpanded] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const hasDescription = !!item.description
  const isArchived = !!item.archivedAt

  const handleArchive = async () => {
    setArchiving(true)
    try {
      await onArchive(item.id, !isArchived)
      showSuccessToast(isArchived ? 'Item unarchived' : 'Item archived')
    } catch {
      showErrorToast(isArchived ? 'Failed to unarchive item' : 'Failed to archive item')
    } finally {
      setArchiving(false)
    }
  }

  return (
    <div className={`qt-card ${isArchived ? 'opacity-60' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className={`qt-text-primary truncate ${isArchived ? 'line-through' : ''}`}>
              {item.title}
            </h3>
            {item.isDefault && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full qt-text-label-xs bg-primary/10 text-primary">
                Default
              </span>
            )}
            {isShared && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full qt-text-label-xs qt-badge-wardrobe-shared">
                Shared
              </span>
            )}
            {isArchived && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full qt-text-label-xs qt-bg-muted qt-text-muted">
                Archived
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {item.types.map((type) => (
              <span
                key={type}
                className={`inline-flex items-center px-2 py-0.5 rounded-full qt-text-label-xs ${TYPE_BADGE_CLASSES[type]}`}
              >
                {type}
              </span>
            ))}
          </div>
          <div className="flex items-center gap-2 mt-1 qt-text-small">
            {item.appropriateness && (
              <span className="italic">{item.appropriateness}</span>
            )}
            {hasDescription && !item.appropriateness && (
              <span>Has description</span>
            )}
            {!hasDescription && !item.appropriateness && (
              <span className="italic qt-text-secondary">No details yet</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasDescription && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="p-2 qt-text-secondary hover:text-foreground rounded"
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
          )}

          {/* Archive / Unarchive button */}
          <button
            onClick={handleArchive}
            disabled={archiving}
            className="p-2 qt-text-secondary hover:text-foreground rounded disabled:opacity-50"
            title={isArchived ? 'Unarchive' : 'Archive'}
          >
            {archiving ? (
              <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            ) : isArchived ? (
              /* Unarchive icon (box with up arrow) */
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4l3-3m0 0l3 3m-3-3v6" />
              </svg>
            ) : (
              /* Archive icon (box with down arrow) */
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4m-2-2v4" />
              </svg>
            )}
          </button>

          {!isArchived && (
            <button
              onClick={() => onEdit(item)}
              className="p-2 text-primary hover:bg-accent rounded"
              title="Edit"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
          )}

          {/* Delete — secondary action with confirmation */}
          <div className="relative">
            <button
              onClick={() => setShowDeleteConfirm(!showDeleteConfirm)}
              disabled={isDeleting}
              className="p-2 qt-text-destructive hover:qt-bg-destructive/10 rounded disabled:opacity-50"
              title="Delete permanently"
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

            {showDeleteConfirm && (
              <div className="absolute right-0 top-full mt-1 z-10 qt-card p-3 shadow-lg min-w-[200px]">
                <p className="qt-text-small qt-text-primary mb-2">
                  Delete permanently?
                </p>
                <div className="flex gap-2 justify-end">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    className="qt-button-secondary qt-button-sm"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(false)
                      onDelete(item.id)
                    }}
                    className="qt-button-sm bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded px-3 py-1 text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {expanded && hasDescription && (
        <div className="mt-4 border-t qt-border-default pt-4">
          <div className="qt-text-small prose qt-prose-auto prose-sm max-w-none">
            <MessageContent content={item.description!} />
          </div>
        </div>
      )}
    </div>
  )
}
