'use client'

import { ReactNode } from 'react'
import { DeleteConfirmPopover } from './DeleteConfirmPopover'

/**
 * Badge configuration for settings cards
 */
export interface SettingsCardBadge {
  /** Badge text content */
  text: string
  /** Visual variant - maps to qt-badge-* classes */
  variant: 'default' | 'cheap' | 'cheapDefault' | 'success' | 'warning' | 'info' | 'muted' | 'destructive'
  /** Optional icon element to display before text */
  icon?: ReactNode
}

/**
 * Metadata row configuration for settings cards
 */
export interface SettingsCardMetadata {
  /** Label for the metadata row */
  label: string
  /** Value to display - can be string or custom ReactNode */
  value: string | ReactNode
  /** If true, show in small text style */
  small?: boolean
}

/**
 * Action button configuration for settings cards
 */
export interface SettingsCardAction {
  /** Button label */
  label: string
  /** Click handler */
  onClick: () => void
  /** Visual variant */
  variant?: 'primary' | 'secondary' | 'destructive'
  /** Whether button is disabled */
  disabled?: boolean
  /** Loading state with custom label */
  loadingLabel?: string
  /** Whether action is loading */
  loading?: boolean
}

/**
 * Status message configuration for cards with test results or status indicators
 */
export interface SettingsCardStatusMessage {
  /** Status message text */
  text: string
  /** Visual variant for styling */
  variant: 'success' | 'error' | 'info' | 'warning'
  /** Optional additional details (e.g., latency) */
  details?: string
}

/**
 * Delete confirmation configuration
 */
export interface SettingsCardDeleteConfig {
  /** Whether delete confirmation is currently showing */
  isConfirming: boolean
  /** Handler to toggle confirmation state */
  onConfirmChange: (confirming: boolean) => void
  /** Handler when delete is confirmed */
  onConfirm: () => void
  /** Confirmation message */
  message?: string
  /** Whether delete operation is in progress */
  isDeleting?: boolean
}

/**
 * Props for the SettingsCard component
 */
export interface SettingsCardProps {
  /** Card title */
  title: string
  /** Subtitle shown below title */
  subtitle?: string
  /** Array of badges to display after title */
  badges?: SettingsCardBadge[]
  /** Metadata rows displayed in a grid */
  metadata?: SettingsCardMetadata[]
  /** Number of columns for metadata grid (default: 2) */
  metadataColumns?: 1 | 2 | 3 | 4
  /** Action buttons */
  actions?: SettingsCardAction[]
  /** Custom content rendered after metadata */
  children?: ReactNode
  /** Where to position action buttons: 'inline' (right-aligned) or 'footer' (bottom) */
  actionsPosition?: 'inline' | 'footer'
  /** Status message to display (e.g., test results) */
  statusMessage?: SettingsCardStatusMessage
  /** Extra content for header area (e.g., health badges) */
  headerExtra?: ReactNode
  /** Delete confirmation config - if provided, shows delete button with popover */
  deleteConfig?: SettingsCardDeleteConfig
}

/**
 * Maps badge variant to qt-badge-* class
 */
const getBadgeClass = (variant: SettingsCardBadge['variant']): string => {
  switch (variant) {
    case 'default':
    case 'success':
      return 'qt-badge-success'
    case 'cheap':
    case 'warning':
      return 'qt-badge-warning'
    case 'cheapDefault':
    case 'info':
      return 'qt-badge-info'
    case 'destructive':
      return 'qt-badge-destructive'
    case 'muted':
      return 'qt-badge-secondary'
    default:
      return 'qt-badge-secondary'
  }
}

/**
 * Maps action variant to qt-button-* class
 */
const getActionClass = (variant: SettingsCardAction['variant']): string => {
  switch (variant) {
    case 'primary':
      return 'qt-button-primary qt-button-sm'
    case 'destructive':
      return 'qt-button-destructive qt-button-sm'
    case 'secondary':
    default:
      return 'qt-button-secondary qt-button-sm'
  }
}

/**
 * Maps status variant to appropriate styling classes
 */
const getStatusClass = (variant: SettingsCardStatusMessage['variant']): string => {
  switch (variant) {
    case 'success':
      return 'qt-alert-success'
    case 'error':
      return 'qt-alert-error'
    case 'warning':
      return 'qt-alert-warning'
    case 'info':
    default:
      return 'qt-alert-info'
  }
}

/**
 * Maps metadata columns to grid class
 */
const getMetadataGridClass = (columns: 1 | 2 | 3 | 4): string => {
  switch (columns) {
    case 1:
      return 'grid-cols-1'
    case 3:
      return 'grid-cols-3'
    case 4:
      return 'grid-cols-4'
    case 2:
    default:
      return 'grid-cols-2'
  }
}

/**
 * Renders action buttons for both inline and footer positions
 */
