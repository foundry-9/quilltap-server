'use client'

import Link from 'next/link'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import AppearanceTab from '@/components/settings/appearance-tab'
import TagsTab from '@/components/settings/tags-tab'

export default function CalliopePage() {
  return (
    <div className="qt-page-container">
      <div className="mb-2">
        <nav className="qt-text-small qt-text-muted">
          <Link href="/foundry" className="qt-link">The Foundry</Link>
          <span className="mx-2">/</span>
          <span>Calliope</span>
        </nav>
      </div>
      <div className="mb-8">
        <h1 className="qt-heading-1">Calliope</h1>
        <p className="qt-text-muted mt-2">Appearance, themes, and tag management</p>
      </div>

      <div className="space-y-4">
        <CollapsibleCard title="Appearance" description="Theme selection, color mode, and display options">
          <AppearanceTab />
        </CollapsibleCard>

        <CollapsibleCard title="Tags" description="Create and manage tags for organizing your content">
          <TagsTab />
        </CollapsibleCard>
      </div>
    </div>
  )
}
