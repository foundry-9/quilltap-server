/**
 * Compression Cache Service
 * Async Pre-Compression Feature
 *
 * Manages cached compression results to avoid blocking message sends.
 * After an LLM response is received, compression is triggered asynchronously
 * and cached for the next message. When the next message is sent:
 * - If compression is ready in memory, use it immediately
 * - If compression is in-flight, wait for it
 * - If no in-memory cache, try to load from database
 * - If no database cache, fall back to synchronous compression
 *
 * Cache is persisted to the database so it survives server restarts.
 */

import { logger } from '@/lib/logger'
import {
  ContextCompressionResult,
  ContextCompressionOptions,
  applyContextCompression,
  CompressibleMessage,
} from '@/lib/chat/context/compression'

/**
 * Persisted cache entry stored in database
 * Excludes promises since they can't be serialized
 */
export interface PersistedCompressionCache {
  /** The compression result */
  result: ContextCompressionResult
  /** Message count when compression was computed */
  messageCount: number
  /** Timestamp when the cache was created */
  createdAt: number
  /** System prompt hash to detect changes */
  systemPromptHash: string
}

/**
 * In-memory cache entry (includes promise for in-flight compression)
 */
interface CompressionCacheEntry {
  /** The compression result (if completed) */
  result?: ContextCompressionResult
  /** Promise for in-flight compression */
  promise?: Promise<ContextCompressionResult>
  /** Message count when compression was computed */
  messageCount: number
  /** Timestamp when the cache was created */
  createdAt: number
  /** System prompt hash to detect changes */
  systemPromptHash: string
}

/**
 * Options for triggering async pre-compression
 */
export interface AsyncCompressionOptions {
  chatId: string
  messages: CompressibleMessage[]
  systemPrompt: string
  compressionOptions: ContextCompressionOptions
}

// In-memory cache for compression results (fast path)
// Key: chatId, Value: CompressionCacheEntry
const compressionCache = new Map<string, CompressionCacheEntry>()

/**
 * Simple hash function for system prompt change detection
 */
export function hashString(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash.toString(16)
}

/**
 * Check if a cache entry is valid for the current context
 * No TTL - cache is only invalidated by system prompt change or if too stale
 *
 * The cached compression summarizes messages UP TO a certain point. If new messages
 * were added since caching, the compression is still valid - those new messages
 * will be included in the "window" (recent messages sent verbatim). The cached
 * history summary covers the OLD messages accurately.
 *
 * We invalidate if:
 * - System prompt changed (character settings, etc.)
 * - Cache is way too old (more than 50 messages behind - would mean a very small summary)
 * - Cache has MORE messages than current (data was deleted)
 */
function isCacheValid(
  entry: { messageCount: number; systemPromptHash: string },
  currentMessageCount: number,
  currentSystemPromptHash?: string
): boolean {
  // Check if system prompt changed (only if hash provided)
  // This is the primary validation - character/settings changes invalidate cache
  if (currentSystemPromptHash && entry.systemPromptHash !== currentSystemPromptHash) {
    return false
  }

  // Cache must have been computed with fewer or equal messages
  // If cache has MORE messages, data was deleted and cache is invalid
  if (entry.messageCount > currentMessageCount) {
    return false
  }

  // Allow cache to be up to 50 messages behind
  // Beyond that, the compressed history would be too small relative to current context
  const messageDiff = currentMessageCount - entry.messageCount
  if (messageDiff > 50) {
    return false
  }

  return true
}

/**
 * Save compression result to database
 * Fire and forget - errors are logged but don't block
 */
async function persistToDatabase(chatId: string, entry: PersistedCompressionCache): Promise<void> {
  try {
    // Dynamic import to avoid circular dependencies
    const { getRepositories } = await import('@/lib/database/repositories')
    const repos = await getRepositories()

    await repos.chats.update(chatId, {
      compressionCache: entry as unknown as Record<string, unknown>,
    })
  } catch (error) {
    logger.error('[CompressionCache] Failed to persist to database', {
      chatId,
    }, error instanceof Error ? error : undefined)
    // Don't throw - persistence failure shouldn't break the flow
  }
}

/**
 * Load compression result from database
 */
async function loadFromDatabase(chatId: string): Promise<PersistedCompressionCache | null> {
  try {
    // Dynamic import to avoid circular dependencies
    const { getRepositories } = await import('@/lib/database/repositories')
    const repos = await getRepositories()

    const chat = await repos.chats.findById(chatId)
    if (!chat?.compressionCache) {
      return null
    }

    // Validate the structure
    const cache = chat.compressionCache as unknown as PersistedCompressionCache
    if (!cache.result || typeof cache.messageCount !== 'number' || !cache.systemPromptHash) {
      return null
    }

    return cache
  } catch (error) {
    logger.error('[CompressionCache] Failed to load from database', {
      chatId,
    }, error instanceof Error ? error : undefined)
    return null
  }
}

