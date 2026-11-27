'use client'

import { Icon } from '@/components/ui/icon'
import { formatRelativeDate } from '@/lib/format-time'
import { useNow } from '@/hooks/useNow'
import type { JobDetail } from './types'
import { jobStatusColor } from './job-status'
import { formatTokenCount } from '@/lib/utils/format-tokens'
import { Spinner } from '@/components/ui/Spinner'

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
  // Shared minute clock, so a queued task's "3m ago" actually becomes "4m ago"
  // instead of waiting for the next unrelated re-render.
  const nowMs = useNow(60_000)
  const formatDate = (dateString: string | null | undefined) =>
    formatRelativeDate(dateString, nowMs)

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PROCESSING':
        return (
          <Spinner className="w-4 h-4" />
        )
      case 'PENDING':
        return <Icon name="clock" className="w-4 h-4" />
      case 'FAILED':
        return <Icon name="alert-triangle" className="w-4 h-4" />
      case 'PAUSED':
        return <Icon name="pause" className="w-4 h-4" />
      default:
        return null
    }
  }

  return (
    <div className="qt-card p-3 hover:qt-bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0 flex-1">
          <span className={jobStatusColor(job.status)}>
            {getStatusIcon(job.status)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="qt-text-primary">
                {job.typeName}
              </span>
              {job.priority > 0 && (
                <span className="text-xs px-1.5 py-0.5 qt-bg-primary/10 qt-text-brand rounded">
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
              <span>{job.awaitingTurn ? 'Waiting for the next turn' : formatDate(job.scheduledAt)}</span>
            </div>
            {job.lastError && (
              <div className="text-xs qt-text-destructive mt-1 truncate">
                Error: {job.lastError}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-right qt-text-xs whitespace-nowrap">
            ~{formatTokenCount(job.estimatedTokens)} tokens
          </div>
          {/* Job Action Buttons */}
          <div className="flex items-center gap-1">
            {/* Pause/Resume Button */}
            {job.status === 'PAUSED' ? (
              <button
                onClick={() => onResume(job.id)}
                disabled={jobActionLoading === job.id}
                className="p-1 rounded hover:qt-bg-success/10 qt-text-success"
                title="Resume"
                aria-label="Resume"
              >
                <Icon name="play" className="w-4 h-4" />
              </button>
            ) : ['PENDING', 'FAILED'].includes(job.status) ? (
              <button
                onClick={() => onPause(job.id)}
                disabled={jobActionLoading === job.id}
                className="p-1 rounded hover:qt-bg-warning/10 qt-text-warning"
                title="Pause"
                aria-label="Pause"
              >
                <Icon name="pause" className="w-4 h-4" />
              </button>
            ) : null}
            {/* View Button */}
            <button
              onClick={() => onView(job.id)}
              disabled={jobActionLoading === job.id}
              className="p-1 rounded hover:qt-bg-info/10 qt-text-info"
              title="View Details"
              aria-label="View Details"
            >
              <Icon name="eye" className="w-4 h-4" />
            </button>
            {/* Delete Button */}
            {job.status !== 'PROCESSING' && (
              <button
                onClick={() => onDelete(job.id)}
                disabled={jobActionLoading === job.id}
                className="p-1 rounded hover:qt-bg-destructive/10 qt-text-destructive"
                title="Delete"
                aria-label="Delete"
              >
                <Icon name="trash" className="w-4 h-4" />
              </button>
            )}
            {/* Loading indicator */}
            {jobActionLoading === job.id && (
              <Spinner className="w-4 h-4 qt-text-secondary" />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
