'use client'

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import EmbeddingProfilesTab from '@/components/settings/embedding-profiles-tab'
import { MemoryDedupCard } from '@/components/tools/memory-dedup-card'
import { MemoryHousekeepingCard } from '@/components/tools/memory-housekeeping-card'
import { MemoryBackfillCard } from '@/components/tools/memory-backfill-card'
import { useSettingsSection } from './useSettingsSection'

export function MemorySearchTabContent() {
  const info = useSubsystemInfo('commonplace-book')
  const activeSection = useSettingsSection()

  return (
    <div>
      <p className="qt-text-small qt-text-muted italic mb-6">{info.description}</p>

      <div className="space-y-4">
        <CollapsibleCard title="Embedding Profiles" description="Configure embedding models for semantic memory" sectionId="embedding-profiles" forceOpen={activeSection === 'embedding-profiles'}>
          <EmbeddingProfilesTab />
        </CollapsibleCard>

        <CollapsibleCard title="Repair Missing Embeddings" description="Generate embeddings for legacy memories that predate the embedding-aware gate" sectionId="memory-backfill" forceOpen={activeSection === 'memory-backfill'}>
          <MemoryBackfillCard />
        </CollapsibleCard>

        <CollapsibleCard title="Memory Housekeeping" description="Automatically prune stale, low-importance memories as characters approach their cap" sectionId="memory-housekeeping" forceOpen={activeSection === 'memory-housekeeping'}>
          <MemoryHousekeepingCard />
        </CollapsibleCard>

        <CollapsibleCard title="Memory Deduplication" description="Find and remove duplicate memories" sectionId="memory-deduplication" forceOpen={activeSection === 'memory-deduplication'}>
          <MemoryDedupCard />
        </CollapsibleCard>
      </div>
    </div>
  )
}
