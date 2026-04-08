'use client'

import { useState, useEffect, useCallback } from 'react'
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
  const archetypeUrl = '/api/v1/wardrobe'

  // ── Personal wardrobe (character-scoped) ──────────────────────────────
  const {
    items: personalItems,
    loading: personalLoading,
    error: personalError,
    deletingId: personalDeletingId,
    editingItem: personalEditingItem,
    showEditor: personalShowEditor,
    refetch: refetchPersonal,
    handleDelete: handleDeletePersonal,
    handleEdit: handleEditPersonal,
    handleCreate: handleCreatePersonal,
    handleEditorClose: handleClosePersonal,
    handleEditorSave: handleSavePersonal,
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

  // ── Shared wardrobe (archetypes) ──────────────────────────────────────
  const {
    items: sharedItems,
    loading: sharedLoading,
    error: sharedError,
    deletingId: sharedDeletingId,
    editingItem: sharedEditingItem,
    showEditor: sharedShowEditor,
    refetch: refetchShared,
    handleDelete: handleDeleteShared,
    handleEdit: handleEditShared,
    handleCreate: handleCreateShared,
    handleEditorClose: handleCloseShared,
    handleEditorSave: handleSaveShared,
  } = useListManager<WardrobeItem>({
    fetchFn: async () => {
      const result = await fetchJson<{ wardrobeItems: WardrobeItem[] }>(
        `${archetypeUrl}?archetypes=true`
      )
      if (!result.ok) throw new Error(result.error || 'Failed to fetch shared wardrobe items')
      return result.data?.wardrobeItems || []
    },
    deleteFn: async (id: string) => {
      const result = await fetchJson(`${archetypeUrl}/${id}`, { method: 'DELETE' })
      if (!result.ok) throw new Error(result.error || 'Failed to delete shared wardrobe item')
    },
    deleteConfirmMessage: 'Are you sure you want to delete this shared wardrobe item? It will be removed for all characters.',
    deleteSuccessMessage: 'Shared wardrobe item deleted',
  })

  const [sharedCollapsed, setSharedCollapsed] = useState(true)

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      refetchPersonal()
      refetchShared()
    }
  }, [refreshKey, refetchPersonal, refetchShared])

  const handleArchivePersonal = useCallback(async (id: string, archive: boolean) => {
    const result = await fetchJson(`${baseUrl}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        archivedAt: archive ? new Date().toISOString() : null,
      }),
    })
    if (!result.ok) throw new Error(result.error || 'Failed to archive wardrobe item')
    refetchPersonal()
  }, [baseUrl, refetchPersonal])

  const handleArchiveShared = useCallback(async (id: string, archive: boolean) => {
    const result = await fetchJson(`${archetypeUrl}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        archivedAt: archive ? new Date().toISOString() : null,
      }),
    })
    if (!result.ok) throw new Error(result.error || 'Failed to archive shared wardrobe item')
    refetchShared()
  }, [archetypeUrl, refetchShared])

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

  const loading = personalLoading && sharedLoading
  const error = personalError || sharedError

  if (loading) {
    return <LoadingState variant="spinner" />
  }

  if (error) {
    return (
      <ErrorAlert
        message={error}
        onRetry={() => { refetchPersonal(); refetchShared() }}
      />
    )
  }

  return (
    <div>
      {/* ── Personal Wardrobe ──────────────────────────────────────── */}
      <SectionHeader
        title="Personal Wardrobe"
        count={personalItems.length}
        action={{
          label: 'Add Item',
          onClick: handleCreatePersonal,
        }}
      />

      {personalItems.length === 0 ? (
        <EmptyState
          icon={hangerIcon}
          title="No wardrobe items yet"
          description="Add individual clothing and accessory items to build this character's wardrobe"
          variant="dashed"
          action={{
            label: 'Add Item',
            onClick: handleCreatePersonal,
          }}
        />
      ) : (
        <div className="space-y-3">
          {personalItems.map((wardrobeItem) => (
            <WardrobeItemCard
              key={wardrobeItem.id}
              item={wardrobeItem}
              onEdit={handleEditPersonal}
              onDelete={handleDeletePersonal}
              onArchive={handleArchivePersonal}
              isDeleting={personalDeletingId === wardrobeItem.id}
            />
          ))}
        </div>
      )}

      {/* ── Shared Wardrobe (Archetypes) ──────────────────────────── */}
      <div className="mt-8">
        <button
          type="button"
          onClick={() => setSharedCollapsed(!sharedCollapsed)}
          className="flex w-full items-center justify-between gap-4 mb-4"
        >
          <h3 className="qt-text-section text-foreground flex items-center gap-2">
            Shared Wardrobe
            {sharedItems.length > 0 && (
              <span className="qt-text-muted qt-text-small font-normal">
                ({sharedItems.length})
              </span>
            )}
            <span className="qt-text-xs qt-text-muted font-normal italic">
              available to all characters
            </span>
            <svg
              className={`w-4 h-4 qt-text-secondary transition-transform ${sharedCollapsed ? '' : 'rotate-180'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </h3>
          <span className="flex-shrink-0" />
        </button>

        {!sharedCollapsed && (
          <>
            <div className="flex justify-end mb-4">
              <button
                type="button"
                onClick={handleCreateShared}
                className="qt-button-secondary qt-button-sm"
              >
                Add Shared Item
              </button>
            </div>

            {sharedItems.length === 0 ? (
              <EmptyState
                icon={hangerIcon}
                title="No shared wardrobe items"
                description="Shared items are available to all characters. Add items here that multiple characters might wear."
                variant="dashed"
                action={{
                  label: 'Add Shared Item',
                  onClick: handleCreateShared,
                }}
              />
            ) : (
              <div className="space-y-3">
                {sharedItems.map((wardrobeItem) => (
                  <WardrobeItemCard
                    key={wardrobeItem.id}
                    item={wardrobeItem}
                    onEdit={handleEditShared}
                    onDelete={handleDeleteShared}
                    onArchive={handleArchiveShared}
                    isDeleting={sharedDeletingId === wardrobeItem.id}
                    isShared
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Editors ───────────────────────────────────────────────── */}
      {personalShowEditor && (
        <WardrobeItemEditor
          characterId={characterId}
          item={personalEditingItem}
          onClose={handleClosePersonal}
          onSave={handleSavePersonal}
        />
      )}

      {sharedShowEditor && (
        <WardrobeItemEditor
          characterId={characterId}
          item={sharedEditingItem}
          isShared
          onClose={handleCloseShared}
          onSave={handleSaveShared}
        />
      )}
    </div>
  )
}
