'use client'

/**
 * DocumentPickerModal - Source selection and file browser for Document Mode
 *
 * Two-step modal:
 * Step 1: Select source (new blank document, project library, mounted stores)
 * Step 2: Browse the chosen store through the Scriptorium's folder browser
 *         (`DocumentStoreBrowser` in pick mode, ⋮ menus included). The
 *         Project library is the project's own store; the General library is
 *         Quilltap General.
 *
 * Scriptorium Phase 3.5
 *
 * @module app/salon/[id]/components/DocumentPickerModal
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { DocumentStoreBrowser } from '@/components/document-browser/DocumentStoreBrowser'
import type { DocumentEntry } from '@/components/document-browser/useDocumentStoreSource'
import { Icon } from '@/components/ui/icon'
import { BaseModal } from '@/components/ui/BaseModal'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import { MAX_RECENT_DOCUMENTS } from '@/lib/chat-documents/constants'
import { showErrorToast } from '@/lib/toast'

interface DocumentPickerModalProps {
  isOpen: boolean
  onClose: () => void
  /**
   * The chat whose reach scopes the picker. `null` = the standalone (chat-less)
   * surface: stores and recents come from `/api/v1/documents`, every enabled
   * store is shown (there is no narrower reach to default to), and the
   * project-library shortcut is unavailable.
   */
  chatId: string | null
  projectId?: string | null
  projectName?: string | null
  onSelectDocument: (params: {
    filePath?: string
    title?: string
    scope?: 'project' | 'document_store' | 'general'
    mountPoint?: string
    /** For new blank docs (no filePath), the folder to create inside. */
    targetFolder?: string
  }) => void
}

interface MountPoint {
  id: string
  name: string
  type: string
}

/**
 * A document store reachable from this chat, as returned by
 * `?action=accessible-stores`. `name` is the canonical mount name (used to
 * open documents — `document_store` paths resolve by name); `label` is the
 * display text (a character's name for vaults).
 */
interface AccessibleStore {
  mountPointId: string
  name: string
  label: string
  kind: 'character' | 'document-store'
  mountType: 'filesystem' | 'obsidian' | 'database'
  storeType: 'documents' | 'character'
  characterId?: string
  /** True when reached via a group membership — bucketed into "Group Files". */
  isGroupStore?: boolean
}

/** A store behind a left-column button: the project's own, or Quilltap General (see server). */
interface LibraryTarget {
  mountPointId: string
  name: string
  mountType: 'filesystem' | 'obsidian' | 'database'
}

interface RecentDocument {
  id: string
  filePath: string
  scope: 'project' | 'document_store' | 'general'
  mountPoint?: string | null
  displayTitle?: string | null
  isActive?: boolean
  /** True when this recent doc was last opened in the current chat. */
  fromCurrentChat?: boolean
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
  const [selectedMountPoint, setSelectedMountPoint] = useState<MountPoint | null>(null)
  const [accessibleStores, setAccessibleStores] = useState<AccessibleStore[]>([])
  // The project's own store and Quilltap General, behind the "Project
  // library" and "General library" buttons. Each button is hidden while its
  // store is missing.
  const [projectLibrary, setProjectLibrary] = useState<LibraryTarget | null>(null)
  const [generalLibrary, setGeneralLibrary] = useState<LibraryTarget | null>(null)
  const [recentDocuments, setRecentDocuments] = useState<RecentDocument[]>([])
  const [loading, setLoading] = useState(false)
  // "Look everywhere" widens the store accordions beyond this chat's reach to
  // every enabled store (character vaults of all characters, all doc stores).
  const [lookEverywhere, setLookEverywhere] = useState(false)

