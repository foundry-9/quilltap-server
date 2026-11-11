'use client'

import { ProviderWizard } from '@/components/setup-wizard/ProviderWizard'

/**
 * First-run provider setup wizard page.
 * Reached after pepper vault setup and profile creation.
 */
export default function ProviderSetupPage() {
  return (
    <ProviderWizard
      mode="setup"
      onComplete={() => {
        // Full page load to re-initialize session provider and all client state
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full page load wanted to re-initialize the session provider and all client state after first-run setup
        window.location.href = '/'
      }}
    />
  )
}
