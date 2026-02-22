'use client'

import { useRouter } from 'next/navigation'
import { ProviderWizard } from '@/components/setup-wizard/ProviderWizard'

/**
 * Settings re-entry point for the provider setup wizard.
 * Accessible from The Foundry > Forge.
 */
export default function ForgeWizardPage() {
  const router = useRouter()

  return (
    <ProviderWizard
      mode="settings"
      onComplete={() => router.push('/foundry/forge')}
      onCancel={() => router.push('/foundry/forge')}
    />
  )
}