  const fetchAccessibleStores = async (all: boolean) => {
    try {
      setLoading(true)
      const res = await fetch(chatId
        ? `/api/v1/chats/${chatId}?action=accessible-stores${all ? '&all=true' : ''}`
        : '/api/v1/documents?action=accessible-stores')
      if (res.ok) {
        const data = await res.json()
        setAccessibleStores(data.stores || [])
        setProjectLibrary(data.projectLibrary ?? null)
        setGeneralLibrary(data.generalLibrary ?? null)
      }
    } catch (error) {
      console.error('[DocumentPickerModal] Failed to fetch accessible stores', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchRecentDocuments = async () => {
    try {
      const url = chatId
        ? `/api/v1/chats/${chatId}?action=recent-documents`
        : '/api/v1/documents?action=recent-documents'
      const res = await fetch(url, {
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

  // Recent documents — fetched when the modal opens.
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch when modal opens; parent renders unconditionally
      fetchRecentDocuments()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch function is stable
  }, [isOpen])

  // Accessible stores — refetched when the modal opens or the "look everywhere"
  // scope toggles.
  useEffect(() => {
    if (isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- data fetch; parent renders unconditionally
      fetchAccessibleStores(lookEverywhere)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fetch function is stable
  }, [isOpen, lookEverywhere])

  // Reset state when modal closes
  useEffect(() => {
    if (!isOpen) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- modal reset on close; parent renders unconditionally
      setStep('source')
      setSelectedMountPoint(null)
      setLookEverywhere(false)
      setProjectLibrary(null)
      setGeneralLibrary(null)
    }
  }, [isOpen])

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

  const handleSelectStore = useCallback((mp: MountPoint) => {
    setSelectedMountPoint(mp)
    setStep('browse')
  }, [])

  const browseLibrary = useCallback((library: LibraryTarget) => {
    handleSelectStore({ id: library.mountPointId, name: library.name, type: library.mountType })
  }, [handleSelectStore])

  const handleMountPointFileSelect = useCallback((file: DocumentEntry) => {
    onSelectDocument({
      filePath: file.relativePath,
      scope: 'document_store',
      mountPoint: selectedMountPoint?.name || undefined,
    })
    onClose()
  }, [onSelectDocument, selectedMountPoint, onClose])

  // Create a brand-new "Untitled Document.md" inside the currently-browsed
  // folder of the selected mount point. The server picks the actual filename
  // (with collision numbering); we just hand it the scope and target folder.
  const handleNewBlankInFolder = useCallback((currentFolder: string) => {
    if (!selectedMountPoint) return
    onSelectDocument({
      scope: 'document_store',
      mountPoint: selectedMountPoint.name,
      targetFolder: currentFolder || undefined,
    })
    onClose()
  }, [onSelectDocument, selectedMountPoint, onClose])

  // "Where else this appears" → Go there: browse that store, named as the
  // shelves name it (an unreachable store falls back to the browser's note).
  const handleOpenOtherStore = useCallback((mountPointId: string) => {
    const store = accessibleStores.find(s => s.mountPointId === mountPointId)
    const library = [projectLibrary, generalLibrary].find(l => l?.mountPointId === mountPointId)
    if (store) {
      handleSelectStore({ id: store.mountPointId, name: store.name, type: store.mountType })
    } else if (library) {
      browseLibrary(library)
    } else {
      showErrorToast("That store is not on this chat's shelves. Tick Look everywhere to reach it.")
    }
  }, [accessibleStores, projectLibrary, generalLibrary, handleSelectStore, browseLibrary])

  const handleBack = useCallback(() => {
    setStep('source')
  }, [])

  // On the standalone (chat-less) surface everything is already "everywhere":
  // the toggle disappears and the accordion descriptions read accordingly.
  const everywhere = chatId === null || lookEverywhere

  // Bucket the chat-accessible stores for the right-column accordions. Group
  // stores get their own bucket and are held out of the generic Database-/
  // Filesystem-backed buckets so each store appears exactly once.
  const storeBuckets = useMemo(() => ({
    characterVaults: accessibleStores.filter(s => s.storeType === 'character'),
    groupStores: accessibleStores.filter(s => s.isGroupStore),
    databaseStores: accessibleStores.filter(s => s.storeType === 'documents' && s.mountType === 'database' && !s.isGroupStore),
    filesystemStores: accessibleStores.filter(s => s.storeType === 'documents' && s.mountType !== 'database' && !s.isGroupStore),
  }), [accessibleStores])

  // Clicking a store row drills into its file browser (Step 2). We pass the
  // canonical mount name so document opens resolve correctly.
  const renderStoreRow = useCallback((store: AccessibleStore) => (
    <button
      key={store.mountPointId}
      onClick={() => handleSelectStore({ id: store.mountPointId, name: store.name, type: store.mountType })}
      className="w-full flex items-center gap-3 px-3 py-2 rounded-md hover:qt-bg-surface-hover transition-colors text-left"
    >
      <Icon name="file" className="w-4 h-4 flex-shrink-0 qt-text-secondary" />
      <div className="flex-1 min-w-0">
        <div className="text-sm qt-text-primary font-medium truncate" title={store.label}>{store.label}</div>
      </div>
      <Icon name="chevron-right" className="w-3 h-3 flex-shrink-0 qt-text-muted" />
    </button>
  ), [handleSelectStore])

  const renderEmptyBucket = () => (
    <div className="px-3 py-2 text-sm qt-text-muted">None available here.</div>
  )

  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title={step === 'source' ? 'Open Document' : 'Select File'}
      maxWidth={step === 'source' ? '4xl' : 'lg'}
    >
      {step === 'source' ? (
        <div className="flex flex-col gap-4 p-4 md:flex-row md:items-start">
          {/* Left column: defaults + recent files */}
          <div className="space-y-3 md:w-72 md:flex-shrink-0">
            {/* New blank document */}
            <button
              onClick={handleNewBlank}
              className="w-full flex items-center gap-3 p-4 rounded-lg border border-dashed qt-border hover:qt-bg-surface-hover transition-colors text-left"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center qt-bg-muted">
                <Icon name="plus" className="w-5 h-5 qt-text-secondary" />
              </div>
              <div>
                <div className="font-medium qt-text-primary">New blank document</div>
                <div className="text-sm qt-text-secondary">Create an empty Markdown document</div>
              </div>
            </button>

            {/* Project library: the chat's project's own store. */}
            {projectId && projectLibrary && (
              <button
                onClick={() => browseLibrary(projectLibrary)}
                className="w-full flex items-center gap-3 p-4 rounded-lg border qt-border hover:qt-bg-surface-hover transition-colors text-left"
              >
                <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center qt-bg-muted">
                  <Icon name="folder" className="w-5 h-5 qt-text-secondary" />
                </div>
                <div>
                  <div className="font-medium qt-text-primary">Project library</div>
                  <div className="text-sm qt-text-secondary">{projectName || 'Current project'} files</div>
                </div>
              </button>
            )}

            {/* General library: Quilltap General. */}
            {generalLibrary && (
            <button
              onClick={() => browseLibrary(generalLibrary)}
              className="w-full flex items-center gap-3 p-4 rounded-lg border qt-border hover:qt-bg-surface-hover transition-colors text-left"
            >
              <div className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center qt-bg-muted">
                <Icon name="scriptorium" className="w-5 h-5 qt-text-secondary" />
              </div>
              <div>
                <div className="font-medium qt-text-primary">General library</div>
                <div className="text-sm qt-text-secondary">Quilltap General, the shelf every chat shares</div>
              </div>
            </button>
            )}

            {/* Recent documents — quick reopen (this chat first, then others) */}
            <CollapsibleCard
              key={`recent-${recentDocuments.length > 0}`}
              title="Recent"
              description="Documents you've lately had open"
              defaultOpen={recentDocuments.length > 0}
              icon={<Icon name="clock" className="w-5 h-5" />}
            >
              <div className="space-y-1">
                {recentDocuments.length === 0 && (
                  <div className="px-3 py-2 text-sm qt-text-muted">No recent documents yet.</div>
                )}
                {recentDocuments.slice(0, MAX_RECENT_DOCUMENTS).map((doc) => {
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
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-lg border qt-border hover:qt-bg-surface-hover transition-colors text-left"
                    >
                      {doc.isActive
                        ? <Icon name="file" className="w-5 h-5 flex-shrink-0 qt-text-secondary" />
                        : <Icon name="clock" className="w-5 h-5 flex-shrink-0 qt-text-secondary" />
                      }
                      <div className="flex-1 min-w-0">
                        <div className="font-medium qt-text-primary truncate">
                          {doc.displayTitle || doc.filePath}
                        </div>
                        <div className="text-xs qt-text-secondary">{actionLabel} &middot; {scopeLabel}</div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </CollapsibleCard>
          </div>

          {/* Right column: document stores, grouped by kind */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Look-everywhere toggle — widens the accordions beyond this chat.
                Absent on the standalone surface, which is always everywhere. */}
            {chatId !== null && (
              <label className="flex items-start gap-3 px-1 pb-1 cursor-pointer">
                <input
                  type="checkbox"
                  checked={lookEverywhere}
                  onChange={(e) => setLookEverywhere(e.target.checked)}
                  className="qt-checkbox mt-0.5"
                />
                <span>
                  <span className="block text-sm font-medium qt-text-primary">Look everywhere</span>
                  <span className="block text-xs qt-text-secondary">Show every store, not just the ones reachable from this chat</span>
                </span>
              </label>
            )}

            <CollapsibleCard
              key={`vaults-${everywhere}-${storeBuckets.characterVaults.length > 0}`}
              title="Character Vaults"
              description={everywhere ? 'Every character vault' : 'Vaults of characters in this chat'}
              defaultOpen={storeBuckets.characterVaults.length > 0}
              icon={<Icon name="characters" className="w-5 h-5" />}
            >
              <div className="space-y-0.5">
                {storeBuckets.characterVaults.length > 0
                  ? storeBuckets.characterVaults.map(renderStoreRow)
                  : renderEmptyBucket()}
              </div>
            </CollapsibleCard>

            {storeBuckets.groupStores.length > 0 && (
              <CollapsibleCard
                key={`group-${everywhere}-${storeBuckets.groupStores.length > 0}`}
                title="Group Files"
                description="Stores shared with characters' groups"
                defaultOpen={storeBuckets.groupStores.length > 0}
                icon={<Icon name="users" className="w-5 h-5" />}
              >
                <div className="space-y-0.5">
                  {storeBuckets.groupStores.map(renderStoreRow)}
                </div>
              </CollapsibleCard>
            )}

            <CollapsibleCard
              key={`db-${everywhere}-${storeBuckets.databaseStores.length > 0}`}
              title="Database-backed document stores"
              description={everywhere ? 'Every store kept inside Quilltap' : 'Project stores kept inside Quilltap'}
              defaultOpen={storeBuckets.databaseStores.length > 0}
              icon={<Icon name="database" className="w-5 h-5" />}
            >
              <div className="space-y-0.5">
                {storeBuckets.databaseStores.length > 0
                  ? storeBuckets.databaseStores.map(renderStoreRow)
                  : renderEmptyBucket()}
              </div>
            </CollapsibleCard>

            <CollapsibleCard
              key={`fs-${everywhere}-${storeBuckets.filesystemStores.length > 0}`}
              title="Filesystem-backed document stores"
              description={everywhere ? 'Every store backed by folders on disk' : 'Project stores backed by folders on disk'}
              defaultOpen={storeBuckets.filesystemStores.length > 0}
              icon={<Icon name="folder" className="w-5 h-5" />}
            >
              <div className="space-y-0.5">
                {storeBuckets.filesystemStores.length > 0
                  ? storeBuckets.filesystemStores.map(renderStoreRow)
                  : renderEmptyBucket()}
              </div>
            </CollapsibleCard>

            {loading && (
              <div className="text-center py-2 qt-text-muted text-sm">Loading stores…</div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col" style={{ height: '60vh' }}>
          {/* Back button and scope label */}
          <div className="flex items-center gap-2 px-4 py-2 border-b qt-border">
            <button
              onClick={handleBack}
              className="flex items-center gap-1 text-sm qt-text-secondary hover:qt-text-primary transition-colors"
            >
              <Icon name="arrow-left" className="w-4 h-4" />
              Back
            </button>
            <span className="text-sm qt-text-muted">
              {selectedMountPoint?.id === projectLibrary?.mountPointId ? projectName || 'Project' :
               selectedMountPoint?.id === generalLibrary?.mountPointId ? 'General Library' :
               selectedMountPoint?.name || 'Document Store'}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto">
            {selectedMountPoint && (
              /* The Scriptorium's folder browser, in pick mode: opening a
                 file opens it in Document Mode; its ⋮ menus stay. */
              <div className="p-2">
                <DocumentStoreBrowser
                  key={selectedMountPoint.id}
                  storeId={selectedMountPoint.id}
                  onPickFile={handleMountPointFileSelect}
                  onOpenStore={handleOpenOtherStore}
                  footerActions={(currentFolder) => (
                    <button
                      type="button"
                      onClick={() => handleNewBlankInFolder(currentFolder)}
                      className="qt-button-secondary qt-button-sm inline-flex items-center gap-1.5"
                    >
                      <Icon name="file-plus" className="w-4 h-4" />
                      New document here
                    </button>
                  )}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </BaseModal>
  )
}
