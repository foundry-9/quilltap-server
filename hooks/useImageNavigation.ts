'use client'

import { useEffect, useCallback } from 'react'
import { clientLogger } from '@/lib/client-logger'

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
  /** Log context for debugging */
  logContext?: string
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
  logContext = 'useImageNavigation',
}: UseImageNavigationOptions): void {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && handleEscape) {
        clientLogger.debug('Escape pressed, closing', { context: logContext })
        onClose()
      } else if (e.key === 'ArrowLeft' && onPrev) {
        clientLogger.debug('ArrowLeft pressed, navigating to previous', { context: logContext })
        onPrev()
      } else if (e.key === 'ArrowRight' && onNext) {
        clientLogger.debug('ArrowRight pressed, navigating to next', { context: logContext })
        onNext()
      }
    },
    [onClose, onPrev, onNext, handleEscape, logContext]
  )

  useEffect(() => {
    if (isOpen) {
      clientLogger.debug('Registering keyboard navigation', {
        context: logContext,
        hasEscape: handleEscape,
        hasPrev: !!onPrev,
        hasNext: !!onNext,
      })
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
  }, [isOpen, handleKeyDown, preventBodyScroll, logContext, onPrev, onNext, handleEscape])
}
