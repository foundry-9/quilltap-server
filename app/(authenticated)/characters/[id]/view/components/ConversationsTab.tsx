'use client'

import { CharacterConversationsTab } from '@/components/character/character-conversations-tab'

interface ConversationsTabProps {
  characterId: string
  characterName: string
}

export function ConversationsTab({
  characterId,
  characterName,
}: ConversationsTabProps) {
  return (
    <CharacterConversationsTab
      characterId={characterId}
      characterName={characterName || 'Character'}
    />
  )
}
