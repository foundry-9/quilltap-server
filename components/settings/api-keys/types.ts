/**
 * API Key Import/Export Types
 */

// Duplicate handling options for import
export type DuplicateHandling = 'skip' | 'replace' | 'rename'

// Export dialog steps
export type ExportStep = 'passphrase' | 'exporting' | 'complete' | 'error'

// Import dialog steps
export type ImportStep =
  | 'file'
  | 'passphrase'
  | 'preview'
  | 'options'
  | 'importing'
  | 'complete'
  | 'error'

// Preview of a key to be imported
export interface ImportKeyPreview {
  provider: string
  label: string
  keyPreview: string
  isDuplicate: boolean
  existingId?: string
}

// Export file structure
export interface ExportFile {
  format: string
  version: number
  exportedAt: string
  keyCount: number
  encryption: {
    algorithm: string
    kdf: string
    kdfIterations: number
    salt: string
  }
  payload: {
    ciphertext: string
    iv: string
    authTag: string
  }
  signature: string
}

// Preview API response
export interface PreviewResponse {
  valid: boolean
  signatureValid: boolean
  keyCount: number
  keys: ImportKeyPreview[]
  duplicateCount: number
  error?: string
}

// Import result from API
export interface ImportResult {
  imported: number
  skipped: number
  replaced: number
  errors: string[]
}

// Export dialog state
export interface ExportState {
  step: ExportStep
  passphrase: string
  passphraseConfirm: string
  exporting: boolean
  error: string | null
}

// Import dialog state
export interface ImportState {
  step: ImportStep
  selectedFile: File | null
  fileData: ExportFile | null
  passphrase: string
  keyPreviews: ImportKeyPreview[]
  signatureValid: boolean
  duplicateCount: number
  duplicateHandling: DuplicateHandling
  importing: boolean
  importResult: ImportResult | null
  error: string | null
}
