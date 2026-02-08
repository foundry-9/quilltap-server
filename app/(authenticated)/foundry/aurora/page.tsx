'use client'

import Link from 'next/link'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import RoleplayTemplatesTab from '@/components/settings/roleplay-templates'
import PromptsTab from '@/components/settings/prompts-tab'

export default function AuroraPage() {
  return (
    <div className="qt-page-container">
      <div className="mb-2">
        <nav className="qt-text-small qt-text-muted">
          <Link href="/foundry" className="qt-link">The Foundry</Link>
          <span className="mx-2">/</span>
          <span>Aurora</span>
        </nav>
      </div>
      <div className="mb-8">
        <h1 className="qt-heading-1">Aurora</h1>
        <p className="qt-text-muted mt-2">Character model configuration, roleplay templates, and prompt management</p>
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