/**
 * Clear compression cache from database
 */
async function clearFromDatabase(chatId: string): Promise<void> {
  try {
    // Dynamic import to avoid circular dependencies
    const { getRepositories } = await import('@/lib/database/repositories')
    const repos = await getRepositories()

    await repos.chats.update(chatId, {
      compressionCache: null,
    })
  } catch (error) {
    logger.error('[CompressionCache] Failed to clear from database', {
      chatId,
    }, error instanceof Error ? error : undefined)
  }
}

/**
 * Trigger async pre-compression for the next message
 * Called after an LLM response is received and saved
 */
export function triggerAsyncCompression(options: AsyncCompressionOptions): void {
  const { chatId, messages, systemPrompt, compressionOptions } = options

  // Don't pre-compress if there aren't enough messages
  if (messages.length <= compressionOptions.windowSize) {
    return
  }

  const systemPromptHash = hashString(systemPrompt)

  // Check if we already have a valid cache entry
  const existingEntry = compressionCache.get(chatId)
  if (existingEntry && isCacheValid(existingEntry, messages.length, systemPromptHash)) {
    // Even if cache structure is valid, re-compress when enough new messages
    // have accumulated. Without this, the "dynamic window" grows unbounded
    // (effective window = windowSize + messagesSinceCache), defeating compression.
    const messagesSinceCache = messages.length - existingEntry.messageCount
    if (messagesSinceCache < compressionOptions.windowSize) {
      return
    }
    logger.info('[CompressionCache] Cache valid but stale, re-compressing to incorporate new messages', {
      chatId,
      cachedMessageCount: existingEntry.messageCount,
      currentMessageCount: messages.length,
      messagesSinceCache,
      windowSize: compressionOptions.windowSize,
    })
  }

  logger.info('[CompressionCache] Starting async pre-compression', {
    chatId,
    messageCount: messages.length,
    windowSize: compressionOptions.windowSize,
  })

  // Create the compression promise using an async helper function
  // This avoids unhandled promise rejections by catching all errors
  const runCompression = async (): Promise<ContextCompressionResult> => {
    try {
      const result = await applyContextCompression(
        messages,
        systemPrompt,
        compressionOptions
      )

      // Update in-memory cache entry with result
      const entry = compressionCache.get(chatId)
      if (entry) {
        entry.result = result
        delete entry.promise
      }

      logger.info('[CompressionCache] Async pre-compression completed', {
        chatId,
        compressionApplied: result.compressionApplied,
        savings: result.compressionDetails?.totalSavings,
      })

      // Persist to database (fire and forget)
      if (result.compressionApplied) {
        const persistedEntry: PersistedCompressionCache = {
          result,
          messageCount: messages.length,
          createdAt: Date.now(),
          systemPromptHash,
        }
        persistToDatabase(chatId, persistedEntry).catch(() => {
          // Already logged in persistToDatabase
        })
      }

      return result
    } catch (error) {
      logger.error('[CompressionCache] Async pre-compression failed', {
        chatId,
      }, error instanceof Error ? error : undefined)

      // Return a "not applied" result instead of throwing
      // This ensures the promise resolves, avoiding unhandled rejections
      const failureResult: ContextCompressionResult = {
        compressionApplied: false,
        warnings: [`Compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`],
      }

      // Update cache with failure result instead of deleting
      const entry = compressionCache.get(chatId)
      if (entry) {
        entry.result = failureResult
        delete entry.promise
      }

      return failureResult
    }
  }

  const compressionPromise = runCompression()

  // Store the cache entry with the promise
  compressionCache.set(chatId, {
    promise: compressionPromise,
    messageCount: messages.length,
    createdAt: Date.now(),
    systemPromptHash,
  })
}

/**
 * Result from getCachedCompression with metadata
 */
export interface CachedCompressionResponse {
  /** The compression result */
  result: ContextCompressionResult
  /** Message count when this compression was computed */
  cachedMessageCount: number
  /** Whether this is a fallback to older cache (async wasn't ready) */
  isFallback: boolean
}

/**
 * Get cached compression result, preferring speed over waiting for in-flight compression
 *
 * Checks in this order:
 * 1. In-memory cache with completed result (fastest)
 * 2. Database cache / previous result (fallback when async not ready)
 * 3. Returns undefined (caller should do sync compression)
 *
 * IMPORTANT: This function does NOT wait for in-flight compression. Instead, it
 * falls back to the previous compression result (from database) to avoid blocking.
 * This trades more tokens (larger effective window) for faster response time.
 *
 * @param chatId - The chat ID
 * @param currentMessageCount - Current number of messages (excluding new user message)
 * @param currentSystemPromptHash - Hash of the current system prompt (optional, for validation)
 * @returns Cached compression response with metadata, or undefined if not available
 */
