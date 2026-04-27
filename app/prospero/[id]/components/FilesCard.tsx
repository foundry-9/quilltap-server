'use client'

/**
 * Files Card
 *
 * Expandable/scrollable card displaying project files.
 * Files are clickable to open in a new tab.
 * Includes a "Browse All" button to open the full file browser.
 */

import { useState } from 'react'
import FileBrowser from '@/components/files/FileBrowser'
import FileThumbnail from '@/components/files/FileThumbnail'
import { FilePreviewModal } from '@/components/files/FilePreview'
import { useProjectFileUpload } from '@/components/files/useProjectFileUpload'
import { BaseModal } from '@/components/ui/BaseModal'
import type { ProjectFile } from '../types'
import type { FileInfo } from '@/components/files/types'
import { ChevronIcon } from '@/components/ui/ChevronIcon'

interface FilesCardProps {
  files: ProjectFile[]
  expanded: boolean
  onToggle: () => void
  projectId?: string
  onFilesChange?: () => void
}

function ImageIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  )
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  )
}

function FolderIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Convert ProjectFile to FileInfo for the preview modal.
 * Passes through mountPointId/relativePath so the preview and download
 * actions resolve against the mount-point blob endpoint when the file
 * lives in a linked Scriptorium store.
 */
function toFileInfo(file: ProjectFile): FileInfo {
  return {
    id: file.id,
    originalFilename: file.originalFilename,
    mimeType: file.mimeType,
    size: file.size,
    category: file.category,
    createdAt: file.createdAt,
    updatedAt: file.createdAt,
    mountPointId: file.mountPointId,
    relativePath: file.relativePath,
  }
}

export function FilesCard({ files, expanded, onToggle, projectId, onFilesChange }: FilesCardProps) {
  const [showBrowser, setShowBrowser] = useState(false)
  const [selectedFile, setSelectedFile] = useState<FileInfo | null>(null)

  // Upload functionality
  const {
    uploading,
    uploadProgress,
    fileInputRef,
    handleFileSelect,
    triggerFileSelect,
  } = useProjectFileUpload({
    projectId: projectId || '',
    folderPath: '/',
    onSuccess: () => {
      onFilesChange?.()
    },
  })

  const handleFileClick = (file: ProjectFile) => {
    setSelectedFile(toFileInfo(file))
  }

  // Convert all files to FileInfo for the preview modal
  const filesAsFileInfo = files.map(toFileInfo)

  return (
    <>
      <div className="qt-card qt-bg-card qt-border rounded-lg overflow-hidden">
        {/* Header - always visible */}
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between p-4 hover:qt-bg-muted transition-colors"
        >
          <div className="flex items-center gap-3">
            <FolderIcon className="w-5 h-5 qt-text-primary" />
            <div className="text-left">
              <h3 className="qt-heading-4 text-foreground">Files</h3>
              <p className="qt-text-small qt-text-secondary">
                {files.length} file{files.length !== 1 ? 's' : ''}
              </p>
            </div>
          </div>
          <ChevronIcon className="w-5 h-5 qt-text-secondary" expanded={expanded} />
        </button>

        {/* Content - expandable */}
        {expanded && (
          <div className="border-t qt-border-default">
            {files.length === 0 ? (
              <div className="p-4 text-center qt-text-secondary">
                <p>No files in this project yet.</p>
                <p className="qt-text-small mt-1">Files will appear here when added to project chats.</p>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto p-2 space-y-1">
                {files.slice(0, 10).map((file) => (
                  <button
                    key={file.id}
                    onClick={() => handleFileClick(file)}
                    className="w-full flex items-center gap-3 p-2 rounded-lg hover:qt-bg-muted transition-colors text-left"
                  >
                    <FileThumbnail
                      fileId={file.id}
                      mimeType={file.mimeType}
                      alt={file.originalFilename}
                      size={40}
                      className="rounded flex-shrink-0"
                      mountPointId={file.mountPointId}
                      relativePath={file.relativePath}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="qt-label text-foreground truncate">
                        {file.originalFilename}
                      </p>
                      <p className="qt-text-xs qt-text-secondary">
                        {formatBytes(file.size)} &bull; {file.category}
                      </p>
                    </div>
                  </button>
                ))}
                {files.length > 10 && (
                  <p className="qt-text-xs qt-text-secondary text-center py-2">
                    +{files.length - 10} more files
                  </p>
                )}
              </div>
            )}

            {/* Action buttons */}
            {projectId && (
              <div className="p-2 border-t qt-border-default flex gap-2">
                <button
                  onClick={triggerFileSelect}
                  disabled={uploading}
                  className="flex-1 qt-button qt-button-secondary text-sm"
                >
                  {uploading
                    ? `Uploading ${uploadProgress?.current}/${uploadProgress?.total}...`
                    : 'Upload Files'}
                </button>
                <button
                  onClick={() => setShowBrowser(true)}
                  className="flex-1 qt-button qt-button-secondary text-sm"
                >
                  Browse All Files
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* File Browser Modal */}
      {/* closeOnClickOutside=false prevents the modal from closing when
          showConfirmation or FileDeleteConfirmation dialogs appear,
          since those render outside this modal's DOM tree */}
      {projectId && (
        <BaseModal
          isOpen={showBrowser}
          onClose={() => setShowBrowser(false)}
          title="Project Files"
          maxWidth="3xl"
          closeOnClickOutside={false}
          showCloseButton={true}
        >
          <div className="min-h-[400px]">
            <FileBrowser
              projectId={projectId}
              title="Project Files"
              showUpload={true}
              onFilesChange={onFilesChange}
            />
          </div>
        </BaseModal>
      )}

      {/* Hidden file input for uploads */}
      {projectId && (
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelect}
          accept="image/jpeg,image/png,image/gif,image/webp,application/pdf,text/plain,text/markdown,text/csv"
        />
      )}

      {/* File Preview Modal */}
      {selectedFile && (
        <FilePreviewModal
          file={selectedFile}
          files={filesAsFileInfo}
          onClose={() => setSelectedFile(null)}
          onDelete={() => {
            setSelectedFile(null)
            onFilesChange?.()
          }}
          onNavigate={(file) => setSelectedFile(file)}
        />
      )}
    </>
  )
}
