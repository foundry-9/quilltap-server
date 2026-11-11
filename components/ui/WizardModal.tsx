'use client'

import { ReactNode } from 'react'
import { BaseModal, type ModalSize } from '@/components/ui/BaseModal'

/** The primary (forward) action of a wizard step. */
export interface WizardPrimaryAction {
  label: ReactNode
  onClick: () => void
  disabled?: boolean
}

export interface WizardModalProps {
  /** Defaults to true — the tools wizards are mounted only while open */
  isOpen?: boolean
  onClose: () => void
  title: ReactNode
  /** A description under the title; ignored when `step` is given */
  description?: ReactNode
  /** Draws "Step N of M" under the title */
  step?: { current: number; total: number }
  /**
   * Work in flight: Escape, the backdrop and the header close button do
   * nothing, and Back and Cancel are disabled.
   */
  busy?: boolean
  maxWidth?: ModalSize
  children: ReactNode
  /**
   * The wizard has finished: the footer becomes a single full-width Close
   * button calling `onDone` (default `onClose`).
   */
  done?: boolean
  onDone?: () => void
  /** Shows a Back button at the left of the footer */
  onBack?: () => void
  backDisabled?: boolean
  /** The forward action; omit (or null) to show none on this step */
  primary?: WizardPrimaryAction | null
  /** Hide Cancel (and the forward action) — e.g. while the work runs */
  hideActions?: boolean
  cancelLabel?: ReactNode
  /** Replaces the whole standard footer */
  footer?: ReactNode
  /** Classes for the body wrapper, as BaseModal's `bodyClassName` */
  bodyClassName?: string
}

/**
 * The tools dialogs' shell (export, import, backup, restore, the Almanack,
 * delete data): a `BaseModal` with a step line under the title, a busy guard,
 * and a Back / Cancel / forward footer that turns into one Close button when
 * the wizard is done.
 */
export function WizardModal({
  isOpen = true,
  onClose,
  title,
  description,
  step,
  busy = false,
  maxWidth = '2xl',
  children,
  done = false,
  onDone,
  onBack,
  backDisabled = false,
  primary,
  hideActions = false,
  cancelLabel = 'Cancel',
  footer,
  bodyClassName,
}: WizardModalProps) {
  const subtitle = step ? `Step ${step.current} of ${step.total}` : description

  const standardFooter = done ? (
    <button type="button" onClick={onDone ?? onClose} className="flex-1 qt-button qt-button-primary">
      Close
    </button>
  ) : (
    <>
      {onBack && (
        <button type="button" onClick={onBack} disabled={backDisabled || busy} className="qt-button qt-button-secondary">
          Back
        </button>
      )}
      {!hideActions && (
        <>
          <button type="button" onClick={onClose} disabled={busy} className="qt-button qt-button-secondary">
            {cancelLabel}
          </button>
          {primary && (
            <button type="button" onClick={primary.onClick} disabled={primary.disabled} className="qt-button qt-button-primary">
              {primary.label}
            </button>
          )}
        </>
      )}
    </>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      busy={busy}
      showCloseButton
      maxWidth={maxWidth}
      className="w-[90vw]"
      bodyClassName={bodyClassName}
      footer={footer ?? standardFooter}
      footerClassName={`qt-dialog-footer flex gap-3 flex-shrink-0 ${onBack || done ? 'justify-between' : ''}`}
    >
      {children}
    </BaseModal>
  )
}

export default WizardModal
