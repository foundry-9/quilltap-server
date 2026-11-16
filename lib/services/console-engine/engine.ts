/**
 * Console engine — one turn of a console conversation (Calliope Live, Spec J
 * decision 2).
 *
 * Character-less and memory-free: the operator's message is stored, the
 * persona's model answers through the shared agent loop, and the transcript is
 * the only thing kept. What is the persona's — prompt, tools, ceiling,
 * attachment folder, fallback model, turn budget, how its answer is stored —
 * comes from a `ConsolePersona` (`./persona.ts`); Brahma is the first
 * (`lib/services/brahma-console/orchestrator.service.ts`).
 *
 *  - No character: no identity, personality, wardrobe, avatar, roleplay
 *    templates, scene state, or Concierge. One synthetic assistant voice.
 *  - No persistent memory: `triggerTurnMemoryExtraction` is NEVER called. The
 *    only persistence is the chat transcript itself.
 *  - No page awareness: no help-doc resolution, no current-page context.
 *
 * The connection profile (model) is read from `chat.consoleConnectionProfileId`
 * each turn, so switching the model mid-conversation simply continues the same
 * chat with the new engine. Frames are written through `legacyFrameEncoder`:
 * the console clients read the pre-4.12 untagged-bag SSE shape.
 *
 * @module lib/services/console-engine/engine
 */

import { newWardrobeTurnContainers } from '@/lib/wardrobe/turn-containers'
import { createServiceLogger } from '@/lib/logging/create-logger'
import { describeProfileApiKeyFailure, resolveConnectionProfileApiKey } from '@/lib/services/api-key.service'
import type { ChatMetadata, ConnectionProfile, MessageEvent } from '@/lib/schemas/types'
import type { ToolExecutionContext } from '@/lib/chat/tool-executor'
import {
  streamMessage,
  encodeContentChunk,
  encodeReasoningChunk,
  encodeDoneEvent,
  encodeErrorEvent,
  safeEnqueue,
  safeClose,
} from '@/lib/services/chat-message/streaming.service'
import {
  processToolCalls,
  saveToolMessages,
  detectToolCallsInResponse,
} from '@/lib/services/chat-message/tool-execution.service'
import {
  buildAssistantToolCallMessage,
  buildToolResultMessages,
  type ThreadedMessage,
} from '@/lib/services/chat-message/tool-call-threading'
import { buildConversationMessages } from '@/lib/services/chat-message/context-builder.service'
import {
  buildNativeToolSystemInstructions,
  checkShouldUseTextBlockTools,
  buildTextBlockSystemInstructions,
  parseTextBlocksFromResponse,
  stripTextBlockMarkersFromResponse,
} from '@/lib/services/chat-message/pseudo-tool.service'
import { hasTextBlockMarkers } from '@/lib/tools'
import {
  buildAgentModeInstructions,
  buildForceFinalMessage,
  extractSubmitFinalResponseFromText,
} from '@/lib/services/chat-message/agent-mode-resolver.service'
import { triggerContextSummaryCheck } from '@/lib/services/chat-message/memory-trigger.service'
import { trackMessageTokenUsage } from '@/lib/services/token-tracking.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'
import { legacyFrameEncoder } from '@/lib/chat/stream-frames'
import { profileParams } from '@/lib/llm/cheap-llm'
import { resolveToolResultVerbatimTurns } from '@/lib/llm/connection-profile-utils'
import { applyImageTransportBudget } from '@/lib/chat/image-transport-budget'
import { loadConsoleTurnAttachments, composeAttachmentContent } from './turn-attachments'
import { normalizeToolCallSignature } from './loop-guard'
import type { ConsolePersona, ConsoleRepos, ConsoleTurnPlanBase } from './persona'

const logger = createServiceLogger('ConsoleEngine')

/** Options for sending a console message. */
export interface ConsoleSendOptions {
  /** User message content */
  content: string
  /** Optional attachment ids (mount-file link ids in the persona's folder) */
  fileIds?: string[]
}

/**
 * The connection profile a console conversation talks to: the one pinned on
 * the chat (`consoleConnectionProfileId`) when the user owns it, else the
 * persona's own fallback. Null when neither resolves.
 */
