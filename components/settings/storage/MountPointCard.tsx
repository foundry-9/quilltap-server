'use client'

import { useState } from 'react'
import { HealthBadge } from './HealthBadge'
import { SettingsCard, SettingsCardBadge, SettingsCardAction, SettingsCardStatusMessage } from '@/components/ui/SettingsCard'
import type { MountPoint, ConnectionTestResult, AvailableBackend } from './types'

interface MountPointCardProps {
  mountPoint: MountPoint
  backend?: AvailableBackend
  onEdit: (mountPoint: MountPoint) => void
  onDelete: (id: string) => Promise<boolean>
  onTestConnection: (id: string) => Promise<ConnectionTestResult>
  onSetDefault: (id: string) => Promise<boolean>
  onScanOrphans?: (mountPoint: MountPoint) => void
}

/**
 * Card component displaying a single mount point
 * Uses SettingsCard for consistent styling with footer-positioned actions
 */
export function MountPointCard({
  mountPoint,
  backend,
  onEdit,
  onDelete,
  onTestConnection,
  onSetDefault,
  onScanOrphans,
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
      console.error('Connection test failed', { error })
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
      console.error('Delete failed', { error })
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirm(false)
    }
  }

  const handleSetDefault = async () => {
    try {
      await onSetDefault(mountPoint.id)
    } catch (error) {
      console.error('Set default failed', { error })
    }
  }

  const backendDisplayName = backend?.displayName || mountPoint.backendType

  // Build badges array
  const badges: SettingsCardBadge[] = []
  if (!mountPoint.enabled) {
    badges.push({ text: 'Disabled', variant: 'muted' })
  }
  badges.push({ text: backendDisplayName, variant: 'info' })
  badges.push({ text: mountPoint.scope === 'system' ? 'System' : 'User', variant: 'muted' })
  if (mountPoint.isDefault) {
    badges.push({ text: 'Default', variant: 'success' })
  }

  // Build actions array
  const actions: SettingsCardAction[] = [
    {
      label: 'Test Connection',
      onClick: handleTest,
      variant: 'secondary',
      loading: isTesting,
      loadingLabel: 'Testing...',
    },
    {
      label: 'Edit',
      onClick: () => onEdit(mountPoint),
      variant: 'secondary',
    },
  ]

  if (onScanOrphans) {
    actions.push({
      label: 'Scan Orphans',
      onClick: () => onScanOrphans(mountPoint),
      variant: 'secondary',
    })
  }

  if (!mountPoint.isDefault) {
    actions.push({
      label: 'Set as Default',
      onClick: handleSetDefault,
      variant: 'secondary',
    })
  }

  // Build status message from test result
  let statusMessage: SettingsCardStatusMessage | undefined
  if (testResult) {
    statusMessage = {
      text: testResult.message,
      variant: testResult.success ? 'success' : 'error',
      details: testResult.latencyMs !== undefined && testResult.success
        ? `${testResult.latencyMs}ms`
        : undefined,
    }
  }

  return (
    <SettingsCard
      title={mountPoint.name}
      subtitle={mountPoint.description || undefined}
      badges={badges}
      actions={actions}
      actionsPosition="footer"
      statusMessage={statusMessage}
      headerExtra={<HealthBadge status={mountPoint.healthStatus} />}
      deleteConfig={{
        isConfirming: showDeleteConfirm,
        onConfirmChange: setShowDeleteConfirm,
        onConfirm: handleDelete,
        message: 'Delete this mount point? Files stored on this mount point will become orphaned but can be recovered by recreating a mount point with the same configuration.',
        isDeleting: isDeleting,
      }}
    />
  )
}
