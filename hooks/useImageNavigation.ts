'use client'

import { useEffect, useCallback } from 'react'

interface UseImageNavigationOptions {
  /** Whether the modal/viewer is currently open */
  isOpen: boolean
  /** Callback to close the modal */
  onClose: () => void
  /** Callback for previous image (optional - if provided, ArrowLeft triggers it) */
  onPrev?: () => void
  /** Callback for next image (optional - if provided, ArrowRight triggers it) */
  onNext?: () => void
  /**
   * Whether to handle Escape key. Default: true.
   * Set to false if you want to conditionally handle Escape (e.g., in nested modals).
   */
  handleEscape?: boolean
  /**
   * Whether to prevent body scroll when open. Default: true.
   */
  preventBodyScroll?: boolean
}

/**
 * Hook for keyboard navigation in image modals/viewers.
 *
 * Handles:
 * - Escape key to close
 * - ArrowLeft for previous image
 * - ArrowRight for next image
 * - Prevents body scroll when open
 *
 * @example
 * ```tsx
 * function ImageModal({ isOpen, onClose, onPrev, onNext }) {
 *   useImageNavigation({ isOpen, onClose, onPrev, onNext })
 *
 *   if (!isOpen) return null
 *   return <div>...</div>
 * }
 * ```
 */
export function useImageNavigation({
  isOpen,
  onClose,
  onPrev,
  onNext,
  handleEscape = true,
  preventBodyScroll = true,
}: UseImageNavigationOptions): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && handleEscape) {
        onClose()
      } else if (e.key === 'ArrowLeft' && onPrev) {
        onPrev()
      } else if (e.key === 'ArrowRight' && onNext) {
        onNext()
      }
    },
    [onClose, onPrev, onNext, handleEscape]
  )

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown)

      if (preventBodyScroll) {
        document.body.style.overflow = 'hidden'
      }
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      if (preventBodyScroll) {
        document.body.style.overflow = ''
      }
    }
  }, [isOpen, handleKeyDown, preventBodyScroll])
}
