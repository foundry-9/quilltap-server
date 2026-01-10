'use client'

import { MountPointCard } from './MountPointCard'
import type { MountPoint, AvailableBackend, ConnectionTestResult } from './types'

interface MountPointListProps {
  mountPoints: MountPoint[]
  availableBackends: AvailableBackend[]
  onEdit: (mountPoint: MountPoint) => void
  onDelete: (id: string) => Promise<boolean>
  onTestConnection: (id: string) => Promise<ConnectionTestResult>
  onSetDefault: (id: string) => Promise<boolean>
}

/**
 * List of mount point cards
 */
export function MountPointList({
  mountPoints,
  availableBackends,
  onEdit,
  onDelete,
  onTestConnection,
  onSetDefault,
}: MountPointListProps) {
  // Create a map of backends by ID for quick lookup
  const backendMap = new Map(availableBackends.map((b) => [b.backendId, b]))

  if (mountPoints.length === 0) {
    return (
      <div className="qt-card p-8 text-center">
        <div className="qt-text-small text-muted-foreground mb-4">
          No mount points configured. Create one to start storing files.
        </div>
        <p className="text-sm text-muted-foreground">
          A default local filesystem mount point will be used automatically if no mount points are
          configured.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {mountPoints.map((mountPoint) => (
        <MountPointCard
          key={mountPoint.id}
          mountPoint={mountPoint}
          backend={backendMap.get(mountPoint.backendType)}
          onEdit={onEdit}
          onDelete={onDelete}
          onTestConnection={onTestConnection}
          onSetDefault={onSetDefault}
        />
      ))}
    </div>
  )
}
