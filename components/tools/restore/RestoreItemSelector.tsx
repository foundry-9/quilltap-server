'use client'

import { useRef, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { activateOnKey } from '@/components/ui/activate-on-key'

interface RestoreItemSelectorProps {
  selectedFile: File | null
  error: string | null
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  /** A file dropped on the zone (#334). */
  onFileDrop: (file: File | null) => void
}

export function RestoreItemSelector({
  selectedFile,
  error,
  onFileSelect,
  onFileDrop,
}: RestoreItemSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [dragActive, setDragActive] = useState(false)

  const handleDrag = (e: React.DragEvent<HTMLDivElement>) => {
    // Without preventDefault the browser opens or downloads the dropped file.
    e.preventDefault()
    e.stopPropagation()
    setDragActive(e.type === 'dragenter' || e.type === 'dragover')
  }

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    const file = e.dataTransfer.files?.[0]
    if (file) onFileDrop(file)
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="qt-label mb-3">
          Select Backup File
        </label>
        <div
          className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:qt-border-input transition-colors ${
            dragActive ? 'qt-border-primary qt-bg-primary/10' : 'qt-border-default'
          }`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={activateOnKey}
          role="button"
          tabIndex={0}
          aria-label={selectedFile ? `Backup file chosen: ${selectedFile.name}. Press to choose another` : 'Choose a backup file: drop one here or press to browse'}
        >
          <Icon name="plus" className="w-12 h-12 mx-auto qt-text-secondary mb-2" />
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
            accept=".zip,application/zip"
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
