'use client'

import { useEffect } from 'react'
import { useListManager } from '@/hooks/useListManager'
import { fetchJson } from '@/lib/fetch-helpers'
import { ClothingRecordCard, ClothingRecord } from './clothing-record-card'
import { ClothingRecordEditor } from './clothing-record-editor'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { EmptyState } from '@/components/ui/EmptyState'

interface ClothingRecordListProps {
  entityId: string
  refreshKey?: number
}

export function ClothingRecordList({ entityId, refreshKey }: ClothingRecordListProps) {
  const baseUrl = `/api/v1/characters/${entityId}/clothing`

  const {
    items: records,
    loading,
    error,
    deletingId,
    editingItem: editingRecord,
    showEditor,
    refetch,
    handleDelete,
    handleEdit,
    handleCreate,
    handleEditorClose,
    handleEditorSave,
  } = useListManager<ClothingRecord>({
    fetchFn: async () => {
      const result = await fetchJson<{ clothingRecords: ClothingRecord[] }>(baseUrl)
      if (!result.ok) throw new Error(result.error || 'Failed to fetch clothing records')
      return result.data?.clothingRecords || []
    },
    deleteFn: async (id: string) => {
      const result = await fetchJson(`${baseUrl}/${id}`, { method: 'DELETE' })
      if (!result.ok) throw new Error(result.error || 'Failed to delete clothing record')
    },
    deleteConfirmMessage: 'Are you sure you want to delete this clothing record?',
    deleteSuccessMessage: 'Clothing record deleted',
  })

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refetch()
    }
  }, [refreshKey, refetch])

  const hangerIcon = (
    <svg
      className="w-12 h-12 text-muted-foreground mx-auto"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 2C10.343 2 9 3.343 9 5c0 1.035.527 1.95 1.327 2.487L4.5 12.5c-.667.5-1 1.167-1 2 0 1.5 1.5 2.5 3 2.5h11c1.5 0 3-1 3-2.5 0-.833-.333-1.5-1-2L12.673 7.487A2.992 2.992 0 0015 5c0-1.657-1.343-3-3-3z"
      />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M6.5 17v2.5a1.5 1.5 0 001.5 1.5h8a1.5 1.5 0 001.5-1.5V17"
      />
    </svg>
  )

  if (loading) {
    return <LoadingState variant="spinner" />
  }

  if (error) {
    return (
      <ErrorAlert
        message={error}
        onRetry={refetch}
      />
    )
  }

  return (
    <div>
      <SectionHeader
        title="Clothing & Outfits"
        count={records.length}
        action={{
          label: 'Add Outfit',
          onClick: handleCreate,
        }}
      />

      {records.length === 0 ? (
        <EmptyState
          icon={hangerIcon}
          title="No clothing records yet"
          description="Add outfits to describe what this character wears in different situations"
          variant="dashed"
          action={{
            label: 'Add Outfit',
            onClick: handleCreate,
          }}
        />
      ) : (
        <div className="space-y-3">
          {records.map((record) => (
            <ClothingRecordCard
              key={record.id}
              record={record}
              onEdit={handleEdit}
              onDelete={handleDelete}
              isDeleting={deletingId === record.id}
            />
          ))}
        </div>
      )}

      {showEditor && (
        <ClothingRecordEditor
          entityId={entityId}
          record={editingRecord}
          onClose={handleEditorClose}
          onSave={handleEditorSave}
        />
      )}
    </div>
  )
}