export async function resolveConsoleConnectionProfile<Plan extends ConsoleTurnPlanBase>(
  repos: ConsoleRepos,
  userId: string,
  consoleConnectionProfileId: string | null | undefined,
  persona: Pick<ConsolePersona<Plan>, 'defaultConnectionProfile'>,
): Promise<ConnectionProfile | null> {
  if (consoleConnectionProfileId) {
    const pinned = await repos.connections.findById(consoleConnectionProfileId)
    if (pinned && pinned.userId === userId) return pinned
  }
  return persona.defaultConnectionProfile(repos, userId)
}

/**
 * Send a message in a persona's console conversation and stream the reply.
 */
export async function runConsoleTurn<Plan extends ConsoleTurnPlanBase>(
  persona: ConsolePersona<Plan>,
  repos: ConsoleRepos,
  chatId: string,
  userId: string,
  options: ConsoleSendOptions,
): Promise<ReadableStream<Uint8Array>> {
  // The console clients read the pre-4.12 untagged-bag SSE shape.
  const encoder = legacyFrameEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        const chat = await repos.chats.findById(chatId)
        if (!chat) throw new Error('Chat not found')
        if (chat.userId !== userId) throw new Error('Unauthorized')
        if (chat.chatType !== persona.chatType) throw new Error(`Not a ${persona.label} chat`)

        // Save the user message
        const userMessage: MessageEvent = {
          type: 'message',
          id: crypto.randomUUID(),
          role: 'USER',
          content: options.content,
          attachments: options.fileIds ?? [],
          createdAt: new Date().toISOString(),
        }
        await repos.chats.addMessage(chatId, userMessage)

        // Resolve the active connection profile (model)
        const connectionProfile = await resolveConsoleConnectionProfile(
          repos,
          userId,
          chat.consoleConnectionProfileId,
          persona,
        )
        if (!connectionProfile) {
          throw new Error('No connection profile available. Add a connection profile first.')
        }

        await processConsoleResponse(persona, repos, chat, userId, connectionProfile, controller, encoder, userMessage.id)

        // Fire async background tasks — context-summary check (for auto-titling
        // of the past-chats list) and cost tracking. NEVER memory extraction:
        // a console forms no persistent memories.
        triggerAsyncTasks(repos, chatId, userId, connectionProfile)

        safeClose(controller)
      } catch (error) {
        logger.error('Console message error', {
          persona: persona.label,
          chatId,
          error: error instanceof Error ? error.message : String(error),
        })
        try {
          safeEnqueue(controller, encodeErrorEvent(
            encoder,
            error instanceof Error ? error.message : 'Failed to process message',
            'fatal_error',
            ''
          ))
        } catch { /* stream may already be closed */ }
        safeClose(controller)
      }
    },
  })
}

/**
 * Run the single-turn, character-less agent loop and stream the response.
 */
