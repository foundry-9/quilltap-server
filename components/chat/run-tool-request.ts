/**
 * The operator's built-in tool run — `POST /api/v1/chats/[id]?action=run-tool`.
 * Shared by the Run Tool dialog and the composer's parameterless `/` commands:
 * one request, one success rule.
 *
 * @module components/chat/run-tool-request
 */

import { apiFetch } from '@/lib/query/fetcher'

export interface RunBuiltInToolArgs {
  toolName: string
  arguments: Record<string, unknown>
  /** The character the run is attributed to; the server falls back to the first active one. */
  characterId?: string | null
  private: boolean
}

interface RunToolResponse {
  success?: boolean
  error?: string
  message?: string
}

/**
 * Run a built-in tool in a chat. Resolves when the server reports success;
 * throws an `ApiFetchError` on a non-2xx and an `Error` carrying the server's
 * `error` / `message` when it answers 2xx without `success`.
 */
export async function runBuiltInTool(chatId: string, args: RunBuiltInToolArgs): Promise<void> {
  const data = await apiFetch<RunToolResponse>(`/api/v1/chats/${chatId}?action=run-tool`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      toolName: args.toolName,
      arguments: args.arguments,
      characterId: args.characterId || undefined,
      private: args.private,
    }),
  })
  if (!data?.success) {
    throw new Error(data?.error || data?.message || '')
  }
}

/** The form's values with every empty field (undefined, null, '') left out. */
export function cleanArgs(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null && value !== '') {
      out[key] = value
    }
  }
  return out
}
