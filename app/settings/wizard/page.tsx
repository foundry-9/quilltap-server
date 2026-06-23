'use client'

import { SettingsWizardView } from './SettingsWizardView'

/**
 * Settings re-entry point for the provider setup wizard — thin route wrapper
 * around {@link SettingsWizardView} so the workspace can render it as a tab.
 */
export default function SettingsWizardPage() {
  return <SettingsWizardView />
}
