'use client'

/**
 * LibraryFilePickerModal Component
 *
 * Two-step modal for picking a file from anywhere the user has files —
 * General library, their own photo gallery, project files, or any of the
 * database-backed document stores in the system — and linking it to the
 * current chat.
 *
 * Step 1 ("scope"): pick a source.
 * Step 2 ("browse-project" | "browse-gallery" | "browse-mount"): browse the
 *   selected source. The Gallery view is a custom thumbnail grid backed by
 *   `/api/v1/photos`; everything else delegates to `FileBrowser`.
 */

import { useState, useEffect, useCallback } from 'react'
import useSWR from 'swr'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { BaseModal } from '@/components/ui/BaseModal'
import FileBrowser, { type FileInfo, type FileBrowserMountPoint } from '@/components/files/FileBrowser'

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
   * Called when a Scriptorium document-store file (including a gallery photo
   * or a generic mount-store file) has been pinned to the chat via a
   * Librarian announcement. There is no composer-tray hand-off — the
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

interface MountPointSummary {
  id: string
  name: string
  mountType: 'filesystem' | 'obsidian' | 'database'
  storeType: 'documents' | 'character'
  enabled: boolean
}

interface MountPointsResponse {
  mountPoints: MountPointSummary[]
}

interface GalleryEntry {
  linkId: string
  mountPointId: string
  relativePath: string
  fileName: string
  blobUrl: string
  mimeType: string
  caption: string | null
  keptAt: string
  generationPromptExcerpt: string
}

interface GalleryResponse {
  entries: GalleryEntry[]
  total: number
  hasMore: boolean
}

type Step = 'scope' | 'browse-project' | 'browse-gallery' | 'browse-mount'

export default function LibraryFilePickerModal({
  isOpen,
  onClose,
  chatId,
  onFileLinked,
  onMountFileAttached,
}: Readonly<LibraryFilePickerModalProps>) {
  const [step, setStep] = useState<Step>('scope')
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [selectedScopeName, setSelectedScopeName] = useState<string>('General')
  const [selectedMount, setSelectedMount] = useState<FileBrowserMountPoint | null>(null)
  const [linking, setLinking] = useState(false)

  const { data: projectsData, isLoading: projectsLoading } = useSWR<{ projects: Project[] }>(
    isOpen ? '/api/v1/projects' : null
  )
  const projects = projectsData?.projects || []

  const { data: mountsData, isLoading: mountsLoading } = useSWR<MountPointsResponse>(
    isOpen ? '/api/v1/mount-points' : null
  )
  // Show database-backed stores that aren't private character vaults — those
  // are managed via the character optimizer / Aurora tab and are conceptually
  // off-limits for the human composer.
  const docStores = (mountsData?.mountPoints || []).filter(
    mp => mp.enabled && mp.mountType === 'database' && mp.storeType !== 'character'
  )

  // Reset state when modal closes (modal-reset pattern)
  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset fires only on open; parent renders unconditionally
      setStep('scope')
      setSelectedProjectId(null)
      setSelectedScopeName('General')
      setSelectedMount(null)
      setLinking(false)
    }
  }, [isOpen])

  const attachMountFile = useCallback(
    async (mountPointId: string, relativePath: string, displayName: string) => {
      const res = await fetch(
        `/api/v1/chats/${chatId}/files?action=attach-mount-file`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mountPointId, relativePath }),
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
      showSuccessToast(`Attached "${displayName}" — the Librarian has noted it`)
      if (onMountFileAttached) {
        onMountFileAttached()
      }
      onClose()
    },
    [chatId, onClose, onMountFileAttached]
  )

  const handleProjectScopeSelect = useCallback(
    (projectId: string | null, name: string) => {
      setSelectedProjectId(projectId)
      setSelectedScopeName(name)
      setSelectedMount(null)
      setStep('browse-project')
    },
    []
  )

  const handleGalleryScopeSelect = useCallback(() => {
    setSelectedScopeName('My Gallery')
    setStep('browse-gallery')
  }, [])

  const handleMountScopeSelect = useCallback((mount: MountPointSummary) => {
    setSelectedMount({
      id: mount.id,
      mountType: mount.mountType,
      storeType: mount.storeType,
      name: mount.name,
    })
    setSelectedScopeName(mount.name)
    setStep('browse-mount')
  }, [])

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
          await attachMountFile(file.mountPointId!, file.relativePath!, filename)
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
    [chatId, linking, onFileLinked, onClose, attachMountFile]
  )

  const handleGalleryPick = useCallback(
    async (entry: GalleryEntry) => {
      if (linking) return
      const displayName = entry.caption || entry.fileName
      try {
        setLinking(true)
        await attachMountFile(entry.mountPointId, entry.relativePath, displayName)
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        console.error('[LibraryFilePickerModal] Failed to attach gallery photo', {
          chatId,
          linkId: entry.linkId,
          error: errorMessage,
        })
        showErrorToast(errorMessage || 'Failed to attach photo')
      } finally {
        setLinking(false)
      }
    },
    [chatId, linking, attachMountFile]
  )

  const handleBack = useCallback(() => {
    setStep('scope')
    setSelectedMount(null)
  }, [])

  const title =
    step === 'scope'
      ? 'Choose File Source'
      : `Browse Files — ${selectedScopeName}`

  const footer =
    step !== 'scope' ? (
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
        <ScopePicker
          projects={projects}
          docStores={docStores}
          projectsLoading={projectsLoading}
          mountsLoading={mountsLoading}
          onPickGeneral={() => handleProjectScopeSelect(null, 'General')}
          onPickGallery={handleGalleryScopeSelect}
          onPickProject={handleProjectScopeSelect}
          onPickMount={handleMountScopeSelect}
        />
      )}

      {step === 'browse-project' && (
        <div className="min-h-[50vh] relative">
          {linking && <LinkingOverlay />}
          <FileBrowser
            projectId={selectedProjectId}
            onFileClick={handleFileClick}
            showUpload={false}
          />
        </div>
      )}

      {step === 'browse-mount' && selectedMount && (
        <div className="min-h-[50vh] relative">
          {linking && <LinkingOverlay />}
          <FileBrowser
            projectId={null}
            mountPoint={selectedMount}
            onFileClick={handleFileClick}
            showUpload={false}
          />
        </div>
      )}

      {step === 'browse-gallery' && (
        <GalleryPanel onPick={handleGalleryPick} linking={linking} />
      )}
    </BaseModal>
  )
}

