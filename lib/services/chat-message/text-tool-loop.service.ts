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
  name: 'provider-text-markers' | 'text-block' | 'simple-json'
  /** Returns true when the response contains markers this strategy can parse. */
  hasMarkers: (response: string) => boolean
  /** Parses tool calls out of the response. May return an empty array even
   * when {@link hasMarkers} returned true; the pass no-ops in that case. */
  parse: (response: string) => ParsedTextToolCall[]
  /** Removes the strategy's markers from the response. Called once on the
   * pre-continuation text *and* once on the final combined response. */
  strip: (response: string) => string
  /** Formats a single tool result for inclusion in the continuation slate as
   * a synthetic `user`-role message. Each strategy frames results in the
   * style symmetric with the markers it just stripped. */
  formatToolResult: (toolName: string, content: string) => string
  /** Optional provider stop sequences to apply to the continuation re-stream.
   * The orchestrator is responsible for applying them to the *initial* stream;
   * the loop applies them here for the continuation. */
  stopSequences?: string[]
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
 * Cap on text-tool iterations per assistant turn. Mirrors the native-tool
 * loop's `effectiveMaxTurns` default (`native-tool-loop.service.ts:100`).
 */
const MAX_TEXT_TOOL_ITERATIONS = 5

/**
 * Number of *prior* identical tool-call signatures permitted before the loop
 * stops executing and asks the model to respond with what it already has.
 * `>= 2` prior matches means the current call is the third — same threshold
 * the help-chat orchestrator uses for stuck agents
 * (`help-chat/orchestrator.service.ts:335`).
 */
const MAX_DUPLICATE_TOOL_CALLS = 2

