'use client'

import Link from 'next/link'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import EmbeddingProfilesTab from '@/components/settings/embedding-profiles-tab'
import { MemoryDedupCard } from '@/components/tools/memory-dedup-card'

export default function CommonplaceBookPage() {
  return (
    <div className="qt-page-container" style={{ '--story-background-url': 'url(/images/commonplace_book.png)' } as React.CSSProperties}>
      <div className="mb-2">
        <nav className="qt-text-small qt-text-muted">
          <Link href="/foundry" className="qt-link">The Foundry</Link>
          <span className="mx-2">/</span>
          <span>The Commonplace Book</span>
        </nav>
      </div>
      <div className="mb-8">
        <h1 className="qt-heading-1">The Commonplace Book</h1>
        <p className="qt-text-muted mt-2">Embedding profiles and memory deduplication</p>
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
