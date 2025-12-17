'use client'

import type { JobDetail } from './types'

interface TaskItemProps {
  job: JobDetail
  jobActionLoading: string | null
  onView: (jobId: string) => void
  onPause: (jobId: string) => void
  onResume: (jobId: string) => void
  onDelete: (jobId: string) => void
}

export function TaskItem({
  job,
  jobActionLoading,
  onView,
  onPause,
  onResume,
  onDelete,
}: TaskItemProps) {
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000000) {
      return `${(tokens / 1000000).toFixed(1)}M`
    }
    if (tokens >= 1000) {
      return `${(tokens / 1000).toFixed(1)}K`
    }
    return tokens.toString()
  }

  const formatDate = (dateString: string): string => {
    try {
      const date = new Date(dateString)
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)

      if (diffMins < 1) return 'Just now'
      if (diffMins < 60) return `${diffMins}m ago`
      if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return dateString
    }
  }

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'PROCESSING':
        return 'text-blue-600 dark:text-blue-400'
      case 'PENDING':
        return 'text-yellow-600 dark:text-yellow-400'
      case 'FAILED':
        return 'text-red-600 dark:text-red-400'
      case 'PAUSED':
        return 'text-orange-600 dark:text-orange-400'
      default:
        return 'text-muted-foreground'
    }
  }

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PROCESSING':
        return (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )
      case 'PENDING':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        )
      case 'FAILED':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
            />
          </svg>
        )
      case 'PAUSED':
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M10 9v6m4-6v6m7-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        )
      default:
        return null
    }
  }

  return (
    <div className="qt-card p-3 hover:bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <span className={getStatusColor(job.status)}>
            {getStatusIcon(job.status)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="qt-text-primary">
                {job.typeName}
              </span>
              {job.priority > 0 && (
                <span className="text-xs px-1.5 py-0.5 bg-primary/10 text-primary rounded">
                  P{job.priority}
                </span>
              )}
            </div>
            <div className="qt-text-xs mt-0.5">
              {job.characterName && (
                <span className="mr-2">Character: {job.characterName}</span>
              )}
              {job.attempts > 0 && (
                <span className="mr-2">
                  Attempt {job.attempts}/{job.maxAttempts}
                </span>
              )}
              <span>{formatDate(job.scheduledAt)}</span>
            </div>
            {job.lastError && (
              <div className="text-xs text-red-500 mt-1 truncate">
                Error: {job.lastError}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right qt-text-xs whitespace-nowrap">
            ~{formatTokens(job.estimatedTokens)} tokens
          </div>
          {/* Job Action Buttons */}
          <div className="flex items-center gap-1">
            {/* Pause/Resume Button */}
            {job.status === 'PAUSED' ? (
              <button
                onClick={() => onResume(job.id)}
                disabled={jobActionLoading === job.id}
                className="p-1 rounded hover:bg-green-100 dark:hover:bg-green-900/30 text-green-600 dark:text-green-400"
                title="Resume"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                </svg>
              </button>
            ) : ['PENDING', 'FAILED'].includes(job.status) ? (
              <button
                onClick={() => onPause(job.id)}
                disabled={jobActionLoading === job.id}
                className="p-1 rounded hover:bg-orange-100 dark:hover:bg-orange-900/30 text-orange-600 dark:text-orange-400"
                title="Pause"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 9v6m4-6v6" />
                </svg>
              </button>
            ) : null}
            {/* View Button */}
            <button
              onClick={() => onView(job.id)}
              disabled={jobActionLoading === job.id}
              className="p-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900/30 text-blue-600 dark:text-blue-400"
              title="View Details"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
              </svg>
            </button>
            {/* Delete Button */}
            {job.status !== 'PROCESSING' && (
              <button
                onClick={() => onDelete(job.id)}
                disabled={jobActionLoading === job.id}
                className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/30 text-red-600 dark:text-red-400"
                title="Delete"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
            {/* Loading indicator */}
            {jobActionLoading === job.id && (
              <svg className="w-4 h-4 animate-spin text-muted-foreground" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
