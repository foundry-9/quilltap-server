'use client'

import { ReactNode } from 'react'
import { DeleteConfirmPopover } from './DeleteConfirmPopover'

export interface ProfileCardBadge {
  /** Badge text content */
  text: string
  /** Visual variant */
  variant: 'default' | 'cheap' | 'cheapDefault' | 'success' | 'warning' | 'info' | 'muted'
  /** Optional icon element to display before text */
  icon?: ReactNode
}

export interface ProfileCardMetadata {
  /** Label for the metadata row */
  label: string
  /** Value to display */
  value: string | ReactNode
  /** If true, show in small text style */
  small?: boolean
}

export interface ProfileCardAction {
  /** Button label */
  label: string
  /** Click handler */
  onClick: () => void
  /** Visual variant */
  variant?: 'primary' | 'secondary' | 'danger'
  /** Whether button is disabled */
  disabled?: boolean
  /** Loading state with custom label */
  loadingLabel?: string
  /** Whether action is loading */
  loading?: boolean
}

export interface ProfileCardProps {
  /** Card title */
  title: string
  /** Subtitle shown below title */
  subtitle?: string
  /** Array of badges to display after title */
  badges?: ProfileCardBadge[]
  /** Metadata rows displayed in a grid */
  metadata?: ProfileCardMetadata[]
  /** Action buttons */
  actions?: ProfileCardAction[]
  /** Custom content rendered after metadata */
  children?: ReactNode
  /** Delete confirmation config - if provided, shows delete button with popover */
  deleteConfig?: {
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
}

const badgeStyles: Record<ProfileCardBadge['variant'], string> = {
  default: 'bg-green-100/50 text-green-700',
  cheap: 'bg-amber-100/50 text-amber-700',
  cheapDefault: 'bg-indigo-100/50 text-indigo-700',
  success: 'bg-green-100/50 text-green-700',
  warning: 'bg-amber-100/50 text-amber-700',
  info: 'bg-blue-100/50 text-blue-700',
  muted: 'bg-muted text-muted-foreground',
}

const actionStyles: Record<NonNullable<ProfileCardAction['variant']>, string> = {
  primary: 'bg-primary/10 text-primary rounded hover:bg-primary/20',
  secondary: 'text-primary hover:bg-primary/10 rounded border border-primary/50 hover:border-primary focus:outline-none focus:ring-2 focus:ring-ring',
  danger: 'text-destructive hover:bg-destructive/10 rounded border border-destructive/50 hover:border-destructive focus:outline-none focus:ring-2 focus:ring-destructive',
}

/**
 * Generic profile card component for displaying profile-like entities.
 * Used across connection profiles, embedding profiles, and API keys.
 *
 * @example
 * ```tsx
 * <ProfileCard
 *   title="My Profile"
 *   subtitle="OPENAI • gpt-4"
 *   badges={[
 *     { text: 'Default', variant: 'default' },
 *   ]}
 *   metadata={[
 *     { label: 'API Key', value: 'my-key' },
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
 * ```
 */
export function ProfileCard({
  title,
  subtitle,
  badges = [],
  metadata = [],
  actions = [],
  children,
  deleteConfig,
}: ProfileCardProps) {
  return (
    <div className="border border-border rounded-lg p-4 bg-card hover:bg-accent/50">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* Title row with badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <p className="qt-text-primary">{title}</p>
            {badges.map((badge, index) => (
              <span
                key={index}
                className={`px-2 py-1 text-xs rounded-full flex items-center gap-1 ${badgeStyles[badge.variant]}`}
              >
                {badge.icon}
                {badge.text}
              </span>
            ))}
          </div>

          {/* Subtitle */}
          {subtitle && (
            <p className="qt-text-small mt-1">{subtitle}</p>
          )}

          {/* Metadata grid */}
          {metadata.length > 0 && (
            <div className="grid grid-cols-2 gap-4 mt-2 qt-text-small">
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
        </div>

        {/* Actions */}
        <div className="flex gap-2 ml-4">
          {actions.map((action, index) => (
            <button
              key={index}
              onClick={action.onClick}
              disabled={action.disabled || action.loading}
              className={`px-3 py-1 text-sm ${actionStyles[action.variant || 'secondary']} disabled:opacity-50 disabled:cursor-not-allowed`}
            >
              {action.loading ? action.loadingLabel || 'Loading...' : action.label}
            </button>
          ))}

          {/* Delete button with confirmation popover */}
          {deleteConfig && (
            <div className="relative">
              <button
                onClick={() => deleteConfig.onConfirmChange(!deleteConfig.isConfirming)}
                className={`px-3 py-1 text-sm ${actionStyles.danger}`}
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
        </div>
      </div>
    </div>
  )
}
