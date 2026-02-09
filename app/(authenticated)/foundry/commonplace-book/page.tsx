'use client'

import Link from 'next/link'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import EmbeddingProfilesTab from '@/components/settings/embedding-profiles-tab'
import { MemoryDedupCard } from '@/components/tools/memory-dedup-card'
import { useSubsystemInfo } from '@/components/providers/theme-provider'

export default function CommonplaceBookPage() {
  const info = useSubsystemInfo('commonplace-book')
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
        <CollapsibleCard title="Embedding Profiles" description="Configure embedding models for semantic memory">
          <EmbeddingProfilesTab />
        </CollapsibleCard>

        <CollapsibleCard title="Memory Deduplication" description="Find and remove duplicate memories">
          <MemoryDedupCard />
        </CollapsibleCard>
      </div>
    </div>
  )
}