/**
 * Run text-tool detection-and-continuation up to {@link MAX_TEXT_TOOL_ITERATIONS}
 * times. No-ops when the initial response has no markers.
 *
 * Per iteration: parse markers, fingerprint the call set, refuse repeats past
 * the duplicate cap, otherwise execute the tools and re-stream a continuation
 * with the **un-stripped** assistant turn re-included so the model can see its
 * own tool call paired with the result it's now responding to. Streamed
 * content from every iteration is enqueued to the client in order; the final
 * `streaming.fullResponse` is the stripped concatenation suitable for storage.
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

  // Raw (un-stripped) response from each stream pass — the primary stream
  // first, then each continuation. Stripped and joined at the end into the
  // user-visible message body.
  const rawResponses: string[] = [streaming.fullResponse]
  // Accumulated (assistant, tool_result+) pairs sent back to the model on
  // every continuation. The assistant entries keep their `<tool_call>` markers
  // so the causal chain stays intact for the model — it sees its own request
  // sitting next to the result it's now reacting to.
  const ledger: typeof formattedMessages = []
  // JSON-stringified signatures of executed tool-call batches; same shape as
  // `help-chat/orchestrator.service.ts:428`.
  const toolCallHistory: string[] = []
  let iterations = 0

  while (iterations < MAX_TEXT_TOOL_ITERATIONS) {
    const latest = rawResponses[rawResponses.length - 1]
    if (!strategy.hasMarkers(latest)) break

    const parsedToolCalls = strategy.parse(latest)
    if (parsedToolCalls.length === 0) break

    const callSignature = JSON.stringify(
      parsedToolCalls.map(tc => ({ name: tc.name, arguments: tc.arguments }))
    )
    const duplicateCount = toolCallHistory.filter(s => s === callSignature).length

    if (duplicateCount >= MAX_DUPLICATE_TOOL_CALLS) {
      logger.warn('Text-tool loop: repeated identical tool calls; nudging model to respond', {
        chatId,
        characterName: character.name,
        strategy: strategy.name,
        iterations,
        duplicateCount: duplicateCount + 1,
        tools: parsedToolCalls.map(tc => tc.name),
      })

      // Don't execute the duplicate batch. Keep the assistant's repeated
      // request in the ledger so the model sees what it just tried, then
      // append a synthetic user nudge and re-stream once more for the final
      // response. Mirrors the help-chat dedupe nudge at
      // `help-chat/orchestrator.service.ts:447-453`.
      ledger.push({
        role: 'assistant',
        content: latest,
        thoughtSignature: streaming.thoughtSignature,
        reasoningContent: streaming.reasoningContent,
        name: undefined,
      })
      ledger.push({
        role: 'user',
        content:
          `You have already called the same tool with the same arguments ` +
          `${duplicateCount + 1} times and received the same result each time. ` +
          `You already have the data you need — do NOT call any more tools. ` +
          `Respond now, in character, using what you've already learned.`,
        thoughtSignature: undefined,
        reasoningContent: undefined,
        name: undefined,
      })

      try {
        await streamContinuation({
          chatId,
          userId,
          character,
          preGeneratedAssistantMessageId,
          strategy,
          formattedMessages,
          ledger,
          modelParams,
          continuationTools,
          continuationUseNativeWebSearch,
          streaming,
          controller,
          encoder,
          rawResponses,
        })
      } catch (nudgeError) {
        streaming.fullResponse = assembleStripped(strategy, rawResponses)
        await preservePartialOnError(nudgeError)
        throw nudgeError
      }
      break
    }

    toolCallHistory.push(callSignature)
    iterations++

    logger.info(
      `Detected ${strategy.name === 'text-block' ? 'text-block' : 'text'} tool calls in response`,
      {
        iteration: iterations,
        count: parsedToolCalls.length,
        tools: parsedToolCalls.map(tc => tc.name),
        strategy: strategy.name,
        ...(strategy.name === 'provider-text-markers'
          ? { provider: streaming.effectiveProfile.provider }
          : {}),
      },
    )

    const results = await processToolCalls(
      parsedToolCalls,
      toolContext,
      controller,
      encoder,
      { characterName: character.name, characterId: character.id },
    )
    toolMessages.push(...results.toolMessages)
    generatedImagePaths.push(...results.generatedImagePaths)

    // Append the just-finished turn to the ledger. `latest` retains its
    // `<tool_call>` markers on purpose: stripping them here is what broke
    // continuations on simple-json (the model couldn't see why a tool_result
    // had appeared in a user turn).
    ledger.push({
      role: 'assistant',
      content: latest,
      thoughtSignature: streaming.thoughtSignature,
      reasoningContent: streaming.reasoningContent,
      name: undefined,
    })
    for (const toolMsg of results.toolMessages) {
      ledger.push({
        role: 'user',
        content: strategy.formatToolResult(toolMsg.toolName, toolMsg.content),
        thoughtSignature: undefined,
        reasoningContent: undefined,
        name: undefined,
      })
    }

    try {
      await streamContinuation({
        chatId,
        userId,
        character,
        preGeneratedAssistantMessageId,
        strategy,
        formattedMessages,
        ledger,
        modelParams,
        continuationTools,
        continuationUseNativeWebSearch,
        streaming,
        controller,
        encoder,
        rawResponses,
      })
    } catch (continuationError) {
      streaming.fullResponse = assembleStripped(strategy, rawResponses)
      await preservePartialOnError(continuationError)
      throw continuationError
    }
  }

  if (iterations >= MAX_TEXT_TOOL_ITERATIONS) {
    logger.warn('Text-tool loop hit iteration cap', {
      chatId,
      characterName: character.name,
      strategy: strategy.name,
      iterations,
    })
  }

  streaming.fullResponse = assembleStripped(strategy, rawResponses)
}

interface StreamContinuationArgs {
  chatId: string
  userId: string
  character: { id: string; name: string }
  preGeneratedAssistantMessageId: string
  strategy: TextToolStrategy
  formattedMessages: StreamOptions['messages']
  ledger: StreamOptions['messages']
  modelParams: Record<string, unknown>
  continuationTools: unknown[]
  continuationUseNativeWebSearch: boolean
  streaming: StreamingState
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  /** Appended to in place: a fresh empty string is pushed before the stream
   * begins, then each chunk's content is concatenated onto it. Lets the caller
   * recover partial content if the stream throws mid-iteration. */
  rawResponses: string[]
}

async function streamContinuation(args: StreamContinuationArgs): Promise<void> {
  const {
    chatId,
    userId,
    character,
    preGeneratedAssistantMessageId,
    strategy,
    formattedMessages,
    ledger,
    modelParams,
    continuationTools,
    continuationUseNativeWebSearch,
    streaming,
    controller,
    encoder,
    rawResponses,
  } = args

  safeEnqueue(controller, encodeStatusEvent(encoder, {
    stage: 'sending',
    message: `Sending to ${character.name}...`,
    characterName: character.name,
    characterId: character.id,
  }))

  const continuationMessages: typeof formattedMessages = [...formattedMessages, ...ledger]
  rawResponses.push('')
  const idx = rawResponses.length - 1

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
    stop: strategy.stopSequences,
  })) {
    if (chunk.content) {
      rawResponses[idx] += chunk.content
      controller.enqueue(encodeContentChunk(encoder, chunk.content))
    }

    if (chunk.done) {
      streaming.usage = chunk.usage || null
      streaming.cacheUsage = chunk.cacheUsage || null
      streaming.rawResponse = chunk.rawResponse
      if (chunk.thoughtSignature) {
        streaming.thoughtSignature = chunk.thoughtSignature
      }
      if (chunk.reasoningContent) {
        streaming.reasoningContent = chunk.reasoningContent
      }
    }
  }
}

function assembleStripped(strategy: TextToolStrategy, rawResponses: string[]): string {
  return rawResponses
    .map(r => strategy.strip(r))
    .filter(r => r.trim().length > 0)
    .join('\n\n')
}
