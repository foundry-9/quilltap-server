'use client'

/**
 * Group Editor Page — thin route wrapper around {@link GroupDetailView}. The
 * view body is shared with the Aurora workspace tab, which renders it in place
 * (no route) for keep-alive.
 */

import { use } from 'react'
import { useRouter } from 'next/navigation'
import { GroupDetailView } from './GroupDetailView'

interface GroupEditorPageProps {
  params: Promise<{ id: string }>
}

export default function GroupEditorPage({ params }: GroupEditorPageProps) {
  const { id: groupId } = use(params)
  const router = useRouter()
  return <GroupDetailView groupId={groupId} onBack={() => router.push('/aurora')} />
}
