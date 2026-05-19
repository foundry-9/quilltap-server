'use client'

import { RefObject } from 'react'
import { formatBytes } from '@/lib/utils/format-bytes'

interface ImportFileStepProps {
  selectedFile: File | null
  dragActive: boolean
  fileInputRef: RefObject<HTMLInputElement | null>
  onDragEnter: (e: React.DragEvent<HTMLDivElement>) => void
  onDragLeave: (e: React.DragEvent<HTMLDivElement>) => void
  onDragOver: (e: React.DragEvent<HTMLDivElement>) => void
  onDrop: (e: React.DragEvent<HTMLDivElement>) => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
}

/**
 * Step 1: Select a file to import via drag-drop or file picker
 */
export function ImportFileStep({
  selectedFile,
  dragActive,
  fileInputRef,
  onDragEnter,
  onDragLeave,
  onDragOver,
  onDrop,
  onFileSelect,
}: ImportFileStepProps) {
  return (
    <div className="space-y-4">
      <p className="qt-text-small qt-text-secondary">
        Select a Quilltap export file (.qtap) to import.
      </p>

      <div
        className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
          dragActive
            ? 'qt-border-primary qt-bg-primary/10'
            : 'qt-border-default hover:qt-border-primary/50'
        }`}
        onClick={() => fileInputRef.current?.click()}
        onDragEnter={onDragEnter}
        onDragLeave={onDragLeave}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".qtap,.json"
          onChange={onFileSelect}
          className="hidden"
        />
        <svg
          className="w-12 h-12 mx-auto mb-3 qt-text-secondary"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M12 16v-4m0-4v4m0 0l3.09-3.09m-6.18 0L12 12m0 0l-3.09-3.09m6.18 0L12 12"
          />
        </svg>
        <p className="text-foreground font-medium">
          Drag and drop a .qtap file here
        </p>
        <p className="qt-text-secondary text-sm mt-1">
          or click to browse
        </p>
      </div>

      {selectedFile && (
        <div className="p-4 qt-bg-muted/50 rounded-lg">
          <p className="font-medium text-foreground truncate">
            {selectedFile.name}
          </p>
          <p className="qt-text-small qt-text-secondary mt-1">
            {formatBytes(selectedFile.size)}
          </p>
        </div>
      )}
    </div>
  )
}