export async function getCachedCompression(
  chatId: string,
  currentMessageCount: number,
  currentSystemPromptHash?: string
): Promise<CachedCompressionResponse | undefined> {
  // 1. Check in-memory cache first (fastest path)
  const memoryEntry = compressionCache.get(chatId)

  if (memoryEntry) {
    // Validate the in-memory entry using the same logic as isCacheValid
    const messageDiff = currentMessageCount - memoryEntry.messageCount
    const cacheHasMoreMessages = memoryEntry.messageCount > currentMessageCount
    const cacheTooStale = messageDiff > 50

    if (cacheHasMoreMessages) {
      compressionCache.delete(chatId)
    } else if (cacheTooStale) {
      compressionCache.delete(chatId)
    } else if (currentSystemPromptHash && memoryEntry.systemPromptHash !== currentSystemPromptHash) {
      compressionCache.delete(chatId)
    } else {
      // In-memory entry is valid
      if (memoryEntry.result) {
        logger.info('[CompressionCache] Using in-memory cached compression result', {
          chatId,
          messageCount: currentMessageCount,
          cachedMessageCount: memoryEntry.messageCount,
        })
        return {
          result: memoryEntry.result,
          cachedMessageCount: memoryEntry.messageCount,
          isFallback: false,
        }
      }

      // 2. If compression is in-flight, DON'T wait - fall back to database instead
      // This trades more tokens (larger window) for faster response
      if (memoryEntry.promise) {
        logger.info('[CompressionCache] Async compression in-flight, checking for fallback cache', {
          chatId,
        })
        // Fall through to database check
      }
    }
  }

  // 3. Check database cache (survives restarts, also serves as fallback)
  const dbEntry = await loadFromDatabase(chatId)

  if (dbEntry) {
    // Validate the database entry
    if (isCacheValid(dbEntry, currentMessageCount, currentSystemPromptHash)) {
      // Determine if this is a fallback (async was in-flight but we're using older cache)
      const isFallback = !!(memoryEntry?.promise && !memoryEntry.result)

      logger.info('[CompressionCache] Using database cached compression result', {
        chatId,
        messageCount: currentMessageCount,
        cachedMessageCount: dbEntry.messageCount,
        cacheAge: Date.now() - dbEntry.createdAt,
        isFallback,
      })

      // Only populate in-memory cache if there's no in-flight compression
      // (don't overwrite the pending promise entry)
      if (!memoryEntry?.promise) {
        compressionCache.set(chatId, {
          result: dbEntry.result,
          messageCount: dbEntry.messageCount,
          createdAt: dbEntry.createdAt,
          systemPromptHash: dbEntry.systemPromptHash,
        })
      }

      return {
        result: dbEntry.result,
        cachedMessageCount: dbEntry.messageCount,
        isFallback,
      }
    } else {
      // Clear invalid database cache
      clearFromDatabase(chatId).catch(() => {
        // Already logged
      })
    }
  }

  // 4. No valid cache found
  return undefined
}

/**
 * Invalidate cache for a chat (both in-memory and database)
 * Called when:
 * - Full context is requested (bypass compression)
 * - Settings change
 * - Chat is deleted
 */
export function invalidateCompressionCache(chatId: string): void {
  if (compressionCache.has(chatId)) {
    compressionCache.delete(chatId)
  }

  // Clear from database too (fire and forget)
  clearFromDatabase(chatId).catch(() => {
    // Already logged
  })
}

/**
 * Clear all in-memory cached compression results
 * Useful for testing or when settings change globally
 * Note: Does not clear database caches
 */
export function clearCompressionCache(): void {
  compressionCache.clear()
}

/**
 * Get cache statistics for debugging
 */
export function getCompressionCacheStats(): {
  size: number
  entries: Array<{
    chatId: string
    messageCount: number
    hasResult: boolean
    hasPromise: boolean
    ageMs: number
  }>
} {
  const entries: Array<{
    chatId: string
    messageCount: number
    hasResult: boolean
    hasPromise: boolean
    ageMs: number
  }> = []

  const now = Date.now()
  for (const [chatId, entry] of compressionCache.entries()) {
    entries.push({
      chatId,
      messageCount: entry.messageCount,
      hasResult: !!entry.result,
      hasPromise: !!entry.promise,
      ageMs: now - entry.createdAt,
    })
  }

  return {
    size: compressionCache.size,
    entries,
  }
}
