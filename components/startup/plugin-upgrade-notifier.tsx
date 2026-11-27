'use client'

import { useEffect } from 'react'
import { showSuccessToast, showWarningToast } from '@/lib/toast'
import { createStartupNotifier } from './startup-notices'

/**
 * Interface matching UpgradeResult from lib/plugins/upgrader.ts
 */
interface UpgradeResult {
  packageName: string
  success: boolean
  fromVersion: string
  toVersion?: string
  error?: string
  requiresRestart: boolean
}

interface UpgradeResults {
  upgraded: UpgradeResult[]
  failed: UpgradeResult[]
  totalChecked: number
}

interface UpgradesResponse {
  success: boolean
  ready: boolean
  results: UpgradeResults | null
  message?: string
  error?: string
}

const notifyPluginUpgrades = createStartupNotifier<UpgradesResponse>({
  initialDelayMs: 1000,
  url: '/api/v1/system/plugins?action=upgrades',
  markNotifiedUrl: '/api/v1/system/plugins?action=mark-upgrades-notified',
  label: 'plugin upgrades',
  toNotices: (data) => {
    if (!data.success) {
      console.error('Error response from upgrades API', { error: data.error })
      return null
    }

    // Server not ready yet, or no upgrades to notify
    if (!data.ready || !data.results) return null

    const { upgraded, failed } = data.results
    return [
      // Success toasts for upgraded plugins
      ...upgraded.map((result) => () => {
        const message = result.requiresRestart
          ? `Plugin ${result.packageName} upgraded to v${result.toVersion} (restart required)`
          : `Plugin ${result.packageName} upgraded to v${result.toVersion}`
        showSuccessToast(message, 5000)
      }),
      // Warning toasts for failed upgrades
      ...failed.map((result) => () => {
        showWarningToast(`Failed to upgrade ${result.packageName}: ${result.error || 'Unknown error'}`, 7000)
      }),
    ]
  },
})

/**
 * Component that shows toast notifications for plugin upgrades that occurred during startup.
 *
 * This component:
 * 1. Reads GET /api/v1/system/plugins?action=upgrades once, shortly after mount
 * 2. If there are un-notified upgrades, shows sequential toast notifications
 * 3. Marks upgrades as notified to prevent re-notification on page refresh
 */
export function PluginUpgradeNotifier() {
  useEffect(() => {
    void notifyPluginUpgrades()
  }, [])

  // Component doesn't render anything
  return null
}
