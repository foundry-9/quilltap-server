'use client'

/**
 * Personas Page - DEPRECATED
 * Characters Not Personas Feature
 *
 * Personas have been merged into Characters with controlledBy: 'user'.
 * This page redirects to the Characters page.
 */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { clientLogger } from '@/lib/client-logger'

export default function PersonasPage() {
  const router = useRouter()

  useEffect(() => {
    clientLogger.info('[PersonasPage] Redirecting to Characters page - Personas deprecated')
    router.replace('/characters?filter=user-controlled')
  }, [router])

  return (
    <div className="flex items-center justify-center h-64">
      <div className="text-center">
        <h2 className="text-xl font-semibold mb-2">Redirecting...</h2>
        <p className="qt-text-small">
          Personas have been merged into Characters.
        </p>
        <p className="qt-text-xs mt-2">
          You will be redirected to the Characters page.
        </p>
      </div>
    </div>
  )
}
