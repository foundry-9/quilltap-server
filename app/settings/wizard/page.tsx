/**
 * Provider Setup Wizard Route — redirects into the tabbed workspace's wizard tab.
 */

import { redirectToWorkspaceTab } from '@/lib/navigation/workspace-redirect'

export default function SettingsWizardPage() {
  return redirectToWorkspaceTab('settings-wizard')
}
