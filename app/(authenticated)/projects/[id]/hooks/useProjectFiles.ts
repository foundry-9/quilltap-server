'use client'

/**
 * useProjectFiles Hook
 *
 * Manages project files data.
 *
 * @module app/(authenticated)/projects/[id]/hooks/useProjectFiles
 */

import { useCallback, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import type { ProjectFile } from '../types'

interface UseProjectFilesReturn {
  files: ProjectFile[]
  fetchFiles: () => Promise<void>
}

export function useProjectFiles(projectId: string): UseProjectFilesReturn {
  const [files, setFiles] = useState<ProjectFile[]>([])

  const fetchFiles = useCallback(async () => {
    try {
      clientLogger.debug('useProjectFiles: fetching files', { projectId })
      const res = await fetch(`/api/projects/${projectId}/files`)
      if (res.ok) {
        const data = await res.json()
        setFiles(data.files || [])
        clientLogger.debug('useProjectFiles: loaded files', { projectId, count: data.files?.length || 0 })
      }
    } catch (err) {
      clientLogger.error('useProjectFiles: fetch error', { error: err instanceof Error ? err.message : String(err), projectId })
    }
  }, [projectId])

  return {
    files,
    fetchFiles,
  }
}
