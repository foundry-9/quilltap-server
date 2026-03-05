'use client'

import { useEffect } from 'react'
import { showWarningToast } from '@/lib/toast'

interface MigrationWarningsResponse {
  success: boolean
  ready: boolean
  warnings: string[]
  message?: string
}

/** Delay between toast notifications in milliseconds */
const TOAST_DELAY_MS = 3000

/**
 * Component that shows toast notifications for migration warnings generated during startup.
 *
 * This component:
 * 1. Polls the /api/v1/system/migration-warnings endpoint after mount
 * 2. If there are un-notified warnings, shows sequential warning toasts
 * 3. Marks warnings as notified via POST to prevent re-notification on page refresh
 */
export function MigrationWarningNotifier() {
  useEffect(() => {
    checkAndNotifyWarnings()
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
 * Check for migration warning notifications and show toasts
 */
async function checkAndNotifyWarnings(): Promise<void> {
  // Prevent concurrent notification attempts
  if (notificationInProgress) {
    return
  }
  notificationInProgress = true

  try {
    // Small delay to let the page render first
    await delay(2000)

    const response = await fetch('/api/v1/system/migration-warnings')

    if (!response.ok) {
      console.error('Failed to fetch migration warnings', { status: response.status })
      return
    }

    const data: MigrationWarningsResponse = await response.json()

    if (!data.success) {
      return
    }

    // Server not ready yet, or no warnings to notify
    if (!data.ready || data.warnings.length === 0) {
      return
    }

    // Show warning toasts for each migration warning
    for (const warning of data.warnings) {
      showWarningToast(warning, 15000)

      // Delay between toasts
      if (data.warnings.indexOf(warning) < data.warnings.length - 1) {
        await delay(TOAST_DELAY_MS)
      }
    }

    // Mark warnings as notified
    await fetch('/api/v1/system/migration-warnings', {
      method: 'POST',
    })

  } catch (error) {
    console.error('Error checking migration warnings', {
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    notificationInProgress = false
  }
}
