/**
 * One-shot tool loop — a non-persisting agent loop shared by every surface that
 * needs "one request → tools → one answer" with nothing written to a chat.
 *
 * Callers:
 *  - `runBrahmaQuery` (`lib/services/brahma-console/one-shot.service.ts`) —
 *    Brahma consulted as a Carina answerer; sink controller, operator surface.
 *  - `runScenarioBuilder` (`lib/services/scenario-builder/scenario-builder.service.ts`)
 *    — The Host setting a scene; live SSE controller, pre-built mount pool.
 *
 * The caller owns everything surface-specific: the profile and key, the tool
 * slate (`buildTools`), the system prompt and the tool context. This module owns
 * the loop itself: tool-call detection (native or text-block), threading, the
 * `submit_final_response` completion, the stuck-loop guard, the forced final
 * turn, and the budget-exhaustion salvage (bug 47).
 *
 * Nothing is persisted. Tool side effects stand; per-iteration assistant/TOOL
 * messages live only in memory. The only durable trace is the LLM log rows
 * `streamMessage` writes, typed by `logType`.
 *
 * The streaming Brahma orchestrator (`orchestrator.service.ts`) is deliberately
 * NOT built on this: it persists every iteration and emits done/error events.
 *
 * @module services/agent-loop/one-shot-loop
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ToolExecutionContext } from '@/lib/chat/tool-executor'
import type { ConnectionProfile } from '@/lib/schemas/types'
import type { LLMLogType } from '@/lib/schemas/llm-log.types'
import { streamMessage } from '@/lib/services/chat-message/streaming.service'
import {
  processToolCalls,
  detectToolCallsInResponse,
  type StreamController,
} from '@/lib/services/chat-message/tool-execution.service'
import {
  buildAssistantToolCallMessage,
  buildToolResultMessages,
  type ThreadedMessage,
} from '@/lib/services/chat-message/tool-call-threading'
import {
  buildNativeToolSystemInstructions,
  checkShouldUseTextBlockTools,
  buildTextBlockSystemInstructions,
  parseTextBlocksFromResponse,
  stripTextBlockMarkersFromResponse,
  type TextBlockEnabledToolOptions,
} from '@/lib/services/chat-message/pseudo-tool.service'
import { hasTextBlockMarkers } from '@/lib/tools'
import {
  buildAgentModeInstructions,
  buildForceFinalMessage,
  extractSubmitFinalResponseFromText,
} from '@/lib/services/chat-message/agent-mode-resolver.service'
// The duplicate-call signature is the streaming Brahma console's; one rule for both loops.
import { normalizeToolCallSignature } from '@/lib/services/brahma-console/orchestrator.service'

const logger = createServiceLogger('OneShotToolLoop')

/** Consecutive duplicate / stale tool iterations before forcing a final answer. */
export const MAX_DUPLICATE_TOOL_CALLS = 2

/** The `buildTools` result the loop consumes. */
export interface BuiltTools {
  tools: unknown[]
  modelSupportsNativeTools: boolean
}

export interface OneShotUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export type OneShotLoopResult =
  | { ok: true; answer: string; toolsExecuted: number; usage: OneShotUsage }
  | { ok: false; detail: string }

/**
 * Whether this profile + slate runs text-block (pseudo) tools rather than
 * native ones. `simple-json` downgrades to text-block: the one-shot loop does
 * not implement the simple-json continuation.
 */
export function resolveOneShotUsesTextBlockTools(
  connectionProfile: ConnectionProfile,
  built: BuiltTools,
): boolean {
  const profilePseudoToolMode = (connectionProfile as { pseudoToolMode?: 'auto' | 'native' | 'simple-json' | 'text-block' }).pseudoToolMode
  const effectivePseudoToolMode: 'auto' | 'native' | 'text-block' =
    profilePseudoToolMode === 'simple-json' ? 'text-block' : (profilePseudoToolMode ?? 'auto')
  return checkShouldUseTextBlockTools(built.modelSupportsNativeTools, effectivePseudoToolMode)
}

