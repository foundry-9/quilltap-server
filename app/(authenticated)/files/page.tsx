'use client'

/**
 * Files Page
 *
 * Browse and manage general (non-project) files.
 * Uses the FileBrowser component for navigation.
 */

import { useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { clientLogger } from '@/lib/client-logger'
import FileBrowser from '@/components/files/FileBrowser'

function FilesPageContent() {
  const searchParams = useSearchParams()
  const selectedFileId = searchParams.get('fileId')

  useEffect(() => {
    clientLogger.debug('FilesPage: mounted', { selectedFileId })
  }, [selectedFileId])

  const handleFileClick = (file: { id: string; filepath?: string }) => {
    if (file.filepath) {
      window.open(file.filepath, '_blank')
    }
    clientLogger.debug('FilesPage: file clicked', { fileId: file.id })
  }

  return (
    <div className="qt-page-container text-foreground">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-6">
        <div>
          <h1 className="text-3xl font-semibold leading-tight">Files</h1>
          <p className="qt-text-small qt-text-secondary mt-1">
            Browse and manage your general files (not in any project)
          </p>
        </div>
      </div>

      <div className="mt-6">
        <FileBrowser
          projectId={null}
          title="General Files"
          onFileClick={handleFileClick}
          className="min-h-[400px]"
        />
      </div>

      <div className="mt-8 p-4 border border-border rounded-lg bg-muted/50">
        <h3 className="font-medium mb-2">About General Files</h3>
        <ul className="qt-text-small text-muted-foreground space-y-1 list-disc list-inside">
          <li>General files are not associated with any project</li>
          <li>The LLM can access these files during conversations using the file management tool</li>
          <li>Files in projects are accessible only within that project&apos;s chats</li>
          <li>You can promote message attachments to general files for persistent storage</li>
        </ul>
      </div>
    </div>
  )
}

export default function FilesPage() {
  return (
    <Suspense fallback={
      <div className="qt-page-container text-foreground">
        <div className="flex min-h-screen items-center justify-center">
          <p className="text-lg text-foreground">Loading files...</p>
        </div>
      </div>
    }>
      <FilesPageContent />
    </Suspense>
  )
}
