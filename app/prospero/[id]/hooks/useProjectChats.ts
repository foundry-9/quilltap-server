'use client'

/**
 * useProjectChats Hook
 *
 * The project's chats, a page at a time (`?action=list-chats`), as one
 * infinite query keyed `projects.chats(id)` — under the `projects` prefix the
 * Prospero tab refetch sweeps, so coming back to the tab re-reads every page
 * already loaded. Removing a chat from the project re-reads the list and
 * the project's counts.
 *
 * @module app/prospero/[id]/hooks/useProjectChats
 */

import { useCallback, useMemo } from 'react'
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { showSuccessToast, showErrorToast } from '@/lib/toast'
import { apiErrorMessage, apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { ProjectChat } from '../types'

interface Pagination {
  total: number
  offset: number
  limit: number
  hasMore: boolean
}

interface ProjectChatsPage {
  chats?: ProjectChat[]
  pagination?: Pagination
}

interface UseProjectChatsReturn {
  chats: ProjectChat[]
  loading: boolean
  loadingMore: boolean
  pagination: Pagination
  loadMoreChats: () => Promise<void>
  handleRemoveChat: (chatId: string) => Promise<void>
}

export const PROJECT_CHATS_PAGE_SIZE = 20

const EMPTY_PAGINATION: Pagination = { total: 0, offset: 0, limit: PROJECT_CHATS_PAGE_SIZE, hasMore: false }

export function useProjectChats(projectId: string): UseProjectChatsReturn {
  const queryClient = useQueryClient()
  const chatsKey = queryKeys.projects.chats(projectId)

  const query = useInfiniteQuery({
    queryKey: chatsKey,
    queryFn: ({ pageParam, signal }) =>
      apiFetch<ProjectChatsPage>(
        `/api/v1/projects/${projectId}?action=list-chats&limit=${PROJECT_CHATS_PAGE_SIZE}&offset=${pageParam}`,
        { signal },
      ),
    initialPageParam: 0,
    getNextPageParam: (last, _all, lastOffset) =>
      last.pagination?.hasMore ? lastOffset + (last.chats?.length ?? 0) : undefined,
  })
  const { data, isLoading, isFetchingNextPage, hasNextPage, fetchNextPage } = query

  const chats = useMemo(() => data?.pages.flatMap((p) => p.chats ?? []) ?? [], [data])
  const lastPage = data?.pages[data.pages.length - 1]
  const pagination: Pagination = lastPage?.pagination
    ? { ...lastPage.pagination, hasMore: !!hasNextPage }
    : EMPTY_PAGINATION

  const loadMoreChats = useCallback(async () => {
    if (!hasNextPage || isFetchingNextPage) return
    await fetchNextPage()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  const { mutateAsync: removeChat } = useMutation({
    mutationFn: (chatId: string) =>
      apiFetch(`/api/v1/projects/${projectId}?action=remove-chat`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId }),
      }),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: chatsKey }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists }),
        queryClient.invalidateQueries({ queryKey: queryKeys.chats.lists }),
      ]),
  })

  const handleRemoveChat = useCallback(
    async (chatId: string) => {
      try {
        await removeChat(chatId)
        showSuccessToast('Chat removed from project')
      } catch (err) {
        const message = apiErrorMessage(err, 'Failed to remove chat')
        console.error('useProjectChats: remove error', { projectId, chatId, message })
        showErrorToast(message)
      }
    },
    [removeChat, projectId],
  )

  return {
    chats,
    loading: isLoading,
    loadingMore: isFetchingNextPage,
    pagination,
    loadMoreChats,
    handleRemoveChat,
  }
}
