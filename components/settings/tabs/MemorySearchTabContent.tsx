'use client'

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import EmbeddingProfilesTab from '@/components/settings/embedding-profiles-tab'
import { MemoryDedupCard } from '@/components/tools/memory-dedup-card'

export function MemorySearchTabContent() {
  const info = useSubsystemInfo('commonplace-book')

  return (
    <div>
      <p className="qt-text-small qt-text-muted italic mb-6">{info.description}</p>

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
