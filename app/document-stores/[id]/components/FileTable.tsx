'use client'

/**
 * File Table
 *
 * Displays indexed files for a document store in a table layout
 * with size, sync status, conversion status, and embedding info.
 */

import { useState, useMemo } from 'react'
import type { DocumentStoreFile } from '../../types'

interface FileTableProps {
  files: DocumentStoreFile[]
  loading: boolean
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function FileTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    markdown: 'bg-green-500/20 text-green-400',
    txt: 'bg-gray-500/20 text-gray-400',
    pdf: 'bg-red-500/20 text-red-400',
    docx: 'bg-blue-500/20 text-blue-400',
  }
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${colors[type] || 'bg-gray-500/20 text-gray-400'}`}>
      {type.toUpperCase()}
    </span>
  )
}

function ConversionBadge({ status, error }: { status: string; error: string | null }) {
  const styles: Record<string, string> = {
    converted: 'bg-green-500/20 text-green-400',
    pending: 'bg-amber-500/20 text-amber-400',
    failed: 'bg-red-500/20 text-red-400',
    skipped: 'bg-gray-500/20 text-gray-400',
  }
  return (
    <span
      className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium ${styles[status] || 'bg-gray-500/20 text-gray-400'}`}
      title={error || undefined}
    >
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

function EmbeddingIndicator({ chunkCount }: { chunkCount: number }) {
  if (chunkCount === 0) {
    return <span className="text-xs qt-text-secondary">None</span>
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-green-400" />
      {chunkCount} chunk{chunkCount !== 1 ? 's' : ''}
    </span>
  )
}

type SortField = 'fileName' | 'fileType' | 'fileSizeBytes' | 'conversionStatus' | 'chunkCount' | 'lastModified'
type SortDir = 'asc' | 'desc'

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) {
    return (
      <svg className="w-3 h-3 ml-1 qt-text-secondary opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    )
  }
  return (
    <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      {dir === 'asc' ? (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
      ) : (
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
      )}
    </svg>
  )
}

export function FileTable({ files, loading }: FileTableProps) {
  const [sortField, setSortField] = useState<SortField>('fileName')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [filter, setFilter] = useState('')

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  const filteredAndSorted = useMemo(() => {
    let result = files
    if (filter) {
      const lower = filter.toLowerCase()
      result = result.filter(f =>
        f.fileName.toLowerCase().includes(lower) ||
        f.relativePath.toLowerCase().includes(lower) ||
        f.fileType.toLowerCase().includes(lower)
      )
    }
    return [...result].sort((a, b) => {
      const aVal = a[sortField]
      const bVal = b[sortField]
      const cmp = typeof aVal === 'string'
        ? aVal.localeCompare(bVal as string)
        : (aVal as number) - (bVal as number)
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [files, filter, sortField, sortDir])

  const totalSize = useMemo(() =>
    files.reduce((sum, f) => sum + f.fileSizeBytes, 0),
    [files]
  )

  const totalChunks = useMemo(() =>
    files.reduce((sum, f) => sum + f.chunkCount, 0),
    [files]
  )

  const conversionStats = useMemo(() => ({
    converted: files.filter(f => f.conversionStatus === 'converted').length,
    pending: files.filter(f => f.conversionStatus === 'pending').length,
    failed: files.filter(f => f.conversionStatus === 'failed').length,
    skipped: files.filter(f => f.conversionStatus === 'skipped').length,
  }), [files])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <p className="qt-text-secondary">Loading files...</p>
      </div>
    )
  }

  return (
    <div>
      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <div className="flex items-center gap-6 text-sm">
          <span className="qt-text-secondary">
            <strong className="text-foreground">{files.length}</strong> files
          </span>
          <span className="qt-text-secondary">
            <strong className="text-foreground">{formatBytes(totalSize)}</strong> total
          </span>
          <span className="qt-text-secondary">
            <strong className="text-foreground">{totalChunks}</strong> chunks
          </span>
          {conversionStats.converted > 0 && (
            <span className="text-green-400 text-xs">{conversionStats.converted} converted</span>
          )}
          {conversionStats.pending > 0 && (
            <span className="text-amber-400 text-xs">{conversionStats.pending} pending</span>
          )}
          {conversionStats.failed > 0 && (
            <span className="text-red-400 text-xs">{conversionStats.failed} failed</span>
          )}
        </div>
        <div className="ml-auto">
          <input
            type="text"
            placeholder="Filter files..."
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="qt-input text-sm py-1 px-3 w-48"
          />
        </div>
      </div>

      {files.length === 0 ? (
        <div className="rounded-2xl border border-dashed qt-border-default/70 qt-bg-card/80 px-8 py-12 text-center qt-shadow-sm">
          <p className="qt-text-secondary">No files indexed yet. Run a scan to discover files.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border qt-border-default qt-bg-card">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b qt-border-default">
                {([
                  ['fileName', 'File'],
                  ['fileType', 'Type'],
                  ['fileSizeBytes', 'Size'],
                  ['conversionStatus', 'Status'],
                  ['chunkCount', 'Embeddings'],
                  ['lastModified', 'Modified'],
                ] as [SortField, string][]).map(([field, label]) => (
                  <th
                    key={field}
                    onClick={() => handleSort(field)}
                    className="px-4 py-3 text-left text-xs font-medium qt-text-secondary uppercase tracking-wider cursor-pointer hover:text-foreground select-none"
                  >
                    <span className="inline-flex items-center">
                      {label}
                      <SortIcon active={sortField === field} dir={sortDir} />
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredAndSorted.map((file) => (
                <tr key={file.id} className="border-b qt-border-default/50 hover:qt-bg-muted/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground truncate max-w-xs" title={file.relativePath}>
                      {file.fileName}
                    </div>
                    <div className="text-xs qt-text-secondary truncate max-w-xs" title={file.relativePath}>
                      {file.relativePath}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <FileTypeBadge type={file.fileType} />
                  </td>
                  <td className="px-4 py-3 text-foreground whitespace-nowrap">
                    {formatBytes(file.fileSizeBytes)}
                  </td>
                  <td className="px-4 py-3">
                    <ConversionBadge status={file.conversionStatus} error={file.conversionError || null} />
                  </td>
                  <td className="px-4 py-3">
                    <EmbeddingIndicator chunkCount={file.chunkCount} />
                  </td>
                  <td className="px-4 py-3 text-xs qt-text-secondary whitespace-nowrap">
                    {new Date(file.lastModified).toLocaleDateString(undefined, {
                      month: 'short', day: 'numeric', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
