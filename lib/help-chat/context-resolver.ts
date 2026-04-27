/**
 * Help Chat Context Resolver
 *
 * Resolves the current page URL to the best matching help documentation.
 * Uses a tiered matching strategy: exact -> query params -> pattern -> prefix -> wildcard -> fallback.
 */

import { getHelpSearch } from '@/lib/help-search'
import { logger } from '@/lib/logger'

const helpChatLogger = logger.child({ context: 'HelpChat' })

export interface HelpPageContext {
  title: string
  content: string
  url: string
  matchType: 'exact' | 'query' | 'pattern' | 'prefix' | 'wildcard' | 'fallback'
}

/**
 * Resolve the best matching help content for a given page URL
 */
export async function resolveHelpContentForUrl(url: string): Promise<HelpPageContext | null> {
  const helpSearch = getHelpSearch()

  if (!helpSearch.isLoaded()) {
    helpChatLogger.debug('Help docs not loaded, attempting to load from database', { url })
    try {
      await helpSearch.loadFromDatabase()
    } catch (error) {
      helpChatLogger.error('Failed to load help docs from database', { error: error instanceof Error ? error.message : String(error) })
      return null
    }
  }

  const documents = await helpSearch.listDocuments()
  if (documents.length === 0) {
    helpChatLogger.warn('No help documents available')
    return null
  }

  helpChatLogger.debug('Resolving help content for URL', { url, documentCount: documents.length })

  // Parse the incoming URL
  const [urlPath, urlQuery] = url.split('?')
  const urlParams = new URLSearchParams(urlQuery || '')

  // Strategy 1: Exact match (path + query params)
  if (urlQuery) {
    const exactMatch = documents.find(doc => doc.url === url)
    if (exactMatch) {
      return buildContext(exactMatch.id, 'exact')
    }
  }

  // Strategy 2: Exact path match (ignoring query)
  const pathMatch = documents.find(doc => {
    const [docPath] = doc.url.split('?')
    return docPath === urlPath && !doc.url.includes(':')
  })
  if (pathMatch) {
    // If there are query param matches too, prefer the most specific
    if (urlQuery) {
      const queryMatches = documents.filter(doc => {
        const [docPath, docQuery] = doc.url.split('?')
        if (docPath !== urlPath || !docQuery) return false
        const docParams = new URLSearchParams(docQuery)
        // Check if all doc params match URL params
        for (const [key, value] of docParams.entries()) {
          if (urlParams.get(key) !== value) return false
        }
        return true
      })

      if (queryMatches.length > 0) {
        // Pick the match with the most query params (most specific)
        const bestQuery = queryMatches.sort((a, b) => {
          const aParams = new URLSearchParams(a.url.split('?')[1] || '')
          const bParams = new URLSearchParams(b.url.split('?')[1] || '')
          return [...bParams.entries()].length - [...aParams.entries()].length
        })[0]
        return buildContext(bestQuery.id, 'query')
      }
    }
    return buildContext(pathMatch.id, 'exact')
  }

  // Strategy 3: Pattern match (e.g., /aurora/:id/edit matches /aurora/abc-123/edit)
  const patternMatches = documents.filter(doc => {
    if (!doc.url.includes(':')) return false
    const [docPath] = doc.url.split('?')
    return matchUrlPattern(docPath, urlPath)
  })
  if (patternMatches.length > 0) {
    // Pick most specific pattern (most segments)
    const bestPattern = patternMatches.sort((a, b) => {
      return b.url.split('/').length - a.url.split('/').length
    })[0]
    return buildContext(bestPattern.id, 'pattern')
  }

  // Strategy 4: Prefix match (e.g., /settings matches /settings/something)
  const prefixMatches = documents.filter(doc => {
    const [docPath] = doc.url.split('?')
    return docPath !== '*' && urlPath.startsWith(docPath + '/')
  })
  if (prefixMatches.length > 0) {
    // Pick longest prefix (most specific)
    const bestPrefix = prefixMatches.sort((a, b) => b.url.length - a.url.length)[0]
    return buildContext(bestPrefix.id, 'prefix')
  }

  // Strategy 5: Wildcard match (url: '*')
  const wildcardDocs = documents.filter(doc => doc.url === '*')
  if (wildcardDocs.length > 0) {
    return buildContext(wildcardDocs[0].id, 'wildcard')
  }

  // Strategy 6: Fallback to homepage
  const homepageDoc = documents.find(doc => doc.url === '/')
  if (homepageDoc) {
    return buildContext(homepageDoc.id, 'fallback')
  }

  helpChatLogger.warn('No help content found for URL', { url })
  return null
}

/**
 * Match a URL pattern with :param placeholders against an actual URL path
 */
export function matchUrlPattern(pattern: string, actualPath: string): boolean {
  const patternParts = pattern.split('/')
  const actualParts = actualPath.split('/')

  if (patternParts.length !== actualParts.length) return false

  return patternParts.every((part, i) => {
    if (part.startsWith(':')) return true // :param matches anything
    return part === actualParts[i]
  })
}

/**
 * Build a HelpPageContext from a document ID
 */
async function buildContext(documentId: string, matchType: HelpPageContext['matchType']): Promise<HelpPageContext | null> {
  const helpSearch = getHelpSearch()
  const doc = await helpSearch.getDocument(documentId)

  if (!doc) {
    helpChatLogger.warn('Document not found after matching', { documentId, matchType })
    return null
  }

  helpChatLogger.debug('Resolved help content', {
    documentId,
    matchType,
    title: doc.title,
    url: doc.url,
    contentLength: doc.content.length,
  })

  return {
    title: doc.title,
    content: doc.content,
    url: doc.url,
    matchType,
  }
}

/**
 * Resolve multiple help documents for a URL (includes wildcard matches)
 * Used when we want both the page-specific doc and universal docs (like sidebar)
 */
export async function resolveAllHelpContentForUrl(url: string): Promise<HelpPageContext[]> {
  const results: HelpPageContext[] = []

  // Get the primary match
  const primary = await resolveHelpContentForUrl(url)
  if (primary) {
    results.push(primary)
  }

  // Also include wildcard documents that apply everywhere
  const helpSearch = getHelpSearch()
  if (helpSearch.isLoaded()) {
    const documents = await helpSearch.listDocuments()
    const wildcardDocs = documents.filter(doc => doc.url === '*')

    for (const doc of wildcardDocs) {
      // Don't add if it's already the primary match
      if (primary && doc.id === primary.url) continue
      const ctx = await buildContext(doc.id, 'wildcard')
      if (ctx) {
        results.push(ctx)
      }
    }
  }

  return results
}
