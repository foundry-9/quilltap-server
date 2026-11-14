'use client'

import { BaseModal, ModalTitle } from '@/components/ui/BaseModal'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

interface AlertDialogProps {
  message: string
  onClose: (buttonLabel?: string) => void
  buttons?: string[]
  showCopy?: boolean
}

export function AlertDialog({ message, onClose, buttons, showCopy = true }: AlertDialogProps) {
  const { copy } = useCopyToClipboard()
  const handleCopy = () => copy(message)

  // Default to single close button if no buttons provided
  const dialogButtons = buttons && buttons.length > 0 ? buttons : ['Close']

  const getButtonStyle = (index: number, total: number) => {
    // Last button is primary (blue), others are secondary (gray)
    const isLast = index === total - 1
    return isLast ? 'qt-button qt-button-primary' : 'qt-button qt-button-secondary'
  }

  return (
    <BaseModal
      isOpen
      onClose={() => onClose()}
      role="alertdialog"
      headerless
      className="p-6"
      bodyClassName="overflow-y-auto"
      // Raised to the lightbox layer: lib/alert.tsx summons it imperatively,
      // and a confirm asked from inside a lightbox (ImageModal, z-[100]) must
      // paint above it. Among other dialogs it is on top by DOM order anyway.
      overlayClassName="z-[100]"
    >
      <div className="qt-dialog-body !px-0 !py-0 mb-6">
        <ModalTitle className="text-sm font-normal qt-text whitespace-pre-wrap break-words">
          {message}
        </ModalTitle>
      </div>
      <div className="flex gap-3 justify-end">
        {showCopy && (
          <button
            onClick={handleCopy}
            className="qt-copy-button"
          >
            📋 Copy
          </button>
        )}
        {dialogButtons.map((buttonLabel, index) => (
          <button
            key={buttonLabel}
            onClick={() => onClose(buttonLabel)}
            className={getButtonStyle(index, dialogButtons.length)}
          >
            {buttonLabel}
          </button>
        ))}
      </div>
    </BaseModal>
  )
}
