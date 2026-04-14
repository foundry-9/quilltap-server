/**
 * Document Stores Page Types
 *
 * Shared types for the document stores list and detail page components.
 */

export interface DocumentStore {
  id: string
  name: string
  basePath: string
  mountType: 'filesystem' | 'obsidian'
  includePatterns: string[]
  excludePatterns: string[]
  enabled: boolean
  lastScannedAt: string | null
  scanStatus: 'idle' | 'scanning' | 'error'
  lastScanError: string | null
  fileCount: number
  chunkCount: number
  totalSizeBytes: number
  embeddedChunkCount: number
  createdAt: string
  updatedAt: string
}

export interface DocumentStoreFile {
  id: string
  mountPointId: string
  relativePath: string
  fileName: string
  fileType: 'pdf' | 'docx' | 'markdown' | 'txt'
  sha256: string
  fileSizeBytes: number
  lastModified: string
  conversionStatus: 'pending' | 'converted' | 'failed' | 'skipped'
  conversionError: string | null
  plainTextLength: number | null
  chunkCount: number
  createdAt: string
  updatedAt: string
}

export interface ScanResult {
  filesScanned: number
  filesNew: number
  filesModified: number
  filesDeleted: number
  chunksCreated: number
  errors: Array<{ file: string; error: string }>
}

export interface UseDocumentStoresReturn {
  stores: DocumentStore[]
  loading: boolean
  error: string | null
  fetchStores: () => Promise<void>
  createStore: (data: CreateDocumentStoreData) => Promise<DocumentStore | null>
  updateStore: (id: string, data: UpdateDocumentStoreData) => Promise<DocumentStore | null>
  deleteStore: (id: string) => Promise<boolean>
  scanStore: (id: string) => Promise<{ scanResult: ScanResult; embeddingJobsEnqueued: number } | null>
}

export interface CreateDocumentStoreData {
  name: string
  basePath: string
  mountType?: 'filesystem' | 'obsidian'
  includePatterns?: string[]
  excludePatterns?: string[]
  enabled?: boolean
}

export interface UpdateDocumentStoreData {
  name?: string
  basePath?: string
  mountType?: 'filesystem' | 'obsidian'
  includePatterns?: string[]
  excludePatterns?: string[]
  enabled?: boolean
}
