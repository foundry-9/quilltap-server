'use client'

/**
 * Document Stores List Page
 *
 * Displays all document stores (mount points) with CRUD and scan actions.
 */

import { useEffect, useState } from 'react'
import { useDocumentStores } from './hooks/useDocumentStores'
import {
  DocumentStoresGrid,
  CreateDocumentStoreDialog,
  EditDocumentStoreDialog,
  DeleteDocumentStoreDialog,
  ConvertToDatabaseDialog,
  DeconvertToFilesystemDialog,
} from './components'
import type { DocumentStore, CreateDocumentStoreData, UpdateDocumentStoreData } from './types'

export default function DocumentStoresPage() {
  const {
    stores,
    loading,
    error,
    fetchStores,
    createStore,
    updateStore,
    deleteStore,
    scanStore,
    convertStore,
    deconvertStore,
  } = useDocumentStores()

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editStore, setEditStore] = useState<DocumentStore | null>(null)
  const [deleteStoreId, setDeleteStoreId] = useState<string | null>(null)
  const [convertStoreTarget, setConvertStoreTarget] = useState<DocumentStore | null>(null)
  const [deconvertStoreTarget, setDeconvertStoreTarget] = useState<DocumentStore | null>(null)
  const [scanningIds, setScanningIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchStores()
  }, [fetchStores])

  const handleCreate = async (data: CreateDocumentStoreData) => {
    const result = await createStore(data)
    if (result) {
      setCreateDialogOpen(false)
    }
  }

  const handleUpdate = async (id: string, data: UpdateDocumentStoreData) => {
    const result = await updateStore(id, data)
    if (result) {
      setEditStore(null)
    }
  }

  const handleDelete = async () => {
    if (deleteStoreId) {
      const success = await deleteStore(deleteStoreId)
      if (success) {
        setDeleteStoreId(null)
      }
    }
  }

  const handleScan = async (storeId: string) => {
    setScanningIds(prev => new Set(prev).add(storeId))
    await scanStore(storeId)
    setScanningIds(prev => {
      const next = new Set(prev)
      next.delete(storeId)
      return next
    })
  }

  const handleConvertConfirm = async () => {
    if (!convertStoreTarget) return
    const targetId = convertStoreTarget.id
    setConvertStoreTarget(null)
    await convertStore(targetId)
  }

  const handleDeconvertConfirm = async (targetPath: string) => {
    if (!deconvertStoreTarget) return
    const targetId = deconvertStoreTarget.id
    setDeconvertStoreTarget(null)
    await deconvertStore(targetId, targetPath)
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="qt-section-title">Loading document stores...</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg qt-text-destructive">Error: {error}</p>
      </div>
    )
  }

  return (
    <div className="qt-page-container text-foreground" style={{ '--story-background-url': 'url(/images/scriptorium.webp)' } as React.CSSProperties}>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b qt-border-default/60 pb-6">
        <div>
          <h1 className="qt-page-title">The Scriptorium</h1>
          <p className="mt-1 qt-text-small">Mount external document directories as searchable knowledge sources</p>
        </div>
        <button
          onClick={() => setCreateDialogOpen(true)}
          className="qt-button-primary"
        >
          Add Document Store
        </button>
      </div>

      <DocumentStoresGrid
        stores={stores}
        scanningIds={scanningIds}
        onCreateClick={() => setCreateDialogOpen(true)}
        onEditClick={setEditStore}
        onDeleteClick={setDeleteStoreId}
        onScanClick={handleScan}
        onConvertClick={setConvertStoreTarget}
        onDeconvertClick={setDeconvertStoreTarget}
      />

      <CreateDocumentStoreDialog
        open={createDialogOpen}
        onClose={() => setCreateDialogOpen(false)}
        onSubmit={handleCreate}
      />

      <EditDocumentStoreDialog
        store={editStore}
        onClose={() => setEditStore(null)}
        onSubmit={handleUpdate}
      />

      <DeleteDocumentStoreDialog
        open={deleteStoreId !== null}
        onClose={() => setDeleteStoreId(null)}
        onConfirm={handleDelete}
      />

      <ConvertToDatabaseDialog
        store={convertStoreTarget}
        onClose={() => setConvertStoreTarget(null)}
        onConfirm={handleConvertConfirm}
      />

      <DeconvertToFilesystemDialog
        store={deconvertStoreTarget}
        onClose={() => setDeconvertStoreTarget(null)}
        onConfirm={handleDeconvertConfirm}
      />
    </div>
  )
}
