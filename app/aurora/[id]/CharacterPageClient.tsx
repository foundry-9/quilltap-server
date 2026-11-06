'use client'

/**
 * Full-page body of `/aurora/[id]` (workspace disabled): the back button
 * routes to the list, and the section in view is kept in `?section=`.
 */

import { useRouter } from 'next/navigation'
import { characterPageHref, type CharacterPageSection } from '@/lib/characters/page-sections'
import { CharacterPage } from './CharacterPage'

export function CharacterPageClient({
  characterId,
  initialSection,
  openChatOnMount,
}: {
  characterId: string
  initialSection?: CharacterPageSection
  openChatOnMount?: boolean
}) {
  const router = useRouter()
  return (
    <CharacterPage
      characterId={characterId}
      initialSection={initialSection}
      openChatOnMount={openChatOnMount}
      onBack={() => router.push('/aurora')}
      onSectionChange={(section) => router.replace(characterPageHref(characterId, { section }), { scroll: false })}
    />
  )
}
