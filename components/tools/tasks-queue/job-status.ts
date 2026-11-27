/**
 * The text colour a job's status wears in the queue list and its detail dialog.
 *
 * @module components/tools/tasks-queue/job-status
 */
export function jobStatusColor(status: string): string {
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
