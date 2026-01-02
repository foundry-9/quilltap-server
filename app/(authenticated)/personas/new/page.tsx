'use client'

/**
 * New Persona Page - DEPRECATED
 * Characters Not Personas Feature
 *
 * Personas have been merged into Characters with controlledBy: 'user'.
 * This page redirects to create a new Character.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { clientLogger } from '@/lib/client-logger'

export default function NewPersonaPage() {
  const router = useRouter()

  useEffect(() => {
    clientLogger.info('[NewPersonaPage] Redirecting to New Character page - Personas deprecated')
    router.replace('/characters/new?controlledBy=user')
  }, [router])

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Redirecting...</h2>
        <p className="qt-text-small">
          To create a user-controlled character, use the Characters page.
        </p>
        <p className="qt-text-xs mt-2">
          You will be redirected to create a new Character.
        </p>
      </div>
    </div>
  )
}
