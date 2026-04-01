/**
 * Text Content Detection Utility
 *
 * Detects if file content is plain text by analyzing bytes,
 * and infers appropriate MIME types from file extensions.
 *
 * Used during file upload to:
 * 1. Detect if a file is readable as text
 * 2. Infer a better MIME type when browser provides generic types
 * 3. Support previewing and LLM access to code/text files
 *
 * @module files/text-detection
 */

import { logger } from '@/lib/logger'

/**
 * Result of text detection analysis
 */
export interface TextDetectionResult {
  /** Whether the file content appears to be plain text */
  isPlainText: boolean
  /** Inferred MIME type based on extension (if better than provided) */
  detectedMimeType: string | null
  /** Detected or assumed encoding */
  encoding: string
}

/**
 * File extension to MIME type mapping
 * Used to infer better MIME types when browser provides generic ones
 */
const EXTENSION_MIME_MAP: Record<string, string> = {
  // TypeScript/JavaScript
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.js': 'text/javascript',
  '.jsx': 'text/javascript',
  '.mjs': 'text/javascript',
  '.cjs': 'text/javascript',

  // Web
  '.html': 'text/html',
  '.htm': 'text/html',
  '.css': 'text/css',
  '.scss': 'text/x-scss',
  '.sass': 'text/x-sass',
  '.less': 'text/x-less',
  '.vue': 'text/x-vue',
  '.svelte': 'text/x-svelte',

  // Data formats
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.yaml': 'text/yaml',
  '.yml': 'text/yaml',
  '.toml': 'text/toml',
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',

  // Documentation
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.txt': 'text/plain',
  '.text': 'text/plain',
  '.log': 'text/plain',
  '.rst': 'text/x-rst',

  // Programming languages
  '.py': 'text/x-python',
  '.pyw': 'text/x-python',
  '.rb': 'text/x-ruby',
  '.rs': 'text/x-rust',
  '.go': 'text/x-go',
  '.java': 'text/x-java',
  '.kt': 'text/x-kotlin',
  '.kts': 'text/x-kotlin',
  '.scala': 'text/x-scala',
  '.swift': 'text/x-swift',
  '.c': 'text/x-c',
  '.h': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.hpp': 'text/x-c++',
  '.cc': 'text/x-c++',
  '.cxx': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.php': 'text/x-php',
  '.pl': 'text/x-perl',
  '.pm': 'text/x-perl',
  '.r': 'text/x-r',
  '.R': 'text/x-r',
  '.lua': 'text/x-lua',
  '.dart': 'text/x-dart',
  '.ex': 'text/x-elixir',
  '.exs': 'text/x-elixir',
  '.erl': 'text/x-erlang',
  '.hrl': 'text/x-erlang',
  '.clj': 'text/x-clojure',
  '.cljs': 'text/x-clojure',
  '.hs': 'text/x-haskell',
  '.lhs': 'text/x-haskell',
  '.ml': 'text/x-ocaml',
  '.mli': 'text/x-ocaml',
  '.fs': 'text/x-fsharp',
  '.fsx': 'text/x-fsharp',

  // Shell/Scripts
  '.sh': 'text/x-shellscript',
  '.bash': 'text/x-shellscript',
  '.zsh': 'text/x-shellscript',
  '.fish': 'text/x-shellscript',
  '.ps1': 'text/x-powershell',
  '.psm1': 'text/x-powershell',
  '.bat': 'text/x-batch',
  '.cmd': 'text/x-batch',

  // Database
  '.sql': 'text/x-sql',
  '.pgsql': 'text/x-sql',
  '.mysql': 'text/x-sql',

  // Config files
  '.ini': 'text/plain',
  '.cfg': 'text/plain',
  '.conf': 'text/plain',
  '.config': 'text/plain',
  '.env': 'text/plain',
  '.env.local': 'text/plain',
  '.env.development': 'text/plain',
  '.env.production': 'text/plain',
  '.properties': 'text/plain',
  '.editorconfig': 'text/plain',
  '.gitignore': 'text/plain',
  '.gitattributes': 'text/plain',
  '.dockerignore': 'text/plain',
  '.npmignore': 'text/plain',
  '.eslintrc': 'application/json',
  '.prettierrc': 'application/json',
  '.babelrc': 'application/json',

  // Misc
  '.graphql': 'text/x-graphql',
  '.gql': 'text/x-graphql',
  '.proto': 'text/x-protobuf',
  '.tf': 'text/x-terraform',
  '.tfvars': 'text/x-terraform',
  '.dockerfile': 'text/x-dockerfile',
  '.makefile': 'text/x-makefile',
}

/** Bytes to sample for text detection */
const SAMPLE_SIZE = 8192

/** Maximum ratio of non-printable characters to consider as text */
const NON_PRINTABLE_THRESHOLD = 0.10

/**
 * Check if a byte is a printable ASCII character or common whitespace
 */
function isPrintableOrWhitespace(byte: number): boolean {
  // Tab, newline, carriage return
  if (byte === 0x09 || byte === 0x0a || byte === 0x0d) return true
  // Printable ASCII (space through tilde)
  if (byte >= 0x20 && byte <= 0x7e) return true
  // High bytes (could be valid UTF-8 continuation)
  if (byte >= 0x80) return true
  return false
}

