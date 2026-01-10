'use client'

import { useEffect, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { useMountPoints } from './hooks/useMountPoints'
import { MountPointModal } from './MountPointModal'
import { MountPointList } from './MountPointList'
import type { MountPoint } from './types'

// Re-export types and utilities for consumers
export type {
  MountPoint,
  AvailableBackend,
  BackendConfigField,
  MountPointFormData,
  ConnectionTestResult,
  HealthStatus,
} from './types'
export { HEALTH_STATUS_BADGE_CLASSES, HEALTH_STATUS_LABELS } from './types'
export { useMountPoints } from './hooks/useMountPoints'
export { MountPointForm } from './MountPointForm'
export { MountPointList } from './MountPointList'
export { MountPointCard } from './MountPointCard'
export { HealthBadge } from './HealthBadge'

/**
 * Main storage settings tab component
 */
export default function StorageSettingsTab() {
  // UI states
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingMountPoint, setEditingMountPoint] = useState<MountPoint | null>(null)

  // Data hook
  const {
    mountPoints,
    availableBackends,
    loading: initialLoading,
    error: loadError,
    loadData,
    fetchMountPoints,
    createMountPoint,
    updateMountPoint,
    deleteMountPoint,
    testConnection,
    setDefault,
  } = useMountPoints()

  // Load initial data on mount only
  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // loadData is stable

  const handleEdit = (mountPoint: MountPoint) => {
    clientLogger.debug('Editing mount point', { mountPointId: mountPoint.id })
    setEditingMountPoint(mountPoint)
    setIsModalOpen(true)
  }

  const handleOpenModal = () => {
    clientLogger.debug('Opening new mount point modal')
    setEditingMountPoint(null)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    clientLogger.debug('Closing mount point modal')
    setIsModalOpen(false)
    setEditingMountPoint(null)
  }

  const handleModalSuccess = async () => {
    clientLogger.debug('Mount point saved via modal')
    await fetchMountPoints()
  }

  // Show loading state during initial load
  if (initialLoading) {
    return <LoadingState message="Loading storage configuration..." />
  }

  return (
    <div className="space-y-6">
      {/* Header with description and action */}
      <div>
        <SectionHeader
          title="File Storage"
          level="h2"
          action={{
            label: 'New Mount Point',
            onClick: handleOpenModal,
          }}
        />
        <p className="qt-text-small text-muted-foreground">
          Configure where files are stored. You can use local filesystem storage or connect to S3-compatible
          cloud storage.
        </p>
      </div>

      {/* Load error alert */}
      {loadError && (
        <ErrorAlert
          message={loadError}
          onRetry={() => {
            clientLogger.debug('Retrying load')
            window.location.reload()
          }}
        />
      )}

      {/* Info box about default behavior */}
      {mountPoints.length === 0 && (
        <div className="qt-card p-4 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
          <h3 className="qt-text font-medium text-blue-700 dark:text-blue-300 mb-1">
            Default Storage
          </h3>
          <p className="qt-text-small text-blue-600 dark:text-blue-400">
            When no mount points are configured, files are stored locally at the path specified by the
            QUILLTAP_FILE_STORAGE_PATH environment variable (default: ./data/files).
          </p>
        </div>
      )}

      {/* Mount Points List */}
      <MountPointList
        mountPoints={mountPoints}
        availableBackends={availableBackends}
        onEdit={handleEdit}
        onDelete={deleteMountPoint}
        onTestConnection={testConnection}
        onSetDefault={setDefault}
      />

      {/* Mount Point Modal - key ensures remount when switching mount points */}
      <MountPointModal
        key={editingMountPoint?.id || 'new'}
        isOpen={isModalOpen}
        onClose={handleCloseModal}
        onSuccess={handleModalSuccess}
        mountPoint={editingMountPoint}
        availableBackends={availableBackends}
        createMountPoint={createMountPoint}
        updateMountPoint={updateMountPoint}
      />
    </div>
  )
}
