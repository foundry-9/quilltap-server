'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useClickOutside } from '@/hooks/useClickOutside'
import { SearchResults } from './search-results'
import { SearchDialog } from './search-dialog'
import type { SearchResult, SearchResponse, SearchType } from './types'

const ALL_TYPES: SearchType[] = ['chats', 'characters', 'messages', 'tags', 'memories']

export function SearchBar() {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Desktop inline search state
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [countsByType, setCountsByType] = useState<Partial<Record<SearchType, number>>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Mobile dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [dialogInitialQuery, setDialogInitialQuery] = useState('')
  const [dialogInitialTypes, setDialogInitialTypes] = useState<SearchType[] | undefined>(undefined)

  // Global keyboard shortcut (Cmd+K on macOS, Ctrl+K on Windows/Linux)
  // On macOS, Ctrl+K is "delete to end of line" and should not be intercepted
  useEffect(() => {
    const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().indexOf('MAC') >= 0

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

  // Debounced search
  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([])
      setCountsByType({})
      setHasSearched(false)
      return
    }

    setIsLoading(true)
    setHasSearched(true)

    try {
      const response = await fetch(`/api/v1/ui/search?q=${encodeURIComponent(searchQuery)}&limit=20`)

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`)
      }

      const data: SearchResponse = await response.json()
      setResults(data.results ?? [])
      setCountsByType(data.countsByType ?? {})
    } catch (error) {
      console.error('Inline search error', { error: error instanceof Error ? error.message : String(error) })
      setResults([])
      setCountsByType({})
    } finally {
      setIsLoading(false)
    }
  }, [])

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

  // Handle result click
  const handleResultClick = () => {
    setShowDropdown(false)
    setQuery('')
    setResults([])
    setCountsByType({})
    setHasSearched(false)
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
      setShowDropdown(false)
      inputRef.current?.blur()
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
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            onFocus={handleFocus}
            placeholder="Search... (⌘K)"
            className="w-48 lg:w-64 pl-9 pr-3 py-1.5 text-sm border border-input rounded-md bg-background text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent transition-all"
          />
        </div>

        {/* Dropdown results */}
        {showDropdown && (query.length >= 2 || hasSearched) && (
          <div className="absolute top-full left-0 mt-2 w-96 bg-background rounded-lg qt-shadow-lg border border-border overflow-hidden z-50">
            <div className="max-h-96 overflow-y-auto">
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
              <div className="px-3 py-2 border-t border-border bg-muted">
                <button
                  onClick={() => {
                    setDialogInitialQuery(query)
                    setDialogInitialTypes(undefined) // Show all types
                    setIsDialogOpen(true)
                    setShowDropdown(false)
                  }}
                  className="text-xs text-primary hover:underline"
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
          setDialogInitialQuery('')
          setIsDialogOpen(true)
        }}
        className="md:hidden p-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
        aria-label="Search"
      >
        <svg
          className="w-5 h-5"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
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
      />
    </>
  )
}
