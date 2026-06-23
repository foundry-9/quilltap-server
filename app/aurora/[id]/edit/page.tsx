'use client'

import { use } from 'react'
import { useSearchParams } from 'next/navigation'
import { CharacterEditView } from './CharacterEditView'

export default function EditCharacterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const tab = useSearchParams().get('tab') ?? undefined
  return <CharacterEditView characterId={id} initialTab={tab} />
}
