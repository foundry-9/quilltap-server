'use client'

import { BaseModal } from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'

/**
 * Plugin upgrade information for the confirmation modal
 */
export interface PluginUpgrade {
  packageName: string
  currentVersion: string
  latestVersion: string
  isNonBreaking: boolean
  pluginTitle: string
  pluginDescription?: string
  homepage?: string
  repository?: string
  npmUrl: string
  changelogUrl?: string
}

/**
 * Props for the UpgradeConfirmModal component
 */
interface UpgradeConfirmModalProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when modal closes */
  onClose: () => void
  /** Callback when upgrade is confirmed */
  onConfirm: () => void
  /** The upgrade to confirm */
  upgrade: PluginUpgrade
  /** Whether upgrade is currently in progress */
  isUpgrading: boolean
}


/**
 * Confirmation modal for breaking plugin upgrades
 *
 * Shows a warning about breaking changes (major version updates) and provides
 * links to changelog/repository for the user to review before confirming.
 */
export function UpgradeConfirmModal({
  isOpen,
  onClose,
  onConfirm,
  upgrade,
  isUpgrading,
}: UpgradeConfirmModalProps) {
  return (
    <BaseModal
      isOpen={isOpen}
      onClose={onClose}
      title="Confirm Plugin Upgrade"
      maxWidth="md"
      footer={
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={isUpgrading}
            className="qt-button-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isUpgrading}
            className="qt-button-warning"
          >
            {isUpgrading ? (
              <span className="flex items-center gap-2">
                <span className="qt-spinner-sm" />
                Upgrading...
              </span>
            ) : (
              'Upgrade Anyway'
            )}
          </button>
        </div>
      }
    >
      <div className="space-y-4">
        {/* Warning banner */}
        <div className="qt-alert-warning flex items-start gap-3">
          <Icon name="alert-triangle" className="w-5 h-5 flex-shrink-0 mt-0.5 qt-text-warning" />
          <div>
            <h4 className="font-medium text-foreground">
              Breaking Changes Detected
            </h4>
            <p className="qt-text-small mt-1 qt-text-secondary">
              This is a major version upgrade which may include breaking changes.
              We recommend reviewing the changelog before upgrading.
            </p>
          </div>
        </div>

        {/* Plugin info */}
        <div className="qt-card p-4">
          <h3 className="font-semibold text-foreground">{upgrade.pluginTitle}</h3>
          <p className="qt-text-small qt-text-secondary mt-1">{upgrade.packageName}</p>

          {upgrade.pluginDescription && (
            <p className="qt-text-small mt-2">{upgrade.pluginDescription}</p>
          )}

          {/* Version transition */}
          <div className="flex items-center gap-2 mt-4">
            <span className="qt-badge-secondary font-mono">v{upgrade.currentVersion}</span>
            <Icon name="arrow-right" className="w-4 h-4 qt-text-secondary" />
            <span className="qt-badge-warning font-mono">v{upgrade.latestVersion}</span>
          </div>
        </div>

        {/* Links section */}
        <div className="flex flex-wrap gap-3">
          {upgrade.changelogUrl && (
            <a
              href={upgrade.changelogUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="qt-button-secondary qt-button-sm inline-flex items-center gap-1.5"
            >
              View Changelog
              <Icon name="external-link" className="w-3.5 h-3.5" />
            </a>
          )}
          {upgrade.repository && (
            <a
              href={upgrade.repository}
              target="_blank"
              rel="noopener noreferrer"
              className="qt-button-ghost qt-button-sm inline-flex items-center gap-1.5"
            >
              Repository
              <Icon name="external-link" className="w-3.5 h-3.5" />
            </a>
          )}
          <a
            href={upgrade.npmUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="qt-button-ghost qt-button-sm inline-flex items-center gap-1.5"
          >
            npm
            <Icon name="external-link" className="w-3.5 h-3.5" />
          </a>
        </div>

        {/* Additional warning text */}
        <p className="qt-text-small qt-text-secondary">
          After upgrading, the plugin will be reloaded. Some settings or behaviors
          may change. Make sure to test the plugin after the upgrade completes.
        </p>
      </div>
    </BaseModal>
  )
}

export default UpgradeConfirmModal
