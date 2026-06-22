'use client'

/**
 * Project Detail Page — thin route wrapper around {@link ProjectDetailView}.
 * The view body is shared with the Prospero workspace tab, which renders it in
 * place (no route) for keep-alive.
 */

import { useParams, useRouter } from 'next/navigation'
import { ProjectDetailView } from './ProjectDetailView'

export default function ProjectDetailPage() {
  const params = useParams()
  const router = useRouter()
  const projectId = params.id as string
  return <ProjectDetailView projectId={projectId} onBack={() => router.push('/prospero')} />
}
