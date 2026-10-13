'use client'

import { useSubsystemInfo } from '@/components/providers/theme-provider'
import { CollapsibleCard } from '@/components/ui/CollapsibleCard'
import EmbeddingProfilesTab from '@/components/settings/embedding-profiles-tab'
import { MemoryMaintenanceCard } from '@/components/tools/memory-maintenance-card'
import { MemoryExtractionGrainCard } from '@/components/tools/memory-extraction-grain-card'
import { MemoryRecallCard } from '@/components/tools/memory-recall-card'
import { MemoryBackfillCard } from '@/components/tools/memory-backfill-card'
import { MemoryRegenerateCard } from '@/components/tools/memory-regenerate-card'
import { ConversationSummaryRegenerateCard } from '@/components/tools/conversation-summary-regenerate-card'
import { useSettingsSection } from './useSettingsSection'

/**
 * Deep links to the three cards the Maintenance card replaced (decision 11)
 * open it instead, so old help pages and bookmarks still land somewhere.
 */
const RETIRED_SECTIONS: Record<string, string> = {
  'memory-housekeeping': 'memory-maintenance',
  'memory-consolidation': 'memory-maintenance',
  'memory-deduplication': 'memory-maintenance',
}

export function MemorySearchTabContent() {
  const info = useSubsystemInfo('commonplace-book')
  const requestedSection = useSettingsSection()
  const activeSection = requestedSection ? (RETIRED_SECTIONS[requestedSection] ?? requestedSection) : null

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

        <CollapsibleCard title="Maintenance" description="Fold repetitions, consolidate into digests, keep each character under the cap, and let old archive notes go" sectionId="memory-maintenance" forceOpen={activeSection === 'memory-maintenance'}>
          <MemoryMaintenanceCard />
        </CollapsibleCard>

        <CollapsibleCard title="Extraction Grain" description="Choose how often a character's observations of other characters are noted" sectionId="memory-extraction-grain" forceOpen={activeSection === 'memory-extraction-grain'}>
          <MemoryExtractionGrainCard />
        </CollapsibleCard>

        <CollapsibleCard title="Recall Relevance" description="Keep project-specific memories from wandering into unrelated chats" sectionId="memory-recall" forceOpen={activeSection === 'memory-recall'}>
          <MemoryRecallCard />
        </CollapsibleCard>

        <CollapsibleCard title="Regenerate Memories" description="Wipe and rebuild every chat-linked memory using the current extraction pipeline" sectionId="memory-regenerate" forceOpen={activeSection === 'memory-regenerate'}>
          <MemoryRegenerateCard />
        </CollapsibleCard>

        <CollapsibleCard title="Regenerate Conversation Summaries" description="Re-mirror every summarised chat into its characters' vaults for relevant-conversation recall" sectionId="conversation-summaries-regenerate" forceOpen={activeSection === 'conversation-summaries-regenerate'}>
          <ConversationSummaryRegenerateCard />
        </CollapsibleCard>
      </div>
    </div>
  )
}
