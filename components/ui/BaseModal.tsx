'use client'

import { useRef, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useClickOutside } from '@/hooks/useClickOutside'

/**
 * Size variants for the modal
 */
export type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl' | 'full'

/**
 * Props for the BaseModal component
 */
export interface BaseModalProps {
  /** Whether the modal is currently open */
  isOpen: boolean
  /** Callback when the modal should close */
  onClose: () => void
  /** The modal title displayed in the header */
  title: string
  /** The main content of the modal */
  children: ReactNode
  /** Optional footer content (typically FormActions) */
  footer?: ReactNode
  /** Maximum width of the modal - defaults to 'lg' */
  maxWidth?: ModalSize
  /** Additional classes to apply to the modal container */
  className?: string
  /** Whether to show the close button in the header - defaults to false */
  showCloseButton?: boolean
  /** Whether clicking outside should close the modal - defaults to true */
  closeOnClickOutside?: boolean
  /** Whether pressing Escape should close the modal - defaults to true */
  closeOnEscape?: boolean
}

const maxWidthClasses: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
  full: 'max-w-full',
}

/**
 * A reusable modal component that provides consistent dialog styling and behavior.
 *
 * This component consolidates the common modal pattern used across the application:
 * - Click outside to close
 * - Escape key to close
 * - Consistent header/body/footer structure
 * - Scrollable body with fixed header/footer
 *
 * @example
 * <BaseModal
 *   isOpen={isOpen}
 *   onClose={handleClose}
 *   title="Edit Profile"
 *   footer={
 *     <FormActions
 *       onCancel={handleClose}
 *       onSubmit={handleSubmit}
 *       isLoading={loading}
 *     />
 *   }
 * >
 *   <div className="space-y-4">
 *     <input type="text" ... />
 *   </div>
 * </BaseModal>
 */
export function BaseModal({
  isOpen,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'lg',
  className = '',
  showCloseButton = false,
  closeOnClickOutside = true,
  closeOnEscape = true,
}: BaseModalProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  useClickOutside(modalRef, onClose, {
    enabled: isOpen && closeOnClickOutside,
    onEscape: closeOnEscape ? onClose : undefined,
  })

  if (!isOpen || typeof document === 'undefined') return null

  // Use portal to render at document body level, avoiding stacking context issues
  // (e.g., qt-page-container > * { z-index: 1 } trapping modals inside grid cells)
  return createPortal(
    <div className="qt-dialog-overlay">
      <div
        ref={modalRef}
        className={`qt-dialog ${maxWidthClasses[maxWidth]} max-h-[90vh] flex flex-col ${className}`}
      >
        <div className="qt-dialog-header">
          <h2 className="qt-dialog-title">{title}</h2>
          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              className="absolute top-4 right-4 qt-text-secondary hover:text-foreground transition-colors"
              aria-label="Close"
            >
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M6 18L18 6M6 6l12 12"
                />
              </svg>
            </button>
          )}
        </div>

        <div className="qt-dialog-body flex-1 overflow-y-auto">{children}</div>

        {footer && <div className="qt-dialog-footer">{footer}</div>}
      </div>
    </div>,
    document.body
  )
}

export default BaseModal
