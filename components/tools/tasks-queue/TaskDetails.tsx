'use client'

import { Icon } from '@/components/ui/icon'
import type { FullJobDetail } from './types'

interface TaskDetailsProps {
  job: FullJobDetail
  isOpen: boolean
  jobActionLoading: string | null
  onClose: () => void
  onDelete: () => void
  formatDate: (dateString: string) => string
}

export function TaskDetails({
  job,
  isOpen,
  jobActionLoading,
  onClose,
  onDelete,
  formatDate,
}: TaskDetailsProps) {
  if (!isOpen) return null

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'PROCESSING':
        return 'qt-text-info'
      case 'PENDING':
        return 'qt-text-warning'
      case 'FAILED':
        return 'qt-text-destructive'
      case 'PAUSED':
        return 'qt-text-warning'
      default:
        return 'qt-text-secondary'
    }
  }

  return (
    <div
      className="qt-dialog-overlay"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-lg qt-shadow-lg max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Dialog Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <div>
            <h3 className="qt-heading-4 text-foreground">Job Details</h3>
            <p className="qt-text-small">{job.type}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:qt-bg-muted"
          >
            <Icon name="close" className="w-5 h-5" />
          </button>
        </div>

        {/* Dialog Content */}
        <div className="p-4 overflow-y-auto max-h-[calc(80vh-140px)]">
          {/* Status and metadata */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <span className="qt-text-xs">Status</span>
              <div className={`font-medium ${getStatusColor(job.status)}`}>
                {job.status}
              </div>
            </div>
            <div>
              <span className="qt-text-xs">Priority</span>
              <div className="font-medium">{job.priority}</div>
            </div>
            <div>
              <span className="qt-text-xs">Attempts</span>
              <div className="font-medium">
                {job.attempts} / {job.maxAttempts}
              </div>
            </div>
            <div>
              <span className="qt-text-xs">Scheduled</span>
              <div className="font-medium text-sm">{formatDate(job.scheduledAt)}</div>
            </div>
          </div>

          {job.lastError && (
            <div className="mb-4">
              <span className="qt-text-xs">Last Error</span>
              <div className="text-sm qt-text-destructive qt-bg-destructive/10 p-2 rounded mt-1">
                {job.lastError}
              </div>
            </div>
          )}

          {/* Job parameters */}
          <div>
            <span className="qt-text-xs">Job Parameters</span>
            <pre className="mt-1 p-3 qt-bg-muted rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">
              {JSON.stringify(job.payload, null, 2)}
            </pre>
          </div>
        </div>

        {/* Dialog Footer */}
        <div className="flex items-center justify-between p-4 border-t qt-bg-muted/30">
          <button
            onClick={onClose}
            className="qt-button qt-button-secondary"
          >
            Close
          </button>
          {job.status !== 'PROCESSING' && (
            <button
              onClick={onDelete}
              disabled={jobActionLoading === job.id}
              className="qt-button qt-button-destructive"
            >
              {jobActionLoading === job.id ? (
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
              ) : (
                <Icon name="trash" className="w-4 h-4" />
              )}
              Delete Job
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
