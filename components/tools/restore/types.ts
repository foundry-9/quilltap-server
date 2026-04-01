import type { RestoreSummary } from '@/lib/backup/types'

export type RestoreStep = 'source' | 'preview' | 'mode' | 'progress'
export type RestoreMode = 'replace' | 'import'

export interface RestoreDialogProps {
  isOpen: boolean
  onClose: () => void
  onRestoreComplete: () => void
}

export interface RestorePreview {
  characters: number
  personas: number
  chats: number
  messages: number
  tags: number
  files: number
  memories: number
}

export interface RestoreState {
  step: RestoreStep
  selectedFile: File | null
  preview: RestorePreview | null
  loadingPreview: boolean
  restoreMode: RestoreMode
  confirmReplace: boolean
  restoring: boolean
  restoreSummary: RestoreSummary | null
  error: string | null
}

export interface RestoreActions {
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleNext: () => Promise<void>
  handleBack: () => void
  fetchPreview: () => Promise<void>
  handleStartRestore: () => Promise<void>
  handleClose: () => void
  handleCloseAfterRestore: () => void
  resetDialog: () => void
}
