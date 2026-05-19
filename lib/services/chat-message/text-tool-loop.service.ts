/**
 * Text-Tool Loop Service
 *
 * Unifies the two "detect text-format tool calls in the streamed response →
 * execute them → re-stream a continuation" passes that the orchestrator runs
 * after its primary stream and native-tool loop have finished:
 *
 *   - **provider-text-markers**: catches spontaneous XML-style emissions that
 *     the provider plugin recognises (e.g. DeepSeek's `<function_calls>`,
 *     Gemini's `<tool_use>`). Detector/parser/stripper come from the active
 *     `getProvider(...)` plugin.
 *   - **text-block**: catches the prompt-injected `[[TOOL_NAME ...]]content[[/TOOL_NAME]]`
 *     format that every provider can emit. Detector/parser/stripper come from
 *     `pseudo-tool.service` and `@/lib/tools`.
 *
 * The pass is a no-op when the strategy reports no markers (or parses to an
 * empty list). Otherwise it executes the parsed tool calls via
 * `processToolCalls`, strips the markers from the response, builds a fresh
 * conversation slate (formattedMessages + stripped assistant turn + one
 * synthetic user message per tool result), and re-streams a continuation.
 * On stream failure the partial continuation is preserved via the caller's
 * `preservePartialOnError` closure before the error re-throws.
 *
 * Mutations: `streaming.fullResponse` is rewritten to `<stripped>\n\n<continuation>`
 * (re-stripped at the end so any markers in the continuation are gone), and
 * `streaming.usage` / `cacheUsage` / `rawResponse` / `thoughtSignature` track
 * the continuation chunks. `toolMessages` and `generatedImagePaths` are
 * pushed to in place. The orchestrator's bindings are passed by reference.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  encodeContentChunk,
  encodeStatusEvent,
  safeEnqueue,
  streamMessage,
  type StreamOptions,
} from './streaming.service'
import { processToolCalls } from './tool-execution.service'

import type { ToolExecutionContext } from '@/lib/chat/tool-executor'
import type { GeneratedImage, StreamingState, ToolMessage } from './types'

const logger = createServiceLogger('TextToolLoop')

export interface ParsedTextToolCall {
  name: string
  arguments: Record<string, unknown>
  callId?: string
}

export interface TextToolStrategy {
  /** Identifies the pass for logging and the unsupported-strategy fallthrough. */
  name: 'provider-text-markers' | 'text-block'
  /** Returns true when the response contains markers this strategy can parse. */
  hasMarkers: (response: string) => boolean
  /** Parses tool calls out of the response. May return an empty array even
   * when {@link hasMarkers} returned true; the pass no-ops in that case. */
  parse: (response: string) => ParsedTextToolCall[]
  /** Removes the strategy's markers from the response. Called once on the
   * pre-continuation text *and* once on the final combined response. */
  strip: (response: string) => string
}

export interface RunTextToolPassOptions {
  chatId: string
  userId: string
  character: { id: string; name: string }
  preGeneratedAssistantMessageId: string
  strategy: TextToolStrategy
  /** Conversation slate that primed the initial stream. The continuation
   * starts from a fresh copy of this. */
  formattedMessages: StreamOptions['messages']
  modelParams: Record<string, unknown>
  /** Tools to expose during the continuation re-stream. The text-block pass
   * generally sends `[]` here (the text-block tools that produced the markers
   * shouldn't be re-offered as native tools); the provider-text-markers pass
   * generally sends the regular tool slate. */
  continuationTools: unknown[]
  /** Whether the continuation re-stream may use native web search. */
  continuationUseNativeWebSearch: boolean
  toolContext: ToolExecutionContext
  /** Mutated in place: `fullResponse`, `usage`, `cacheUsage`, `rawResponse`,
   * `thoughtSignature` are all rewritten by the continuation. */
  streaming: StreamingState
  /** Mutated in place via `.push(...)`. */
  toolMessages: ToolMessage[]
  /** Mutated in place via `.push(...)`. */
  generatedImagePaths: GeneratedImage[]
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  /** Idempotent partial-response preserver from the orchestrator. */
  preservePartialOnError: (error: unknown) => Promise<void>
}

