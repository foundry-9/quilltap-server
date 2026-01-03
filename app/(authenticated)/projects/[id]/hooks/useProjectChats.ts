'use client'

/**
 * useProjectChats Hook
 *
 * Manages project chats data and operations with pagination support.
 *
 * @module app/(authenticated)/projects/[id]/hooks/useProjectChats
 */

import { useCallback, useState, useRef } from 'react'
import { clientLogger } from '@/lib/client-logger'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { useSidebarData } from '@/components/providers/sidebar-data-provider'
import type { ProjectChat } from '../types'

interface Pagination {
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

interface UseProjectChatsReturn {
  chats: ProjectChat[]
  loading: boolean
  loadingMore: boolean
  pagination: Pagination
  fetchChats: () => Promise<void>
  loadMoreChats: () => Promise<void>
  handleRemoveChat: (chatId: string) => Promise<void>
}

const DEFAULT_LIMIT = 20

export function useProjectChats(projectId: string): UseProjectChatsReturn {
  const [chats, setChats] = useState<ProjectChat[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [pagination, setPagination] = useState<Pagination>({
    total: 0,
    offset: 0,
    limit: DEFAULT_LIMIT,
    hasMore: false,
  })
  const { refreshProjects } = useSidebarData()
  const fetchingRef = useRef(false)

  const fetchChats = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    setLoading(true)

    try {
      clientLogger.debug('useProjectChats: fetching chats', { projectId })
      const res = await fetch(`/api/projects/${projectId}/chats?limit=${DEFAULT_LIMIT}&offset=0`)
      if (res.ok) {
        const data = await res.json()
        setChats(data.chats || [])
        setPagination(data.pagination || { total: 0, offset: 0, limit: DEFAULT_LIMIT, hasMore: false })
        clientLogger.debug('useProjectChats: loaded chats', {
          projectId,
          count: data.chats?.length || 0,
          total: data.pagination?.total || 0,
        })
      }
    } catch (err) {
      clientLogger.error('useProjectChats: fetch error', {
        error: err instanceof Error ? err.message : String(err),
        projectId,
      })
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }, [projectId])

  const loadMoreChats = useCallback(async () => {
    if (fetchingRef.current || !pagination.hasMore) return
    fetchingRef.current = true
    setLoadingMore(true)

    const newOffset = pagination.offset + pagination.limit

    try {
      clientLogger.debug('useProjectChats: loading more chats', { projectId, offset: newOffset })
      const res = await fetch(`/api/projects/${projectId}/chats?limit=${DEFAULT_LIMIT}&offset=${newOffset}`)
      if (res.ok) {
        const data = await res.json()
        setChats(prev => [...prev, ...(data.chats || [])])
        setPagination(data.pagination || { total: 0, offset: newOffset, limit: DEFAULT_LIMIT, hasMore: false })
        clientLogger.debug('useProjectChats: loaded more chats', {
          projectId,
          newCount: data.chats?.length || 0,
          totalLoaded: chats.length + (data.chats?.length || 0),
        })
      }
    } catch (err) {
      clientLogger.error('useProjectChats: load more error', {
        error: err instanceof Error ? err.message : String(err),
        projectId,
      })
    } finally {
      setLoadingMore(false)
      fetchingRef.current = false
    }
  }, [projectId, pagination, chats.length])

  const handleRemoveChat = useCallback(async (chatId: string) => {
    try {
      clientLogger.debug('useProjectChats: removing chat', { projectId, chatId })
      const res = await fetch(`/api/projects/${projectId}/chats?chatId=${chatId}`, {
        method: 'DELETE',
      })

      if (!res.ok) throw new Error('Failed to remove chat')
      setChats(prev => prev.filter(c => c.id !== chatId))
      setPagination(prev => ({ ...prev, total: prev.total - 1 }))
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
    loading,
    loadingMore,
    pagination,
    fetchChats,
    loadMoreChats,
    handleRemoveChat,
  }
}
