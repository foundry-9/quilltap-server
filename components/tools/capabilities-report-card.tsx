'use client'

import { useState } from 'react'
import useSWR from 'swr'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { showConfirmation } from '@/lib/alert'
import { getErrorMessage } from '@/lib/error-utils'
import { formatBytes } from '@/lib/utils/format-bytes'
import { formatDateTime } from '@/lib/format-time'
import { CapabilitiesReportDialog } from './capabilities-report-dialog'
import { Icon } from '@/components/ui/icon'

interface ReportInfo {
  id: string
  filename: string
  storageKey: string
  createdAt: string
  size: number
}

export function CapabilitiesReportCard() {
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadingReportId, setLoadingReportId] = useState<string | null>(null)

  // Dialog state
  const [showDialog, setShowDialog] = useState(false)
  const [selectedReport, setSelectedReport] = useState<{
    id: string
    filename: string
    content: string
  } | null>(null)

  const { data, isLoading, error: loadError, mutate: mutateReports } = useSWR<{ reports: ReportInfo[] }>(
    '/api/v1/system/tools?action=capabilities-report-list'
  )
  const reports = data?.reports ?? []

  const handleGenerateReport = async () => {
    try {
      setGenerating(true)
      setError(null)

      const res = await fetch('/api/v1/system/tools?action=capabilities-report-generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to generate report')
      }

      const data = await res.json()

      showSuccessToast('Report generated successfully')

      // Show the report immediately
      setSelectedReport({
        id: data.reportId,
        filename: data.filename,
        content: data.content,
      })
      setShowDialog(true)

      // Refresh the list
      await mutateReports()
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      setError(errorMessage)
      console.error('Failed to generate capabilities report', { error: errorMessage })
      showErrorToast(errorMessage)
    } finally {
      setGenerating(false)
    }
  }

  const handleViewReport = async (report: ReportInfo) => {
    try {
      setLoadingReportId(report.id)

      const res = await fetch(`/api/v1/system/tools?action=capabilities-report-get&reportId=${report.id}`)
      if (!res.ok) throw new Error('Failed to load report')

      const data = await res.json()
      setSelectedReport({
        id: report.id,
        filename: report.filename,
        content: data.content,
      })
      setShowDialog(true)
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      console.error('Failed to view report', { error: errorMessage })
      showErrorToast('Failed to load report')
    } finally {
      setLoadingReportId(null)
    }
  }

  const handleDeleteReport = async (report: ReportInfo) => {
    const confirmed = await showConfirmation(
      `Are you sure you want to delete "${report.filename}"?`
    )
    if (!confirmed) return

    try {
      const res = await fetch('/api/v1/system/tools?action=capabilities-report-delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reportId: report.id }),
      })

      if (!res.ok) throw new Error('Failed to delete report')

      showSuccessToast('Report deleted')
      await mutateReports()
    } catch (err) {
      const errorMessage = getErrorMessage(err)
      console.error('Failed to delete report', { error: errorMessage })
      showErrorToast('Failed to delete report')
    }
  }

  const formatDate = formatDateTime

  return (
    <div className="qt-card p-6">
      {/* Header */}
      <div className="flex items-start gap-4 mb-6">
        <div className="flex-1">
          <h2 className="qt-heading-2 text-foreground mb-1">
            Capabilities Report
          </h2>
          <p className="qt-text-small">
            Generate a comprehensive report of your system configuration
          </p>
        </div>
        <div className="flex-shrink-0 text-primary">
          <svg
            className="w-8 h-8"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="qt-bg-destructive/10 border qt-border-destructive qt-text-destructive px-4 py-3 rounded mb-4">
          {error}
        </div>
      )}

      {/* Generate Button */}
      <div className="mb-6">
        <button
          onClick={handleGenerateReport}
          disabled={generating}
          className="qt-button qt-button-primary w-full flex items-center justify-center gap-2"
        >
          {generating ? (
            <>
              <svg
                className="w-5 h-5 animate-spin"
                fill="none"
                viewBox="0 0 24 24"
              >
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
              Generating Report...
            </>
          ) : (
            <>
              <svg
                className="w-5 h-5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
              Generate Report
            </>
          )}
        </button>
      </div>

      {/* Previous Reports Section */}
      <div>
        <h3 className="qt-heading-4 text-foreground mb-3">
          Previous Reports
        </h3>

        {isLoading && !generating ? (
          <div className="text-center py-6 qt-text-secondary">
            <svg
              className="animate-spin h-6 w-6 mx-auto mb-2"
              fill="none"
              viewBox="0 0 24 24"
            >
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
            Loading reports...
          </div>
        ) : reports.length === 0 ? (
          <div className="qt-card p-6 text-center">
            <Icon name="file" className="w-12 h-12 mx-auto mb-3 qt-text-secondary/50" />
            <p className="qt-text-small">
              No reports yet. Generate one to get started.
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[180px] overflow-y-auto">
            {reports.map((report) => (
              <div
                key={report.id}
                className="qt-card p-4 flex items-center justify-between hover:qt-bg-muted/50 transition-colors"
              >
                <div className="flex-1 min-w-0">
                  <p className="qt-text-primary truncate">
                    {report.filename}
                  </p>
                  <div className="flex gap-4 mt-1 qt-text-small">
                    <span>{formatDate(report.createdAt)}</span>
                    <span>{formatBytes(report.size)}</span>
                  </div>
                </div>
                <div className="ml-4 flex items-center gap-2">
                  {/* View Button */}
                  <button
                    onClick={() => handleViewReport(report)}
                    className="qt-button qt-button-icon qt-button-secondary p-2"
                    title="View Report"
                  >
                    <Icon name="eye" className="w-4 h-4" />
                  </button>

                  {/* Download Button */}
                  <a
                    href={`/api/v1/system/tools?action=capabilities-report-get&reportId=${report.id}&download=true`}
                    download={report.filename}
                    className="qt-button qt-button-icon qt-button-primary p-2"
                    title="Download Report"
                  >
                    <Icon name="download" className="w-4 h-4" />
                  </a>

                  {/* Delete Button */}
                  <button
                    onClick={() => handleDeleteReport(report)}
                    className="qt-button qt-button-icon qt-button-destructive p-2"
                    title="Delete Report"
                  >
                    <Icon name="trash" className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Report Viewer Dialog */}
      {selectedReport && (
        <CapabilitiesReportDialog
          isOpen={showDialog}
          onClose={() => {
            setShowDialog(false)
            setSelectedReport(null)
          }}
          reportId={selectedReport.id}
          filename={selectedReport.filename}
          content={selectedReport.content}
        />
      )}
    </div>
  )
}