/**
 * Run a single text-tool detection-and-continuation pass. No-ops when the
 * strategy detects nothing.
 */
export async function runTextToolPass(opts: RunTextToolPassOptions): Promise<void> {
  const {
    chatId,
    userId,
    character,
    preGeneratedAssistantMessageId,
    strategy,
    formattedMessages,
    modelParams,
    continuationTools,
    continuationUseNativeWebSearch,
    toolContext,
    streaming,
    toolMessages,
    generatedImagePaths,
    controller,
    encoder,
    preservePartialOnError,
  } = opts

  if (!streaming.fullResponse || !strategy.hasMarkers(streaming.fullResponse)) {
    return
  }

  const parsedToolCalls = strategy.parse(streaming.fullResponse)
  if (parsedToolCalls.length === 0) {
    return
  }

  logger.info(`Detected ${strategy.name === 'text-block' ? 'text-block' : 'text'} tool calls in response`, {
    count: parsedToolCalls.length,
    tools: parsedToolCalls.map(tc => tc.name),
    strategy: strategy.name,
    ...(strategy.name === 'provider-text-markers'
      ? { provider: streaming.effectiveProfile.provider }
      : {}),
  })

  const results = await processToolCalls(
    parsedToolCalls,
    toolContext,
    controller,
    encoder,
    { characterName: character.name, characterId: character.id },
  )
  toolMessages.push(...results.toolMessages)
  generatedImagePaths.push(...results.generatedImagePaths)

  const strippedResponse = strategy.strip(streaming.fullResponse)

  // Build a fresh continuation slate: original formatted messages, then the
  // stripped assistant turn (if non-empty), then one synthetic user message
  // per tool result. Re-using `formattedMessages` directly (rather than the
  // current native-tool-loop's `currentMessages`) matches the pre-extraction
  // behaviour at lines 1564 and 1654 of the original orchestrator.
  const continuationMessages: typeof formattedMessages = [...formattedMessages]
  if (strippedResponse.trim()) {
    continuationMessages.push({
      role: 'assistant',
      content: strippedResponse,
      thoughtSignature: streaming.thoughtSignature,
      name: undefined,
    })
  }
  for (const toolMsg of results.toolMessages) {
    continuationMessages.push({
      role: 'user',
      content: `[Tool Result: ${toolMsg.toolName}]\n${toolMsg.content}`,
      thoughtSignature: undefined,
      name: undefined,
    })
  }

  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'sending',
    message: `Sending to ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))

  let continuationResponse = ''
  try {
    for await (const chunk of streamMessage({
      messages: continuationMessages,
      connectionProfile: streaming.effectiveProfile,
      apiKey: streaming.effectiveApiKey,
      modelParams,
      tools: continuationTools,
      useNativeWebSearch: continuationUseNativeWebSearch,
      userId,
      messageId: preGeneratedAssistantMessageId,
      chatId,
    })) {
      if (chunk.content) {
        continuationResponse += chunk.content
        controller.enqueue(encodeContentChunk(encoder, chunk.content))
      }

      if (chunk.done) {
        streaming.usage = chunk.usage || null
        streaming.cacheUsage = chunk.cacheUsage || null
        streaming.rawResponse = chunk.rawResponse
        if (chunk.thoughtSignature) {
          streaming.thoughtSignature = chunk.thoughtSignature
        }
      }
    }
  } catch (continuationError) {
    streaming.fullResponse = joinStrippedAndContinuation(strippedResponse, continuationResponse)
    // Match phase-20's belt-and-braces re-strip on the error path.
    streaming.fullResponse = strategy.strip(streaming.fullResponse)
    await preservePartialOnError(continuationError)
    throw continuationError
  }

  streaming.fullResponse = joinStrippedAndContinuation(strippedResponse, continuationResponse)
  // Strip any markers that survived into the continuation.
  streaming.fullResponse = strategy.strip(streaming.fullResponse)
}

function joinStrippedAndContinuation(stripped: string, continuation: string): string {
  const separator = stripped.trim() && continuation.trim() ? '\n\n' : ''
  return stripped + separator + continuation
}
