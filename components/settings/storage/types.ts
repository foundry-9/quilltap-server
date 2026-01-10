/**
 * Storage Settings Types
 *
 * Type definitions for mount points and file storage configuration UI
 */

import type { MountPoint, MountPointBackendType, HealthStatus } from '@/lib/file-storage/mount-point.types'

// Re-export types from mount-point.types for convenience
export type { MountPoint, MountPointBackendType, HealthStatus }

/**
 * Available file backend types from registered plugins
 */
export interface AvailableBackend {
  backendId: string
  displayName: string
  description: string
  configFields: BackendConfigField[]
}

/**
 * Configuration field definition for backend plugins
 */
export interface BackendConfigField {
  name: string
  label: string
  type: 'string' | 'secret' | 'boolean' | 'number'
  required: boolean
  description?: string
  placeholder?: string
  defaultValue?: string | boolean | number
}

/**
 * Form data for creating/editing a mount point
 */
export interface MountPointFormData {
  name: string
  description?: string
  backendType: string
  backendConfig: Record<string, unknown>
  scope: 'system' | 'user'
  enabled: boolean
}

/**
 * Mount point summary with derived information
 */
export interface MountPointSummary extends MountPoint {
  backend?: AvailableBackend
  fileCount?: number
}

/**
 * Test connection result
 */
export interface ConnectionTestResult {
  success: boolean
  message: string
  latencyMs?: number
}

/**
 * Health status badge classes using qt-* theme utility classes
 */
export const HEALTH_STATUS_BADGE_CLASSES: Record<HealthStatus, string> = {
  healthy: 'qt-badge-success',
  degraded: 'qt-badge-warning',
  unhealthy: 'qt-badge-destructive',
  unknown: 'qt-badge-secondary',
}

/**
 * Health status labels for UI
 */
export const HEALTH_STATUS_LABELS: Record<HealthStatus, string> = {
  healthy: 'Healthy',
  degraded: 'Degraded',
  unhealthy: 'Unhealthy',
  unknown: 'Unknown',
}
