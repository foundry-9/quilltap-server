'use client'

import type { ImportKeyPreview } from './types'

interface ImportKeysPreviewProps {
  keys: ImportKeyPreview[]
  signatureValid: boolean
}

export function ImportKeysPreview({ keys, signatureValid }: ImportKeysPreviewProps) {
  const duplicateCount = keys.filter((k) => k.isDuplicate).length

  return (
    <div className="space-y-4">
      {!signatureValid && (
        <div className="p-3 rounded-lg qt-bg-warning/10 border qt-border-warning">
          <p className="qt-text-small qt-text-warning">
            <strong>Warning:</strong> The signature on this export file could not be verified.
            This may mean:
          </p>
          <ul className="list-disc list-inside qt-text-small qt-text-warning mt-2">
            <li>The file was exported by a different user</li>
            <li>The file was modified after export</li>
            <li>The file was exported from a different Quilltap instance</li>
          </ul>
          <p className="qt-text-small qt-text-warning mt-2">
            You can still import these keys, but verify they are correct before using them.
          </p>
        </div>
      )}

      {duplicateCount > 0 && (
        <div className="p-3 rounded-lg qt-bg-info/10 border qt-border-info">
          <p className="qt-text-small qt-text-info">
            <strong>Note:</strong> {duplicateCount} key{duplicateCount !== 1 ? 's' : ''} already
            exist{duplicateCount === 1 ? 's' : ''} with the same provider and label.
            You can choose how to handle duplicates in the next step.
          </p>
        </div>
      )}

      <div className="space-y-2">
        <p className="qt-text-label">Keys to import ({keys.length}):</p>
        <div className="max-h-60 overflow-y-auto space-y-2">
          {keys.map((key, index) => (
            <div
              key={index}
              className={`p-3 rounded-lg border ${
                key.isDuplicate
                  ? 'qt-bg-warning/5 qt-border-warning'
                  : 'qt-bg-surface qt-border-default'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium qt-text-primary truncate">
                      {key.label}
                    </span>
                    {key.isDuplicate && (
                      <span className="text-xs px-2 py-0.5 rounded qt-bg-warning/20 qt-text-warning">
                        Duplicate
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs px-2 py-0.5 rounded qt-bg-surface-alt qt-text-secondary">
                      {key.provider}
                    </span>
                    <span className="qt-text-xs font-mono">{key.keyPreview}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default ImportKeysPreview