/**
 * Detect if file content is likely plain text
 *
 * Analyzes the first 8KB of the file for:
 * 1. Null bytes (strong binary indicator)
 * 2. Ratio of non-printable characters
 *
 * @param buffer File content buffer
 * @returns true if content appears to be text
 */
export function isTextContent(buffer: Buffer): boolean {
  const sampleLength = Math.min(buffer.length, SAMPLE_SIZE)

  if (sampleLength === 0) {
    // Empty files are considered text
    return true
  }

  let nullBytes = 0
  let nonPrintable = 0

  for (let i = 0; i < sampleLength; i++) {
    const byte = buffer[i]

    // Null bytes are a strong indicator of binary content
    if (byte === 0x00) {
      nullBytes++
      // If we find more than a couple null bytes, it's likely binary
      if (nullBytes > 2) {
        return false
      }
    }

    if (!isPrintableOrWhitespace(byte)) {
      nonPrintable++
    }
  }

  const nonPrintableRatio = nonPrintable / sampleLength
  return nonPrintableRatio < NON_PRINTABLE_THRESHOLD
}

/**
 * Get MIME type from file extension
 *
 * @param filename Original filename
 * @returns Inferred MIME type or null if unknown
 */
export function getMimeTypeFromExtension(filename: string): string | null {
  // Handle compound extensions like .env.local, .d.ts
  const lowerFilename = filename.toLowerCase()

  // Check for compound extensions first
  for (const [ext, mimeType] of Object.entries(EXTENSION_MIME_MAP)) {
    if (lowerFilename.endsWith(ext)) {
      return mimeType
    }
  }

  // Check standard extension
  const match = lowerFilename.match(/\.([^.]+)$/)
  if (match) {
    const ext = `.${match[1]}`
    return EXTENSION_MIME_MAP[ext] || null
  }

  // Handle special filenames without extensions
  const specialFiles: Record<string, string> = {
    'dockerfile': 'text/x-dockerfile',
    'makefile': 'text/x-makefile',
    'gemfile': 'text/x-ruby',
    'rakefile': 'text/x-ruby',
    'cmakelists.txt': 'text/x-cmake',
    'license': 'text/plain',
    'readme': 'text/plain',
    'changelog': 'text/plain',
    'authors': 'text/plain',
    'contributors': 'text/plain',
  }

  const baseName = lowerFilename.split('/').pop() || lowerFilename
  return specialFiles[baseName] || null
}

/**
 * Check if a MIME type indicates text content
 */
export function isTextMimeType(mimeType: string): boolean {
  // Explicit text types
  if (mimeType.startsWith('text/')) return true

  // Common text-based application types
  const textApplicationTypes = [
    'application/json',
    'application/xml',
    'application/javascript',
    'application/typescript',
    'application/x-javascript',
    'application/x-typescript',
    'application/x-sh',
    'application/x-shellscript',
    'application/graphql',
  ]

  return textApplicationTypes.includes(mimeType)
}

/**
 * Detect if file is text and infer best MIME type
 *
 * @param buffer File content buffer
 * @param filename Original filename
 * @param providedMimeType MIME type from browser/client
 * @returns Detection result with isPlainText flag and inferred MIME type
 */
export function detectTextContent(
  buffer: Buffer,
  filename: string,
  providedMimeType: string
): TextDetectionResult {
  const log = logger.child({ module: 'text-detection', filename })

  // Check if content is text
  const contentIsText = isTextContent(buffer)

  // Infer MIME type from extension
  const extensionMimeType = getMimeTypeFromExtension(filename)

  // Determine the best MIME type to use
  let detectedMimeType: string | null = null

  // If browser provided a generic type, prefer our extension-based detection
  const isGenericMimeType =
    providedMimeType === 'application/octet-stream' ||
    providedMimeType === '' ||
    providedMimeType === 'application/x-unknown'

  if (extensionMimeType && isGenericMimeType) {
    detectedMimeType = extensionMimeType

  } else if (contentIsText && isGenericMimeType) {
    // Content is text but we don't recognize the extension
    detectedMimeType = 'text/plain'

  }

  // Determine if this should be treated as plain text for previewing
  const isPlainText =
    contentIsText &&
    (isTextMimeType(providedMimeType) ||
      isTextMimeType(detectedMimeType || '') ||
      extensionMimeType !== null)

  return {
    isPlainText,
    detectedMimeType,
    encoding: 'utf-8', // Assume UTF-8 for now
  }
}

/**
 * Get the best MIME type for a file
 *
 * Returns the detected MIME type if better than provided,
 * otherwise returns the provided MIME type.
 *
 * @param detectionResult Result from detectTextContent
 * @param providedMimeType Original MIME type from upload
 * @returns Best MIME type to use
 */
export function getBestMimeType(
  detectionResult: TextDetectionResult,
  providedMimeType: string
): string {
  return detectionResult.detectedMimeType || providedMimeType
}
