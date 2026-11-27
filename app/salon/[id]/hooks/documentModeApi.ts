'use client'

import { patchChat } from '@/lib/chat/patch-chat'
import { apiFetch } from '@/lib/query/fetcher'
import type { Message } from '../types'
import type { ActiveDocument, DocumentMode } from './useDocumentMode'
import type { DocumentViewTarget } from '@/lib/folder-browser/document-actions'

type DocumentScope = ActiveDocument['scope']

interface ActiveDocumentRecord {
  id: string
  filePath: string
  scope: DocumentScope
  mountPoint?: string | null
  displayTitle?: string
}

interface OpenDocumentsResponse {
  documents: ActiveDocumentRecord[]
}

interface ReadDocumentResponse {
  content?: string
  mtime?: number
  /** Present for a file shown read-only; `content` is then empty. */
  viewer?: DocumentViewTarget
}

interface ResolveDocumentResponse {
  exists: boolean
  kind: 'document' | 'image' | 'other'
}

interface OpenDocumentResponse {
  document: ActiveDocumentRecord
  content?: string
  mtime?: number
  /** Present for a file shown read-only; `content` is then empty. */
  viewer?: DocumentViewTarget
  /** Librarian announcement message posted alongside the open (null if chat not found) */
  librarianMessage?: Message | null
}

interface ChatStateResponse {
  chat?: {
    documentMode?: DocumentMode
    dividerPosition?: number
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

/**
 * POST `?action=<action>` on the chat. A refusal throws an `ApiFetchError`
 * carrying the server's parsed `{ error }`.
 */
function postDocumentAction<T>(chatId: string, action: string, body?: unknown): Promise<T> {
  return apiFetch<T>(`/api/v1/chats/${chatId}?action=${action}`, {
    method: 'POST',
    headers: JSON_HEADERS,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

export function toActiveDocument(
  document: ActiveDocumentRecord,
  content = '',
  mtime?: number,
  viewer?: DocumentViewTarget,
): ActiveDocument {
  return {
    ...(viewer ? { viewer } : {}),
    id: document.id,
    filePath: document.filePath,
    scope: document.scope,
    mountPoint: document.mountPoint,
    displayTitle: document.displayTitle || document.filePath,
    content,
    mtime,
  }
}

export async function persistChatDocumentState(
  chatId: string,
  updates: Partial<{ documentMode: DocumentMode; dividerPosition: number }>,
): Promise<void> {
  await patchChat(chatId, updates)
}

/**
 * List every open document for the chat. The tabbed workspace restores one
 * editor pane per record on mount and after LLM open/close tool calls.
 */
export async function fetchOpenDocumentRecords(chatId: string): Promise<OpenDocumentsResponse> {
  return postDocumentAction<OpenDocumentsResponse>(chatId, 'open-documents')
}

export async function readDocumentContentForChat(
  chatId: string,
  params: {
    filePath: string
    scope: DocumentScope
    mountPoint?: string | null
  },
): Promise<ReadDocumentResponse> {
  return postDocumentAction<ReadDocumentResponse>(chatId, 'read-document', params)
}

/**
 * Existence probe for a `qtap://` document target, used to gate clickable links
 * in the Salon transcript. Returns `{ exists: false }` for an unreachable,
 * inaccessible, or missing document (the server never reveals bytes here).
 */
export async function resolveDocumentExistsForChat(
  chatId: string,
  params: {
    filePath: string
    scope: DocumentScope
    mountPoint?: string
  },
): Promise<ResolveDocumentResponse> {
  return postDocumentAction<ResolveDocumentResponse>(chatId, 'resolve-document', params)
}

export async function openDocumentForChat(
  chatId: string,
  params: {
    filePath?: string
    title?: string
    scope: DocumentScope
    mountPoint?: string
    mode: 'split' | 'focus'
    /**
     * Folder (relative to scope root) to drop a new blank document in. Used
     * only when `filePath` is omitted; the server picks an unused
     * "Untitled Document.md" name within that folder.
     */
    targetFolder?: string
  },
): Promise<OpenDocumentResponse> {
  return postDocumentAction<OpenDocumentResponse>(chatId, 'open-document', params)
}

/**
 * Close one document. Throws (an `ApiFetchError`) when the server refuses, so
 * the caller can keep the pane open rather than lose it until the next
 * reconcile brings it back (#306).
 */
export async function closeDocumentForChat(chatId: string, chatDocumentId?: string): Promise<void> {
  await postDocumentAction<unknown>(chatId, 'close-document', { chatDocumentId })
}

export async function requestDocumentWrite(
  chatId: string,
  params: {
    filePath: string
    scope: DocumentScope
    mountPoint?: string | null
    content: string
    mtime?: number
    /** Optional pre-formatted diff — when provided, the server posts a Librarian save announcement */
    diffContent?: string
  },
): Promise<Response> {
  // The raw answer, not apiFetch: the save loop branches on a 409
  // (`documentWriteOutcome`, document-saver.ts).
  return fetch(`/api/v1/chats/${chatId}?action=write-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  })
}

export async function fetchChatDocumentState(chatId: string): Promise<ChatStateResponse> {
  return apiFetch<ChatStateResponse>(`/api/v1/chats/${chatId}`)
}

interface RenameDocumentResponse {
  document: ActiveDocumentRecord
  /** Librarian announcement message posted alongside the rename (null if chat not found) */
  librarianMessage?: Message | null
}

export async function renameDocumentForChat(
  chatId: string,
  newTitle: string,
  chatDocumentId?: string,
): Promise<RenameDocumentResponse> {
  return postDocumentAction<RenameDocumentResponse>(chatId, 'rename-document', { newTitle, chatDocumentId })
}

interface DeleteDocumentResponse {
  success: boolean
  /** Librarian announcement message posted alongside the delete (null if chat not found) */
  librarianMessage?: Message | null
}

export async function deleteDocumentForChat(
  chatId: string,
  chatDocumentId?: string,
): Promise<DeleteDocumentResponse> {
  return postDocumentAction<DeleteDocumentResponse>(chatId, 'delete-document', { chatDocumentId })
}
