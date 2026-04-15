'use client'

/**
 * DocumentPickerModal - Source selection and file browser for Document Mode
 *
 * Two-step modal:
 * Step 1: Select source (new blank document, project library, mounted stores)
 * Step 2: Browse files within the selected scope
 *
 * Scriptorium Phase 3.5
 *
 * @module app/salon/[id]/components/DocumentPickerModal
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { BaseModal } from '@/components/ui/BaseModal'
import FileBrowser, { type FileInfo } from '@/components/files/FileBrowser'

interface DocumentPickerModalProps {
  isOpen: boolean
  onClose: () => void
  chatId: string
  projectId?: string | null
  projectName?: string | null
  onSelectDocument: (params: {
    filePath?: string
    title?: string
    scope?: 'project' | 'document_store' | 'general'
    mountPoint?: string
  }) => void
}

interface MountPoint {
  id: string
  name: string
  type: string
}

interface MountPointFile {
  id: string
  relativePath: string
  size?: number
  mimeType?: string
  updatedAt?: string
}

interface RecentDocument {
  id: string
  filePath: string
  scope: 'project' | 'document_store' | 'general'
  mountPoint?: string | null
  displayTitle?: string | null
  isActive?: boolean
  updatedAt: string
}

export default function DocumentPickerModal({
  isOpen,
  onClose,
  chatId,
  projectId,
  projectName,
  onSelectDocument,
}: Readonly<DocumentPickerModalProps>) {
  const [step, setStep] = useState<'source' | 'browse'>('source')
  const [selectedScope, setSelectedScope] = useState<'project' | 'document_store' | 'general'>('project')
  const [selectedMountPoint, setSelectedMountPoint] = useState<MountPoint | null>(null)
  const [mountPoints, setMountPoints] = useState<MountPoint[]>([])
  const [mountPointFiles, setMountPointFiles] = useState<MountPointFile[]>([])
  const [mountPointFilesLoading, setMountPointFilesLoading] = useState(false)
  const [recentDocuments, setRecentDocuments] = useState<RecentDocument[]>([])
  const [loading, setLoading] = useState(false)
  // Current folder path for mount point tree navigation (empty string = root)
  const [currentFolder, setCurrentFolder] = useState('')

  // Fetch mount points and recent documents when modal opens
  useEffect(() => {
    if (isOpen) {
      fetchMountPoints()
      fetchRecentDocuments()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch functions are stable
  }, [isOpen])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setStep('source')
      setSelectedScope('project')
      setSelectedMountPoint(null)
      setMountPointFiles([])
      setCurrentFolder('')
    }
  }, [isOpen])

  const fetchMountPoints = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/v1/mount-points')
      if (res.ok) {
        const data = await res.json()
        setMountPoints(data.mountPoints || [])
      }
    } catch (error) {
      console.error('[DocumentPickerModal] Failed to fetch mount points', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchRecentDocuments = async () => {
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=recent-documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      if (res.ok) {
        const data = await res.json()
        setRecentDocuments(data.documents || [])
      }
    } catch (error) {
      console.error('[DocumentPickerModal] Failed to fetch recent documents', error)
    }
  }

  const fetchMountPointFiles = async (mp: MountPoint) => {
    try {
      setMountPointFilesLoading(true)
      const res = await fetch(`/api/v1/mount-points/${mp.id}/files`)
      if (res.ok) {
        const data = await res.json()
        setMountPointFiles(data.files || [])
        setCurrentFolder('')
      }
    } catch (error) {
      console.error('[DocumentPickerModal] Failed to fetch mount point files', error)
    } finally {
      setMountPointFilesLoading(false)
    }
  }

  const handleNewBlank = useCallback(() => {
    onSelectDocument({})
    onClose()
  }, [onSelectDocument, onClose])

  const handleReopenDocument = useCallback((doc: RecentDocument) => {
    onSelectDocument({
      filePath: doc.filePath,
      scope: doc.scope,
      mountPoint: doc.mountPoint || undefined,
    })
    onClose()
  }, [onSelectDocument, onClose])

  const handleSelectScope = useCallback((scope: 'project' | 'document_store' | 'general', mp?: MountPoint) => {
    setSelectedScope(scope)
    setSelectedMountPoint(mp || null)
    setStep('browse')

    // Fetch files for document stores
    if (scope === 'document_store' && mp) {
      fetchMountPointFiles(mp)
    }
  }, [])

  const handleFileSelect = useCallback((file: FileInfo) => {
    onSelectDocument({
      filePath: file.filepath || file.filename,
      scope: selectedScope,
      mountPoint: selectedMountPoint?.name || undefined,
    })
    onClose()
  }, [onSelectDocument, selectedScope, selectedMountPoint, onClose])

  const handleMountPointFileSelect = useCallback((file: MountPointFile) => {
    onSelectDocument({
      filePath: file.relativePath,
      scope: 'document_store',
      mountPoint: selectedMountPoint?.name || undefined,
    })
    onClose()
  }, [onSelectDocument, selectedMountPoint, onClose])

  const handleBack = useCallback(() => {
    setStep('source')
    setMountPointFiles([])
  }, [])

  // Compute folders and files at the current folder level for mount point tree view
  const mountPointEntries = useMemo(() => {
    if (mountPointFiles.length === 0) return { folders: [] as string[], files: [] as MountPointFile[] }

    const prefix = currentFolder ? currentFolder + '/' : ''
    const folderSet = new Set<string>()
    const filesAtLevel: MountPointFile[] = []

    for (const file of mountPointFiles) {
      if (!file.relativePath.startsWith(prefix)) continue

      const remainder = file.relativePath.substring(prefix.length)
      const slashIndex = remainder.indexOf('/')

      if (slashIndex === -1) {
        // File at this level
        filesAtLevel.push(file)
      } else {
        // Subfolder
        folderSet.add(remainder.substring(0, slashIndex))
      }
    }

    const folders = Array.from(folderSet).sort((a, b) => a.localeCompare(b))
    filesAtLevel.sort((a, b) => {
      const nameA = a.relativePath.split('/').pop() || ''
      const nameB = b.relativePath.split('/').pop() || ''
      return nameA.localeCompare(nameB)
    })

    return { folders, files: filesAtLevel }
  }, [mountPointFiles, currentFolder])

  const handleNavigateFolder = useCallback((folderName: string) => {
    setCurrentFolder(prev => prev ? `${prev}/${folderName}` : folderName)
  }, [])

  const handleNavigateUp = useCallback(() => {
    setCurrentFolder(prev => {
      const lastSlash = prev.lastIndexOf('/')
      return lastSlash === -1 ? '' : prev.substring(0, lastSlash)
    })
  }, [])

  // Breadcrumb segments for current folder path
  const folderBreadcrumbs = useMemo(() => {
    if (!currentFolder) return []
    return currentFolder.split('/')
  }, [currentFolder])

  // Format file size for display
  const formatSize = (bytes?: number) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={step === 'source' ? 'Open Document' : 'Select File'}
      maxWidth="lg"
    >
      {step === 'source' ? (
        <div className="space-y-3 p-4">
          {/* New blank document */}
          <button
            onClick={handleNewBlank}
            className="w-full flex items-center gap-3 p-4 rounded-lg border border-dashed qt-border hover:qt-bg-hover transition-colors text-left"
          >
            <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center qt-bg-muted">
              <svg className="w-5 h-5 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </div>
            <div>
              <div className="font-medium qt-text-primary">New blank document</div>
              <div className="text-sm qt-text-secondary">Create an empty Markdown document</div>
            </div>
          </button>

          {/* Recent documents — quick reopen */}
          {recentDocuments.length > 0 && (
            <>
              <div className="text-xs uppercase tracking-wider qt-text-muted pt-1">Recent</div>
              {recentDocuments.map((doc) => {
                const scopeLabel = doc.scope === 'document_store' && doc.mountPoint
                  ? doc.mountPoint
                  : doc.scope === 'project'
                  ? 'Project'
                  : 'General'
                const actionLabel = doc.isActive ? 'Continue editing' : 'Reopen'
                return (
                  <button
                    key={doc.id}
                    onClick={() => handleReopenDocument(doc)}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border qt-border hover:qt-bg-hover transition-colors text-left"
                  >
                    <svg className="w-5 h-5 flex-shrink-0 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      {doc.isActive ? (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      ) : (
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      )}
                    </svg>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium qt-text-primary truncate">
                        {doc.displayTitle || doc.filePath}
                      </div>
                      <div className="text-xs qt-text-secondary">{actionLabel} &middot; {scopeLabel}</div>
                    </div>
                  </button>
                )
              })}
            </>
          )}

          {/* Project library (if chat has a project) */}
          {projectId && (
            <button
              onClick={() => handleSelectScope('project')}
              className="w-full flex items-center gap-3 p-4 rounded-lg border qt-border hover:qt-bg-hover transition-colors text-left"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center qt-bg-muted">
                <svg className="w-5 h-5 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              </div>
              <div>
                <div className="font-medium qt-text-primary">Project library</div>
                <div className="text-sm qt-text-secondary">{projectName || 'Current project'} files</div>
              </div>
            </button>
          )}

          {/* General library */}
          <button
            onClick={() => handleSelectScope('general')}
            className="w-full flex items-center gap-3 p-4 rounded-lg border qt-border hover:qt-bg-hover transition-colors text-left"
          >
            <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center qt-bg-muted">
              <svg className="w-5 h-5 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
              </svg>
            </div>
            <div>
              <div className="font-medium qt-text-primary">General library</div>
              <div className="text-sm qt-text-secondary">All non-project files</div>
            </div>
          </button>

          {/* Mounted document stores */}
          {mountPoints.length > 0 && (
            <>
              <div className="text-xs uppercase tracking-wider qt-text-muted pt-2">Document Stores</div>
              {mountPoints.map((mp) => (
                <button
                  key={mp.id}
                  onClick={() => handleSelectScope('document_store', mp)}
                  className="w-full flex items-center gap-3 p-4 rounded-lg border qt-border hover:qt-bg-hover transition-colors text-left"
                >
                  <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center qt-bg-muted">
                    <svg className="w-5 h-5 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                    </svg>
                  </div>
                  <div>
                    <div className="font-medium qt-text-primary">{mp.name}</div>
                    <div className="text-sm qt-text-secondary">{mp.type}</div>
                  </div>
                </button>
              ))}
            </>
          )}

          {loading && (
            <div className="text-center py-4 qt-text-muted text-sm">Loading sources...</div>
          )}
        </div>
      ) : (
        <div className="flex flex-col" style={{ height: '60vh' }}>
          {/* Back button and scope label */}
          <div className="flex items-center gap-2 px-4 py-2 border-b qt-border">
            <button
              onClick={handleBack}
              className="flex items-center gap-1 text-sm qt-text-secondary hover:qt-text-primary transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Back
            </button>
            <span className="text-sm qt-text-muted">
              {selectedScope === 'project' ? projectName || 'Project' :
               selectedScope === 'general' ? 'General Library' :
               selectedMountPoint?.name || 'Document Store'}
            </span>
          </div>

          {/* File browser — different component per scope */}
          <div className="flex-1 overflow-y-auto">
            {selectedScope === 'document_store' ? (
              /* Mount point folder tree */
              <div className="p-2">
                {mountPointFilesLoading ? (
                  <div className="text-center py-8 qt-text-muted text-sm">Loading files...</div>
                ) : mountPointFiles.length === 0 ? (
                  <div className="text-center py-8 qt-text-muted text-sm">
                    No files found in this document store.
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {/* Breadcrumb path */}
                    {currentFolder && (
                      <div className="flex items-center gap-1 px-3 py-1.5 mb-1 text-xs qt-text-muted">
                        <button
                          onClick={() => setCurrentFolder('')}
                          className="hover:qt-text-primary transition-colors"
                        >
                          {selectedMountPoint?.name || 'Root'}
                        </button>
                        {folderBreadcrumbs.map((segment, idx) => (
                          <span key={idx} className="flex items-center gap-1">
                            <span>/</span>
                            <button
                              onClick={() => setCurrentFolder(folderBreadcrumbs.slice(0, idx + 1).join('/'))}
                              className={idx === folderBreadcrumbs.length - 1 ? 'qt-text-primary font-medium' : 'hover:qt-text-primary transition-colors'}
                            >
                              {segment}
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Up navigation */}
                    {currentFolder && (
                      <button
                        onClick={handleNavigateUp}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:qt-bg-hover transition-colors text-left"
                      >
                        <svg className="w-4 h-4 flex-shrink-0 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 17l-5-5m0 0l5-5m-5 5h12" />
                        </svg>
                        <span className="text-sm qt-text-secondary">..</span>
                      </button>
                    )}

                    {/* Folders */}
                    {mountPointEntries.folders.map((folder) => (
                      <button
                        key={`folder-${folder}`}
                        onClick={() => handleNavigateFolder(folder)}
                        className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:qt-bg-hover transition-colors text-left"
                      >
                        <svg className="w-4 h-4 flex-shrink-0 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                        </svg>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm qt-text-primary font-medium truncate">{folder}</div>
                        </div>
                        <svg className="w-3 h-3 flex-shrink-0 qt-text-muted" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>
                    ))}

                    {/* Files */}
                    {mountPointEntries.files.map((file) => {
                      const fileName = file.relativePath.split('/').pop() || file.relativePath
                      return (
                        <button
                          key={file.id}
                          onClick={() => handleMountPointFileSelect(file)}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:qt-bg-hover transition-colors text-left"
                        >
                          <svg className="w-4 h-4 flex-shrink-0 qt-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                          </svg>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm qt-text-primary truncate" title={file.relativePath}>
                              {fileName}
                            </div>
                          </div>
                          {file.size != null && (
                            <span className="text-xs qt-text-muted flex-shrink-0">
                              {formatSize(file.size)}
                            </span>
                          )}
                        </button>
                      )
                    })}

                    {/* Empty folder */}
                    {mountPointEntries.folders.length === 0 && mountPointEntries.files.length === 0 && (
                      <div className="text-center py-4 qt-text-muted text-sm">This folder is empty.</div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              /* Project or general library — use FileBrowser */
              <FileBrowser
                projectId={selectedScope === 'project' ? (projectId || null) : null}
                onFileClick={handleFileSelect}
                showUpload={false}
              />
            )}
          </div>
        </div>
      )}
    </BaseModal>
  )
}
