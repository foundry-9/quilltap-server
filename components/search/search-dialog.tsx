'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { clientLogger } from '@/lib/client-logger'
import { SearchResults } from './search-results'
import type { SearchResult, SearchResponse, SearchType } from './types'

interface SearchDialogProps {
  isOpen: boolean
  onClose: () => void
}

const ALL_TYPES: SearchType[] = ['chats', 'characters', 'personas', 'tags', 'memories']

export function SearchDialog({ isOpen, onClose }: SearchDialogProps) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedTypes, setSelectedTypes] = useState<SearchType[]>(ALL_TYPES)
  const [hasSearched, setHasSearched] = useState(false)
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen) {
      clientLogger.debug('Search dialog opened')
      setTimeout(() => inputRef.current?.focus(), 100)
    } else {
      // Reset state when closing
      setQuery('')
      setResults([])
      setHasSearched(false)
    }
  }, [isOpen])

  // Handle escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        clientLogger.debug('Search dialog closed via Escape')
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  // Debounced search
  const performSearch = useCallback(async (searchQuery: string, types: SearchType[]) => {
    if (searchQuery.length < 2) {
      setResults([])
      setHasSearched(false)
      return
    }

    setIsLoading(true)
    setHasSearched(true)
    clientLogger.debug('Performing search', { query: searchQuery, types })

    try {
      const typesParam = types.join(',')
      const response = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&types=${typesParam}&limit=30`)

      if (!response.ok) {
        throw new Error(`Search failed: ${response.status}`)
      }

      const data: SearchResponse = await response.json()
      clientLogger.debug('Search completed', { query: searchQuery, resultCount: data.results.length })
      setResults(data.results)
    } catch (error) {
      clientLogger.error('Search error', { error: error instanceof Error ? error.message : String(error) })
      setResults([])
    } finally {
      setIsLoading(false)
    }
  }, [])

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
    clientLogger.debug('Search type filter changed', { types: newTypes })

    // Re-search if we have a query
    if (query.length >= 2) {
      performSearch(query, newTypes)
    }
  }

  // Handle result click
  const handleResultClick = () => {
    clientLogger.debug('Search result selected, closing dialog')
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

  if (!isOpen) return null

  return (
    <>
      {/* Backdrop */}
      <button
        className="fixed inset-0 bg-black bg-opacity-50 z-[100] cursor-default"
        onClick={onClose}
        aria-label="Close search"
        type="button"
      />

      {/* Dialog */}
      <div className="fixed inset-x-4 top-16 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-2xl z-[101]">
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-2xl overflow-hidden">
          {/* Search input */}
          <div className="p-4 border-b border-gray-200 dark:border-slate-700">
            <div className="relative">
              <svg
                className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400"
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
                placeholder="Search chats, characters, personas, tags, memories..."
                className="w-full pl-10 pr-4 py-3 text-lg border-0 bg-transparent text-gray-900 dark:text-white placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-0"
              />
              {query && (
                <button
                  onClick={() => {
                    setQuery('')
                    setResults([])
                    setHasSearched(false)
                    inputRef.current?.focus()
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
                  aria-label="Clear search"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Type filters */}
            <div className="flex flex-wrap gap-2 mt-3">
              {ALL_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`px-2 py-1 text-xs rounded-full transition-colors ${
                    selectedTypes.includes(type)
                      ? 'bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300'
                      : 'bg-gray-100 dark:bg-slate-700 text-gray-500 dark:text-gray-400'
                  }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* Results */}
          <div className="max-h-[60vh] overflow-y-auto">
            {hasSearched ? (
              <SearchResults
                results={results}
                query={query}
                isLoading={isLoading}
                onResultClick={handleResultClick}
              />
            ) : (
              <div className="p-6 text-center text-gray-500 dark:text-gray-400">
                <p>Type at least 2 characters to search</p>
                <p className="text-sm mt-1">
                  Search across your chats, characters, personas, tags, and memories
                </p>
              </div>
            )}
          </div>

          {/* Footer with keyboard shortcuts */}
          <div className="px-4 py-2 border-t border-gray-200 dark:border-slate-700 bg-gray-50 dark:bg-slate-900 text-xs text-gray-500 dark:text-gray-400 flex justify-between">
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-slate-700 rounded">↵</kbd> to search
            </span>
            <span>
              <kbd className="px-1.5 py-0.5 bg-gray-200 dark:bg-slate-700 rounded">Esc</kbd> to close
            </span>
          </div>
        </div>
      </div>
    </>
  )
}
