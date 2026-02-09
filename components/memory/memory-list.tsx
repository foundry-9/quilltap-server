'use client'

import { useCallback, useEffect, useState } from 'react'
import { MemoryCard } from './memory-card'
import { MemoryEditor } from './memory-editor'
import { HousekeepingDialog } from './housekeeping-dialog'
import { useListManager } from '@/hooks/useListManager'
import { fetchJson } from '@/lib/fetch-helpers'
import { getErrorMessage } from '@/lib/error-utils'
import { showConfirmation } from '@/lib/alert'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { EmptyState } from '@/components/ui/EmptyState'

interface Tag {
  id: string
  name: string
}

interface Memory {
  id: string
  characterId: string
  content: string
  summary: string
  keywords: string[]
  tags: string[]
  tagDetails?: Tag[]
  importance: number
  source: 'AUTO' | 'MANUAL'
  createdAt: string
  updatedAt: string
}

interface MemoryListProps {
  characterId: string
  /** Optional key to trigger data refresh when changed */
  refreshKey?: number
}

type SortBy = 'createdAt' | 'updatedAt' | 'importance'
type SortOrder = 'asc' | 'desc'

export function MemoryList({ characterId, refreshKey }: MemoryListProps) {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('createdAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'AUTO' | 'MANUAL'>('ALL')
  const [showHousekeeping, setShowHousekeeping] = useState(false)

  // Build the fetch function with current filters
  const fetchMemoriesWithFilters = useCallback(async (): Promise<Memory[]> => {
    try {
      const params = new URLSearchParams()
      params.set('characterId', characterId)
      if (search) params.set('search', search)
      params.set('sortBy', sortBy)
      params.set('sortOrder', sortOrder)
      if (sourceFilter !== 'ALL') params.set('source', sourceFilter)

      const result = await fetchJson<{ memories: Memory[] }>(
        `/api/v1/memories?${params}`
      )

      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch memories')
      }

      return result.data?.memories || []
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to fetch memories')
      console.error('MemoryList: Fetch failed', { error: errorMessage })
      throw new Error(errorMessage)
    }
  }, [characterId, search, sortBy, sortOrder, sourceFilter])

  // Use the list manager hook for core CRUD operations
  const {
    items: memories,
    loading,
    error,
    deletingId,
    editingItem: editingMemory,
    showEditor,
    refetch,
    handleDelete,
    handleEdit,
    handleCreate,
    handleEditorClose,
    handleEditorSave,
  } = useListManager<Memory>({
    fetchFn: fetchMemoriesWithFilters,
    deleteFn: async (memoryId: string) => {
      const result = await fetchJson(
        `/api/v1/memories/${memoryId}`,
        { method: 'DELETE' }
      )

      if (!result.ok) {
        throw new Error(result.error || 'Failed to delete memory')
      }
    },
    deleteConfirmMessage: 'Are you sure you want to delete this memory?',
    deleteSuccessMessage: 'Memory deleted',
  })

  // Refetch when filters change or refreshKey changes
  useEffect(() => {
    refetch()
  }, [search, sortBy, sortOrder, sourceFilter, refreshKey, refetch])

  const handleHousekeepingComplete = () => {
    setShowHousekeeping(false)
    refetch()
  }

  // Show loading state when initially loading
  if (loading && memories.length === 0) {
    return <LoadingState message="Loading memories..." />
  }

  return (
    <div className="space-y-4">
      {/* Header with title and action buttons */}
      <div className="flex items-center justify-between gap-4">
        <SectionHeader
          title="Memories"
          count={memories.length}
          action={{
            label: 'Add Memory',
            onClick: handleCreate,
          }}
        />
        {memories.length > 0 && (
          <button
            onClick={() => setShowHousekeeping(true)}
            className="px-3 py-1.5 bg-muted text-foreground text-sm rounded-lg hover:bg-accent"
            title="Clean up old and low-importance memories"
          >
            Cleanup
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search memories..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          className="px-3 py-2 text-sm border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="createdAt">Created Date</option>
          <option value="updatedAt">Updated Date</option>
          <option value="importance">Importance</option>
        </select>
        <button
          onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
          className="px-3 py-2 text-sm border border-input bg-background text-foreground rounded-lg hover:bg-accent"
          title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
        >
          {sortOrder === 'asc' ? '↑' : '↓'}
        </button>
        <select
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as 'ALL' | 'AUTO' | 'MANUAL')}
          className="px-3 py-2 text-sm border border-input bg-background text-foreground rounded-lg focus:outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="ALL">All Sources</option>
          <option value="AUTO">Auto-generated</option>
          <option value="MANUAL">Manual</option>
        </select>
      </div>

      {/* Error State */}
      {error && (
        <ErrorAlert message={error} onRetry={refetch} />
      )}

      {/* Empty State */}
      {!loading && memories.length === 0 && (
        <EmptyState
          title={search ? 'No memories match your search' : 'No memories yet'}
          description={
            !search
              ? 'Memories will be created automatically during conversations, or you can add them manually.'
              : undefined
          }
          variant="muted"
        />
      )}

      {/* Memory Grid */}
      {memories.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-1 lg:grid-cols-2">
          {memories.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              onEdit={handleEdit}
              onDelete={handleDelete}
              isDeleting={deletingId === memory.id}
            />
          ))}
        </div>
      )}

      {/* Memory Editor Modal */}
      {showEditor && (
        <MemoryEditor
          characterId={characterId}
          memory={editingMemory}
          onClose={handleEditorClose}
          onSave={handleEditorSave}
        />
      )}

      {/* Housekeeping Dialog */}
      {showHousekeeping && (
        <HousekeepingDialog
          characterId={characterId}
          onClose={() => setShowHousekeeping(false)}
          onComplete={handleHousekeepingComplete}
        />
      )}
    </div>
  )
}
