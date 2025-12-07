'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { clientLogger } from '@/lib/client-logger'
import { SearchResults } from './search-results'
import { SearchDialog } from './search-dialog'
import type { SearchResult, SearchResponse, SearchType } from './types'

const ALL_TYPES: SearchType[] = ['chats', 'characters', 'personas', 'tags', 'memories']

export function SearchBar() {
  const router = useRouter()
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Desktop inline search state
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [showDropdown, setShowDropdown] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Mobile dialog state
  const [isDialogOpen, setIsDialogOpen] = useState(false)

  // Global keyboard shortcut (Cmd/Ctrl + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        clientLogger.debug('Search shortcut triggered (Cmd/Ctrl+K)')
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
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Debounced search
  const performSearch = useCallback(async (searchQuery: string) => {
    if (searchQuery.length < 2) {
      setResults([])
      setHasSearched(false)
      return
    }

    setIsLoading(true)
    setHasSearched(true)
    clientLogger.debug('Performing inline search', { query: searchQuery })

    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&limit=20`)

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`)
      }

      const data: SearchResponse = await response.json()
      clientLogger.debug('Inline search completed', { query: searchQuery, resultCount: data.results.length })
      setResults(data.results)
    } catch (error) {
      clientLogger.error('Inline search error', { error: error instanceof Error ? error.message : String(error) })
      setResults([])
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
    clientLogger.debug('Search result selected from inline search')
    setShowDropdown(false)
    setQuery('')
    setResults([])
    setHasSearched(false)
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
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400"
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
            className="w-48 lg:w-64 pl-9 pr-3 py-1.5 text-sm border border-gray-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 dark:focus:ring-indigo-400 focus:border-transparent transition-all"
          />
        </div>

        {/* Dropdown results */}
        {showDropdown && (query.length >= 2 || hasSearched) && (
          <div className="absolute top-full left-0 mt-2 w-96 bg-white dark:bg-slate-800 rounded-lg shadow-xl border border-gray-200 dark:border-slate-700 overflow-hidden z-50">
            <div className="max-h-96 overflow-y-auto">
              {hasSearched ? (
                <SearchResults
                  results={results}
                  query={query}
                  isLoading={isLoading}
                  onResultClick={handleResultClick}
                />
              ) : (
                <div className="p-4 text-center text-gray-500 dark:text-gray-400 text-sm">
                  Type at least 2 characters to search
                </div>
              )}
            </div>
            {results.length > 0 && (
              <div className="px-3 py-2 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900">
                <button
                  onClick={() => {
                    setIsDialogOpen(true)
                    setShowDropdown(false)
                  }}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
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
          clientLogger.debug('Mobile search button clicked')
          setIsDialogOpen(true)
        }}
        className="md:hidden p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-md transition-colors"
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
      <SearchDialog isOpen={isDialogOpen} onClose={() => setIsDialogOpen(false)} />
    </>
  )
}
