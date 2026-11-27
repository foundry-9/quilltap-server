'use client'

/**
 * HelpGuideTab
 *
 * Main orchestrator for the browseable Guide tab in the Help dialog.
 * Three layers: category list, expanded topics, and document reader.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import { useWorkspaceNavigate } from '@/components/workspace/useWorkspaceNavigate'
import { useHelpChat } from '@/components/providers/help-chat-provider'
import { HELP_CATEGORIES, EXCLUDED_DOCUMENTS, getCategoryForUrl } from '@/lib/help-guide/categories'
import { HelpGuideSearch } from './HelpGuideSearch'
import { HelpWelcomeCard } from './HelpWelcomeCard'
import { HelpCategorySection } from './HelpCategorySection'
import { HelpTopicReader } from './HelpTopicReader'

interface DocumentInfo {
  /** Slug, not the database ID — categories and doc links are keyed by slug */
  id: string
  title: string
  url: string
}

interface NavHistoryEntry {
  docId: string
  categoryLabel: string
  scrollTop: number
}

/** Keystroke settling time before the text search hits the server. */
const SEARCH_DEBOUNCE_MS = 200

export function HelpGuideTab() {
  const { currentPageUrl } = useHelpChat()
  // Keep-alive-safe page navigation (opens tab-equivalent routes in place).
  const navigate = useWorkspaceNavigate()

  // Document index and chat count from the API
  const indexQuery = useQuery({
    queryKey: queryKeys.helpDocs.index,
    queryFn: ({ signal }) =>
      apiFetch<{ documents?: Array<{ slug: string; title: string; url: string }> }>('/api/v1/help-docs', { signal }),
  })
  const countQuery = useQuery({
    queryKey: queryKeys.helpDocs.chatCount,
    queryFn: ({ signal }) => apiFetch<{ count?: number | null }>('/api/v1/help-docs?action=chat-count', { signal }),
  })
  const documents = useMemo(() => {
    const docMap = new Map<string, DocumentInfo>()
    for (const doc of indexQuery.data?.documents || []) {
      if (!EXCLUDED_DOCUMENTS.includes(doc.slug)) {
        docMap.set(doc.slug, { id: doc.slug, title: doc.title, url: doc.url })
      }
    }
    return docMap
  }, [indexQuery.data])
  const chatCount = countQuery.data?.count ?? null
  const loading = indexQuery.isPending || countQuery.isPending

  // Navigation state
  const [activeDocId, setActiveDocId] = useState<string | null>(null)
  const [activeCategoryLabel, setActiveCategoryLabel] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  /** The query the text search was last asked, once typing settles. */
  const [settledQuery, setSettledQuery] = useState('')

  // Navigation history for scroll position restoration
  const navHistoryRef = useRef<NavHistoryEntry[]>([])
  const readerScrollRef = useRef<HTMLDivElement>(null)
  const [restoreScrollTop, setRestoreScrollTop] = useState<number | undefined>(undefined)

  // Determine which category to auto-expand
  const contextCategoryId = useMemo(
    () => getCategoryForUrl(currentPageUrl),
    [currentPageUrl]
  )

  // Build category data with resolved document info
  const categories = useMemo(() => {
    return HELP_CATEGORIES.map((cat) => ({
      ...cat,
      resolvedDocs: cat.documents
        .map((docId) => documents.get(docId))
        .filter((d): d is DocumentInfo => d !== undefined),
    }))
  }, [documents])

  // Text-search hits from the server, keyed by slug. Document *content* is not
  // shipped with the index (far too large), so matching against the prose has
  // to happen server-side; the title match below stays client-side so the list
  // narrows on the first keystroke rather than waiting on a round trip.
  useEffect(() => {
    const query = searchQuery.trim()
    if (query.length < 2) return
    const timer = setTimeout(() => setSettledQuery(query), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searchQuery])

  const textSearch = useQuery({
    queryKey: queryKeys.helpDocs.search(settledQuery),
    queryFn: ({ signal }) =>
      apiFetch<{ matches?: Array<{ slug: string; snippet?: string | null }> }>(
        `/api/v1/help-docs?action=search&q=${encodeURIComponent(settledQuery)}`,
        { signal },
      ),
    enabled: settledQuery.length >= 2,
  })
  /**
   * Text-search hits, tagged with the query that produced them, so stale
   * results from a previous query never leak into the current filter. A
   * failed search leaves the title-only filter in place.
   */
  const contentMatches = useMemo(() => {
    if (!textSearch.data) return null
    const bySlug = new Map<string, string | null>()
    for (const match of textSearch.data.matches || []) {
      bySlug.set(match.slug, match.snippet ?? null)
    }
    return { query: settledQuery, bySlug }
  }, [textSearch.data, settledQuery])

  /** Text hits for the query currently in the box, or null if they're stale. */
  const currentTextHits = useMemo(
    () => (contentMatches?.query === searchQuery.trim() ? contentMatches.bySlug : null),
    [contentMatches, searchQuery]
  )

  // Filter categories by search query — title match, plus any document whose
  // text the server matched.
  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return categories
    const query = searchQuery.toLowerCase()
    return categories
      .map((cat) => ({
        ...cat,
        resolvedDocs: cat.resolvedDocs.filter((doc) =>
          doc.title.toLowerCase().includes(query) || currentTextHits?.has(doc.id)
        ),
      }))
      .filter((cat) => cat.resolvedDocs.length > 0)
  }, [categories, searchQuery, currentTextHits])

  const handleSelectTopic = useCallback((docId: string, categoryLabel: string) => {
    navHistoryRef.current = []
    setRestoreScrollTop(undefined)
    setActiveDocId(docId)
    setActiveCategoryLabel(categoryLabel)
  }, [])

  const handleBack = useCallback(() => {
    const entry = navHistoryRef.current.pop()
    if (entry) {
      // Go back to previous document and restore its scroll position
      setRestoreScrollTop(entry.scrollTop)
      setActiveDocId(entry.docId)
      setActiveCategoryLabel(entry.categoryLabel)
    } else {
      // No history — go back to category list
      setRestoreScrollTop(undefined)
      setActiveDocId(null)
      setActiveCategoryLabel('')
    }
  }, [])

  const handleNavigateDoc = useCallback((docId: string) => {
    // Push current document onto history stack before navigating
    if (activeDocId) {
      navHistoryRef.current.push({
        docId: activeDocId,
        categoryLabel: activeCategoryLabel,
        scrollTop: readerScrollRef.current?.scrollTop ?? 0,
      })
    }
    const cat = HELP_CATEGORIES.find((c) => c.documents.includes(docId))
    setRestoreScrollTop(undefined)
    setActiveDocId(docId)
    setActiveCategoryLabel(cat?.label || '')
  }, [activeDocId, activeCategoryLabel])

  const handleNavigatePage = useCallback((url: string) => {
    navigate(url)
  }, [navigate])

  const handleOpenWelcomeDoc = useCallback((docId: string) => {
    const cat = HELP_CATEGORIES.find((c) => c.documents.includes(docId))
    setActiveDocId(docId)
    setActiveCategoryLabel(cat?.label || '')
  }, [])

  // Both views wrapped in Art Deco scoping class
  return (
    <div className="qt-help-guide-deco flex flex-col h-full">
      {activeDocId ? (
        <HelpTopicReader
          documentId={activeDocId}
          categoryLabel={activeCategoryLabel}
          scrollContainerRef={readerScrollRef}
          restoreScrollTop={restoreScrollTop}
          onBack={handleBack}
          onNavigateDoc={handleNavigateDoc}
          onNavigatePage={handleNavigatePage}
        />
      ) : (
        <>
          <div className="flex-shrink-0 p-3 pb-0">
            <HelpGuideSearch value={searchQuery} onChange={setSearchQuery} />
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {loading ? (
              <div className="qt-loading-state" style={{ color: 'var(--deco-fg-muted)' }}>
                Loading guide...
              </div>
            ) : (
              <>
                {chatCount !== null && chatCount < 3 && !searchQuery && (
                  <HelpWelcomeCard onOpenDocument={handleOpenWelcomeDoc} />
                )}

                {filteredCategories.map((cat) => (
                  <HelpCategorySection
                    key={cat.id}
                    label={cat.label}
                    documents={cat.resolvedDocs}
                    currentPageUrl={currentPageUrl}
                    defaultExpanded={cat.id === contextCategoryId && !searchQuery}
                    forceExpanded={!!searchQuery}
                    snippets={currentTextHits}
                    onSelectTopic={(docId) => handleSelectTopic(docId, cat.label)}
                  />
                ))}

                {filteredCategories.length === 0 && searchQuery && (
                  <div className="text-center py-6" style={{ color: 'var(--deco-fg-muted)' }}>
                    No topics match &ldquo;{searchQuery}&rdquo;
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