/**
 * Compose the tool-instruction block for a one-shot system prompt: native or
 * text-block instructions (when any tools were built), then the agent-mode
 * instructions for the turn budget.
 */
export function buildOneShotToolInstructions(opts: {
  connectionProfile: ConnectionProfile
  built: BuiltTools
  textBlockOptions: TextBlockEnabledToolOptions
  maxAgentTurns: number
}): string {
  const { connectionProfile, built, textBlockOptions, maxAgentTurns } = opts
  const useTextBlockTools = resolveOneShotUsesTextBlockTools(connectionProfile, built)

  let toolInstructions = ''
  if (useTextBlockTools && built.tools.length > 0) {
    toolInstructions = buildTextBlockSystemInstructions(textBlockOptions)
  } else if (built.tools.length > 0) {
    toolInstructions = buildNativeToolSystemInstructions()
  }

  const agentInstructions = buildAgentModeInstructions(maxAgentTurns)
  return toolInstructions ? `${toolInstructions}\n\n${agentInstructions}` : agentInstructions
}

export interface RunOneShotToolLoopOptions {
  repos: ReturnType<typeof getRepositories>
  userId: string
  /** Tool scope and log attribution; may be synthetic (no chat row behind it). */
  chatId: string
  connectionProfile: ConnectionProfile
  apiKey: string
  systemPrompt: string
  userMessage: string
  tools: BuiltTools
  toolContext: ToolExecutionContext
  maxAgentTurns: number
  /** Where tool events stream. Omitted → a sink (nothing surfaced live). */
  controller?: StreamController
  /** Checked between turns and while streaming; an abort ends the loop. */
  signal?: AbortSignal
  /** LLM log row type. Defaults to `CHAT_MESSAGE`. */
  logType?: LLMLogType
  /** Status-event attribution for `processToolCalls`. */
  statusContext?: { characterName: string; characterId: string }
  /** Cumulative reasoning text for the current turn (replace, don't append). */
  onReasoning?: (reasoning: string) => void
  /** A short label for log lines (e.g. `Brahma one-shot`). */
  logLabel?: string
}

/**
 * Run the loop. Never throws for model-side failures: returns
 * `{ ok: false, detail }`. An abort returns `{ ok: false, detail: 'aborted' }`.
 */