function ScopePicker({
  projects,
  docStores,
  projectsLoading,
  mountsLoading,
  onPickGeneral,
  onPickGallery,
  onPickProject,
  onPickMount,
}: {
  projects: Project[]
  docStores: MountPointSummary[]
  projectsLoading: boolean
  mountsLoading: boolean
  onPickGeneral: () => void
  onPickGallery: () => void
  onPickProject: (id: string, name: string) => void
  onPickMount: (mount: MountPointSummary) => void
}) {
  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <ScopeCard icon="📁" title="General" subtitle="Files not assigned to any project" onClick={onPickGeneral} />
        <ScopeCard icon="🖼️" title="My Gallery" subtitle="Photos you've saved from chats" onClick={onPickGallery} />
      </section>

      {projects.length > 0 && (
        <section className="space-y-2">
          <h3 className="qt-text-label">Projects</h3>
          {projects.map((project) => (
            <ScopeCard
              key={project.id}
              icon={project.icon || '📂'}
              title={project.name}
              onClick={() => onPickProject(project.id, project.name)}
            />
          ))}
        </section>
      )}

      {projectsLoading && (
        <p className="qt-text-secondary py-2 text-center text-sm">Loading projects…</p>
      )}

      {docStores.length > 0 && (
        <section className="space-y-2">
          <h3 className="qt-text-label">Document Stores</h3>
          {docStores.map((mount) => (
            <ScopeCard
              key={mount.id}
              icon="📚"
              title={mount.name}
              subtitle="Database-backed store"
              onClick={() => onPickMount(mount)}
            />
          ))}
        </section>
      )}

      {mountsLoading && (
        <p className="qt-text-secondary py-2 text-center text-sm">Loading document stores…</p>
      )}
    </div>
  )
}

function ScopeCard({
  icon,
  title,
  subtitle,
  onClick,
}: {
  icon: string
  title: string
  subtitle?: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="qt-card w-full text-left p-4 hover:bg-accent/50 transition-colors cursor-pointer flex items-center gap-3"
    >
      <span className="text-xl">{icon}</span>
      <div>
        <div className="font-medium text-foreground">{title}</div>
        {subtitle && <div className="qt-text-muted text-sm">{subtitle}</div>}
      </div>
    </button>
  )
}

function GalleryPanel({
  onPick,
  linking,
}: {
  onPick: (entry: GalleryEntry) => void
  linking: boolean
}) {
  const { data, isLoading, error } = useSWR<GalleryResponse>('/api/v1/photos?limit=200')
  const entries = data?.entries ?? []

  if (isLoading) {
    return <p className="qt-text-secondary py-8 text-center">Loading your gallery…</p>
  }
  if (error) {
    return <p className="qt-text-error py-8 text-center">Couldn&rsquo;t load gallery: {String(error)}</p>
  }
  if (entries.length === 0) {
    return (
      <p className="qt-text-muted py-8 text-center text-sm">
        Your gallery is empty. Save an image from any chat via &ldquo;Save to my gallery&rdquo; and it&rsquo;ll appear here.
      </p>
    )
  }

  return (
    <div className="relative min-h-[50vh]">
      {linking && <LinkingOverlay />}
      <ul className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
        {entries.map((entry) => (
          <li key={entry.linkId}>
            <button
              type="button"
              onClick={() => onPick(entry)}
              disabled={linking}
              className="qt-card w-full text-left p-2 hover:bg-accent/50 transition-colors cursor-pointer disabled:opacity-50"
              title={entry.caption || entry.fileName}
            >
              <img
                src={entry.blobUrl}
                alt={entry.caption || entry.fileName}
                loading="lazy"
                className="w-full h-32 object-cover rounded"
              />
              <p className="qt-text-xs qt-text-muted mt-2 truncate">
                {entry.caption || entry.generationPromptExcerpt || entry.fileName}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function LinkingOverlay() {
  return (
    <div className="absolute inset-0 bg-background/50 z-10 flex items-center justify-center">
      <p className="qt-text-secondary">Attaching…</p>
    </div>
  )
}
