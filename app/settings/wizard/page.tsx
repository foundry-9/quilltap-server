'use client'

import { useRouter } from 'next/navigation'
import { ProviderWizard } from '@/components/setup-wizard/ProviderWizard'

/**
 * Settings re-entry point for the provider setup wizard.
 * Accessible from Settings > AI Providers tab.
 */
export default function SettingsWizardPage() {
  const router = useRouter()

  return (
    <ProviderWizard
      mode="settings"
      onComplete={() => router.push('/settings')}
      onCancel={() => router.push('/settings')}
    />
  )
}
