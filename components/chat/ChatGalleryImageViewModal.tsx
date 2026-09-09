'use client'

/**
 * ChatGalleryImageViewModal — one picture from the chat gallery, enlarged.
 *
 * It used to carry two hard-wired album buttons that posted to the first
 * character's and the first user-character's photo routes. That was a shortcut
 * from before `SaveImageDialog` existed: it could reach two albums out of the
 * several a chat can see, it had no caption or duplicate notice, and it handed
 * a `doc_mount_file_links` id to a route that only understands a `files.id`.
 * Save now opens the same dialog the message toolbar's bookmark opens, with
 * the same list of albums, and this view keeps only what it is for — looking,
 * copying, downloading, walking the roll, and retiring a picture the chat
 * itself owns.
 */

import { useState } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { useImageNavigation } from '@/hooks/useImageNavigation'
import DeletedImagePlaceholder from '@/components/images/DeletedImagePlaceholder'
import { downloadGalleryEntry } from '@/lib/download-utils'
import { copyImageToClipboard } from '@/lib/clipboard-utils'
import { Icon } from '@/components/ui/icon'
import type { ChatGalleryEntry, ChatGallerySource } from '@/lib/photos/chat-gallery'

interface ChatGalleryImageViewModalProps {
  isOpen: boolean
  onClose: () => void
  entry: ChatGalleryEntry
  onPrev?: () => void
  onNext?: () => void
  /** Retire a picture the chat owns. Only offered when `entry.deletable`. */
  onDelete: () => void
  /** Open the album picker on this picture. */
  onSave: () => void
  /** Scroll the transcript to the message this picture hangs beneath. */
  onJumpToMessage?: (messageId: string) => void
}

/** How each source describes itself in the line under the picture. */
const SOURCE_PHRASE: Record<ChatGallerySource, string> = {
  'story-background': 'Story background',
  avatar: 'Avatar, repainted during this conversation',
  portrait: 'Standing portrait',
  generated: 'Generated in this conversation',
  attachment: 'Attached beneath a message',
  kept: 'Brought out of a photo album',
  inline: 'Woven into the prose',
}

function formatDay(iso: string): string | null {
  const ms = new Date(iso).getTime()
  // Portraits and inline references can carry a placeholder date; a nonsense
  // day in the provenance line is worse than no day at all.
  if (!Number.isFinite(ms) || ms <= 0) return null
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

export default function ChatGalleryImageViewModal({
  isOpen,
  onClose,
  entry,
  onPrev,
  onNext,
  onDelete,
  onSave,
  onJumpToMessage,
}: Readonly<ChatGalleryImageViewModalProps>) {
  const [imageMissing, setImageMissing] = useState(false)

  useImageNavigation({ isOpen, onClose, onPrev, onNext })

  const handleCopyToClipboard = async () => {
    try {
      await copyImageToClipboard(entry.url)
      showSuccessToast('Image copied to clipboard')
    } catch (error) {
      console.error('Failed to copy image to clipboard:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast('Failed to copy image to clipboard')
    }
  }

  const handleDownload = async () => {
    try {
      await downloadGalleryEntry(entry)
    } catch (error) {
      console.error('Failed to download image:', { error: error instanceof Error ? error.message : String(error) })
      showErrorToast('Failed to download image')
    }
  }

  if (!isOpen) return null

  const day = formatDay(entry.createdAt)
  const provenance = [
    SOURCE_PHRASE[entry.source],
    entry.characterName ?? null,
    day ? `painted ${day}` : null,
    entry.isCurrent ? 'current' : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const linkCount = entry.linkSummary?.count ?? 0

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center qt-bg-overlay backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      {/* Navigation buttons - left and right sides */}
      {onPrev && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onPrev()
          }}
          className="absolute left-4 top-1/2 -translate-y-1/2 p-3 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors z-10 cursor-pointer"
          title="Previous image (Left Arrow)"
        >
          <Icon name="chevron-left" className="w-8 h-8" />
        </button>
      )}

      {onNext && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            onNext()
          }}
          className="absolute right-4 top-1/2 -translate-y-1/2 p-3 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors z-10 cursor-pointer"
          title="Next image (Right Arrow)"
        >
          <Icon name="chevron-right" className="w-8 h-8" />
        </button>
      )}

      {/* Top right control buttons */}
      {!imageMissing && (
        <div className="absolute top-4 right-4 flex gap-2 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSave()
            }}
            className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors cursor-pointer"
            title="Save to a photo album"
            aria-label="Save to a photo album"
          >
            <Icon name="bookmark" className="w-6 h-6" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleDownload()
            }}
            className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors cursor-pointer"
            title="Download"
            aria-label="Download"
          >
            <Icon name="download" className="w-6 h-6" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleCopyToClipboard()
            }}
            className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors cursor-pointer"
            title="Copy to clipboard"
            aria-label="Copy to clipboard"
          >
            <Icon name="copy" className="w-6 h-6" />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              onClose()
            }}
            className="p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors cursor-pointer"
            title="Close (Escape)"
            aria-label="Close"
          >
            <Icon name="close" className="w-6 h-6" />
          </button>
        </div>
      )}

      {/* Delete — only where the chat itself owns the record. A portrait
          belongs to its character; a kept or inline picture belongs to an
          album or a vault; the background presently on the wall is what the
          chat is showing. */}
      {!imageMissing && entry.deletable && (
        <div className="absolute bottom-4 right-4 z-10">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
            className="p-2 qt-bg-destructive/80 hover:qt-bg-destructive rounded-full qt-text-overlay transition-colors cursor-pointer"
            title="Delete image permanently"
            aria-label="Delete image permanently"
          >
            <Icon name="trash" className="w-6 h-6" />
          </button>
        </div>
      )}

      {/* Image container */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {imageMissing ? (
          <DeletedImagePlaceholder
            imageId={entry.id}
            filename={entry.filename}
            onCleanup={onClose}
            width={600}
            height={400}
          />
        ) : (
          <>
            { }
            <img
              src={entry.url}
              alt={entry.filename}
              className="max-w-full max-h-[90vh] w-auto h-auto object-contain"
              onError={() => setImageMissing(true)}
            />
          </>
        )}
      </div>

      {/* Filename and provenance at the bottom */}
      <div
        className="absolute bottom-4 left-1/2 -translate-x-1/2 qt-text-overlay-muted text-sm qt-bg-overlay-caption px-3 py-1 rounded text-center"
        onClick={(e) => e.stopPropagation()}
      >
        <div>{entry.filename}</div>
        <div className="text-xs opacity-80">
          {provenance}
          {linkCount > 0 && ` · [${linkCount} link${linkCount === 1 ? '' : 's'}]`}
          {entry.messageId && onJumpToMessage && (
            <>
              {' · '}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onJumpToMessage(entry.messageId!)
                }}
                className="qt-link underline"
              >
                Jump to message
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
