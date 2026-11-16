'use client'

/**
 * Calliope's conversations about a draft, as the editor reads and writes them
 * (`/api/v1/calliope`, Calliope Live, Spec J Stage 3). One read hook per list
 * (conversations by draft, one conversation's messages and proposals), and the
 * actions on a proposal. Keep and Try return what the editor needs; neither
 * writes the draft — the editor does, through its own edit path.
 *
 * @module components/theme-editor/calliope/api
 */

import { useQuery } from '@tanstack/react-query'
import { apiFetch } from '@/lib/query/fetcher'
import { queryKeys } from '@/lib/query/keys'
import type { ProposalView } from '@/lib/calliope/proposals'
import type { ChangeOperation } from '@/lib/themes/assist/change-set'
import type { ThemeTokensDocument } from '@/lib/themes/engine/client'
import type { ConsoleAttachmentView } from '@/components/brahma-console/ConsoleMessageAttachments'

export type { ProposalView }

/** Her collection route. */
export const CALLIOPE_API = '/api/v1/calliope'

/** Her picture, as the staff avatars are kept. */
export const CALLIOPE_AVATAR = '/images/avatars/calliope-avatar.webp'

export interface CalliopeChatSummary {
  id: string
  title: string
  themeDraftId: string | null
  createdAt: string
  updatedAt: string
  lastMessageAt: string | null
  messageCount: number
  consoleConnectionProfileId: string | null
  attachmentCount: number
}

/** A stored message as the messages route returns it (attachments resolved). */
export interface CalliopeMessage {
  id: string
  type: string
  role?: string
  content?: string
  createdAt: string
  reasoningContent?: string | null
  provider?: string | null
  modelName?: string | null
  attachments?: Array<ConsoleAttachmentView | string> | null
}

export interface CalliopeMessages {
  messages: CalliopeMessage[]
  proposals: ProposalView[]
  draftMissing: boolean
}

export interface KeptProposal {
  proposalId: string
  operations: ChangeOperation[]
  draftChanged: boolean
}

export interface TriedProposal {
  proposalId: string
  tokens: ThemeTokensDocument
  custom: string
}

export function useCalliopeChats(draftId: string) {
  return useQuery({
    queryKey: queryKeys.calliope.byDraft(draftId),
    queryFn: ({ signal }) =>
      apiFetch<{ chats: CalliopeChatSummary[] }>(`${CALLIOPE_API}?draftId=${encodeURIComponent(draftId)}`, { signal }).then((r) => r.chats),
  })
}

export function useCalliopeMessages(chatId: string | null) {
  return useQuery({
    queryKey: queryKeys.calliope.messages(chatId ?? ''),
    queryFn: ({ signal }) => apiFetch<CalliopeMessages>(`${CALLIOPE_API}/${chatId}/messages`, { signal }),
    enabled: !!chatId,
  })
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export function createCalliopeChat(draftId: string): Promise<{ chat: CalliopeChatSummary }> {
  return apiFetch(CALLIOPE_API, json({ draftId }))
}

export function deleteCalliopeChat(chatId: string): Promise<unknown> {
  return apiFetch(`${CALLIOPE_API}/${chatId}`, { method: 'DELETE' })
}

export function setCalliopeModel(chatId: string, connectionProfileId: string): Promise<unknown> {
  return apiFetch(`${CALLIOPE_API}/${chatId}?action=set-model`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionProfileId }),
  })
}

export function keepProposal(chatId: string, proposalId: string): Promise<KeptProposal> {
  return apiFetch(`${CALLIOPE_API}/${chatId}?action=keep`, json({ proposalId }))
}

export function discardProposal(chatId: string, proposalId: string): Promise<unknown> {
  return apiFetch(`${CALLIOPE_API}/${chatId}?action=discard`, json({ proposalId }))
}

export function tryProposal(chatId: string, proposalId: string): Promise<TriedProposal> {
  return apiFetch(`${CALLIOPE_API}/${chatId}?action=try`, json({ proposalId }))
}