async function processConsoleResponse<Plan extends ConsoleTurnPlanBase>(
  persona: ConsolePersona<Plan>,
  repos: ConsoleRepos,
  chat: ChatMetadata,
  userId: string,
  connectionProfile: ConnectionProfile,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  currentMessageId: string,
): Promise<void> {
  const chatId = chat.id
  const plan = persona.planTurn(chat)
  logger.debug('Console turn plan', {
    persona: persona.label,
    chatId,
    plan,
  })

  // Resolve the API key (providers that require one, and those that merely
  // accept one — see Bug 81)
  const keyResolution = await resolveConnectionProfileApiKey(repos, connectionProfile)
  if (!keyResolution.ok) {
    throw new Error(describeProfileApiKeyFailure(keyResolution.reason))
  }
  const apiKey = keyResolution.apiKey

  // The persona's tool slate. Web search & curl flow from the profile /
  // installed plugins exactly as elsewhere.
  const { tools, modelSupportsNativeTools, offer: toolOffer, pluginToolEffects } = await persona.buildTools({
    connectionProfile,
    userId,
    plan,
  })

  // Determine tool mode (native vs pseudo-tool). As with help-chat, anything
  // that would resolve to simple-json is downgraded to text-block.
  const profilePseudoToolMode = (connectionProfile as { pseudoToolMode?: 'auto' | 'native' | 'simple-json' | 'text-block' }).pseudoToolMode
  const effectivePseudoToolMode: 'auto' | 'native' | 'text-block' =
    profilePseudoToolMode === 'simple-json' ? 'text-block' : (profilePseudoToolMode ?? 'auto')
  const useTextBlockTools = checkShouldUseTextBlockTools(modelSupportsNativeTools, effectivePseudoToolMode)

  // Build tool instructions
  let toolInstructions = ''
  if (useTextBlockTools && tools.length > 0) {
    toolInstructions = buildTextBlockSystemInstructions(persona.textBlockToolOptions({ connectionProfile, plan }))
  } else if (tools.length > 0) {
    toolInstructions = buildNativeToolSystemInstructions('assistant')
  }

  // Agent mode instructions (always enabled). The turn budget is the
  // persona's; the stuck-loop guard below still stops a repeating loop well
  // before this cap.
  const maxAgentTurns = await persona.maxAgentTurns()
  const agentInstructions = buildAgentModeInstructions(maxAgentTurns, plan.agentKind)
  toolInstructions = toolInstructions
    ? `${toolInstructions}\n\n${agentInstructions}`
    : agentInstructions

  const systemPrompt = await persona.buildSystemPrompt({
    repos,
    userId,
    chat,
    connectionProfile,
    toolInstructions,
    plan,
  })

  // Load conversation history (full transcript, no compression) and thread it
  // through the SAME builder the Salon uses, so a prior turn's tool activity is
  // replayed in a form the model can actually follow: each stored TOOL message
  // becomes a `[Tool Result: …]` user message (elided after the profile's
  // toolResultVerbatimTurns), rather
  // than a bare `tool`-role message bound to no call. Without this the model
  // can't tell it already ran a query and re-runs it — the console's loop bug.
  const messages = await repos.chats.getMessages(chatId)
  const { conversationMessages: history } = buildConversationMessages(
    messages,
    false,
    resolveToolResultVerbatimTurns(connectionProfile),
  )

  // Attachments on the operator's messages, through the Salon's own loaders:
  // this turn's images as uploads, earlier turns' as re-hydrated.
  const attachmentPayloads = await loadConsoleTurnAttachments({
    messages,
    currentMessageId,
    connectionProfile,
    repos,
    userId,
    chatId,
  })

  let conversationMessages: Array<ThreadedMessage & { attachments?: unknown[] }> = [
    { role: 'system', content: systemPrompt },
    // Drop the empty assistant turns the console persists for each tool
    // iteration (kept for the tool-card UI) — they carry no text and the tool
    // result already follows as user-readable context. Lowercase the builder's
    // USER/ASSISTANT roles to the provider wire form.
    ...history
      .filter((m) => !(m.role === 'ASSISTANT' && !m.content?.trim()))
      .map((m) => {
        const payload = m.role === 'USER' && m.id ? attachmentPayloads.get(m.id) : undefined
        if (!payload) return { role: m.role.toLowerCase(), content: m.content }
        return {
          role: 'user',
          content: composeAttachmentContent(m.content, payload),
          ...(payload.attachments.length > 0 ? { attachments: payload.attachments } : {}),
        }
      }),
  ]

  // One transport budget for every image on the request — capability, the
  // profile's image cap and the byte budget; an image the model cannot see is
  // described or omitted there. The profile is read per turn, so switching to
  // a model without vision just works.
  if (attachmentPayloads.size > 0) {
    conversationMessages = (await applyImageTransportBudget(conversationMessages, connectionProfile, {
      repos,
      userId,
      logContext: { chatId, surface: persona.surface },
      describeOptions: { chatId },
    })).messages
  }

  // Effective tools: native tools only when supported and not in text-block mode
  const effectiveTools = (!useTextBlockTools && modelSupportsNativeTools) ? tools : []

  // Agent loop
  let agentTurnCount = 0
  let fullResponse = ''
  const totalUsage = { promptTokens: 0, completionTokens: 0 }
  const toolCallHistory: string[] = []
  const MAX_DUPLICATE_TOOL_CALLS = 2
  // Stuck-loop detection. Two complementary signals, because models evade an
  // exact-arguments check by perturbing the query (whitespace, `COLLATE NOCASE`,
  // an extra `OR …`) while getting the identical result every time:
  //   1. `toolCallHistory` — normalized call signatures (whitespace/case folded).
  //   2. `staleIterations` — consecutive tool iterations that surfaced NO result
  //      the model hadn't already seen. This catches semantically-different
  //      queries that keep returning the same rows.
  const seenResultFingerprints = new Set<string>()
  let staleIterations = 0
  // Most recent tool result text, surfaced verbatim in the loop-guard nudge so
  // the model is reminded of the data it already has.
  let lastToolResultText = ''

  // Reasoning ("thinking") accumulators — DISPLAY ONLY. Each agent turn is its
  // own streamMessage call, so the provider's cumulative `reasoningContent`
  // resets per turn; we fold completed turns into `priorReasoning` and emit the
  // growing `runReasoning` so the client watches one continuous chain and the
  // saved messages keep the whole thing. `unsavedReasoning` is the reasoning
  // not yet attached to a persisted message: each intermediate tool-call turn
  // takes what precedes it, so the transcript interleaves thinking with the
  // tool cards it led to; the final answer takes the remainder.
  let priorReasoning = ''
  let runReasoning = ''
  let unsavedReasoning = ''

  while (agentTurnCount <= maxAgentTurns) {
    agentTurnCount++

    if (agentTurnCount === maxAgentTurns) {
      conversationMessages.push({ role: 'user', content: buildForceFinalMessage(plan.agentKind) })
    }

    let currentResponse = ''
    let turnReasoning = ''
    let streamUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null = null
    let rawResponse: unknown = null
    // Captured so the assistant tool-call turn can carry it on the follow-up
    // stream — required by providers (e.g. Anthropic) that pair the thinking
    // block with the tool-use turn within a request.
    let turnThoughtSignature: string | undefined

    for await (const chunk of streamMessage({
      messages: conversationMessages,
      connectionProfile,
      apiKey,
      // The profile's own parameters (prompt-cache breakpoints, thinking,
      // max tokens) — an empty object here left every Anthropic call in this
      // loop uncached.
      modelParams: profileParams(connectionProfile) ?? {},
      tools: effectiveTools,
      useNativeWebSearch: false,
      userId,
      chatId,
    })) {
      // Capture + live-forward reasoning ("thinking"). Providers emit the
      // cumulative thinking-so-far on each reasoning-bearing chunk, so we
      // last-wins it and push the run-level cumulative to the client (which
      // replaces, not appends). DISPLAY ONLY — never re-fed to a model.
      if (chunk.reasoningContent && chunk.reasoningContent !== turnReasoning) {
        turnReasoning = chunk.reasoningContent
        runReasoning = priorReasoning + turnReasoning
        safeEnqueue(controller, encodeReasoningChunk(encoder, runReasoning))
      }
      if (chunk.content) {
        currentResponse += chunk.content
        safeEnqueue(controller, encodeContentChunk(encoder, chunk.content))
      }
      if (chunk.usage) streamUsage = chunk.usage
      if (chunk.rawResponse) rawResponse = chunk.rawResponse
      if (chunk.thoughtSignature) turnThoughtSignature = chunk.thoughtSignature
    }

    // Fold this turn's reasoning into the run-level chain so the next turn's
    // cumulative thinking appends after it rather than overwriting it.
    if (turnReasoning.trim()) {
      priorReasoning = `${runReasoning}\n\n`
      unsavedReasoning = unsavedReasoning ? `${unsavedReasoning}\n\n${turnReasoning}` : turnReasoning
    }

    totalUsage.promptTokens += streamUsage?.promptTokens || 0
    totalUsage.completionTokens += streamUsage?.completionTokens || 0

    // Detect tool calls
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

    // submit_final_response (agent-mode completion)
    let isSubmitFinal = toolCallsToProcess?.some((tc) => tc.name === 'submit_final_response') ?? false
    if (isSubmitFinal && toolCallsToProcess) {
      const submitCall = toolCallsToProcess.find((tc) => tc.name === 'submit_final_response')
      const finalContent = (submitCall?.arguments?.response as string) || currentResponse
      if (finalContent && finalContent !== currentResponse) {
        safeEnqueue(controller, encodeContentChunk(encoder, finalContent))
        currentResponse = finalContent
      }
      fullResponse = currentResponse
      hasToolCalls = false
    }

    // Fallback: submit_final_response emitted as raw JSON text
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
      // Stuck-loop guard. Fire when EITHER the model repeats a normalized call
      // signature, OR it keeps running tools that surface nothing new (queries
      // that differ on the surface but return the same rows).
      const callSignature = normalizeToolCallSignature(toolCallsToProcess)
      const duplicateCount = toolCallHistory.filter(sig => sig === callSignature).length
      toolCallHistory.push(callSignature)

      const isStuck =
        duplicateCount >= MAX_DUPLICATE_TOOL_CALLS || staleIterations >= MAX_DUPLICATE_TOOL_CALLS
      if (isStuck) {
        logger.warn('Console agent stuck in tool call loop, forcing final response', {
          persona: persona.label,
          chatId,
          turn: agentTurnCount,
          duplicateCount: duplicateCount + 1,
          staleIterations,
          toolNames: toolCallsToProcess.map(tc => tc.name),
        })
        const toolDataReminder = lastToolResultText
          ? `\n\nHere is the data you already received from your previous tool call:\n${lastToolResultText}`
          : ''
        // Content-only assistant turn (no toolCalls) — we are NOT going to
        // execute these calls, so attaching them would leave an unanswered
        // tool-use block that strict providers reject.
        conversationMessages.push({ role: 'assistant', content: currentResponse })
        conversationMessages.push({
          role: 'user',
          content: `${plan.stuckNudge}${toolDataReminder}`,
        })
        continue
      }

      // Save the assistant message carrying the tool calls (content-only; the
      // console renders the tool cards from the TOOL messages saved below).
      const assistantMessage: MessageEvent = {
        type: 'message',
        id: crypto.randomUUID(),
        role: 'ASSISTANT',
        content: currentResponse,
        provider: connectionProfile.provider,
        modelName: connectionProfile.modelName,
        promptTokens: streamUsage?.promptTokens,
        completionTokens: streamUsage?.completionTokens,
        tokenCount: (streamUsage?.promptTokens || 0) + (streamUsage?.completionTokens || 0),
        attachments: [],
        // Reasoning that led to these calls — DISPLAY ONLY, never re-fed to a
        // model. Rendered just before this turn's tool cards.
        reasoningContent: unsavedReasoning.trim() || null,
        createdAt: new Date().toISOString(),
      }
      await repos.chats.addMessage(chatId, assistantMessage)
      logger.debug('Console saved tool-call turn', {
        persona: persona.label,
        chatId,
        turn: agentTurnCount,
        reasoningChars: unsavedReasoning.length,
        toolCount: toolCallsToProcess.length,
      })
      unsavedReasoning = ''

      // Thread the assistant tool-call turn into the live slate WITH its native
      // tool_calls (paired by callId on the next stream), so the model can see
      // it already issued these calls — the fix for the repeat-the-same-query
      // loop. Empty `currentResponse` (native tool calls carry no prose) is
      // expected and handled by the helper.
      conversationMessages.push(
        buildAssistantToolCallMessage(toolCallsToProcess, currentResponse, {
          reasoningContent: turnReasoning || undefined,
          thoughtSignature: turnThoughtSignature,
        }),
      )

      // Execute the tools under the turn's offer and ceiling, for the surface
      // the persona names.
      const toolContext: ToolExecutionContext = {
        chatId,
        userId,
        ...persona.toolContext(plan),
        toolOffer,
        ...(plan.effectCeiling ? { effectCeiling: plan.effectCeiling } : {}),
        pluginToolEffects,
        ...newWardrobeTurnContainers(),
      }

      const toolResult = await processToolCalls(
        toolCallsToProcess,
        toolContext,
        controller,
        encoder,
        { characterName: persona.label, characterId: '' },
      )

      if (toolResult.toolMessages.length > 0) {
        await saveToolMessages(
          repos,
          chatId,
          userId,
          toolResult.toolMessages,
          toolResult.generatedImagePaths,
        )
        // Pair each result back to its call (native `tool` role + toolCallId, or
        // `[Tool Result: …]` user text when the provider has no call IDs).
        conversationMessages.push(...buildToolResultMessages(toolResult.toolMessages))

        // Update stuck-loop tracking: an iteration is "stale" when every result
        // it produced was one we'd already seen.
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

    // No tool calls or final response — done
    fullResponse = currentResponse
    break
  }

  // Handle models that output submit_final_response as JSON text
  fullResponse = extractSubmitFinalResponseFromText(fullResponse)

  // Budget-exhaustion salvage (Bug 47). The forced final turn (pushed at
  // `agentTurnCount === maxAgentTurns`) executes no tools, so a model that
  // answers it with yet another native tool call instead of
  // `submit_final_response` leaves `fullResponse` empty — native tool calls
  // carry no prose. Without this, the run would end having spent real API budget
  // with NO assistant message and NO `done` event: a silent hang that looks
  // exactly like a crash. The persona words a short notice (folding in the
  // last tool result where that suits it) so a run that did work always
  // finalises with something and always signals completion below.
  // A run can also end empty before the budget is spent — a model whose reply
  // ran out of output allowance answers with nothing — and the notice must not
  // claim a spent budget then.
  let salvaged = false
  if (!fullResponse.trim()) {
    salvaged = true
    const cause = agentTurnCount >= maxAgentTurns ? 'budget' : 'empty'
    fullResponse = persona.salvageMessage({ maxAgentTurns, lastToolResultText, plan, cause })
    logger.warn(
      cause === 'budget'
        ? 'Console exhausted its turn budget without a final response'
        : 'Console run ended with an empty answer before its turn budget',
      {
        persona: persona.label,
        chatId,
        maxAgentTurns,
        turns: agentTurnCount,
        cause,
        hadToolData: !!lastToolResultText,
      },
    )
    safeEnqueue(controller, encodeContentChunk(encoder, fullResponse))
  }

  // The answer as the persona stores it (a mark, a light normalisation).
  const answer = persona.finishAnswer({ text: fullResponse, salvaged, plan })
  fullResponse = answer.content

  // Save the final assistant message
  if (fullResponse) {
    const assistantMessage: MessageEvent = {
      type: 'message',
      id: crypto.randomUUID(),
      role: 'ASSISTANT',
      content: fullResponse,
      provider: connectionProfile.provider,
      modelName: connectionProfile.modelName,
      promptTokens: totalUsage.promptTokens,
      completionTokens: totalUsage.completionTokens,
      tokenCount: totalUsage.promptTokens + totalUsage.completionTokens,
      attachments: [],
      // Reasoning ("thinking") since the last tool-call turn — DISPLAY ONLY,
      // never re-fed to a model. Earlier turns' reasoning rides on their own
      // (tool-call) assistant messages, interleaved with the tool cards.
      reasoningContent: unsavedReasoning.trim() || null,
      ...(answer.systemKind ? { systemKind: answer.systemKind } : {}),
      createdAt: new Date().toISOString(),
    }
    await repos.chats.addMessage(chatId, assistantMessage)
    logger.debug('Console saved final message', {
      persona: persona.label,
      chatId,
      systemKind: answer.systemKind ?? null,
      salvaged,
      chars: fullResponse.length,
    })

    const costResult = await estimateMessageCost(
      connectionProfile.provider,
      connectionProfile.modelName,
      totalUsage.promptTokens,
      totalUsage.completionTokens,
      userId
    )

    safeEnqueue(controller, encodeDoneEvent(encoder, {
      messageId: assistantMessage.id,
      usage: totalUsage,
      cacheUsage: null,
      attachmentResults: null,
      toolsExecuted: agentTurnCount > 1,
      provider: connectionProfile.provider,
      modelName: connectionProfile.modelName,
      reasoningContent: runReasoning.trim() || null,
      systemKind: answer.systemKind ?? null,
    }))

    await trackMessageTokenUsage(
      chatId,
      connectionProfile.id,
      totalUsage,
      costResult.cost,
      costResult.source
    )
  }
}

/**
 * Fire async background tasks after a console turn. Context-summary check
 * (for auto-titling the past-chats list) only. Memory extraction is
 * deliberately omitted — a console forms no persistent memories.
 */
async function triggerAsyncTasks(
  repos: ConsoleRepos,
  chatId: string,
  userId: string,
  connectionProfile: ConnectionProfile
): Promise<void> {
  try {
    const chatSettings = await repos.chatSettings.findByUserId(userId)
    if (!chatSettings?.cheapLLMSettings) return

    triggerContextSummaryCheck(repos, {
      chatId,
      userId,
      provider: connectionProfile.provider,
      modelName: connectionProfile.modelName,
      connectionProfile,
      chatSettings: { cheapLLMSettings: chatSettings.cheapLLMSettings },
    }).catch(error => {
      logger.warn('Failed to trigger context summary check', {
        chatId,
        error: error instanceof Error ? error.message : String(error),
      })
    })
  } catch (error) {
    logger.warn('Failed to trigger async tasks', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
