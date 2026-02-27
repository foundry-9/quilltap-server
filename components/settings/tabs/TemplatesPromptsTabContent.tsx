'use client'

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import RoleplayTemplatesTab from '@/components/settings/roleplay-templates'
import PromptsTab from '@/components/settings/prompts-tab'

export function TemplatesPromptsTabContent() {
  const info = useSubsystemInfo('aurora')

  return (
    <div>
      <p className="qt-text-small qt-text-muted italic mb-6">{info.description}</p>

      <div className="space-y-4">
        <CollapsibleCard title="Roleplay Templates" description="Manage templates that shape how characters interact">
          <RoleplayTemplatesTab />
        </CollapsibleCard>

        <CollapsibleCard title="Prompts" description="Configure system prompts and prompt blocks">
          <PromptsTab />
        </CollapsibleCard>
      </div>
    </div>
  )
}
