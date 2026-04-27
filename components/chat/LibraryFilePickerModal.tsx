'use client'

/**
 * LibraryFilePickerModal Component
 *
 * Two-step modal for picking a file from the library (general or project files)
 * and linking it to the current chat.
 *
 * Step 1: Select scope (General files or a specific project)
 * Step 2: Browse files within the selected scope using FileBrowser
 */

import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import FileBrowser, { type FileInfo } from '@/components/files/FileBrowser'

interface LibraryFilePickerModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  /**
   * Called when a legacy library file (not a Scriptorium document-store file)
   * has been linked to the chat. The parent typically pushes the result into
   * the composer's pending-attachments tray so the user's next message picks
   * it up.
   */
  onFileLinked: (file: {
    id: string
    filename: string
    filepath: string
    mimeType: string
    url: string
  }) => void
  /**
   * Called when a Scriptorium document-store file has been pinned to the chat
   * via a Librarian announcement. There is no composer-tray hand-off — the
   * announcement is already in the transcript — so the parent should refetch
   * the chat to reveal it.
   */
  onMountFileAttached?: () => void
}

interface Project {
  id: string
  name: string
  icon?: string
  color?: string
}

export default function LibraryFilePickerModal({
  isOpen,
  onClose,
  chatId,
  onFileLinked,
  onMountFileAttached,
}: Readonly<LibraryFilePickerModalProps>) {
  const [step, setStep] = useState<'scope' | 'browse'>('scope')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedProjectName, setSelectedProjectName] = useState<string>('General')
  const [linking, setLinking] = useState(false)

  const { data: projectsData, isLoading } = useSWR<{ projects: Project[] }>(
    isOpen ? '/api/v1/projects' : null
  )
  const projects = projectsData?.projects || []

  // Reset state when modal closes (modal-reset pattern)
  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset fires only on open; parent renders unconditionally
      setStep('scope')
      setSelectedProjectId(null)
      setSelectedProjectName('General')
      setLinking(false)
    }
  }, [isOpen])

  const handleScopeSelect = useCallback(
    (projectId: string | null, name: string) => {
      setSelectedProjectId(projectId)
      setSelectedProjectName(name)
      setStep('browse')
    },
    []
  )

  const handleFileClick = useCallback(
    async (file: FileInfo) => {
      if (linking) return

      // Scriptorium document-store files don't live in the legacy `files`
      // table, so the link endpoint can't take their id. Post a Librarian
      // attachment announcement instead — the synthetic message carries the
      // mount-file id as a message-level attachment, and the assistant-side
      // attachment walker surfaces it to the next character turn.
      const isMountFile = !!file.mountPointId && !!file.relativePath
      const filename = file.originalFilename || file.filename || 'file'

      try {
        setLinking(true)

        if (isMountFile) {
          const res = await fetch(
            `/api/v1/chats/${chatId}/files?action=attach-mount-file`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                mountPointId: file.mountPointId,
                relativePath: file.relativePath,
              }),
            }
          )

          if (!res.ok) {
            let errorMessage = 'Failed to attach document'
            try {
              const errorData = await res.json()
              errorMessage = errorData.error || errorMessage
            } catch {
              errorMessage = `HTTP ${res.status}: ${res.statusText}`
            }
            throw new Error(errorMessage)
          }

          showSuccessToast(`Attached "${filename}" — the Librarian has noted it`)
          if (onMountFileAttached) {
            onMountFileAttached()
          }
          onClose()
          return
        }

        const res = await fetch(
          `/api/v1/chats/${chatId}/files?action=link`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId: file.id }),
          }
        )

        if (!res.ok) {
          let errorMessage = 'Failed to link file'
          try {
            const errorData = await res.json()
            errorMessage = errorData.error || errorMessage
          } catch {
            errorMessage = `HTTP ${res.status}: ${res.statusText}`
          }
          throw new Error(errorMessage)
        }

        const data = await res.json()
        const linkedFile = data.file

        showSuccessToast(`Linked "${filename}" to chat`)
        onFileLinked({
          id: linkedFile.id,
          filename: linkedFile.filename,
          filepath: linkedFile.filepath,
          mimeType: linkedFile.mimeType,
          url: linkedFile.url,
        })
        onClose()
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        console.error('[LibraryFilePickerModal] Failed to attach file', {
          chatId,
          fileId: file.id,
          mountPointId: file.mountPointId ?? null,
          relativePath: file.relativePath ?? null,
          isMountFile,
          error: errorMessage,
        })
        showErrorToast(errorMessage || 'Failed to attach file')
      } finally {
        setLinking(false)
      }
    },
    [chatId, linking, onFileLinked, onMountFileAttached, onClose]
  )

  const handleBack = useCallback(() => {
    setStep('scope')
  }, [])

  const title =
    step === 'scope'
      ? 'Choose File Source'
      : `Browse Files — ${selectedProjectName}`

  const footer =
    step === 'browse' ? (
      <div className="flex justify-between">
        <button
          onClick={handleBack}
          disabled={linking}
          className="qt-button qt-button-secondary"
        >
          Back
        </button>
        <button
          onClick={onClose}
          disabled={linking}
          className="qt-button qt-button-secondary"
        >
          Cancel
        </button>
      </div>
    ) : (
      <div className="flex justify-end">
        <button onClick={onClose} className="qt-button qt-button-secondary">
          Cancel
        </button>
      </div>
    )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={title}
      footer={footer}
      maxWidth="4xl"
      closeOnClickOutside={!linking}
      closeOnEscape={!linking}
    >
      {step === 'scope' && (
        <div className="space-y-2">
          {isLoading ? (
            <p className="qt-text-secondary py-4 text-center">
              Loading projects...
            </p>
          ) : (
            <>
              <button
                onClick={() => handleScopeSelect(null, 'General')}
                className="qt-card w-full text-left p-4 hover:bg-accent/50 transition-colors cursor-pointer flex items-center gap-3"
              >
                <span className="text-xl">📁</span>
                <div>
                  <div className="font-medium text-foreground">General</div>
                  <div className="qt-text-muted text-sm">
                    Files not assigned to any project
                  </div>
                </div>
              </button>

              {projects.map((project) => (
                <button
                  key={project.id}
                  onClick={() => handleScopeSelect(project.id, project.name)}
                  className="qt-card w-full text-left p-4 hover:bg-accent/50 transition-colors cursor-pointer flex items-center gap-3"
                >
                  <span className="text-xl">
                    {project.icon || '📂'}
                  </span>
                  <div>
                    <div className="font-medium text-foreground">
                      {project.name}
                    </div>
                  </div>
                </button>
              ))}

              {projects.length === 0 && (
                <p className="qt-text-muted text-sm text-center py-2">
                  No projects found. Only general files are available.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {step === 'browse' && (
        <div className="min-h-[50vh]">
          {linking && (
            <div className="absolute inset-0 bg-background/50 z-10 flex items-center justify-center">
              <p className="qt-text-secondary">Linking file...</p>
            </div>
          )}
          <FileBrowser
            projectId={selectedProjectId}
            onFileClick={handleFileClick}
            showUpload={false}
          />
        </div>
      )}
    </BaseModal>
  )
}
