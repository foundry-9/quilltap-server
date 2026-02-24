'use client'

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import RoleplayTemplatesTab from '@/components/settings/roleplay-templates'
import PromptsTab from '@/components/settings/prompts-tab'
import AIImportTab from '@/components/settings/ai-import'

export function TemplatesPromptsTabContent() {
  const info = useSubsystemInfo('aurora')

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        {info.thumbnail && (
          <img src={info.thumbnail} alt="" className="w-10 h-10 rounded-lg object-cover opacity-60" />
        )}
        <p className="qt-text-small qt-text-muted italic">{info.description}</p>
      </div>

      <div className="space-y-4">
        <CollapsibleCard title="Roleplay Templates" description="Manage templates that shape how characters interact">
          <RoleplayTemplatesTab />
        </CollapsibleCard>

        <CollapsibleCard title="Prompts" description="Configure system prompts and prompt blocks">
          <PromptsTab />
        </CollapsibleCard>

        <CollapsibleCard title="AI Character Import" description="Generate characters from source material using AI">
          <AIImportTab />
        </CollapsibleCard>
      </div>
    </div>
  )
}
