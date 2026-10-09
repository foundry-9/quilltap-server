'use client'

/**
 * FullScreenImageViewer — the frame every "look at this picture properly"
 * view shares: a blurred overlay over the whole window, the picture as large
 * as it will go, round buttons top-right, optional previous/next arrows, a
 * caption at the foot, and an optional destructive button bottom-right.
 *
 * The frame knows nothing about where a picture came from. Callers supply the
 * buttons (Save, Download, Copy, …) and the caption; the frame supplies
 * Close, Escape / arrow-key handling, body-scroll lock, and the swap to
 * `DeletedImagePlaceholder` when the bytes fail to load.
 *
 * It renders through a portal to `document.body`: inside the tabbed workspace
 * `.qt-workspace` is an isolated stacking context, and a `fixed inset-0`
 * child of it is trapped under the sticky toolbar (bug 99).
 */

import { useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useImageNavigation } from '@/hooks/useImageNavigation'
import DeletedImagePlaceholder from '@/components/images/DeletedImagePlaceholder'
import { Icon, type IconName } from '@/components/ui/icon'

export interface FullScreenImageAction {
  icon: IconName
  /** Tooltip and accessible name. */
  label: string
  onClick: () => void
  disabled?: boolean
}

interface FullScreenImageViewerProps {
  isOpen: boolean
  onClose: () => void
  src: string
  alt: string
  /** Id handed to the missing-image placeholder's clean-up. */
  imageId: string
  /** Filename shown by the missing-image placeholder. */
  filename: string
  /**
   * How the missing-image placeholder's Remove clears the dangling reference.
   * Defaults to the generic `DELETE /api/v1/images/{imageId}`; a picture owned
   * by a record (a wardrobe item) passes that record's own removal, which
   * knows its links and pointers (bug 194). The viewer closes after it.
   */
  onMissingCleanup?: () => Promise<void>
  /** Buttons before Close, left to right. Hidden while the image is missing. */
  actions?: FullScreenImageAction[]
  onPrev?: () => void
  onNext?: () => void
  /** Bottom-centre caption. */
  caption?: ReactNode
  /** Bottom-right slot — conventionally a destructive action. Hidden while the image is missing. */
  bottomRight?: ReactNode
  /**
   * While false, keys are not handled — set it false while a dialog opened
   * from this viewer is up, so Escape closes that dialog and not the viewer.
   */
  keyboardActive?: boolean
  /** Overlay z-index class. Defaults to `z-[60]`, the dialog layer. */
  zIndexClassName?: string
}

const ROUND_BUTTON =
  'p-2 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors cursor-pointer disabled:opacity-50'
const ARROW_BUTTON =
  'absolute top-1/2 -translate-y-1/2 p-3 qt-bg-overlay-btn hover:qt-bg-overlay-btn rounded-full qt-text-overlay transition-colors z-10 cursor-pointer'

export function FullScreenImageViewer({
  isOpen,
  onClose,
  src,
  alt,
  imageId,
  filename,
  onMissingCleanup,
  actions = [],
  onPrev,
  onNext,
  caption,
  bottomRight,
  keyboardActive = true,
  zIndexClassName = 'z-[60]',
}: Readonly<FullScreenImageViewerProps>) {
  // Keyed by `src`, so walking to the next picture clears a previous miss.
  const [missingSrc, setMissingSrc] = useState<string | null>(null)
  const imageMissing = missingSrc === src

  useImageNavigation({
    isOpen,
    onClose,
    onPrev: keyboardActive ? onPrev : undefined,
    onNext: keyboardActive ? onNext : undefined,
    handleEscape: keyboardActive,
  })

  if (!isOpen || typeof document === 'undefined') return null

  const stop = (fn: () => void) => (e: React.MouseEvent) => {
    e.stopPropagation()
    fn()
  }

  return createPortal(
    <div
      className={`fixed inset-0 ${zIndexClassName} flex items-center justify-center qt-bg-overlay backdrop-blur-sm`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={alt}
    >
      {onPrev && (
        <button onClick={stop(onPrev)} className={`${ARROW_BUTTON} left-4`} title="Previous image (Left Arrow)">
          <Icon name="chevron-left" className="w-8 h-8" />
        </button>
      )}
      {onNext && (
        <button onClick={stop(onNext)} className={`${ARROW_BUTTON} right-4`} title="Next image (Right Arrow)">
          <Icon name="chevron-right" className="w-8 h-8" />
        </button>
      )}

      <div className="absolute top-4 right-4 flex gap-2 z-10">
        {!imageMissing &&
          actions.map((action) => (
            <button
              key={action.label}
              onClick={stop(action.onClick)}
              disabled={action.disabled}
              className={ROUND_BUTTON}
              title={action.label}
              aria-label={action.label}
            >
              <Icon name={action.icon} className="w-6 h-6" />
            </button>
          ))}
        <button onClick={stop(onClose)} className={ROUND_BUTTON} title="Close (Escape)" aria-label="Close">
          <Icon name="close" className="w-6 h-6" />
        </button>
      </div>

      {!imageMissing && bottomRight && <div className="absolute bottom-4 right-4 z-10">{bottomRight}</div>}

      <div
        className="relative max-w-[90vw] max-h-[90vh] flex items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {imageMissing ? (
          <DeletedImagePlaceholder
            imageId={imageId}
            filename={filename}
            onRemove={onMissingCleanup}
            onCleanup={onClose}
            width={600}
            height={400}
          />
        ) : (
          // A plain <img>: authenticated API routes need the session cookie,
          // which Next.js image optimization does not forward.
          <img
            src={src}
            alt={alt}
            className="max-w-full max-h-[90vh] w-auto h-auto object-contain"
            onError={() => setMissingSrc(src)}
          />
        )}
      </div>

      {caption && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2 qt-text-overlay-muted text-sm qt-bg-overlay-caption px-3 py-1 rounded text-center"
          onClick={(e) => e.stopPropagation()}
        >
          {caption}
        </div>
      )}
    </div>,
    document.body,
  )
}

export default FullScreenImageViewer
