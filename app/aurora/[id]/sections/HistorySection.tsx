'use client'

/**
 * History — *What has happened to them?* Conversations and memories (each
 * collapsed until opened, and paged rather than infinitely scrolled), the two
 * bulk tools that rewrite history (side by side, each behind its own preview),
 * and the LLM logs, collapsed at the foot.
 *
 * @module app/aurora/[id]/sections/HistorySection
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CharacterConversationsTab } from '@/components/character/character-conversations-tab'
import { MemoryList } from '@/components/memory/memory-list'
import LLMLogsSection from '@/components/characters/LLMLogsSection'
import { RenameReplaceTab } from '@/components/characters/RenameReplaceTab'
import { SearchReplaceModal } from '@/components/tools/search-replace'
import type { SearchReplaceResult } from '@/components/tools/search-replace/types'
import { BaseModal } from '@/components/ui/BaseModal'
import { Icon } from '@/components/ui/icon'
import { queryKeys } from '@/lib/query/keys'
import { SectionCard } from '../components/SectionCard'
import { useCharacterPage } from '../CharacterPageContext'

export function HistorySection() {
  const { characterId, character, readOnly, reload, stats } = useCharacterPage()
  const queryClient = useQueryClient()
  const [refreshKey, setRefreshKey] = useState(0)
  const [showSearchReplace, setShowSearchReplace] = useState(false)
  const [showRename, setShowRename] = useState(false)

  const afterBulkEdit = async () => {
    setRefreshKey((k) => k + 1)
    await queryClient.invalidateQueries({ queryKey: queryKeys.characters.stats(characterId) })
  }

  return (
    <div className="space-y-6">
      <SectionCard
        title="Conversations"
        anchor="conversations"
        collapsible
        summary={stats ? `${stats.conversations} ${stats.conversations === 1 ? 'conversation' : 'conversations'}` : undefined}
      >
        <CharacterConversationsTab characterId={characterId} characterName={character.name} refreshKey={refreshKey} />
      </SectionCard>

      <SectionCard
        title="Memories"
        anchor="memories"
        collapsible
        summary={stats ? `${stats.memories} ${stats.memories === 1 ? 'memory' : 'memories'}` : undefined}
      >
        <MemoryList characterId={characterId} refreshKey={refreshKey} />
      </SectionCard>

      <SectionCard
        title="Bulk edits"
        anchor="bulk-edits"
        description="The two tools that rewrite what has already been said. Each shows you every change before it makes one."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={readOnly}
            onClick={() => setShowSearchReplace(true)}
            className="flex items-start gap-3 border qt-border-default rounded-lg p-4 text-left transition hover:qt-bg-muted disabled:opacity-50"
          >
            <Icon name="search" className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <span>
              <span className="block qt-text-label">Search &amp; Replace</span>
              <span className="block qt-text-small">
                Find any text across {character.name}&rsquo;s chats and memories and replace it.
              </span>
            </span>
          </button>
          <button
            type="button"
            disabled={readOnly}
            onClick={() => setShowRename(true)}
            className="flex items-start gap-3 border qt-border-default rounded-lg p-4 text-left transition hover:qt-bg-muted disabled:opacity-50"
          >
            <Icon name="pencil" className="mt-0.5 h-5 w-5 flex-shrink-0" />
            <span>
              <span className="block qt-text-label">Rename / Replace</span>
              <span className="block qt-text-small">
                Give {character.name} a new name everywhere — fields, memories and chats — with aliases replaced
                alongside.
              </span>
            </span>
          </button>
        </div>
      </SectionCard>

      {/* Collapsed by default; it carries its own toggle heading. */}
      <div id="llm-logs" className="scroll-mt-48">
        <LLMLogsSection characterId={characterId} />
      </div>

      <SearchReplaceModal
        isOpen={showSearchReplace}
        onClose={() => setShowSearchReplace(false)}
        initialScope={{ type: 'character', characterId }}
        characterName={character.name}
        onComplete={(result: SearchReplaceResult) => {
          if (result.messagesUpdated > 0 || result.memoriesUpdated > 0) void afterBulkEdit()
        }}
      />

      {showRename && (
        <BaseModal
          isOpen
          onClose={() => setShowRename(false)}
          title={`Rename / Replace — ${character.name}`}
          maxWidth="3xl"
          showCloseButton
        >
          <RenameReplaceTab
            characterId={characterId}
            characterName={character.name}
            onRenameComplete={() => {
              void reload()
              void afterBulkEdit()
            }}
          />
        </BaseModal>
      )}
    </div>
  )
}
