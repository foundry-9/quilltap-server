'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { Icon } from '@/components/ui/icon'
import { useRouter } from 'next/navigation'
import { useClickOutside } from '@/hooks/useClickOutside'
import { SearchResults } from './search-results'
import { SearchDialog } from './search-dialog'
import { ConversationMatches } from './conversation-matches'
import { usePageToolbarOptional } from '@/components/providers/page-toolbar-provider'
import { CONVERSATION_SEARCH_MIN_QUERY } from '@/lib/chat/conversation-search'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { isMacPlatform } from '@/lib/utils/platform'
import type { SearchResult, SearchResponse, SearchType } from './types'

const INLINE_LIMIT = 20
const NO_RESULTS: SearchResult[] = []
const NO_COUNTS: Partial<Record<SearchType, number>> = {}

export function SearchBar() {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Desktop inline search state
  const [query, setQuery] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  // The search on screen, set by the debounce, Enter or focus. It is the query
  // key, so an answer for an earlier term can never replace a newer one.
  const [submittedQuery, setSubmittedQuery] = useState('')
  const hasSearched = submittedQuery.length >= 2
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Mobile dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [dialogInitialQuery, setDialogInitialQuery] = useState('')
  const [dialogInitialTypes, setDialogInitialTypes] = useState<SearchType[] | undefined>(undefined)

  // The open Salon chat, when there is one: searched first, and painted with
  // the query for as long as it stays in the box.
  const conversation = usePageToolbarOptional()?.conversationSearch ?? null
  const trimmedQuery = query.trim()
  const conversationResults = useMemo(
    () => (conversation && trimmedQuery.length >= CONVERSATION_SEARCH_MIN_QUERY
      ? conversation.search(trimmedQuery, 5)
      : null),
    [conversation, trimmedQuery],
  )
  useEffect(() => {
    if (!conversation) return
    conversation.setHighlight(trimmedQuery.length >= CONVERSATION_SEARCH_MIN_QUERY ? trimmedQuery : null)
    return () => conversation.setHighlight(null)
  }, [conversation, trimmedQuery])

  // Global keyboard shortcut (Cmd+K on macOS, Ctrl+K on Windows/Linux)
  // On macOS, Ctrl+K is "delete to end of line" and should not be intercepted
  useEffect(() => {
    const isMac = isMacPlatform()

    const handleKeyDown = (e: KeyboardEvent) => {
      // On macOS: only respond to Cmd+K (metaKey)
      // On other platforms: only respond to Ctrl+K (ctrlKey)
      const isShortcutPressed = isMac ? (e.metaKey && !e.ctrlKey) : (e.ctrlKey && !e.metaKey)

      if (isShortcutPressed && e.key === 'k') {
        e.preventDefault()
        // On desktop, focus the input
        // On mobile, open the dialog
        if (window.innerWidth >= 768) {
          inputRef.current?.focus()
          setShowDropdown(true)
        } else {
          setIsDialogOpen(true)
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  // Close dropdown when clicking outside
  useClickOutside(containerRef, () => setShowDropdown(false))

  const searchQuery = useQuery({
    queryKey: queryKeys.uiSearch.inline(submittedQuery),
    queryFn: ({ signal }) =>
      apiFetch<SearchResponse>(
        `/api/v1/ui/search?q=${encodeURIComponent(submittedQuery)}&limit=${INLINE_LIMIT}`,
        { signal },
      ),
    enabled: hasSearched,
    // The last answer stays up while the next term's is fetched, as it did.
    placeholderData: keepPreviousData,
  })
  // With no term submitted the kept-previous answer is not this search's.
  const results = hasSearched ? (searchQuery.data?.results ?? NO_RESULTS) : NO_RESULTS
  const countsByType = hasSearched ? (searchQuery.data?.countsByType ?? NO_COUNTS) : NO_COUNTS
  const isLoading = hasSearched && searchQuery.isFetching
  useEffect(() => {
    if (searchQuery.error) {
      console.error('Inline search error', { error: searchQuery.error.message })
    }
  }, [searchQuery.error])

  // A search for the term already on screen is asked again, not read from cache.
  const { refetch } = searchQuery
  const performSearch = useCallback((nextQuery: string) => {
    if (nextQuery.length < 2) {
      setSubmittedQuery('')
      return
    }
    if (nextQuery === submittedQuery) {
      void refetch()
      return
    }
    setSubmittedQuery(nextQuery)
  }, [submittedQuery, refetch])

  // Handle input change with debounce
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newQuery = e.target.value
    setQuery(newQuery)
    setShowDropdown(true)

    // Clear existing timeout
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }

    // Debounce search by 300ms
    searchTimeoutRef.current = setTimeout(() => {
      performSearch(newQuery)
    }, 300)
  }

  const clearQuery = () => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current)
    }
    setQuery('')
    setSubmittedQuery('')
  }

  // Handle result click
  const handleResultClick = () => {
    setShowDropdown(false)
    clearQuery()
  }

  // A match in the open chat: scroll to it, and keep the query (and so the
  // highlight) in place so the next match is one click away.
  const handleConversationSelect = (messageId: string) => {
    conversation?.reveal(messageId)
    setShowDropdown(false)
  }

  // Handle clicking on a type count to open dialog filtered to that type
  const handleTypeCountClick = (type: SearchType) => {
    setDialogInitialQuery(query)
    setDialogInitialTypes([type])
    setIsDialogOpen(true)
    setShowDropdown(false)
  }

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.length >= 2) {
      // Perform immediate search
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current)
      }
      performSearch(query)
    } else if (e.key === 'Escape') {
      // First Escape closes the results; a second clears the query and with
      // it the highlight in the conversation.
      if (showDropdown) {
        setShowDropdown(false)
      } else if (query) {
        clearQuery()
      } else {
        inputRef.current?.blur()
      }
    }
  }

  // Handle focus
  const handleFocus = () => {
    setShowDropdown(true)
    if (query.length >= 2) {
      performSearch(query)
    }
  }

  return (
    <>
      {/* Desktop inline search - hidden on mobile */}
      <div ref={containerRef} className="relative hidden md:block">
        <div className="relative">
          <Icon name="search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 qt-text-secondary" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            placeholder={conversation ? 'Search this chat & all… (⌘K)' : 'Search... (⌘K)'}
            aria-label="Search"
            className="qt-input w-48 lg:w-64 pl-9 pr-8 py-1.5 focus:border-transparent transition-all"
          />
          {query && (
            <button
              type="button"
              onClick={() => {
                clearQuery()
                inputRef.current?.focus()
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 qt-text-secondary hover:qt-text"
              aria-label="Clear search"
            >
              <Icon name="close" className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Dropdown results */}
        {showDropdown && (query.length >= 2 || hasSearched) && (
          <div className="absolute top-full left-0 mt-2 w-96 qt-bg-popover rounded-lg qt-shadow-lg border qt-border-default overflow-hidden z-50">
            <div className="max-h-96 overflow-y-auto">
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
                <SearchResults
                  results={results}
                  query={query}
                  isLoading={isLoading}
                  onResultClick={handleResultClick}
                  countsByType={countsByType}
                  onTypeCountClick={handleTypeCountClick}
                />
              ) : (
                <div className="p-4 text-center qt-text-small">
                  Type at least 2 characters to search
                </div>
              )}
            </div>
            {results?.length > 0 && (
              <div className="px-3 py-2 border-t qt-border-default qt-bg-muted">
                <button
                  onClick={() => {
                    setDialogInitialQuery(query)
                    setDialogInitialTypes(undefined) // Show all types
                    setIsDialogOpen(true)
                    setShowDropdown(false)
                  }}
                  className="text-xs qt-text-brand hover:underline"
                >
                  See all results →
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Mobile search button - hidden on desktop */}
      <button
        onClick={() => {
          // A fresh search: drop any query a previous in-chat pick left
          // painted on the conversation.
          clearQuery()
          setDialogInitialQuery('')
          setIsDialogOpen(true)
        }}
        className="md:hidden p-2 qt-text-secondary qt-hover-accent rounded-md transition-colors"
        aria-label="Search"
      >
        <Icon name="search" className="w-5 h-5" />
      </button>

      {/* Search dialog for mobile and "see all results" */}
      <SearchDialog
        isOpen={isDialogOpen}
        onClose={() => {
          setIsDialogOpen(false)
          setDialogInitialQuery('')
          setDialogInitialTypes(undefined)
        }}
        initialQuery={dialogInitialQuery}
        initialTypes={dialogInitialTypes}
        conversation={conversation}
        onConversationReveal={(revealedQuery) => {
          // Carry the dialog's query back to the bar so the highlight it
          // paints outlives the dialog.
          setQuery(revealedQuery)
          setShowDropdown(false)
        }}
      />
    </>
  )
}
