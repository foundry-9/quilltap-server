/**
 * The dice button's request — `POST /api/v1/chats/[id]?action=rng` — and the
 * shape of the pending-result chip it produces. Shared by `RngDropdown` and the
 * composer's `/d6`, `/d20`, `/coin`, `/bottle` commands: one request, one chip.
 *
 * @module components/chat/rng-request
 */

import { apiFetch, ApiFetchError } from '@/lib/query/fetcher'

/** What to roll: a die with this many sides, a coin, or the bottle. */
export type RngRollType = number | 'flip_coin' | 'spin_the_bottle'

export interface RngRequestArgs {
  type: RngRollType
  rolls: number
}

/** Pending tool result data returned from preview mode */
export interface RngPendingResult {
  tool: 'rng'
  displayName: string
  icon: string
  summary: string
  formattedResult: string
  requestPrompt: string
  arguments: Record<string, unknown>
  success: boolean
}

interface RngResponse {
  preview?: boolean
  result?: {
    summary: string
    formattedText: string
    requestPrompt: string
    arguments: Record<string, unknown>
  }
}

async function postRng(chatId: string, args: RngRequestArgs, preview: boolean) {
  try {
    return await apiFetch<RngResponse>(`/api/v1/chats/${chatId}?action=rng`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: args.type, rolls: args.rolls, preview }),
    })
  } catch (err) {
    // A refusal's reason: `message` before `error`, as the dice have always read it.
    const info = err instanceof ApiFetchError ? (err.info as { message?: string; error?: string } | undefined) : undefined
    if (info) throw new Error(info.message || info.error || 'RNG failed')
    throw err
  }
}

/**
 * Roll in preview mode and shape the result as the composer's pending chip.
 * Nothing is posted to the chat; the chip rides along with the next send.
 */
export async function requestRngPendingResult(
  chatId: string,
  args: RngRequestArgs,
): Promise<RngPendingResult> {
  const data = await postRng(chatId, args, true)
  if (!data.preview || !data.result) {
    throw new Error('RNG did not return a preview')
  }
  return {
    tool: 'rng',
    displayName: 'Random Number Generator',
    icon: '🎲',
    summary: data.result.summary,
    formattedResult: data.result.formattedText,
    requestPrompt: data.result.requestPrompt,
    arguments: data.result.arguments,
    success: true,
  }
}

/** Legacy mode: the server posts the roll as a message itself. */
export async function requestRngDirect(
  chatId: string,
  args: RngRequestArgs,
): Promise<{ formattedText: string }> {
  const data = await postRng(chatId, args, false)
  return data.result as { formattedText: string }
}
