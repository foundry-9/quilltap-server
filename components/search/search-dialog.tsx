'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { Icon } from '@/components/ui/icon'
import { useRouter } from 'next/navigation'
import { BaseModal, ModalTitle } from '@/components/ui/BaseModal'
import { SearchResults } from './search-results'
import { ConversationMatches } from './conversation-matches'
import { CONVERSATION_SEARCH_MIN_QUERY, type ConversationSearchSource } from '@/lib/chat/conversation-search'
import { ALL_SEARCH_TYPES } from './types'
import type { SearchResult, SearchResponse, SearchType } from './types'

type CountsByType = Partial<Record<SearchType, number>>

interface SearchDialogProps {
  isOpen: boolean
  onClose: () => void
  initialQuery?: string
  /** Pre-select specific types when opening the dialog */
  initialTypes?: SearchType[]
  /** The open Salon chat, searched first behind a "This conversation" chip. */
  conversation?: ConversationSearchSource | null
  /** Called with the query when an in-chat match is picked, just before closing. */
  onConversationReveal?: (query: string) => void
}

const ALL_TYPES = ALL_SEARCH_TYPES
const PAGE_SIZE = 20
const CONVERSATION_LIMIT = 50
const EMPTY_COUNTS: CountsByType = {}

export function SearchDialog({ isOpen, onClose, initialQuery = '', initialTypes, conversation, onConversationReveal }: SearchDialogProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const [query, setQuery] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<SearchType[]>(ALL_TYPES)
  // The search on screen: set by the debounce, a filter toggle, Enter or an
  // initial query. It is the query key, so an answer for an earlier term or
  // filter set can never replace a newer one.
  const [submitted, setSubmitted] = useState<{ query: string; types: SearchType[] } | null>(null)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const hasInitializedRef = useRef(false)
  // "This conversation" is a filter of its own beside the global types; it is
  // on by default, and off when the dialog was opened to look at one type.
  const [includeConversation, setIncludeConversation] = useState(true)
  const trimmedQuery = query.trim()
  const conversationResults = useMemo(
    () => (conversation && includeConversation && trimmedQuery.length >= CONVERSATION_SEARCH_MIN_QUERY
      ? conversation.search(trimmedQuery, CONVERSATION_LIMIT)
      : null),
    [conversation, includeConversation, trimmedQuery],
  )

  const submittedQuery = submitted?.query ?? ''
  const submittedTypes = submitted?.types ?? ALL_TYPES
  const hasSearched = submittedQuery.length >= 2
  const searchQuery = useInfiniteQuery({
    queryKey: queryKeys.uiSearch.results(submittedQuery, submittedTypes),
    queryFn: ({ pageParam, signal }) =>
      apiFetch<SearchResponse>(
        `/api/v1/ui/search?q=${encodeURIComponent(submittedQuery)}&types=${submittedTypes.join(',')}&limit=${PAGE_SIZE}&offset=${pageParam}`,
        { signal },
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) =>
      lastPage.hasMore ? pages.reduce((n, page) => n + (page.results?.length ?? 0), 0) : undefined,
    enabled: isOpen && hasSearched,
  })
  // Pages appended in order, de-duplicated by type + id.
  const results = useMemo<SearchResult[]>(() => {
    const seen = new Set<string>()
    const out: SearchResult[] = []
    for (const page of searchQuery.data?.pages ?? []) {
      for (const r of page.results ?? []) {
        const key = `${r.type}-${r.id}`
        if (!seen.has(key)) {
          seen.add(key)
          out.push(r)
        }
      }
    }
    return out
  }, [searchQuery.data])
  const pages = searchQuery.data?.pages
  const lastPage = pages?.[pages.length - 1]
  const countsByType: CountsByType = pages?.[0]?.countsByType ?? EMPTY_COUNTS
  const hasMore = searchQuery.hasNextPage
  const totalCount = lastPage?.totalCount ?? 0
  const isLoading = hasSearched && searchQuery.isPending
  const isLoadingMore = searchQuery.isFetchingNextPage
  useEffect(() => {
    if (searchQuery.error) {
      console.error('Search error', { error: searchQuery.error.message })
    }
  }, [searchQuery.error])

  /** Submit a search now (shorter than two characters clears it). */
  const performSearch = useCallback((q: string, types: SearchType[]) => {
    setSubmitted({ query: q, types })
  }, [])

  // Focus input when dialog opens and handle initial query/types
  useEffect(() => {
    if (isOpen) {
      // Set initial query if provided and this is a fresh open
      if (!hasInitializedRef.current) {
        if (initialQuery) {
          // eslint-disable-next-line react-hooks/set-state-in-effect -- the dialog adopts its opening props (initial query and types) on each open
          setQuery(initialQuery)
        }
        // Set initial types if provided, otherwise reset to all types
        if (initialTypes && initialTypes.length > 0) {
          setSelectedTypes(initialTypes)
          setIncludeConversation(false)
        } else {
          setSelectedTypes(ALL_TYPES)
          setIncludeConversation(true)
        }
        hasInitializedRef.current = true
      }
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      // Reset state when closing
      setQuery('')
      setSubmitted(null)
      setSelectedTypes(ALL_TYPES)
      hasInitializedRef.current = false
    }
  }, [isOpen, initialQuery, initialTypes])

  // Trigger search when dialog opens with initial query
  useEffect(() => {
    if (isOpen && initialQuery && initialQuery.length >= 2 && hasInitializedRef.current && !hasSearched) {
      // Use initialTypes if provided, otherwise use current selectedTypes
      const typesToSearch = (initialTypes && initialTypes.length > 0) ? initialTypes : selectedTypes
      performSearch(initialQuery, typesToSearch)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialQuery, initialTypes, hasSearched])

  // Handle input change with debounce
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value
    setQuery(newQuery)

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Debounce search by 300ms
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(newQuery, selectedTypes)
    }, 300)
  }

  // Handle type filter toggle
  const toggleType = (type: SearchType) => {
    const newTypes = selectedTypes.includes(type)
      ? selectedTypes.filter(t => t !== type)
      : [...selectedTypes, type]

    // Don't allow all types to be deselected
    if (newTypes.length === 0) {
      return
    }

    setSelectedTypes(newTypes)

    // Re-search if we have a query
    if (query.length >= 2) {
      performSearch(query, newTypes)
    }
  }

  // Load more results
  const { fetchNextPage } = searchQuery
  const loadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      void fetchNextPage()
    }
  }, [isLoadingMore, hasMore, fetchNextPage])

  // Infinite scroll handler
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container) return

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container
      // Load more when within 100px of the bottom
      if (scrollHeight - scrollTop - clientHeight < 100) {
        loadMore()
      }
    }

    container.addEventListener('scroll', handleScroll)
    return () => container.removeEventListener('scroll', handleScroll)
  }, [loadMore])

  // Handle result click
  const handleResultClick = () => {
    onClose()
  }

  const handleConversationSelect = (messageId: string) => {
    onConversationReveal?.(trimmedQuery)
    conversation?.reveal(messageId)
    onClose()
  }

  // Handle keyboard navigation for search input
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.length >= 2) {
      // Perform immediate search
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
      performSearch(query, selectedTypes)
    }
  }

  // The palette sits near the top of the screen rather than centred, and
  // keeps its popover surface; the shell supplies portal, focus, Escape and
  // the backdrop (outside click closes).
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      headerless
      maxWidth="2xl"
      overlayClassName="items-start pt-16 px-4 md:px-0"
      className="qt-bg-popover rounded-lg shadow-2xl overflow-hidden border-0"
      bodyClassName="flex flex-col min-h-0"
    >
      <ModalTitle className="sr-only">Search</ModalTitle>

      {/* Search input */}
      <div className="p-4 border-b qt-border-default">
        <div className="relative">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 qt-text-secondary" />
          <input
            ref={inputRef}
            type="text"
            aria-label="Search"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Search chats, characters, messages, documents, tags, memories..."
            className="w-full pl-10 pr-4 py-3 text-lg border-0 bg-transparent text-foreground placeholder-muted-foreground focus:outline-none focus:ring-0"
          />
          {query && (
            <button
              onClick={() => {
                setQuery('')
                if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current)
                setSubmitted(null)
                inputRef.current?.focus()
              }}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 qt-text-secondary hover:text-foreground"
              aria-label="Clear search"
            >
              <Icon name="close" className="w-5 h-5" />
            </button>
          )}
        </div>

        {/* Type filters */}
        <div className="flex flex-wrap gap-2 mt-3">
          {conversation && (
            <button
              type="button"
              onClick={() => setIncludeConversation(v => !v)}
              aria-pressed={includeConversation}
              className={includeConversation ? 'qt-filter-chip-active' : 'qt-filter-chip'}
            >
              This conversation
            </button>
          )}
          {ALL_TYPES.map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => toggleType(type)}
              aria-pressed={selectedTypes.includes(type)}
              className={selectedTypes.includes(type)
                ? 'qt-filter-chip-active'
                : 'qt-filter-chip'
              }
            >
              {type.charAt(0).toUpperCase() + type.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Results */}
      <div ref={scrollContainerRef} className="max-h-[60vh] overflow-y-auto">
        {conversationResults && (
          <>
            <ConversationMatches
              matches={conversationResults.matches}
              total={conversationResults.total}
              query={query}
              onSelect={handleConversationSelect}
            />
            <div className="px-3 pt-2 pb-1 border-t qt-border-default qt-text-xs font-semibold uppercase tracking-wider">
              Everywhere
            </div>
          </>
        )}
        {hasSearched ? (
          <>
            <SearchResults
              results={results}
              query={query}
              isLoading={isLoading}
              onResultClick={handleResultClick}
              countsByType={countsByType}
            />
            {/* Loading more indicator */}
            {isLoadingMore && (
              <div className="p-4 text-center">
                <div className="inline-block w-5 h-5 border-2 qt-border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {/* End of results indicator */}
            {!isLoading && !isLoadingMore && results.length > 0 && !hasMore && (
              <div className="p-3 text-center qt-text-xs qt-text-secondary border-t qt-border-default">
                Showing all {totalCount} results
              </div>
            )}
          </>
        ) : (
          <div className="p-6 text-center qt-text-small">
            <p>Type at least 2 characters to search</p>
            <p className="qt-text-xs mt-1">
              Search across your chats, characters, messages, documents, tags, and memories
            </p>
          </div>
        )}
      </div>

      {/* Footer with keyboard shortcuts */}
      <div className="px-4 py-2 border-t qt-border-default qt-bg-muted qt-text-xs flex justify-between">
        <span>
          <kbd className="px-1.5 py-0.5 qt-bg-accent qt-text-on-accent rounded">↵</kbd> to search
        </span>
        <span>
          <kbd className="px-1.5 py-0.5 qt-bg-accent qt-text-on-accent rounded">Esc</kbd> to close
        </span>
      </div>
    </BaseModal>
  )
}
