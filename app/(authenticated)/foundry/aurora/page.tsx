'use client'

import Link from 'next/link'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import RoleplayTemplatesTab from '@/components/settings/roleplay-templates'
import PromptsTab from '@/components/settings/prompts-tab'
import { useSubsystemInfo } from '@/components/providers/theme-provider'

export default function AuroraPage() {
  const info = useSubsystemInfo('aurora')
  const foundryInfo = useSubsystemInfo('foundry')

  return (
    <div className="qt-page-container" style={info.backgroundImage ? { '--story-background-url': `url(${info.backgroundImage})` } as React.CSSProperties : undefined}>
      <div className="mb-2">
        <nav className="qt-text-small qt-text-muted">
          <Link href="/foundry" className="qt-link">{foundryInfo.name}</Link>
          <span className="mx-2">/</span>
          <span>{info.name}</span>
        </nav>
      </div>
      <div className="mb-8">
        <h1 className="qt-heading-1">{info.name}</h1>
        <p className="qt-text-muted mt-2">{info.description}</p>
      </div>

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
