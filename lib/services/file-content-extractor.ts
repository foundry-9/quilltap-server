/**
 * File Content Extractor Service
 *
 * Extracts text content from various file types for use in
 * project context and LLM tool calls.
 *
 * Supported formats:
 * - Text files (.txt, .md, .csv, etc.)
 * - Code files (.ts, .js, .py, .json, etc.)
 * - PDF files
 * - Images (returns description if available)
 *
 * @module services/file-content-extractor
 */

import { logger } from '@/lib/logger'
import { fileStorageManager } from '@/lib/file-storage/manager'
import type { FileEntry } from '@/lib/schemas/types'

/**
 * Result of content extraction
 */
export interface ExtractedContent {
  /** Whether extraction was successful */
  success: boolean
  /** The extracted text content */
  content?: string
  /** Content type hint for the LLM */
  contentType: 'text' | 'code' | 'markdown' | 'image_description' | 'binary' | 'error'
  /** Language hint for code files */
  language?: string
  /** Error message if extraction failed */
  error?: string
  /** Truncated flag if content was too large */
  truncated?: boolean
}

/** Maximum content length to return (chars) */
const MAX_CONTENT_LENGTH = 50000

/** Text-based MIME types that can be extracted directly */
const TEXT_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'text/html',
  'text/xml',
  'application/json',
  'application/xml',
]

/** Code file extensions and their language hints */
const CODE_EXTENSIONS: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.py': 'python',
  '.rb': 'ruby',
  '.rs': 'rust',
  '.go': 'go',
  '.java': 'java',
  '.c': 'c',
  '.cpp': 'cpp',
  '.h': 'c',
  '.hpp': 'cpp',
  '.cs': 'csharp',
  '.php': 'php',
  '.swift': 'swift',
  '.kt': 'kotlin',
  '.scala': 'scala',
  '.r': 'r',
  '.sql': 'sql',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'toml',
  '.ini': 'ini',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.vue': 'vue',
  '.svelte': 'svelte',
}

/** Image MIME types */
const IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]

/**
 * Check if MIME type is text-based
 */
function isTextMimeType(mimeType: string): boolean {
  return TEXT_MIME_TYPES.includes(mimeType) ||
    mimeType.startsWith('text/') ||
    mimeType.includes('json') ||
    mimeType.includes('xml')
}

/**
 * Check if MIME type is an image
 */
function isImageMimeType(mimeType: string): boolean {
  return IMAGE_MIME_TYPES.includes(mimeType) || mimeType.startsWith('image/')
}

/**
 * Get language hint from filename
 */
function getLanguageFromFilename(filename: string): string | undefined {
  const ext = filename.toLowerCase().match(/\.[^.]+$/)?.[0]
  return ext ? CODE_EXTENSIONS[ext] : undefined
}

/**
 * Extract content from a text file
 */
async function extractTextContent(
  buffer: Buffer,
  filename: string
): Promise<ExtractedContent> {
  try {
    let content = buffer.toString('utf-8')
    let truncated = false

    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.slice(0, MAX_CONTENT_LENGTH)
      truncated = true
    }

    const language = getLanguageFromFilename(filename)
    const isMarkdown = filename.toLowerCase().endsWith('.md') ||
      filename.toLowerCase().endsWith('.markdown')

    return {
      success: true,
      content,
      contentType: language ? 'code' : isMarkdown ? 'markdown' : 'text',
      language,
      truncated,
    }
  } catch (error) {
    logger.error('Error extracting text content', {
      filename,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      contentType: 'error',
      error: 'Failed to extract text content',
    }
  }
}

/**
 * Extract content from a PDF file
 * Uses pdf-parse library if available
 */
async function extractPdfContent(buffer: Buffer): Promise<ExtractedContent> {
  try {
    // Dynamically import pdf-parse to handle it not being installed
    // Using require for optional dependency to avoid TypeScript module errors
    let pdfParse: ((buffer: Buffer) => Promise<{ text: string }>) | null = null
    try {
       
      pdfParse = require('pdf-parse')
    } catch {
      // pdf-parse is not installed
    }

    if (!pdfParse) {
      logger.warn('pdf-parse not available, returning placeholder')
      return {
        success: true,
        content: '[PDF content - pdf-parse library not installed]',
        contentType: 'text',
      }
    }

    const data = await pdfParse(buffer)
    let content = data.text

    let truncated = false
    if (content.length > MAX_CONTENT_LENGTH) {
      content = content.slice(0, MAX_CONTENT_LENGTH)
      truncated = true
    }

    return {
      success: true,
      content,
      contentType: 'text',
      truncated,
    }
  } catch (error) {
    logger.error('Error extracting PDF content', {
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      contentType: 'error',
      error: 'Failed to extract PDF content',
    }
  }
}

/**
 * Handle image file - return description if available
 */
function handleImageContent(file: FileEntry): ExtractedContent {
  if (file.description) {
    return {
      success: true,
      content: file.description,
      contentType: 'image_description',
    }
  }

  return {
    success: true,
    content: `[Image: ${file.originalFilename}${file.width && file.height ? ` (${file.width}x${file.height})` : ''}]`,
    contentType: 'image_description',
  }
}

/**
 * Extract text content from a file
 *
 * @param file The file entry with metadata
 * @returns Extracted content result
 */
export async function extractFileContent(file: FileEntry): Promise<ExtractedContent> {
  const log = logger.child({ module: 'file-content-extractor', fileId: file.id })

  // Handle images - return description
  if (isImageMimeType(file.mimeType)) {

    return handleImageContent(file)
  }

  // Check if file is too large
  if (file.size > 10 * 1024 * 1024) { // 10MB limit for extraction
    log.warn('File too large for extraction', { size: file.size })
    return {
      success: false,
      contentType: 'error',
      error: 'File too large for content extraction (max 10MB)',
    }
  }

  // Download file from storage
  let buffer: Buffer
  try {
    if (!file.storageKey) {
      return {
        success: false,
        contentType: 'error',
        error: 'File has no storage key',
      }
    }
    buffer = await fileStorageManager.downloadFile(file)
  } catch (error) {
    log.error('Failed to download file from storage', {
      storageKey: file.storageKey,
      error: error instanceof Error ? error.message : String(error),
    })
    return {
      success: false,
      contentType: 'error',
      error: 'Failed to download file from storage',
    }
  }

  // Handle PDF files
  if (file.mimeType === 'application/pdf') {

    return extractPdfContent(buffer)
  }

  // Handle text-based files
  if (isTextMimeType(file.mimeType)) {

    return extractTextContent(buffer, file.originalFilename)
  }

  // Handle code files by extension
  const language = getLanguageFromFilename(file.originalFilename)
  if (language) {

    return extractTextContent(buffer, file.originalFilename)
  }

  // Unknown binary format

  return {
    success: true,
    content: `[Binary file: ${file.originalFilename} (${file.mimeType}, ${formatBytes(file.size)})]`,
    contentType: 'binary',
  }
}

/**
 * Extract content from multiple files
 *
 * @param files Array of file entries
 * @returns Map of file ID to extracted content
 */
export async function extractMultipleFileContents(
  files: FileEntry[]
): Promise<Map<string, ExtractedContent>> {
  const results = new Map<string, ExtractedContent>()

  await Promise.all(
    files.map(async (file) => {
      const content = await extractFileContent(file)
      results.set(file.id, content)
    })
  )

  return results
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
