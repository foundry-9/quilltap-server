export interface QueueStats {
  pending: number
  processing: number
  failed: number
  completed: number
  dead: number
  paused: number
  activeTotal: number
}

export interface ProcessorStatus {
  running: boolean
  processing: boolean
}

export interface JobDetail {
  id: string
  type: string
  typeName: string
  status: 'PENDING' | 'PROCESSING' | 'FAILED' | 'PAUSED'
  priority: number
  attempts: number
  maxAttempts: number
  scheduledAt: string
  startedAt: string | null
  lastError: string | null
  estimatedTokens: number
  chatId?: string
  characterName?: string
}

export interface FullJobDetail extends JobDetail {
  payload: Record<string, unknown>
  createdAt: string
  updatedAt: string
  userId: string
}

export interface QueueData {
  stats: QueueStats
  jobs: JobDetail[]
  totalEstimatedTokens: number
  processorStatus: ProcessorStatus
}
