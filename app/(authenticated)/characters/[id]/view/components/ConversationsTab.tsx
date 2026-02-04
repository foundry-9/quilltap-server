'use client'

import { CharacterConversationsTab } from '@/components/character/character-conversations-tab'

interface ConversationsTabProps {
  characterId: string
  characterName: string
  refreshKey?: number
}

export function ConversationsTab({
  characterId,
  characterName,
  refreshKey,
}: ConversationsTabProps) {
  return (
    <CharacterConversationsTab
      characterId={characterId}
      characterName={characterName || 'Character'}
      refreshKey={refreshKey}
    />
  )
}
