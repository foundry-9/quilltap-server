'use client'

import { useRef } from 'react'
import type { BackupInfo } from '@/lib/backup/types'

interface RestoreItemSelectorProps {
  selectedFile: File | null
  selectedS3Key: string | null
  s3Backups: BackupInfo[]
  loadingBackups: boolean
  error: string | null
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  onS3Select: (key: string) => void
}

export function RestoreItemSelector({
  selectedFile,
  selectedS3Key,
  s3Backups,
  loadingBackups,
  error,
  onFileSelect,
  onS3Select,
}: RestoreItemSelectorProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm qt-text-primary mb-3">
          Upload Local Backup
        </label>
        <div
          className="border-2 border-dashed border-border rounded-lg p-6 text-center cursor-pointer hover:border-input transition-colors"
          onClick={() => fileInputRef.current?.click()}
        >
          <svg
            className="w-12 h-12 mx-auto text-muted-foreground mb-2"
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
          {selectedFile && (
            <p className="text-sm text-green-600 mt-2">
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

      {/* S3 Backups */}
      <div>
        <label className="block text-sm qt-text-primary mb-3">
          Or Select from Cloud Storage
        </label>
        {loadingBackups ? (
          <div className="text-center py-6 text-muted-foreground">
            Loading backups...
          </div>
        ) : s3Backups.length > 0 ? (
          <div className="space-y-2">
            {s3Backups.map((backup) => (
              <label
                key={backup.key}
                className={`flex items-center p-3 border rounded-lg cursor-pointer transition-colors ${
                  selectedS3Key === backup.key
                    ? 'border-primary bg-accent'
                    : 'border-border bg-background hover:border-input'
                }`}
              >
                <input
                  type="radio"
                  name="s3Backup"
                  checked={selectedS3Key === backup.key}
                  onChange={() => onS3Select(backup.key)}
                  className="w-4 h-4"
                />
                <div className="ml-3 flex-1">
                  <p className="text-sm qt-text-primary">{backup.filename}</p>
                  <p className="qt-text-xs mt-0.5">
                    {new Date(backup.createdAt).toLocaleString()} (
                    {Math.round(backup.size / 1024 / 1024)} MB)
                  </p>
                </div>
              </label>
            ))}
          </div>
        ) : (
          <div className="text-center py-6 text-muted-foreground">
            No backups found in cloud storage
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 bg-destructive/10 border border-destructive rounded-lg">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </div>
  )
}
