import type { BackupInfo, RestoreSummary } from '@/lib/backup/types'

export type RestoreStep = 'source' | 'preview' | 'mode' | 'progress'
export type RestoreMode = 'replace' | 'import'

export interface RestoreDialogProps {
  isOpen: boolean
  onClose: () => void
  onRestoreComplete: () => void
  initialS3Key?: string
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
  s3Backups: BackupInfo[]
  selectedS3Key: string | null
  loadingBackups: boolean
  backupsLoaded: boolean
  preview: RestorePreview | null
  loadingPreview: boolean
  restoreMode: RestoreMode
  confirmReplace: boolean
  restoring: boolean
  restoreSummary: RestoreSummary | null
  error: string | null
}

export interface RestoreActions {
  loadS3Backups: () => Promise<void>
  handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleS3Select: (key: string) => void
  handleNext: () => Promise<void>
  handleBack: () => void
  fetchPreview: () => Promise<void>
  handleStartRestore: () => Promise<void>
  handleClose: () => void
  handleCloseAfterRestore: () => void
  resetDialog: () => void
}
