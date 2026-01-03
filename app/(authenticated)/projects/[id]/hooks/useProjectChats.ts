'use client'

/**
 * useProjectChats Hook
 *
 * Manages project chats data and operations.
 *
 * @module app/(authenticated)/projects/[id]/hooks/useProjectChats
 */

import { useCallback, useState } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { useSidebarData } from '@/components/providers/sidebar-data-provider'
import type { ProjectChat } from '../types'

interface UseProjectChatsReturn {
  chats: ProjectChat[]
  fetchChats: () => Promise<void>
  handleRemoveChat: (chatId: string) => Promise<void>
}

export function useProjectChats(projectId: string): UseProjectChatsReturn {
  const [chats, setChats] = useState<ProjectChat[]>([])
  const { refreshProjects } = useSidebarData()

  const fetchChats = useCallback(async () => {
    try {
      clientLogger.debug('useProjectChats: fetching chats', { projectId })
      const res = await fetch(`/api/projects/${projectId}/chats`)
      if (res.ok) {
        const data = await res.json()
        setChats(data.chats || [])
        clientLogger.debug('useProjectChats: loaded chats', { projectId, count: data.chats?.length || 0 })
      }
    } catch (err) {
      clientLogger.error('useProjectChats: fetch error', { error: err instanceof Error ? err.message : String(err), projectId })
    }
  }, [projectId])

  const handleRemoveChat = useCallback(async (chatId: string) => {
    try {
      clientLogger.debug('useProjectChats: removing chat', { projectId, chatId })
      const res = await fetch(`/api/projects/${projectId}/chats?chatId=${chatId}`, {
        method: 'DELETE',
      })

      if (!res.ok) throw new Error('Failed to remove chat')
      setChats(prev => prev.filter(c => c.id !== chatId))
      showSuccessToast('Chat removed from project')
      refreshProjects()
      clientLogger.info('useProjectChats: removed chat', { projectId, chatId })
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to remove chat'
      clientLogger.error('useProjectChats: remove error', { error: errorMsg, projectId, chatId })
      showErrorToast(errorMsg)
    }
  }, [projectId, refreshProjects])

  return {
    chats,
    fetchChats,
    handleRemoveChat,
  }
}
