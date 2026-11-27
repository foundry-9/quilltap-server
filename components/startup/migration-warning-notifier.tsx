'use client'

import { useEffect } from 'react'
import { showWarningToast } from '@/lib/toast'
import { createStartupNotifier } from './startup-notices'

interface MigrationWarningsResponse {
  success: boolean
  ready: boolean
  warnings: string[]
  message?: string
}

const notifyMigrationWarnings = createStartupNotifier<MigrationWarningsResponse>({
  initialDelayMs: 2000,
  url: '/api/v1/system/migration-warnings',
  markNotifiedUrl: '/api/v1/system/migration-warnings',
  label: 'migration warnings',
  toNotices: (data) => {
    // Server not ready yet, or no warnings to notify
    if (!data.success || !data.ready || data.warnings.length === 0) return null
    return data.warnings.map((warning) => () => showWarningToast(warning, 15000))
  },
})

/**
 * Component that shows toast notifications for migration warnings generated during startup.
 *
 * This component:
 * 1. Reads the /api/v1/system/migration-warnings endpoint once, shortly after mount
 * 2. If there are un-notified warnings, shows sequential warning toasts
 * 3. Marks warnings as notified via POST to prevent re-notification on page refresh
 */
export function MigrationWarningNotifier() {
  useEffect(() => {
    void notifyMigrationWarnings()
  }, [])

  // Component doesn't render anything
  return null
}
