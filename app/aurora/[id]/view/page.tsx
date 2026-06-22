'use client'

/**
 * Character Detail Page — thin route wrapper around {@link CharacterDetailView}.
 * The view body is shared with the Aurora workspace tab, which renders it in
 * place (no route) for keep-alive. Reads the `?action=chat` deep-link here.
 */

import { use } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { CharacterDetailView } from './CharacterDetailView'

export default function ViewCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const searchParams = useSearchParams()
  return (
    <CharacterDetailView
      characterId={id}
      onBack={() => router.push('/aurora')}
      openChatOnMount={searchParams.get('action') === 'chat'}
    />
  )
}
