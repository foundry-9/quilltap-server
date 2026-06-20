/**
 * Tool-call message threading — the single source of truth for how a native
 * tool-use turn is re-threaded into the outgoing message slate so a provider
 * can pair its function-calling blocks on the follow-up stream.
 *
 * Both the Salon's `runNativeToolLoop` and the Brahma Console orchestrator build
 * their per-iteration "assistant turn + tool results" the same way through these
 * helpers, so the two agent loops cannot drift apart. The pairing rule:
 *
 *   - When ANY call in the batch carries a provider call ID, attach the full
 *     `toolCalls` array to the assistant turn and emit each result as a native
 *     `tool`-role message keyed by `toolCallId` (OpenAI / Z.AI / Anthropic).
 *   - Otherwise the assistant turn is content-only and each result is framed as
 *     a `[Tool Result: <name>]` user message, so providers that don't thread by
 *     id still see the output inline.
 *
 * Getting this wrong is what made the Brahma Console loop: empty assistant turns
 * plus `tool` messages bound to no call left the model unable to tell it had
 * already run a query, so it re-ran the same one until it burned its turn cap.
 */

import type { ToolMessage } from './types'

/**
 * A provider-agnostic outgoing chat message. Structurally a subset of
 * `StreamOptions['messages']` element, so instances are assignable into either
 * loop's message slate.
 */
export interface ThreadedMessage {
  role: string
  content: string
  name?: string
  thoughtSignature?: string
  reasoningContent?: string
  toolCallId?: string
  toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
}

/** A tool call as surfaced by `detectToolCallsInResponse`. */
export interface DetectedToolCall {
  name: string
  arguments: Record<string, unknown>
  callId?: string
}

/**
 * Build the assistant turn that carries a batch of native tool calls. Attaches
 * the `toolCalls` array only when at least one call has a provider call ID;
 * otherwise the turn is content-only (the results are framed as text by
 * {@link buildToolResultMessages}). Empty/whitespace prose collapses to `''`.
 *
 * `reasoningContent`/`thoughtSignature` are forwarded for providers that require
 * the thinking block to accompany the tool-use turn within the same request
 * (e.g. Anthropic). They are request-local continuation state, not durable
 * history — historical turns drop them.
 */
export function buildAssistantToolCallMessage(
  toolCalls: DetectedToolCall[],
  currentResponse: string,
  opts?: { reasoningContent?: string; thoughtSignature?: string },
): ThreadedMessage {
  const hasCallIds = toolCalls.some((tc) => tc.callId)
  const toolCallsPayload = hasCallIds
    ? toolCalls
        .filter((tc) => tc.callId)
        .map((tc) => ({
          id: tc.callId!,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }))
    : undefined

  return {
    role: 'assistant',
    content: currentResponse && currentResponse.trim().length > 0 ? currentResponse : '',
    thoughtSignature: opts?.thoughtSignature,
    reasoningContent: opts?.reasoningContent,
    name: undefined,
    toolCalls: toolCallsPayload,
  }
}

/**
 * Build the per-result messages that follow the assistant tool-call turn. A
 * result with a call ID becomes a native `tool`-role message paired by
 * `toolCallId`; without one it falls back to a `[Tool Result: <name>]` user
 * message. Order is preserved so each result sits right after the turn that
 * requested it.
 */
export function buildToolResultMessages(toolMessages: ToolMessage[]): ThreadedMessage[] {
  return toolMessages.map((tm) =>
    tm.callId
      ? {
          role: 'tool',
          content: tm.content,
          toolCallId: tm.callId,
          name: tm.toolName,
          thoughtSignature: undefined,
          reasoningContent: undefined,
        }
      : {
          role: 'user',
          content: `[Tool Result: ${tm.toolName}]\n${tm.content}`,
          thoughtSignature: undefined,
          reasoningContent: undefined,
          name: undefined,
        },
  )
}