function ActionButtons({
  actions,
  deleteConfig,
}: {
  actions: SettingsCardAction[]
  deleteConfig?: SettingsCardDeleteConfig
}) {
  return (
    <>
      {actions.map((action, index) => (
        <button
          key={index}
          onClick={action.onClick}
          disabled={action.disabled || action.loading}
          className={getActionClass(action.variant)}
        >
          {action.loading ? action.loadingLabel || 'Loading...' : action.label}
        </button>
      ))}

      {/* Delete button with confirmation popover */}
      {deleteConfig && (
        <div className="relative">
          <button
            onClick={() => deleteConfig.onConfirmChange(!deleteConfig.isConfirming)}
            className="qt-button-destructive qt-button-sm"
          >
            Delete
          </button>

          <DeleteConfirmPopover
            isOpen={deleteConfig.isConfirming}
            onCancel={() => deleteConfig.onConfirmChange(false)}
            onConfirm={deleteConfig.onConfirm}
            message={deleteConfig.message || 'Delete this item?'}
            isDeleting={deleteConfig.isDeleting}
          />
        </div>
      )}
    </>
  )
}

/**
 * A comprehensive card component for settings pages.
 * Provides consistent styling across all settings tabs with support for
 * badges, metadata grids, action buttons, status messages, and delete confirmation.
 *
 * Uses qt-* utility classes for consistent theming.
 *
 * @example
 * ```tsx
 * // Basic usage with inline actions (default)
 * <SettingsCard
 *   title="My Profile"
 *   subtitle="OPENAI - gpt-4"
 *   badges={[{ text: 'Default', variant: 'success' }]}
 *   metadata={[
 *     { label: 'API Key', value: 'my-key' },
 *     { label: 'Model', value: 'gpt-4' },
 *   ]}
 *   actions={[
 *     { label: 'Edit', onClick: handleEdit, variant: 'secondary' },
 *   ]}
 *   deleteConfig={{
 *     isConfirming: deleteId === id,
 *     onConfirmChange: (c) => setDeleteId(c ? id : null),
 *     onConfirm: handleDelete,
 *     isDeleting: deleteLoading,
 *   }}
 * />
 *
 * // With footer actions and status message (like MountPointCard)
 * <SettingsCard
 *   title="Local Storage"
 *   subtitle="files/"
 *   actionsPosition="footer"
 *   headerExtra={<HealthBadge status="healthy" />}
 *   statusMessage={{
 *     text: 'Connection successful',
 *     variant: 'success',
 *     details: '45ms',
 *   }}
 *   actions={[
 *     { label: 'Test', onClick: handleTest },
 *     { label: 'Edit', onClick: handleEdit },
 *   ]}
 * />
 * ```
 */
export function SettingsCard({
  title,
  subtitle,
  badges = [],
  metadata = [],
  metadataColumns = 2,
  actions = [],
  children,
  actionsPosition = 'inline',
  statusMessage,
  headerExtra,
  deleteConfig,
}: SettingsCardProps) {
  const hasActions = actions.length > 0 || deleteConfig
  const showInlineActions = hasActions && actionsPosition === 'inline'
  const showFooterActions = hasActions && actionsPosition === 'footer'

  return (
    <div className="border border-border rounded-lg p-4 bg-card shadow-sm space-y-3">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {/* Title row with badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="qt-card-title truncate">{title}</h3>
            {badges.map((badge, index) => (
              <span
                key={index}
                className={`${getBadgeClass(badge.variant)} flex items-center gap-1`}
              >
                {badge.icon}
                {badge.text}
              </span>
            ))}
          </div>

          {/* Subtitle */}
          {subtitle && (
            <p className="qt-card-description mt-1">{subtitle}</p>
          )}
        </div>

        {/* Header extra (e.g., health badge) */}
        {headerExtra && (
          <div className="flex-shrink-0 ml-2">
            {headerExtra}
          </div>
        )}

        {/* Inline actions */}
        {showInlineActions && (
          <div className="flex gap-2 ml-4 flex-shrink-0">
            <ActionButtons actions={actions} deleteConfig={deleteConfig} />
          </div>
        )}
      </div>

      {/* Metadata grid */}
      {metadata.length > 0 && (
        <div className={`grid ${getMetadataGridClass(metadataColumns)} gap-4 qt-text-small`}>
          {metadata.map((item, index) => (
            <div key={index}>
              <p className="qt-text-xs uppercase">{item.label}</p>
              <p className={item.small ? 'qt-text-small' : 'text-sm text-foreground'}>
                {item.value}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Custom children content */}
      {children}

      {/* Status message (e.g., test results) */}
      {statusMessage && (
        <div className={`p-2 rounded text-sm ${getStatusClass(statusMessage.variant)}`}>
          {statusMessage.text}
          {statusMessage.details && (
            <span className="ml-2 text-xs opacity-75">({statusMessage.details})</span>
          )}
        </div>
      )}

      {/* Footer actions */}
      {showFooterActions && (
        <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-border">
          <ActionButtons actions={actions} deleteConfig={deleteConfig} />
        </div>
      )}
    </div>
  )
}

export default SettingsCard
