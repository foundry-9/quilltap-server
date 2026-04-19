'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { MemoryCard } from './memory-card'
import { MemoryEditor } from './memory-editor'
import { HousekeepingDialog } from './housekeeping-dialog'
import { fetchJson } from '@/lib/fetch-helpers'
import { getErrorMessage } from '@/lib/error-utils'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
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

const MEMORIES_PER_PAGE = 30

export function MemoryList({ characterId, refreshKey }: MemoryListProps) {
  const [memories, setMemories] = useState<Memory[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState(true)
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)

  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('createdAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'AUTO' | 'MANUAL'>('ALL')

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [showHousekeeping, setShowHousekeeping] = useState(false)

  const observerRef = useRef<IntersectionObserver | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const fetchMemories = useCallback(async (pageNum: number, currentSearch: string, append: boolean = false) => {
    if (pageNum === 0) {
      setIsLoading(true)
    } else {
      setLoadingMore(true)
    }

    try {
      const params = new URLSearchParams()
      params.set('characterId', characterId)
      params.set('limit', String(MEMORIES_PER_PAGE))
      params.set('offset', String(pageNum * MEMORIES_PER_PAGE))
      params.set('sortBy', sortBy)
      params.set('sortOrder', sortOrder)
      if (currentSearch) params.set('search', currentSearch)
      if (sourceFilter !== 'ALL') params.set('source', sourceFilter)

      const result = await fetchJson<{ memories: Memory[]; totalCount: number }>(
        `/api/v1/memories?${params}`
      )

      if (!result.ok) {
        throw new Error(result.error || 'Failed to fetch memories')
      }

      const newMemories = result.data?.memories || []
      const total = result.data?.totalCount ?? 0

      if (append) {
        setMemories(prev => [...prev, ...newMemories])
      } else {
        setMemories(newMemories)
      }

      setTotalCount(total)
      setHasMore(newMemories.length === MEMORIES_PER_PAGE)
      setError(null)
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to fetch memories')
      console.error('MemoryList: Fetch failed', { error: errorMessage })
      setError(errorMessage)
    } finally {
      setIsLoading(false)
      setLoadingMore(false)
    }
  }, [characterId, sortBy, sortOrder, sourceFilter])

  // Reset and refetch when filters change or refreshKey changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- page resets to 0 whenever the paginated query key changes
    setPage(0)
    fetchMemories(0, search, false)
  }, [fetchMemories, search, refreshKey])

  // Debounced search handler
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearch(value)
  }, [])

  // Set up infinite scroll observer
  useEffect(() => {
    if (observerRef.current) {
      observerRef.current.disconnect()
    }

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoading && !loadingMore) {
          const nextPage = page + 1
          setPage(nextPage)
          fetchMemories(nextPage, search, true)
        }
      },
      { threshold: 0.1 }
    )

    if (loadMoreRef.current) {
      observerRef.current.observe(loadMoreRef.current)
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect()
      }
    }
  }, [hasMore, isLoading, loadingMore, page, search, fetchMemories])

  const handleDelete = useCallback(async (id: string) => {
    const confirmed = await showConfirmation('Are you sure you want to delete this memory?')
    if (!confirmed) return

    setDeletingId(id)
    try {
      const result = await fetchJson(`/api/v1/memories/${id}`, { method: 'DELETE' })
      if (!result.ok) {
        throw new Error(result.error || 'Failed to delete memory')
      }
      setMemories(prev => prev.filter(m => m.id !== id))
      setTotalCount(prev => prev - 1)
      showSuccessToast('Memory deleted')
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to delete memory')
      showErrorToast(errorMessage)
    } finally {
      setDeletingId(null)
    }
  }, [])

  const handleEdit = useCallback((memory: Memory) => {
    setEditingMemory(memory)
    setShowEditor(true)
  }, [])

  const handleCreate = useCallback(() => {
    setEditingMemory(null)
    setShowEditor(true)
  }, [])

  const handleEditorClose = useCallback(() => {
    setShowEditor(false)
    setEditingMemory(null)
  }, [])

  const handleEditorSave = useCallback(() => {
    setShowEditor(false)
    setEditingMemory(null)
    // Reset to first page and refetch
    setPage(0)
    fetchMemories(0, search, false)
  }, [fetchMemories, search])

  const handleHousekeepingComplete = useCallback(() => {
    setShowHousekeeping(false)
    setPage(0)
    fetchMemories(0, search, false)
  }, [fetchMemories, search])

  // Show loading state when initially loading
  if (isLoading && memories.length === 0) {
    return <LoadingState message="Loading memories..." />
  }

  return (
    <div className="space-y-4">
      {/* Header with title and action buttons */}
      <div className="flex items-center justify-between gap-4">
        <SectionHeader
          title="Memories"
          count={totalCount}
          action={{
            label: 'Add Memory',
            onClick: handleCreate,
          }}
        />
        {memories.length > 0 && (
          <button
            onClick={() => setShowHousekeeping(true)}
            className="px-3 py-1.5 qt-bg-muted text-foreground text-sm rounded-lg hover:bg-accent"
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
            onChange={handleSearchChange}
            className="qt-input text-sm"
          />
        </div>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
           className="qt-select w-auto"
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
           className="qt-select w-auto"
        >
          <option value="ALL">All Sources</option>
          <option value="AUTO">Auto-generated</option>
          <option value="MANUAL">Manual</option>
        </select>
      </div>

      {/* Error State */}
      {error && (
        <ErrorAlert message={error} onRetry={() => { setPage(0); fetchMemories(0, search, false) }} />
      )}

      {/* Empty State */}
      {!isLoading && memories.length === 0 && (
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

      {/* Load more trigger */}
      <div ref={loadMoreRef} className="py-2">
        {loadingMore && (
          <div className="flex items-center justify-center gap-2 qt-text-secondary">
            <div className="h-4 w-4 animate-spin rounded-full border-2 qt-border-primary border-r-transparent"></div>
            Loading more memories...
          </div>
        )}
        {!hasMore && memories.length > 0 && memories.length < totalCount && (
          <p className="text-center qt-text-small">All memories loaded</p>
        )}
      </div>

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
