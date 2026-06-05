'use client'

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import RoleplayTemplatesTab from '@/components/settings/roleplay-templates'
import PromptsTab from '@/components/settings/prompts-tab'
import { CoreWhisperSection } from '@/components/settings/core-whisper/CoreWhisperSection'
import { useSettingsSection } from './useSettingsSection'

export function TemplatesPromptsTabContent() {
  const info = useSubsystemInfo('aurora')
  const activeSection = useSettingsSection()

  return (
    <div>
      <p className="qt-text-small qt-text-muted italic mb-6">{info.description}</p>

      <div className="space-y-4">
        <CollapsibleCard title="Roleplay Templates" description="Manage templates that shape how characters interact" sectionId="roleplay-templates" forceOpen={activeSection === 'roleplay-templates'}>
          <RoleplayTemplatesTab />
        </CollapsibleCard>

        <CollapsibleCard title="Prompts" description="Configure system prompts and prompt blocks" sectionId="prompts" forceOpen={activeSection === 'prompts'}>
          <PromptsTab />
        </CollapsibleCard>

        <CollapsibleCard title="Aurora's Core Whisper" description="Periodic re-offering of each character's own Core/ vault folder" sectionId="core-whisper" forceOpen={activeSection === 'core-whisper'}>
          <CoreWhisperSection />
        </CollapsibleCard>
      </div>
    </div>
  )
}
