'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { MemoryCard } from './memory-card'
import { BaseModal } from '@/components/ui/BaseModal'
import { MemoryEditor } from './memory-editor'
import { MaintenanceDialog } from './maintenance-dialog'
import { fetchJson } from '@/lib/fetch-helpers'
import { getErrorMessage } from '@/lib/error-utils'
import { showConfirmation } from '@/lib/alert'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { EmptyState } from '@/components/ui/EmptyState'
import { ListPager } from '@/components/ui/ListPager'

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
  source: 'AUTO' | 'MANUAL' | 'CONSOLIDATED'
  keystone?: boolean
  /** 'cold' rows are archived: out of everyday recall, still on the shelf. */
  tier?: 'hot' | 'cold'
  /** The digest that replaced this row, when it has been folded. */
  supersededById?: string | null
  /** The notes a digest was folded from. */
  consolidatedFrom?: string[]
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

const EMPTY_MEMORIES: Memory[] = []

export function MemoryList({ characterId, refreshKey }: MemoryListProps) {
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>('createdAt')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [sourceFilter, setSourceFilter] = useState<'ALL' | 'AUTO' | 'MANUAL' | 'CONSOLIDATED'>('ALL')
  const [tierFilter, setTierFilter] = useState<'ALL' | 'hot' | 'cold'>('ALL')
  const [keystoneOnly, setKeystoneOnly] = useState(false)
  const [viewedDigest, setViewedDigest] = useState<Memory | null>(null)
  const closeDigest = useCallback(() => setViewedDigest(null), [])

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [editingMemory, setEditingMemory] = useState<Memory | null>(null)
  const [showEditor, setShowEditor] = useState(false)
  const [showMaintenance, setShowMaintenance] = useState(false)

  // One page at a time, replacing what is shown — paged, not an infinite
  // scroller. Every input is in the query key: typing, sorting or filtering
  // makes a new query, so an older search term's slow answer is simply not
  // the query on screen (it had no guard against landing last before).
  const filtersKey = [characterId, sortBy, sortOrder, search, sourceFilter, tierFilter, String(keystoneOnly)].join('\u0000')
  // The page belongs to one filter set; a new one starts at the first page.
  const [pageState, setPageState] = useState({ filtersKey, page: 0 })
  const page = pageState.filtersKey === filtersKey ? pageState.page : 0
  const setPage = (next: number) => setPageState({ filtersKey, page: next })

  const queryClient = useQueryClient()
  const pageQuery = useQuery({
    queryKey: queryKeys.memories.list({ characterId, sortBy, sortOrder, search, sourceFilter, tierFilter, keystoneOnly, page }),
    queryFn: ({ signal }) => {
      const params = new URLSearchParams()
      params.set('characterId', characterId)
      params.set('limit', String(MEMORIES_PER_PAGE))
      params.set('offset', String(page * MEMORIES_PER_PAGE))
      params.set('sortBy', sortBy)
      params.set('sortOrder', sortOrder)
      if (search) params.set('search', search)
      if (sourceFilter !== 'ALL') params.set('source', sourceFilter)
      if (tierFilter !== 'ALL') params.set('tier', tierFilter)
      if (keystoneOnly) params.set('keystone', 'true')
      return apiFetch<{ memories?: Memory[]; totalCount?: number }>(`/api/v1/memories?${params}`, { signal })
    },
    // A page or filter change keeps the current page on screen (dimmed).
    placeholderData: keepPreviousData,
  })
  const memories = pageQuery.data?.memories ?? EMPTY_MEMORIES
  const totalCount = pageQuery.data?.totalCount ?? 0
  const isLoading = pageQuery.isPending
  const loadingPage = pageQuery.isPlaceholderData
  const error = pageQuery.error ? apiErrorMessage(pageQuery.error, 'Failed to fetch memories') : null

  /** Re-read this character's memory pages. */
  const refreshMemories = useCallback(
    () => queryClient.invalidateQueries({ queryKey: queryKeys.memories.lists }),
    [queryClient],
  )

  // The parent's refresh signal (an import, a regeneration) re-reads the list.
  const lastRefreshKey = useRef(refreshKey)
  useEffect(() => {
    if (lastRefreshKey.current === refreshKey) return
    lastRefreshKey.current = refreshKey
    void refreshMemories()
  }, [refreshKey, refreshMemories])

  const goToPage = setPage

  // Debounced search handler
  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value
    setSearch(value)
  }, [])

  const handleDelete = useCallback(async (id: string) => {
    const confirmed = await showConfirmation('Are you sure you want to delete this memory?')
    if (!confirmed) return

    setDeletingId(id)
    try {
      const result = await fetchJson(`/api/v1/memories/${id}`, { method: 'DELETE' })
      if (!result.ok) {
        throw new Error(result.error || 'Failed to delete memory')
      }
      showSuccessToast('Memory deleted')
      // Re-read the page so the next memory fills the gap; step back a page
      // when this emptied the last one.
      const lastPage = Math.max(0, Math.ceil((totalCount - 1) / MEMORIES_PER_PAGE) - 1)
      goToPage(Math.min(page, lastPage))
      await refreshMemories()
    } catch (err) {
      const errorMessage = getErrorMessage(err, 'Failed to delete memory')
      showErrorToast(errorMessage)
    } finally {
      setDeletingId(null)
    }
  }, [goToPage, page, totalCount, refreshMemories])

  const handleViewDigest = useCallback(async (digestId: string) => {
    try {
      const result = await fetchJson<{ memory: Memory }>(`/api/v1/memories/${digestId}`)
      if (!result.ok || !result.data?.memory) {
        throw new Error(result.error || 'The digest could not be found')
      }
      setViewedDigest(result.data.memory)
    } catch (err) {
      showErrorToast(getErrorMessage(err, 'Failed to load the digest'))
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

  const handleEditorSave = () => {
    setShowEditor(false)
    setEditingMemory(null)
    // Back to the first page, re-read
    setPage(0)
    void refreshMemories()
  }

  // A real run is queued and works in the background; re-read the first page
  // so anything it has already finished shows.
  const handleMaintenanceQueued = () => {
    setPage(0)
    void refreshMemories()
  }

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
            onClick={() => setShowMaintenance(true)}
            className="px-3 py-1.5 qt-bg-muted qt-text text-sm rounded-lg qt-hover-accent"
            title="Fold repetitions, consolidate, and keep this character under the cap"
          >
            Maintenance
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 items-center">
        <div className="flex-1 min-w-[200px]">
          <input
            type="text"
            placeholder="Search memories..."
            aria-label="Search memories"
            value={search}
            onChange={handleSearchChange}
            className="qt-input text-sm"
          />
        </div>
        <select
          aria-label="Sort memories by"
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
          className="px-3 py-2 text-sm border qt-border-input qt-bg-default qt-text rounded-lg qt-hover-accent"
          title={sortOrder === 'asc' ? 'Ascending' : 'Descending'}
        >
          {sortOrder === 'asc' ? '↑' : '↓'}
        </button>
        <select
          aria-label="Filter by source"
          value={sourceFilter}
          onChange={(e) => setSourceFilter(e.target.value as 'ALL' | 'AUTO' | 'MANUAL' | 'CONSOLIDATED')}
           className="qt-select w-auto"
        >
          <option value="ALL">All Sources</option>
          <option value="AUTO">Auto-generated</option>
          <option value="MANUAL">Manual</option>
          <option value="CONSOLIDATED">Consolidated (digests)</option>
        </select>
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value as 'ALL' | 'hot' | 'cold')}
          className="qt-select w-auto"
          aria-label="Filter by tier"
        >
          <option value="ALL">All Memories</option>
          <option value="hot">Active</option>
          <option value="cold">Archived</option>
        </select>
        <label className="flex items-center gap-2 cursor-pointer qt-text-xs" title="Show only the standing facts you have set in stone">
          <input
            type="checkbox"
            checked={keystoneOnly}
            onChange={(e) => setKeystoneOnly(e.target.checked)}
            className="qt-checkbox"
          />
          Keystones only
        </label>
      </div>

      {/* Error State */}
      {error && (
        <ErrorAlert message={error} onRetry={() => void pageQuery.refetch()} />
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
        <div
          className={`grid gap-4 sm:grid-cols-1 lg:grid-cols-2 transition-opacity ${loadingPage ? 'opacity-60' : ''}`}
          aria-busy={loadingPage}
        >
          {memories.map((memory) => (
            <MemoryCard
              key={memory.id}
              memory={memory}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onViewDigest={handleViewDigest}
              isDeleting={deletingId === memory.id}
            />
          ))}
        </div>
      )}

      <ListPager
        page={page}
        total={totalCount}
        pageSize={MEMORIES_PER_PAGE}
        onPageChange={goToPage}
        disabled={loadingPage}
        noun="memories"
      />

      {/* Memory Editor Modal */}
      {showEditor && (
        <MemoryEditor
          characterId={characterId}
          memory={editingMemory}
          onClose={handleEditorClose}
          onSave={handleEditorSave}
        />
      )}

      {/* Digest viewer */}
      <BaseModal
        isOpen={viewedDigest !== null}
        onClose={closeDigest}
        title="The Digest"
        subtitle={<>The denser note that took this one&rsquo;s place on the active shelf.</>}
        maxWidth="xl"
       
        bodyClassName="flex-1 overflow-y-auto p-6"
        footerClassName="qt-dialog-footer flex justify-end"
        footer={
          <button type="button" className="qt-button qt-button-secondary" onClick={closeDigest}>
            Close
          </button>
        }
      >
        {viewedDigest && <MemoryCard memory={viewedDigest} />}
      </BaseModal>

      {/* Maintenance Dialog */}
      {showMaintenance && (
        <MaintenanceDialog
          characterId={characterId}
          onClose={() => setShowMaintenance(false)}
          onQueued={handleMaintenanceQueued}
        />
      )}
    </div>
  )
}
