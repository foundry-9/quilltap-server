'use client'

/**
 * useProjectChats Hook
 *
 * Manages project chats data and operations with pagination support.
 *
 * @module app/prospero/[id]/hooks/useProjectChats
 */

import { useCallback, useState, useRef } from 'react'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
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
  const fetchingRef = useRef(false)

  const fetchChats = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    setLoading(true)

    try {
      const res = await fetch(`/api/v1/projects/${projectId}?action=list-chats&limit=${DEFAULT_LIMIT}&offset=0`)
      if (res.ok) {
        const data = await res.json()
        setChats(data.chats || [])
        setPagination(data.pagination || { total: 0, offset: 0, limit: DEFAULT_LIMIT, hasMore: false })
      }
    } catch (err) {
      console.error('useProjectChats: fetch error', err instanceof Error ? err.message : String(err))
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
      const res = await fetch(`/api/v1/projects/${projectId}?action=list-chats&limit=${DEFAULT_LIMIT}&offset=${newOffset}`)
      if (res.ok) {
        const data = await res.json()
        setChats(prev => [...prev, ...(data.chats || [])])
        setPagination(data.pagination || { total: 0, offset: newOffset, limit: DEFAULT_LIMIT, hasMore: false })
      }
    } catch (err) {
      console.error('useProjectChats: load more error', err instanceof Error ? err.message : String(err))
    } finally {
      setLoadingMore(false)
      fetchingRef.current = false
    }
  }, [projectId, pagination])

  const handleRemoveChat = useCallback(async (chatId: string) => {
    try {
      const res = await fetch(`/api/v1/projects/${projectId}?action=remove-chat`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      })

      if (!res.ok) throw new Error('Failed to remove chat')
      setChats(prev => prev.filter(c => c.id !== chatId))
      setPagination(prev => ({ ...prev, total: prev.total - 1 }))
      showSuccessToast('Chat removed from project')
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to remove chat'
      console.error('useProjectChats: remove error', errorMsg)
      showErrorToast(errorMsg)
    }
  }, [projectId])

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