export async function runOneShotToolLoop(opts: RunOneShotToolLoopOptions): Promise<OneShotLoopResult> {
  const {
    userId,
    chatId,
    connectionProfile,
    apiKey,
    systemPrompt,
    userMessage,
    tools: built,
    toolContext,
    maxAgentTurns,
    signal,
    logType,
    statusContext,
    onReasoning,
    logLabel = 'One-shot loop',
  } = opts

  const useTextBlockTools = resolveOneShotUsesTextBlockTools(connectionProfile, built)
  const modelSupportsNativeTools = built.modelSupportsNativeTools
  const effectiveTools = (!useTextBlockTools && modelSupportsNativeTools) ? built.tools : []

  const conversationMessages: ThreadedMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userMessage },
  ]

  const controller: StreamController = opts.controller ?? { enqueue: () => {} }
  const encoder = new TextEncoder()

  let agentTurnCount = 0
  let fullResponse = ''
  let toolsExecuted = 0
  const usage: OneShotUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  const toolCallHistory: string[] = []
  // Stuck-loop detection: an exact-signature repeat OR consecutive iterations
  // that surface nothing new force a final turn.
  const seenResultFingerprints = new Set<string>()
  let staleIterations = 0
  let lastToolResultText = ''

  logger.debug(`${logLabel}: starting`, {
    chatId,
    provider: connectionProfile.provider,
    model: connectionProfile.modelName,
    toolCount: built.tools.length,
    useTextBlockTools,
    maxAgentTurns,
    logType: logType ?? 'CHAT_MESSAGE',
  })

  while (agentTurnCount <= maxAgentTurns) {
    if (signal?.aborted) {
      logger.debug(`${logLabel}: aborted between turns`, { chatId, turn: agentTurnCount })
      return { ok: false, detail: 'aborted' }
    }
    agentTurnCount++

    if (agentTurnCount === maxAgentTurns) {
      conversationMessages.push({ role: 'user', content: buildForceFinalMessage() })
    }

    let currentResponse = ''
    let turnReasoning = ''
    let rawResponse: unknown = null
    let turnThoughtSignature: string | undefined
    let turnUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | undefined

    for await (const chunk of streamMessage({
      messages: conversationMessages,
      connectionProfile,
      apiKey,
      modelParams: {},
      tools: effectiveTools,
      useNativeWebSearch: false,
      userId,
      chatId,
      logType,
    })) {
      // Leaving the for-await closes the provider stream where the SDK allows.
      if (signal?.aborted) break
      // Reasoning is request-local continuation state for providers that pair
      // it with the tool-use turn (e.g. Anthropic); surfaced only via the
      // caller's callback, never re-fed as prose.
      if (chunk.reasoningContent && chunk.reasoningContent !== turnReasoning) {
        turnReasoning = chunk.reasoningContent
        onReasoning?.(turnReasoning)
      }
      if (chunk.content) currentResponse += chunk.content
      if (chunk.rawResponse) rawResponse = chunk.rawResponse
      if (chunk.thoughtSignature) turnThoughtSignature = chunk.thoughtSignature
      // Providers may repeat usage across chunks; the last one is the turn's.
      if (chunk.usage) turnUsage = chunk.usage
    }

    if (turnUsage) {
      usage.promptTokens += turnUsage.promptTokens ?? 0
      usage.completionTokens += turnUsage.completionTokens ?? 0
      usage.totalTokens += turnUsage.totalTokens ?? 0
    }

    if (signal?.aborted) {
      logger.debug(`${logLabel}: aborted mid-stream`, { chatId, turn: agentTurnCount })
      return { ok: false, detail: 'aborted' }
    }

    // Detect tool calls (native or text-block).
    let hasToolCalls = false
    let toolCallsToProcess: Array<{ name: string; arguments: Record<string, unknown>; callId?: string }> | null = null

    if (modelSupportsNativeTools && !useTextBlockTools) {
      const detected = detectToolCallsInResponse(rawResponse, connectionProfile.provider)
      if (detected && detected.length > 0) {
        toolCallsToProcess = detected
        hasToolCalls = true
      }
    } else if (useTextBlockTools && hasTextBlockMarkers(currentResponse)) {
      const parsed = parseTextBlocksFromResponse(currentResponse)
      if (parsed.length > 0) {
        toolCallsToProcess = parsed
        hasToolCalls = true
        currentResponse = stripTextBlockMarkersFromResponse(currentResponse)
      }
    }

    // submit_final_response (agent-mode completion).
    let isSubmitFinal = toolCallsToProcess?.some((tc) => tc.name === 'submit_final_response') ?? false
    if (isSubmitFinal && toolCallsToProcess) {
      const submitCall = toolCallsToProcess.find((tc) => tc.name === 'submit_final_response')
      const finalContent = (submitCall?.arguments?.response as string) || currentResponse
      currentResponse = finalContent
      fullResponse = currentResponse
      hasToolCalls = false
    }

    // Fallback: submit_final_response emitted as raw JSON text.
    if (!isSubmitFinal && !hasToolCalls) {
      const extracted = extractSubmitFinalResponseFromText(currentResponse)
      if (extracted !== currentResponse) {
        isSubmitFinal = true
        currentResponse = extracted
        fullResponse = extracted
        hasToolCalls = false
      }
    }

    if (hasToolCalls && !isSubmitFinal && toolCallsToProcess && agentTurnCount < maxAgentTurns) {
      const callSignature = normalizeToolCallSignature(toolCallsToProcess)
      const duplicateCount = toolCallHistory.filter((sig) => sig === callSignature).length
      toolCallHistory.push(callSignature)

      const isStuck =
        duplicateCount >= MAX_DUPLICATE_TOOL_CALLS || staleIterations >= MAX_DUPLICATE_TOOL_CALLS
      if (isStuck) {
        logger.warn(`${logLabel} stuck in tool-call loop, forcing final response`, {
          chatId,
          turn: agentTurnCount,
          duplicateCount: duplicateCount + 1,
          staleIterations,
        })
        const toolDataReminder = lastToolResultText
          ? `\n\nHere is the data you already received from your previous tool call:\n${lastToolResultText}`
          : ''
        // Content-only assistant turn — we are NOT executing these calls, so an
        // attached tool-use block would be left unanswered for strict providers.
        conversationMessages.push({ role: 'assistant', content: currentResponse })
        conversationMessages.push({
          role: 'user',
          content: `You have already gathered this data (a repeated call or repeated identical results). You already have what you need — do NOT call any more tools. Please call the submit_final_response tool NOW with your answer based on the data you already received.${toolDataReminder}`,
        })
        continue
      }

      logger.debug(`${logLabel}: tool turn`, {
        chatId,
        turn: agentTurnCount,
        tools: toolCallsToProcess.map((tc) => tc.name),
      })

      // Thread the assistant tool-call turn WITH its native tool_calls (paired
      // by callId on the next stream) so the model sees it already issued them.
      conversationMessages.push(
        buildAssistantToolCallMessage(toolCallsToProcess, currentResponse, {
          reasoningContent: turnReasoning || undefined,
          thoughtSignature: turnThoughtSignature,
        }),
      )

      const toolResult = await processToolCalls(
        toolCallsToProcess,
        toolContext,
        controller,
        encoder,
        statusContext,
      )
      toolsExecuted += toolCallsToProcess.length

      if (toolResult.toolMessages.length > 0) {
        conversationMessages.push(...buildToolResultMessages(toolResult.toolMessages))

        let producedNewInfo = false
        for (const tm of toolResult.toolMessages) {
          lastToolResultText = tm.content
          const fingerprint = `${tm.toolName}:${tm.success}:${tm.content}`
          if (!seenResultFingerprints.has(fingerprint)) {
            seenResultFingerprints.add(fingerprint)
            producedNewInfo = true
          }
        }
        staleIterations = producedNewInfo ? 0 : staleIterations + 1
      }

      continue
    }

    // No tool calls or final response — done.
    fullResponse = currentResponse
    break
  }

  // Models that output submit_final_response as JSON text.
  fullResponse = extractSubmitFinalResponseFromText(fullResponse)

  let finalAnswer = fullResponse.trim()

  // Budget-exhaustion salvage (bug 47). The forced final turn runs no tools, so
  // a model that answers it with another native tool call instead of
  // `submit_final_response` leaves `fullResponse` empty. Rather than report a
  // bare failure after spending real budget, synthesise an explanatory answer
  // from the last tool result. With no tool data there is nothing to return.
  if (!finalAnswer && lastToolResultText) {
    finalAnswer = `I reached my ${maxAgentTurns}-turn budget before I could compose a final answer.\n\nHere is what I gathered before I stopped:\n\n${lastToolResultText}`
    logger.warn(`${logLabel} exhausted its turn budget without a final response`, {
      chatId,
      maxAgentTurns,
    })
  }

  if (!finalAnswer) {
    logger.debug(`${logLabel} produced an empty answer`, { chatId, turns: agentTurnCount })
    return { ok: false, detail: 'empty response' }
  }

  logger.debug(`${logLabel}: finished`, {
    chatId,
    turns: agentTurnCount,
    toolsExecuted,
    answerLength: finalAnswer.length,
  })
  return { ok: true, answer: finalAnswer, toolsExecuted, usage }
}
