/**
 * Native Tool Loop Service
 *
 * Owns the orchestrator's bounded "stream → execute native tool calls →
 * re-stream" loop that runs after the primary stream completes. Behavior:
 *
 *   1. Each iteration inspects `currentRawResponse` for provider-native tool
 *      calls (function-calling tool-use blocks, etc.). Zero calls → exit.
 *   2. In agent mode, `submit_final_response` is special: it terminates the
 *      loop and stamps `streaming.fullResponse` with the model's structured
 *      final answer. The **ghost-wrap guardrail** rejects an iteration-0,
 *      sole-tool-call `submit_final_response` with no prose — almost always
 *      a re-wrap of a previously-concluded turn rather than a response to
 *      the current user message — and synthesizes a failure tool result so
 *      the loop re-prompts for a conversational reply.
 *   3. Per iteration: dispatch via `processToolCalls`, append the assistant
 *      turn (with `toolCalls:` for callId-bearing providers, or empty content
 *      when the model emitted only tool calls), append one message per tool
 *      result (native `tool` role when a callId is available, text fallback
 *      otherwise), re-stream with the same tool slate, accumulate into
 *      `streaming.fullResponse`.
 *   4. After the loop, if iterations hit `effectiveMaxTurns` without
 *      `submit_final_response` succeeding, agent mode runs a single
 *      force-final pass that may overwrite `streaming.fullResponse` from a
 *      submit_final_response in the force-final response. Non-agent mode
 *      just logs the cap.
 *
 * Mutations: `streaming.fullResponse`, `streaming.usage`, `streaming.cacheUsage`,
 * `streaming.attachmentResults`, `streaming.rawResponse`, `streaming.thoughtSignature`
 * are all written in place. `toolMessages` and `generatedImagePaths` are
 * appended via `.push(...)` so the orchestrator's bindings stay live.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import {
  encodeContentChunk,
  encodeStatusEvent,
  safeEnqueue,
  streamMessage,
  type StreamOptions,
} from './streaming.service'
import { detectToolCallsInResponse, processToolCalls } from './tool-execution.service'
import { buildForceFinalMessage, generateIterationSummary, type ResolvedAgentMode } from './agent-mode-resolver.service'

import type { getRepositories } from '@/lib/repositories/factory'
import type { Character } from '@/lib/schemas/types'
import type { ToolExecutionContext } from '@/lib/chat/tool-executor'
import type { GeneratedImage, StreamingState, ToolMessage, ToolProcessingResult } from './types'

const logger = createServiceLogger('NativeToolLoop')

export interface RunNativeToolLoopOptions {
  repos: ReturnType<typeof getRepositories>
  chatId: string
  userId: string
  character: Character
  characterParticipant: { id: string }
  preGeneratedAssistantMessageId: string
  agentMode: ResolvedAgentMode
  /** Slate that primed the primary stream. The loop builds on top via copy. */
  formattedMessages: StreamOptions['messages']
  modelParams: Record<string, unknown>
  actualTools: unknown[]
  useNativeWebSearch: boolean
  toolContext: ToolExecutionContext
  /** Mutated in place. */
  streaming: StreamingState
  /** Mutated in place via `.push(...)`. */
  toolMessages: ToolMessage[]
  /** Mutated in place via `.push(...)`. */
  generatedImagePaths: GeneratedImage[]
  controller: ReadableStreamDefaultController<Uint8Array>
  encoder: TextEncoder
  preservePartialOnError: (error: unknown) => Promise<void>
}

const GHOST_WRAP_REJECTION_MESSAGE =
  "Rejected: submit_final_response was called on the first iteration without any accompanying task work or conversational prose this turn. The previous turn already concluded — do not re-wrap completed work. Respond to the user's current message directly, in character, as natural prose. You may use memory or other tools first if helpful, but only call submit_final_response after completing fresh agentic work that warrants a structured summary."

/**
 * Run the bounded native-tool loop, including agent-mode `submit_final_response`
 * extraction, the iteration-0 ghost-wrap guardrail, and the max-turns
 * force-final branch.
 */
