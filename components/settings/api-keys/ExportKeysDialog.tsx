'use client'

import { useRef } from 'react'
import { useClickOutside } from '@/hooks/useClickOutside'
import { FormActions } from '@/components/ui/FormActions'
import ErrorAlert from '@/components/ui/ErrorAlert'
import { useExportKeys } from './hooks'

interface ExportKeysDialogProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: () => void
  keyCount: number
}

export function ExportKeysDialog({
  isOpen,
  onClose,
  onSuccess,
  keyCount,
}: ExportKeysDialogProps) {
  const modalRef = useRef<HTMLDivElement>(null)

  const { state, isValid, passphraseError, actions } = useExportKeys({
    isOpen,
    onSuccess,
  })

  useClickOutside(modalRef, onClose, {
    enabled: isOpen && state.step !== 'exporting',
    onEscape: onClose,
  })

  const handleClose = () => {
    actions.reset()
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="qt-dialog-overlay">
      <div ref={modalRef} className="qt-dialog max-w-lg max-h-[80vh] flex flex-col">
        <div className="qt-dialog-header">
          <h2 className="qt-dialog-title">Export API Keys</h2>
        </div>

        <div className="qt-dialog-body flex-1 overflow-y-auto">
          {state.error && (
            <ErrorAlert message={state.error} className="mb-4" />
          )}

          {state.step === 'passphrase' && (
            <div className="space-y-4">
              <p className="qt-text-primary">
                You are about to export {keyCount} API key{keyCount !== 1 ? 's' : ''}.
                Enter a passphrase to encrypt the export file.
              </p>

              <div className="p-3 rounded-lg qt-bg-warning/10 border qt-border-warning">
                <p className="qt-text-small qt-text-warning">
                  <strong>Important:</strong> Keep this passphrase safe. You will need it to
                  import these keys later. If you forget the passphrase, the export file
                  cannot be decrypted.
                </p>
              </div>

              <div>
                <label htmlFor="passphrase" className="block qt-text-label mb-2">
                  Passphrase *
                </label>
                <input
                  type="password"
                  id="passphrase"
                  value={state.passphrase}
                  onChange={(e) => actions.setPassphrase(e.target.value)}
                  placeholder="Enter a strong passphrase (min 8 characters)"
                  className="qt-input"
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="passphraseConfirm" className="block qt-text-label mb-2">
                  Confirm Passphrase *
                </label>
                <input
                  type="password"
                  id="passphraseConfirm"
                  value={state.passphraseConfirm}
                  onChange={(e) => actions.setPassphraseConfirm(e.target.value)}
                  placeholder="Confirm your passphrase"
                  className="qt-input"
                />
                {passphraseError && (
                  <p className="qt-text-xs mt-1 qt-text-error">{passphraseError}</p>
                )}
              </div>
            </div>
          )}

          {state.step === 'exporting' && (
            <div className="flex flex-col items-center justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 qt-border-primary mb-4" />
              <p className="qt-text-primary">Exporting API keys...</p>
            </div>
          )}

          {state.step === 'complete' && (
            <div className="text-center py-8">
              <div className="text-4xl mb-4">✓</div>
              <p className="qt-text-primary font-medium mb-2">
                Export completed successfully!
              </p>
              <p className="qt-text-small">
                Your API keys have been downloaded. Keep the file and passphrase secure.
              </p>
            </div>
          )}

          {state.step === 'error' && (
            <div className="text-center py-8">
              <p className="qt-text-primary mb-4">
                Export failed. Please try again.
              </p>
              <button
                onClick={actions.reset}
                className="qt-button-secondary"
              >
                Try Again
              </button>
            </div>
          )}
        </div>

        <div className="qt-dialog-footer">
          {state.step === 'passphrase' && (
            <FormActions
              onCancel={handleClose}
              onSubmit={actions.handleExport}
              submitLabel="Export Keys"
              isLoading={false}
              isDisabled={!isValid}
            />
          )}

          {(state.step === 'complete' || state.step === 'error') && (
            <button
              onClick={handleClose}
              className="qt-button-primary"
            >
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

export default ExportKeysDialog
