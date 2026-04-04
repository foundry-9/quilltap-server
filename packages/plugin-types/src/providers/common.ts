/**
 * Common types shared across all provider interfaces
 *
 * These types are used by multiple provider shapes (text, image, embedding, scoring)
 * and are extracted here to avoid duplication.
 *
 * @module @quilltap/plugin-types/providers/common
 */

/**
 * File attachment for multimodal messages
 */
export interface FileAttachment {
  /** Unique identifier for the attachment */
  id: string;
  /** Path to the file on disk (internal use) */
  filepath?: string;
  /** Original filename */
  filename: string;
  /** MIME type of the file */
  mimeType: string;
  /** File size in bytes */
  size: number;
  /** Base64 encoded data (loaded at send time) */
  data?: string;
  /** URL to fetch the file (alternative to data) */
  url?: string;
  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Token usage statistics
 */
export interface TokenUsage {
  /** Tokens used for the prompt */
  promptTokens: number;
  /** Tokens used for the completion */
  completionTokens: number;
  /** Total tokens used */
  totalTokens: number;
}

/**
 * Cache usage statistics (OpenRouter, Anthropic)
 */
export interface CacheUsage {
  /** Number of cached tokens */
  cachedTokens?: number;
  /** Cache discount amount */
  cacheDiscount?: number;
  /** Tokens used for cache creation */
  cacheCreationInputTokens?: number;
  /** Tokens read from cache */
  cacheReadInputTokens?: number;
}

/**
 * Attachment processing results
 */
export interface AttachmentResults {
  /** IDs of attachments sent successfully */
  sent: string[];
  /** Attachments that failed with error details */
  failed: Array<{ id: string; error: string }>;
}

/**
 * Model warning level
 */
export type ModelWarningLevel = 'info' | 'warning' | 'error';

/**
 * Model warning information
 */
export interface ModelWarning {
  /** Warning severity level */
  level: ModelWarningLevel;
  /** Warning message */
  message: string;
  /** Optional link to documentation */
  documentationUrl?: string;
}

/**
 * Model metadata with warnings and capabilities
 */
export interface ModelMetadata {
  /** Model identifier */
  id: string;
  /** Human-readable display name */
  displayName?: string;
  /** Warnings or recommendations */
  warnings?: ModelWarning[];
  /** Whether the model is deprecated */
  deprecated?: boolean;
  /** Whether the model is experimental/preview */
  experimental?: boolean;
  /** Capabilities this model lacks */
  missingCapabilities?: string[];
  /** Maximum output tokens */
  maxOutputTokens?: number;
  /** Context window size */
  contextWindow?: number;
}