export async function runNativeToolLoop(opts: RunNativeToolLoopOptions): Promise<void> {
  const {
    repos, chatId, userId, character, preGeneratedAssistantMessageId,
    agentMode, formattedMessages, modelParams, actualTools, useNativeWebSearch,
    toolContext, streaming, toolMessages, generatedImagePaths,
    controller, encoder, preservePartialOnError,
  } = opts

  // Initial state: the primary stream's slate + response is what the loop's
  // first iteration sees. `currentResponse` accumulates per-iteration content
  // for ghost-wrap and submit_final_response heuristics.
  let currentMessages: StreamOptions['messages'] = [...formattedMessages]
  let currentResponse = streaming.fullResponse
  let currentRawResponse: unknown = streaming.rawResponse

  const effectiveMaxTurns = agentMode.enabled ? agentMode.maxTurns : 5
  let toolIterations = 0
  let agentModeCompleted = false

  while (currentRawResponse && toolIterations < effectiveMaxTurns) {
    const toolCalls = detectToolCallsInResponse(currentRawResponse, streaming.effectiveProfile.provider)
    if (toolCalls.length === 0) break

    const submitFinalCall = agentMode.enabled
      ? toolCalls.find(tc => tc.name === 'submit_final_response')
      : undefined

    // Ghost-wrap guardrail: an iteration-0, sole submit_final_response with
    // no accompanying prose is almost always re-wrapping a previously-
    // concluded turn rather than responding to the current message.
    const isGhostWrapUp =
      !!submitFinalCall &&
      toolIterations === 0 &&
      toolCalls.length === 1 &&
      !(currentResponse && currentResponse.trim().length > 0)

    if (submitFinalCall && !isGhostWrapUp) {
      const args = submitFinalCall.arguments as { response?: string; summary?: string; confidence?: number }
      const agentFinalResponse = args.response || currentResponse
      agentModeCompleted = true

      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'agent_completed',
        message: 'Agent completed task',
        characterName: character.name,
        characterId: character.id,
      }))

      logger.info('Agent mode completed via submit_final_response', {
        chatId,
        iterations: toolIterations,
        responseLength: agentFinalResponse?.length,
        summary: args.summary,
        confidence: args.confidence,
      })

      streaming.fullResponse = agentFinalResponse
      break
    }

    toolIterations++

    if (agentMode.enabled) {
      const toolNames = toolCalls.map(tc => tc.name)
      const iterationSummary = generateIterationSummary(toolIterations, toolNames, currentResponse)

      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'agent_iteration',
        message: iterationSummary,
        characterName: character.name,
        characterId: character.id,
      }))

      await repos.chats.update(chatId, { agentTurnCount: toolIterations })
    }

    let results: ToolProcessingResult
    if (isGhostWrapUp && submitFinalCall) {
      logger.info('[AgentMode] Rejecting iteration-0 submit_final_response with no prior work this turn', {
        chatId,
        rejectedResponseLength: (submitFinalCall.arguments as { response?: string }).response?.length,
      })
      results = {
        toolMessages: [{
          toolName: 'submit_final_response',
          success: false,
          content: GHOST_WRAP_REJECTION_MESSAGE,
          callId: submitFinalCall.callId,
          arguments: submitFinalCall.arguments,
        }],
        generatedImagePaths: [],
      }
    } else {
      results = await processToolCalls(toolCalls, toolContext, controller, encoder, { characterName: character.name, characterId: character.id })
    }
    toolMessages.push(...results.toolMessages)
    generatedImagePaths.push(...results.generatedImagePaths)

    // Reconstruct the assistant turn so providers can re-thread their native
    // tool-use blocks. When any tool call carries a callId, attach the full
    // toolCalls array on the assistant message; otherwise fall through to
    // text-only tool result framing below.
    const hasCallIds = toolCalls.some(tc => tc.callId)
    const assistantToolCalls = hasCallIds
      ? toolCalls.filter(tc => tc.callId).map(tc => ({
          id: tc.callId!,
          type: 'function' as const,
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        }))
      : undefined

    currentMessages = [
      ...currentMessages,
      {
        role: 'assistant' as const,
        content: currentResponse && currentResponse.trim().length > 0 ? currentResponse : '',
        thoughtSignature: streaming.thoughtSignature,
        name: undefined,
        toolCalls: assistantToolCalls,
      },
    ]

    for (const toolMsg of results.toolMessages) {
      if (toolMsg.callId) {
        currentMessages = [
          ...currentMessages,
          { role: 'tool' as const, content: toolMsg.content, toolCallId: toolMsg.callId, name: toolMsg.toolName, thoughtSignature: undefined },
        ]
      } else {
        currentMessages = [
          ...currentMessages,
          { role: 'user' as const, content: `[Tool Result: ${toolMsg.toolName}]\n${toolMsg.content}`, thoughtSignature: undefined, name: undefined },
        ]
      }
    }

    // "Running X..." statuses are emitted inside processToolCalls; reset the
    // user-visible stage before the follow-up stream kicks off.
    safeEnqueue(controller, encodeStatusEvent(encoder, {
      stage: 'sending',
      message: `Sending to ${character.name}...`,
      characterName: character.name,
      characterId: character.id,
    }))

    currentResponse = ''
    currentRawResponse = null

    let emittedStreamingStatus = false
    try {
      for await (const chunk of streamMessage({
        messages: currentMessages,
        connectionProfile: streaming.effectiveProfile,
        apiKey: streaming.effectiveApiKey,
        modelParams,
        tools: actualTools,
        useNativeWebSearch,
        userId,
        messageId: preGeneratedAssistantMessageId,
        chatId,
        characterId: character.id,
      })) {
        if (chunk.content) {
          if (!emittedStreamingStatus) {
            emittedStreamingStatus = true
            safeEnqueue(controller, encodeStatusEvent(encoder, {
              stage: 'streaming',
              message: `${character.name} is responding...`,
              characterName: character.name,
              characterId: character.id,
            }))
          }
          currentResponse += chunk.content
          streaming.fullResponse += chunk.content
          controller.enqueue(encodeContentChunk(encoder, chunk.content))
        }

        if (chunk.done) {
          streaming.usage = chunk.usage || null
          streaming.cacheUsage = chunk.cacheUsage || null
          streaming.attachmentResults = chunk.attachmentResults || null
          currentRawResponse = chunk.rawResponse
          streaming.rawResponse = chunk.rawResponse
          if (chunk.thoughtSignature) {
            streaming.thoughtSignature = chunk.thoughtSignature
          }
        }
      }
    } catch (toolLoopStreamError) {
      await preservePartialOnError(toolLoopStreamError)
      throw toolLoopStreamError
    }

    // Silent tool use (raw response but no streamed text) needs an explicit
    // status so the user knows the model is mid-work.
    if (!emittedStreamingStatus && currentRawResponse) {
      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'processing_tools',
        message: `${character.name} is using tools...`,
        characterName: character.name,
        characterId: character.id,
      }))
    }
  }

  if (toolIterations >= effectiveMaxTurns && !agentModeCompleted) {
    if (agentMode.enabled) {
      logger.info('Agent mode max turns reached, forcing final response', {
        chatId,
        iterations: toolIterations,
        maxTurns: effectiveMaxTurns,
      })

      safeEnqueue(controller, encodeStatusEvent(encoder, {
        stage: 'agent_force_final',
        message: 'Requesting final response...',
        characterName: character.name,
        characterId: character.id,
      }))

      const forceFinalMessage = buildForceFinalMessage()
      currentMessages = [
        ...currentMessages,
        { role: 'assistant' as const, content: currentResponse, thoughtSignature: streaming.thoughtSignature, name: undefined },
        { role: 'user' as const, content: forceFinalMessage, thoughtSignature: undefined, name: undefined },
      ]

      try {
        for await (const chunk of streamMessage({
          messages: currentMessages,
          connectionProfile: streaming.effectiveProfile,
          apiKey: streaming.effectiveApiKey,
          modelParams,
          tools: actualTools,
          useNativeWebSearch,
          userId,
          messageId: preGeneratedAssistantMessageId,
          chatId,
        })) {
          if (chunk.content) {
            streaming.fullResponse += chunk.content
            controller.enqueue(encodeContentChunk(encoder, chunk.content))
          }

          if (chunk.done) {
            streaming.usage = chunk.usage || null
            streaming.cacheUsage = chunk.cacheUsage || null
            streaming.attachmentResults = chunk.attachmentResults || null
            streaming.rawResponse = chunk.rawResponse
            if (chunk.thoughtSignature) {
              streaming.thoughtSignature = chunk.thoughtSignature
            }

            // If the force-final call still contains submit_final_response,
            // promote its `response` arg over whatever streamed.
            if (chunk.rawResponse) {
              const finalToolCalls = detectToolCallsInResponse(chunk.rawResponse, streaming.effectiveProfile.provider)
              const submitCall = finalToolCalls.find(tc => tc.name === 'submit_final_response')
              if (submitCall) {
                const args = submitCall.arguments as { response?: string }
                if (args.response) {
                  streaming.fullResponse = args.response
                }
              }
            }
          }
        }
      } catch (forceFinalStreamError) {
        await preservePartialOnError(forceFinalStreamError)
        throw forceFinalStreamError
      }
    } else {
      logger.warn('Max tool iterations reached', { iterations: toolIterations, chatId })
    }
  }
}
