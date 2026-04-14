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
  } = useDocumentStores()

  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [editStore, setEditStore] = useState<DocumentStore | null>(null)
  const [deleteStoreId, setDeleteStoreId] = useState<string | null>(null)
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-foreground">Loading document stores...</p>
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
          <h1 className="text-3xl font-semibold leading-tight">The Scriptorium</h1>
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
    </div>
  )
}
