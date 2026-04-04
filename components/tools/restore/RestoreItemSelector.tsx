'use client'

import { useRef } from 'react'

interface RestoreItemSelectorProps {
  selectedFile: File | null
  error: string | null
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
}

export function RestoreItemSelector({
  selectedFile,
  error,
  onFileSelect,
}: RestoreItemSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm qt-text-primary mb-3">
          Select Backup File
        </label>
        <div
          className="border-2 border-dashed qt-border-default rounded-lg p-6 text-center cursor-pointer hover:border-input transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <svg
            className="w-12 h-12 mx-auto qt-text-secondary mb-2"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
          <p className="qt-text-small">
            Click to select or drag and drop a backup file
          </p>
          <p className="qt-text-xs mt-1">
            Supports .zip backup files
          </p>
          {selectedFile && (
            <p className="text-sm qt-text-success mt-2">
              Selected: {selectedFile.name}
            </p>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,.zip"
            onChange={onFileSelect}
            className="hidden"
          />
        </div>
      </div>

      {error && (
        <div className="p-3 qt-bg-destructive/10 border qt-border-destructive rounded-lg">
          <p className="text-sm qt-text-destructive">{error}</p>
        </div>
      )}
    </div>
  )
}
