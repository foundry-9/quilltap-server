'use client'

/**
 * Thin wrapper around the Terminals + Chats APIs for the salon Terminal Mode.
 * A refusal throws an `ApiFetchError`; read it with `apiErrorMessage`.
 */

import { patchChat } from '@/lib/chat/patch-chat'
import { apiFetch, ApiFetchError } from '@/lib/query/fetcher'

const JSON_HEADERS = { 'Content-Type': 'application/json' }

export type TerminalMode = 'normal' | 'split' | 'focus'

export interface TerminalSessionMeta {
  id: string
  chatId: string
  shell: string
  cwd: string
  label?: string | null
  startedAt: string
  exitedAt?: string | null
  exitCode?: number | null
}

interface SessionListResponse {
  sessions: TerminalSessionMeta[]
}

interface SessionGetResponse {
  session: TerminalSessionMeta
  ringBuffer: string | null
}

interface SpawnResponse {
  session: TerminalSessionMeta
}

export async function persistChatTerminalState(
  chatId: string,
  updates: Partial<{
    terminalMode: TerminalMode
    activeTerminalSessionId: string | null
    rightPaneVerticalSplit: number
  }>,
): Promise<void> {
  await patchChat(chatId, updates)
}

export async function listTerminalSessions(chatId: string): Promise<TerminalSessionMeta[]> {
  const data = await apiFetch<SessionListResponse>(`/api/v1/terminals?chatId=${encodeURIComponent(chatId)}`)
  return data.sessions ?? []
}

export async function getTerminalSession(sessionId: string): Promise<TerminalSessionMeta | null> {
  try {
    const data = await apiFetch<SessionGetResponse>(`/api/v1/terminals/${sessionId}`)
    return data.session
  } catch (error) {
    if (error instanceof ApiFetchError && error.status === 404) return null
    throw error
  }
}

export async function spawnTerminalSession(chatId: string): Promise<TerminalSessionMeta> {
  const data = await apiFetch<SpawnResponse>('/api/v1/terminals', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ chatId }),
  })
  return data.session
}

export async function killTerminalSessionApi(sessionId: string): Promise<void> {
  await apiFetch(`/api/v1/terminals/${sessionId}?action=kill`, {
    method: 'POST',
  })
}

export function isLiveSession(meta: TerminalSessionMeta | null): boolean {
  if (!meta) return false
  return !meta.exitedAt
}
