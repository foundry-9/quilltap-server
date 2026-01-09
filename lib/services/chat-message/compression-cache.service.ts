/**
 * Compression Cache Service
 * Async Pre-Compression Feature
 *
 * Manages cached compression results to avoid blocking message sends.
 * After an LLM response is received, compression is triggered asynchronously
 * and cached for the next message. When the next message is sent:
 * - If compression is ready, use it immediately
 * - If compression is in-flight, wait for it
 * - If no compression started, fall back to synchronous compression
 */

import { logger } from '@/lib/logger'
import {
  ContextCompressionResult,
  ContextCompressionOptions,
  applyContextCompression,
  CompressibleMessage,
} from '@/lib/chat/context/compression'

/**
 * Cached compression entry
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

// In-memory cache for compression results
// Key: chatId, Value: CompressionCacheEntry
const compressionCache = new Map<string, CompressionCacheEntry>()

/**
 * Simple hash function for system prompt change detection
 */
function hashString(str: string): string {
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
 * No TTL - cache is only invalidated by message count mismatch or system prompt change
 */
function isCacheValid(
  entry: CompressionCacheEntry,
  currentMessageCount: number,
  currentSystemPromptHash: string
): boolean {
  // Cache is valid if computed for (messageCount - 1) or messageCount
  // Because we compute after receiving a response (N messages), and use it
  // when sending the next message (N+1 messages, but compression only considers N)
  // The user message being added doesn't affect the compression of older messages
  const validForCount = entry.messageCount === currentMessageCount ||
    entry.messageCount === currentMessageCount - 1

  if (!validForCount) {
    logger.debug('[CompressionCache] Cache entry stale (message count mismatch)', {
      cachedMessageCount: entry.messageCount,
      currentMessageCount,
    })
    return false
  }

  // Check if system prompt changed
  if (entry.systemPromptHash !== currentSystemPromptHash) {
    logger.debug('[CompressionCache] Cache entry stale (system prompt changed)')
    return false
  }

  return true
}

/**
 * Trigger async pre-compression for the next message
 * Called after an LLM response is received and saved
 */
export function triggerAsyncCompression(options: AsyncCompressionOptions): void {
  const { chatId, messages, systemPrompt, compressionOptions } = options

  // Don't pre-compress if there aren't enough messages
  if (messages.length <= compressionOptions.windowSize) {
    logger.debug('[CompressionCache] Skipping pre-compression (not enough messages)', {
      chatId,
      messageCount: messages.length,
      windowSize: compressionOptions.windowSize,
    })
    return
  }

  const systemPromptHash = hashString(systemPrompt)

  // Check if we already have a valid cache entry
  const existingEntry = compressionCache.get(chatId)
  if (existingEntry && isCacheValid(existingEntry, messages.length, systemPromptHash)) {
    logger.debug('[CompressionCache] Valid cache entry already exists, skipping pre-compression', {
      chatId,
      messageCount: messages.length,
    })
    return
  }

  logger.info('[CompressionCache] Starting async pre-compression', {
    chatId,
    messageCount: messages.length,
    windowSize: compressionOptions.windowSize,
  })

  // Create the compression promise
  const compressionPromise = applyContextCompression(
    messages,
    systemPrompt,
    compressionOptions
  ).then(result => {
    // Update cache entry with result
    const entry = compressionCache.get(chatId)
    if (entry && entry.promise === compressionPromise) {
      entry.result = result
      delete entry.promise
      logger.info('[CompressionCache] Async pre-compression completed', {
        chatId,
        compressionApplied: result.compressionApplied,
        savings: result.compressionDetails?.totalSavings,
      })
    }
    return result
  }).catch(error => {
    // Remove failed entry
    const entry = compressionCache.get(chatId)
    if (entry && entry.promise === compressionPromise) {
      compressionCache.delete(chatId)
    }
    logger.error('[CompressionCache] Async pre-compression failed', {
      chatId,
    }, error instanceof Error ? error : undefined)
    throw error
  })

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
 * @param chatId - The chat ID
 * @param currentMessageCount - Current number of messages (excluding new user message)
 * @returns Cached compression result or undefined if not available
 */
export async function getCachedCompression(
  chatId: string,
  currentMessageCount: number
): Promise<ContextCompressionResult | undefined> {
  const entry = compressionCache.get(chatId)

  if (!entry) {
    logger.debug('[CompressionCache] No cache entry found', { chatId })
    return undefined
  }

  // Cache is valid if computed for (messageCount - 1) or messageCount
  // Because we compute after receiving a response (N messages), and use it
  // when sending the next message (N+1 messages, but compression only considers N)
  const validForCount = entry.messageCount === currentMessageCount ||
    entry.messageCount === currentMessageCount - 1

  if (!validForCount) {
    logger.debug('[CompressionCache] Cache entry stale (message count mismatch)', {
      chatId,
      cachedMessageCount: entry.messageCount,
      currentMessageCount,
    })
    compressionCache.delete(chatId)
    return undefined
  }

  // If result is already available, return it
  if (entry.result) {
    logger.info('[CompressionCache] Using cached compression result', {
      chatId,
      messageCount: currentMessageCount,
      cachedMessageCount: entry.messageCount,
    })
    return entry.result
  }

  // If compression is in-flight, wait for it
  if (entry.promise) {
    logger.info('[CompressionCache] Waiting for in-flight compression', {
      chatId,
    })
    try {
      const result = await entry.promise
      return result
    } catch {
      // Compression failed, return undefined to trigger sync compression
      logger.warn('[CompressionCache] In-flight compression failed, will fall back to sync', {
        chatId,
      })
      return undefined
    }
  }

  return undefined
}

/**
 * Invalidate cache for a chat
 * Called when:
 * - Full context is requested (bypass compression)
 * - Settings change
 * - Chat is deleted
 */
export function invalidateCompressionCache(chatId: string): void {
  if (compressionCache.has(chatId)) {
    logger.debug('[CompressionCache] Invalidating cache', { chatId })
    compressionCache.delete(chatId)
  }
}

/**
 * Clear all cached compression results
 * Useful for testing or when settings change globally
 */
export function clearCompressionCache(): void {
  logger.debug('[CompressionCache] Clearing all cache entries', {
    count: compressionCache.size,
  })
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
