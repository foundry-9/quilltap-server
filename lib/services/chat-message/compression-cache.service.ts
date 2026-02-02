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

    logger.debug('[CompressionCache] Persisted to database', {
      chatId,
      messageCount: entry.messageCount,
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
      logger.debug('[CompressionCache] Invalid cache structure in database', { chatId })
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

    logger.debug('[CompressionCache] Cleared from database', { chatId })
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
    return
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
 * Get cached compression result, waiting for in-flight compression if needed
 *
 * Checks in this order:
 * 1. In-memory cache (fastest)
 * 2. In-flight compression (wait for it)
 * 3. Database cache (survives restarts)
 * 4. Returns undefined (caller should do sync compression)
 *
 * @param chatId - The chat ID
 * @param currentMessageCount - Current number of messages (excluding new user message)
 * @param currentSystemPromptHash - Hash of the current system prompt (optional, for validation)
 * @returns Cached compression result or undefined if not available
 */
export async function getCachedCompression(
  chatId: string,
  currentMessageCount: number,
  currentSystemPromptHash?: string
): Promise<ContextCompressionResult | undefined> {
  // 1. Check in-memory cache first (fastest path)
  const memoryEntry = compressionCache.get(chatId)

  if (memoryEntry) {
    // Validate the in-memory entry using the same logic as isCacheValid
    const messageDiff = currentMessageCount - memoryEntry.messageCount
    const cacheHasMoreMessages = memoryEntry.messageCount > currentMessageCount
    const cacheTooStale = messageDiff > 50

    if (cacheHasMoreMessages) {
      logger.debug('[CompressionCache] Memory cache invalid: cache has more messages than current (data deleted?)', {
        chatId,
        cachedCount: memoryEntry.messageCount,
        currentCount: currentMessageCount,
      })
      compressionCache.delete(chatId)
    } else if (cacheTooStale) {
      logger.debug('[CompressionCache] Memory cache invalid: too stale (>50 messages behind)', {
        chatId,
        cachedCount: memoryEntry.messageCount,
        currentCount: currentMessageCount,
        diff: messageDiff,
      })
      compressionCache.delete(chatId)
    } else if (currentSystemPromptHash && memoryEntry.systemPromptHash !== currentSystemPromptHash) {
      logger.debug('[CompressionCache] Memory cache invalid: system prompt hash mismatch', {
        chatId,
        cachedHash: memoryEntry.systemPromptHash,
        currentHash: currentSystemPromptHash,
      })
      compressionCache.delete(chatId)
    } else {
      // In-memory entry is valid
      if (memoryEntry.result) {
        logger.info('[CompressionCache] Using in-memory cached compression result', {
          chatId,
          messageCount: currentMessageCount,
          cachedMessageCount: memoryEntry.messageCount,
        })
        return memoryEntry.result
      }

      // 2. If compression is in-flight, wait for it
      if (memoryEntry.promise) {
        logger.info('[CompressionCache] Waiting for in-flight compression', {
          chatId,
        })
        try {
          const result = await memoryEntry.promise
          return result
        } catch {
          // Compression failed, continue to check database
          logger.warn('[CompressionCache] In-flight compression failed, checking database', {
            chatId,
          })
        }
      }
    }
  }

  // 3. Check database cache (survives restarts)
  logger.debug('[CompressionCache] Checking database for cached compression', { chatId })
  const dbEntry = await loadFromDatabase(chatId)

  if (dbEntry) {
    // Validate the database entry
    if (isCacheValid(dbEntry, currentMessageCount, currentSystemPromptHash)) {
      logger.info('[CompressionCache] Using database cached compression result', {
        chatId,
        messageCount: currentMessageCount,
        cachedMessageCount: dbEntry.messageCount,
        cacheAge: Date.now() - dbEntry.createdAt,
      })

      // Populate in-memory cache for faster subsequent access
      compressionCache.set(chatId, {
        result: dbEntry.result,
        messageCount: dbEntry.messageCount,
        createdAt: dbEntry.createdAt,
        systemPromptHash: dbEntry.systemPromptHash,
      })

      return dbEntry.result
    } else {
      logger.debug('[CompressionCache] Database cache invalid, clearing', {
        chatId,
        cachedCount: dbEntry.messageCount,
        currentCount: currentMessageCount,
      })
      // Clear invalid database cache
      clearFromDatabase(chatId).catch(() => {
        // Already logged
      })
    }
  }

  // 4. No valid cache found
  logger.debug('[CompressionCache] No valid cache found', { chatId })
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
