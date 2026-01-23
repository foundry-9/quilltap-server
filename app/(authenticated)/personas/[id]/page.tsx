'use client'

/**
 * Persona Detail Page - DEPRECATED
 * Characters Not Personas Feature
 *
 * Personas have been merged into Characters with controlledBy: 'user'.
 * This page redirects to the Characters page.
 *
 * Note: After migration, the persona ID becomes a character ID.
 * If the ID exists as a character, it will be accessible at /characters/[id].
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { use } from 'react'

interface Props {
  params: Promise<{
    id: string
  }>
}

export default function PersonaDetailPage({ params }: Props) {
  const router = useRouter()
  const { id } = use(params)

  useEffect(() => {
    // Redirect to the character with the same ID (after migration, persona IDs are preserved as character IDs)
    router.replace(`/characters/${id}`)
  }, [router, id])

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Redirecting...</h2>
        <p className="qt-text-small">
          Personas have been merged into Characters.
        </p>
        <p className="qt-text-xs mt-2">
          You will be redirected to view this character.
        </p>
      </div>
    </div>
  )
}
