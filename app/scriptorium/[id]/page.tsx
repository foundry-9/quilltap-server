'use client'

/**
 * Document Store Detail Page — thin route wrapper around
 * {@link DocumentStoreDetailView}. The view body is shared with the Scriptorium
 * workspace tab, which renders it in place (no route) for keep-alive. The route
 * owns the subsystem background; in-tab the workspace backdrop does.
 */

import { useParams, useRouter } from 'next/navigation'
import { useSubsystemBackgroundStyle } from '@/components/providers/theme-provider'
import { DocumentStoreDetailView } from './DocumentStoreDetailView'

export default function DocumentStoreDetailPage() {
  const params = useParams()
  const router = useRouter()
  const storeId = params.id as string
  const bgStyle = useSubsystemBackgroundStyle('scriptorium')
  return (
    <DocumentStoreDetailView
      storeId={storeId}
      onBack={() => router.push('/scriptorium')}
      style={bgStyle}
    />
  )
}
