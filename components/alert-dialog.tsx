'use client'

import { useEscapeKey } from '@/hooks/useEscapeKey'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

interface AlertDialogProps {
  message: string
  onClose: (buttonLabel?: string) => void
  buttons?: string[]
  showCopy?: boolean
}

export function AlertDialog({ message, onClose, buttons, showCopy = true }: AlertDialogProps) {
  useEscapeKey(() => onClose())

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
    <>
      <button
        className="qt-dialog-overlay cursor-default border-none z-[100]"
        onClick={() => onClose()}
        aria-label="Close dialog"
        type="button"
      />
      <div className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 z-[101] pointer-events-auto">
        <div className="qt-dialog p-6">
        <div className="qt-dialog-body !px-0 !py-0 mb-6">
          <p className="text-sm text-foreground whitespace-pre-wrap break-words">
            {message}
          </p>
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
        </div>
      </div>
    </>
  )
}
