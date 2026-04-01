'use client'

import { useEffect, useState } from 'react'
import { SectionHeader } from '@/components/ui/SectionHeader'
import { LoadingState } from '@/components/ui/LoadingState'
import { ErrorAlert } from '@/components/ui/ErrorAlert'
import { useMountPoints } from './hooks/useMountPoints'
import { MountPointModal } from './MountPointModal'
import { MountPointList } from './MountPointList'
import { OrphanScanModal } from './OrphanScanModal'
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
  const [scanningMountPoint, setScanningMountPoint] = useState<MountPoint | null>(null)

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
    setEditingMountPoint(mountPoint)
    setIsModalOpen(true)
  }

  const handleOpenModal = () => {
    setEditingMountPoint(null)
    setIsModalOpen(true)
  }

  const handleCloseModal = () => {
    setIsModalOpen(false)
    setEditingMountPoint(null)
  }

  const handleModalSuccess = async () => {
    await fetchMountPoints()
  }

  const handleScanOrphans = (mountPoint: MountPoint) => {
    setScanningMountPoint(mountPoint)
  }

  const handleCloseScanModal = () => {
    setScanningMountPoint(null)
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
            window.location.reload()
          }}
        />
      )}

      {/* Info box about default behavior */}
      {mountPoints.length === 0 && (
        <div className="qt-alert-info">
          <h3 className="qt-text font-medium mb-1">
            Default Storage
          </h3>
          <p className="qt-text-small">
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
        onScanOrphans={handleScanOrphans}
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

      {/* Orphan Scan Modal */}
      {scanningMountPoint && (
        <OrphanScanModal
          isOpen={!!scanningMountPoint}
          onClose={handleCloseScanModal}
          mountPoint={scanningMountPoint}
        />
      )}
    </div>
  )
}
