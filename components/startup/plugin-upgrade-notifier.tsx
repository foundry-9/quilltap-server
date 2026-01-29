'use client'

import { useEffect } from 'react'
import { showSuccessToast, showWarningToast } from '@/lib/toast'

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

/** Delay between toast notifications in milliseconds */
const TOAST_DELAY_MS = 3000

/**
 * Component that shows toast notifications for plugin upgrades that occurred during startup.
 *
 * This component:
 * 1. Polls the /api/v1/system/plugins/upgrades endpoint after mount
 * 2. If there are un-notified upgrades, shows sequential toast notifications
 * 3. Marks upgrades as notified to prevent re-notification on page refresh
 */
export function PluginUpgradeNotifier() {
  useEffect(() => {
    checkAndNotifyUpgrades()
  }, [])

  // Component doesn't render anything
  return null
}

/**
 * Flag to prevent multiple notifications in the same session
 */
let notificationInProgress = false

/**
 * Wait for a specified number of milliseconds
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * Check for upgrade notifications and show toasts
 */
async function checkAndNotifyUpgrades(): Promise<void> {
  // Prevent concurrent notification attempts
  if (notificationInProgress) {
    return
  }
  notificationInProgress = true

  try {
    // Small delay to let the page render first
    await delay(1000)

    const response = await fetch('/api/v1/system/plugins/upgrades')

    if (!response.ok) {
      console.error('Failed to fetch plugin upgrades', { status: response.status })
      return
    }

    const data: UpgradesResponse = await response.json()

    if (!data.success) {
      console.error('Error response from upgrades API', { error: data.error })
      return
    }

    // Server not ready yet, or no upgrades to notify
    if (!data.ready || !data.results) {
      return
    }

    const { upgraded, failed } = data.results

    // No notifications needed
    if (upgraded.length === 0 && failed.length === 0) {
      return
    }

    // Show success toasts for upgraded plugins
    for (const result of upgraded) {
      const message = result.requiresRestart
        ? `Plugin ${result.packageName} upgraded to v${result.toVersion} (restart required)`
        : `Plugin ${result.packageName} upgraded to v${result.toVersion}`

      showSuccessToast(message, 5000)

      // Delay between toasts
      if (upgraded.indexOf(result) < upgraded.length - 1 || failed.length > 0) {
        await delay(TOAST_DELAY_MS)
      }
    }

    // Show warning toasts for failed upgrades
    for (const result of failed) {
      const message = `Failed to upgrade ${result.packageName}: ${result.error || 'Unknown error'}`
      showWarningToast(message, 7000)

      // Delay between toasts
      if (failed.indexOf(result) < failed.length - 1) {
        await delay(TOAST_DELAY_MS)
      }
    }

    // Mark upgrades as notified
    await fetch('/api/v1/system/plugins/upgrades', {
      method: 'POST',
    })

  } catch (error) {
    console.error('Error checking plugin upgrades', {
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    notificationInProgress = false
  }
}
