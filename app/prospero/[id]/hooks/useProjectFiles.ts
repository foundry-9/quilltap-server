'use client'

/**
 * useProjectFiles Hook
 *
 * Manages project files data.
 *
 * @module app/prospero/[id]/hooks/useProjectFiles
 */

import { useCallback, useState } from 'react'
import type { ProjectFile } from '../types'

interface UseProjectFilesReturn {
  files: ProjectFile[]
  fetchFiles: () => Promise<void>
}

export function useProjectFiles(projectId: string): UseProjectFilesReturn {
  const [files, setFiles] = useState<ProjectFile[]>([])

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}?action=list-files`)
      if (res.ok) {
        const data = await res.json()
        setFiles(data.files || [])
      }
    } catch (err) {
      console.error('useProjectFiles: fetch error', err instanceof Error ? err.message : String(err))
    }
  }, [projectId])

  return {
    files,
    fetchFiles,
  }
}
