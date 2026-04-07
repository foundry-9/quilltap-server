'use client'

import { useEffect } from 'react'
import { useListManager } from '@/hooks/useListManager'
import { fetchJson } from '@/lib/fetch-helpers'
import { WardrobeItemCard } from './wardrobe-item-card'
import { WardrobeItemEditor } from './wardrobe-item-editor'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { EmptyState } from '@/components/ui/EmptyState'
import type { WardrobeItem } from '@/lib/schemas/wardrobe.types'

interface WardrobeItemListProps {
  characterId: string
  refreshKey?: number
}

export function WardrobeItemList({ characterId, refreshKey }: WardrobeItemListProps) {
  const baseUrl = `/api/v1/characters/${characterId}/wardrobe`

  const {
    items,
    loading,
    error,
    deletingId,
    editingItem,
    showEditor,
    refetch,
    handleDelete,
    handleEdit,
    handleCreate,
    handleEditorClose,
    handleEditorSave,
  } = useListManager<WardrobeItem>({
    fetchFn: async () => {
      const result = await fetchJson<{ wardrobeItems: WardrobeItem[] }>(baseUrl)
      if (!result.ok) throw new Error(result.error || 'Failed to fetch wardrobe items')
      return result.data?.wardrobeItems || []
    },
    deleteFn: async (id: string) => {
      const result = await fetchJson(`${baseUrl}/${id}`, { method: 'DELETE' })
      if (!result.ok) throw new Error(result.error || 'Failed to delete wardrobe item')
    },
    deleteConfirmMessage: 'Are you sure you want to delete this wardrobe item?',
    deleteSuccessMessage: 'Wardrobe item deleted',
  })

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refetch()
    }
  }, [refreshKey, refetch])

  const hangerIcon = (
    <svg
      className="w-12 h-12 qt-text-secondary mx-auto"
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
        title="Wardrobe"
        count={items.length}
        action={{
          label: 'Add Item',
          onClick: handleCreate,
        }}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={hangerIcon}
          title="No wardrobe items yet"
          description="Add individual clothing and accessory items to build this character's wardrobe"
          variant="dashed"
          action={{
            label: 'Add Item',
            onClick: handleCreate,
          }}
        />
      ) : (
        <div className="space-y-3">
          {items.map((wardrobeItem) => (
            <WardrobeItemCard
              key={wardrobeItem.id}
              item={wardrobeItem}
              onEdit={handleEdit}
              onDelete={handleDelete}
              isDeleting={deletingId === wardrobeItem.id}
            />
          ))}
        </div>
      )}

      {showEditor && (
        <WardrobeItemEditor
          characterId={characterId}
          item={editingItem}
          onClose={handleEditorClose}
          onSave={handleEditorSave}
        />
      )}
    </div>
  )
}
