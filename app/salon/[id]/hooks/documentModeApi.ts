'use client'

import type { ActiveDocument, DocumentMode } from './useDocumentMode'

type DocumentScope = ActiveDocument['scope']

interface ActiveDocumentRecord {
  id: string
  filePath: string
  scope: DocumentScope
  mountPoint?: string | null
  displayTitle?: string
}

interface ActiveDocumentResponse {
  document: ActiveDocumentRecord | null
}

interface ReadDocumentResponse {
  content?: string
  mtime?: number
}

interface OpenDocumentResponse {
  document: ActiveDocumentRecord
  content?: string
  mtime?: number
}

interface ChatStateResponse {
  chat?: {
    documentMode?: DocumentMode
    dividerPosition?: number
  }
}

const JSON_HEADERS = { 'Content-Type': 'application/json' }

async function getResponseMessage(response: Response, fallbackMessage: string): Promise<string> {
  try {
    const text = await response.text()
    return text || fallbackMessage
  } catch {
    return fallbackMessage
  }
}

async function parseJsonResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    throw new Error(await getResponseMessage(response, fallbackMessage))
  }

  return response.json() as Promise<T>
}

export function toActiveDocument(
  document: ActiveDocumentRecord,
  content = '',
  mtime?: number,
): ActiveDocument {
  return {
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
  await fetch(`/api/v1/chats/${chatId}`, {
    method: 'PUT',
    headers: JSON_HEADERS,
    body: JSON.stringify({ chat: updates }),
  })
}

export async function fetchActiveDocumentRecord(chatId: string): Promise<ActiveDocumentResponse> {
  const response = await fetch(`/api/v1/chats/${chatId}?action=active-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
  })

  return parseJsonResponse<ActiveDocumentResponse>(response, 'Failed to load active document')
}

export async function readDocumentContentForChat(
  chatId: string,
  params: {
    filePath: string
    scope: DocumentScope
    mountPoint?: string | null
  },
): Promise<ReadDocumentResponse> {
  const response = await fetch(`/api/v1/chats/${chatId}?action=read-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  })

  return parseJsonResponse<ReadDocumentResponse>(response, 'Failed to read document content')
}

export async function openDocumentForChat(
  chatId: string,
  params: {
    filePath?: string
    title?: string
    scope: DocumentScope
    mountPoint?: string
    mode: 'split' | 'focus'
  },
): Promise<OpenDocumentResponse> {
  const response = await fetch(`/api/v1/chats/${chatId}?action=open-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  })

  return parseJsonResponse<OpenDocumentResponse>(response, 'Failed to open document')
}

export async function closeDocumentForChat(chatId: string): Promise<void> {
  await fetch(`/api/v1/chats/${chatId}?action=close-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
  })
}

export async function requestDocumentWrite(
  chatId: string,
  params: {
    filePath: string
    scope: DocumentScope
    mountPoint?: string | null
    content: string
    mtime?: number
  },
): Promise<Response> {
  return fetch(`/api/v1/chats/${chatId}?action=write-document`, {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify(params),
  })
}

export async function fetchChatDocumentState(chatId: string): Promise<ChatStateResponse> {
  const response = await fetch(`/api/v1/chats/${chatId}`)
  return parseJsonResponse<ChatStateResponse>(response, 'Failed to load chat state')
}
