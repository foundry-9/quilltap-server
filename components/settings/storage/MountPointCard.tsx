'use client'

import { useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { HealthBadge } from './HealthBadge'
import type { MountPoint, ConnectionTestResult, AvailableBackend } from './types'

interface MountPointCardProps {
  mountPoint: MountPoint
  backend?: AvailableBackend
  onEdit: (mountPoint: MountPoint) => void
  onDelete: (id: string) => Promise<boolean>
  onTestConnection: (id: string) => Promise<ConnectionTestResult>
  onSetDefault: (id: string, type: 'general' | 'project') => Promise<boolean>
}

/**
 * Card component displaying a single mount point
 */
export function MountPointCard({
  mountPoint,
  backend,
  onEdit,
  onDelete,
  onTestConnection,
  onSetDefault,
}: MountPointCardProps) {
  const [isTesting, setIsTesting] = useState(false)
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

  const handleTest = async () => {
    setIsTesting(true)
    setTestResult(null)

    try {
      const result = await onTestConnection(mountPoint.id)
      setTestResult(result)
    } catch (error) {
      clientLogger.error('Connection test failed', { error })
      setTestResult({
        success: false,
        message: error instanceof Error ? error.message : 'Connection test failed',
      })
    } finally {
      setIsTesting(false)
    }
  }

  const handleDelete = async () => {
    setIsDeleting(true)
    try {
      await onDelete(mountPoint.id)
    } catch (error) {
      clientLogger.error('Delete failed', { error })
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleSetDefault = async (type: 'general' | 'project') => {
    try {
      await onSetDefault(mountPoint.id, type)
    } catch (error) {
      clientLogger.error('Set default failed', { error })
    }
  }

  const backendDisplayName = backend?.displayName || mountPoint.backendType

  return (
    <div className="qt-card p-4 space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="qt-text font-medium truncate">{mountPoint.name}</h3>
            {!mountPoint.enabled && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                Disabled
              </span>
            )}
          </div>
          {mountPoint.description && (
            <p className="qt-text-small text-muted-foreground mt-1 line-clamp-2">
              {mountPoint.description}
            </p>
          )}
        </div>
        <HealthBadge status={mountPoint.healthStatus} />
      </div>

      {/* Backend info */}
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300">
          {backendDisplayName}
        </span>
        <span className="text-muted-foreground">
          {mountPoint.scope === 'system' ? 'System' : 'User'} scope
        </span>
        {mountPoint.isDefault && (
          <span className="px-2 py-0.5 text-xs rounded-full bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300">
            Default
          </span>
        )}
        {mountPoint.isProjectDefault && (
          <span className="px-2 py-0.5 text-xs rounded-full bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300">
            Project Default
          </span>
        )}
      </div>

      {/* Test result */}
      {testResult && (
        <div
          className={`p-2 rounded text-sm ${
            testResult.success
              ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300'
              : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
          }`}
        >
          {testResult.message}
          {testResult.latencyMs !== undefined && testResult.success && (
            <span className="ml-2 text-xs opacity-75">({testResult.latencyMs}ms)</span>
          )}
        </div>
      )}

      {/* Delete confirmation */}
      {showDeleteConfirm && (
        <div className="p-3 rounded bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800">
          <p className="text-sm text-red-700 dark:text-red-300 mb-2">
            Delete this mount point? Files stored on this mount point will become orphaned but can be
            recovered by recreating a mount point with the same configuration.
          </p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              disabled={isDeleting}
              className="qt-button qt-button-danger text-sm"
            >
              {isDeleting ? 'Deleting...' : 'Confirm Delete'}
            </button>
            <button
              onClick={() => setShowDeleteConfirm(false)}
              className="qt-button qt-button-secondary text-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Actions */}
      {!showDeleteConfirm && (
        <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
          <button
            onClick={handleTest}
            disabled={isTesting}
            className="qt-button qt-button-secondary text-sm"
          >
            {isTesting ? 'Testing...' : 'Test Connection'}
          </button>
          <button onClick={() => onEdit(mountPoint)} className="qt-button qt-button-secondary text-sm">
            Edit
          </button>
          {!mountPoint.isDefault && (
            <button
              onClick={() => handleSetDefault('general')}
              className="qt-button qt-button-secondary text-sm"
            >
              Set as Default
            </button>
          )}
          {!mountPoint.isProjectDefault && (
            <button
              onClick={() => handleSetDefault('project')}
              className="qt-button qt-button-secondary text-sm"
            >
              Set as Project Default
            </button>
          )}
          <button
            onClick={() => setShowDeleteConfirm(true)}
            className="qt-button qt-button-danger text-sm ml-auto"
          >
            Delete
          </button>
        </div>
      )}
    </div>
  )
}
