'use client'

import { Icon } from '@/components/ui/icon'
import { BaseModal, ModalTitle } from '@/components/ui/BaseModal'
import type { FullJobDetail } from './types'
import { isHeldForNextTurn } from '@/lib/schemas/job.types'
import { jobStatusColor } from './job-status'
import { Spinner } from '@/components/ui/Spinner'

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
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      headerless
      maxWidth="2xl"
      className="w-full mx-4 !max-h-[80vh] overflow-hidden"
      bodyClassName="flex flex-col min-h-0 flex-1"
      footerClassName="flex items-center justify-between p-4 border-t qt-bg-muted/30"
      footer={
        <>
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
                <Spinner className="w-4 h-4" />
              ) : (
                <Icon name="trash" className="w-4 h-4" />
              )}
              Delete Job
            </button>
          )}
        </>
      }
    >
      {/* Dialog Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <ModalTitle className="qt-heading-4 qt-text">Job Details</ModalTitle>
          <p className="qt-text-small">{job.type}</p>
        </div>
        <button
          type="button"
          aria-label="Close"
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
            <div className={`font-medium ${jobStatusColor(job.status)}`}>
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
            <div className="font-medium text-sm">{isHeldForNextTurn(job) ? 'Waiting for the next turn' : formatDate(job.scheduledAt)}</div>
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
    </BaseModal>
  )
}
