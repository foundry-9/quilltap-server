/**
 * Brahma Console Orchestrator Service
 *
 * Single-turn, character-less, memory-free orchestrator for the Brahma Console
 * — the operator's direct line to a plain LLM inside Quilltap. It mirrors the
 * Help Chat's streaming/agent-loop machinery but diverges sharply:
 *
 *  - No character: no identity, personality, wardrobe, avatar, roleplay
 *    templates, scene state, or Concierge. One synthetic assistant voice.
 *  - No persistent memory: `triggerTurnMemoryExtraction` is NEVER called. The
 *    only persistence is the chat transcript itself.
 *  - No page awareness: no help-doc resolution, no current-page context.
 *  - Operator-scoped tools: search (no memories) + the doc_* read/write family
 *    reach every document store the operator owns; web/curl flow from the
 *    chosen connection profile / installed plugins.
 *
 * The connection profile (model) is read from `chat.consoleConnectionProfileId`
 * each turn, so switching the model mid-conversation simply continues the same
 * chat with the new engine.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { requiresApiKey } from '@/lib/plugins/provider-validation'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ConnectionProfile, MessageEvent } from '@/lib/schemas/types'
import type { ToolExecutionContext } from '@/lib/chat/tool-executor'
import type { BrahmaConsoleSendOptions } from './types'
import {
  buildTools,
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
import { triggerContextSummaryCheck } from '@/lib/services/chat-message/memory-trigger.service'
import { trackMessageTokenUsage } from '@/lib/services/token-tracking.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'
import { buildBrahmaSystemPrompt } from '@/lib/brahma-console/system-prompt-builder'

const logger = createServiceLogger('BrahmaConsoleOrchestrator')

/**
 * Resolve the connection profile a Brahma chat should talk to: the one pinned
 * on the chat (`consoleConnectionProfileId`), falling back to the user's
 * default profile. Returns null when neither resolves (no profiles at all).
 */
export async function resolveBrahmaConnectionProfile(
  repos: ReturnType<typeof getRepositories>,
  userId: string,
  consoleConnectionProfileId: string | null | undefined
): Promise<ConnectionProfile | null> {
  if (consoleConnectionProfileId) {
    const pinned = await repos.connections.findById(consoleConnectionProfileId)
    if (pinned && pinned.userId === userId) return pinned
  }
  return repos.connections.findDefault(userId)
}

/**
 * Handle sending a message in a Brahma Console chat and streaming the response.
 */
export async function handleBrahmaConsoleMessage(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  options: BrahmaConsoleSendOptions
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        const chat = await repos.chats.findById(chatId)
        if (!chat) throw new Error('Chat not found')
        if (chat.userId !== userId) throw new Error('Unauthorized')
        if (chat.chatType !== 'brahma') throw new Error('Not a Brahma Console chat')

        // Save the user message
        const userMessage: MessageEvent = {
          type: 'message',
          id: crypto.randomUUID(),
          role: 'USER',
          content: options.content,
          attachments: [],
          createdAt: new Date().toISOString(),
        }
        await repos.chats.addMessage(chatId, userMessage)

        // Resolve the active connection profile (model)
        const connectionProfile = await resolveBrahmaConnectionProfile(
          repos,
          userId,
          chat.consoleConnectionProfileId
        )
        if (!connectionProfile) {
          throw new Error('No connection profile available. Add a connection profile first.')
        }

        await processBrahmaResponse(repos, chatId, userId, connectionProfile, controller, encoder)

        // Fire async background tasks — context-summary check (for auto-titling
        // of the past-chats list) and cost tracking. NEVER memory extraction:
        // the Brahma Console forms no persistent memories.
        triggerAsyncTasks(repos, chatId, userId, connectionProfile)

        safeClose(controller)
      } catch (error) {
        logger.error('Brahma Console message error', {
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
async function processBrahmaResponse(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  connectionProfile: ConnectionProfile,
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): Promise<void> {
  // Resolve the API key (providers that require one)
  let apiKey = ''
  if (requiresApiKey(connectionProfile.provider)) {
    if (!connectionProfile.apiKeyId) throw new Error('No API key configured for this connection profile')
    const apiKeyData = await repos.connections.findApiKeyById(connectionProfile.apiKeyId)
    if (!apiKeyData) throw new Error('API key not found')
    apiKey = apiKeyData.key_value
  }

  // Build tools — Brahma flags: agent mode on, no help tools, document editing
  // (read/write) on, no wardrobe, no Carina, workspace tools stripped, search
  // without memories. Web search & curl flow from the profile / installed
  // plugins exactly as elsewhere.
  const { tools, modelSupportsNativeTools } = await buildTools(
    connectionProfile,
    null,   // imageProfileId
    null,   // imageProfile
    userId,
    null,   // projectId
    false,  // requestFullContext
    [],     // disabledTools
    [],     // disabledToolGroups
    true,   // agentModeEnabled
    false,  // isMultiCharacter
    false,  // helpToolsEnabled
    false,  // canDressThemselves
    false,  // canCreateOutfits
    true,   // documentEditingEnabled
    false,  // askCarinaEnabled
    false,  // includeWorkspaceTools — stripped for the console
    true,   // excludeMemorySearch — no memory source
    true,   // sqlAccess — the console gets read-only run_sql
  )

  // Determine tool mode (native vs pseudo-tool). As with help-chat, anything
  // that would resolve to simple-json is downgraded to text-block.
  const profilePseudoToolMode = (connectionProfile as { pseudoToolMode?: 'auto' | 'native' | 'simple-json' | 'text-block' }).pseudoToolMode
  const effectivePseudoToolMode: 'auto' | 'native' | 'text-block' =
    profilePseudoToolMode === 'simple-json' ? 'text-block' : (profilePseudoToolMode ?? 'auto')
  const useTextBlockTools = checkShouldUseTextBlockTools(modelSupportsNativeTools, effectivePseudoToolMode)

  // Build tool instructions
  let toolInstructions = ''
  if (useTextBlockTools && tools.length > 0) {
    // Hand-built text-block options for the console: search + (maybe) web
    // search only; no workspace, wardrobe, help, rng/state, or whisper tools.
    const textBlockOptions: TextBlockEnabledToolOptions = {
      imageGeneration: false,
      search: true,
      webSearch: !!connectionProfile.allowWebSearch,
      whisper: false,
      state: false,
      rng: false,
      projectInfo: false,
      helpSearch: false,
      helpSettings: false,
      helpNavigate: false,
      createNote: false,
      wardrobeList: false,
      wardrobeRead: false,
      wardrobeWear: false,
      wardrobeTakeOff: false,
      wardrobeCreate: false,
      wardrobeUpdate: false,
      wardrobeArchive: false,
    }
    toolInstructions = buildTextBlockSystemInstructions(textBlockOptions)
  } else if (tools.length > 0) {
    toolInstructions = buildNativeToolSystemInstructions()
  }

  // Agent mode instructions (always enabled)
  const maxAgentTurns = 25
  const agentInstructions = buildAgentModeInstructions(maxAgentTurns)
  toolInstructions = toolInstructions
    ? `${toolInstructions}\n\n${agentInstructions}`
    : agentInstructions

  // Build the neutral, character-less system prompt. The console always enables
  // the read-only run_sql tool, so the SQL-access section is always appended.
  const systemPrompt = buildBrahmaSystemPrompt({
    profile: connectionProfile,
    toolInstructions,
    includeSqlAccess: true,
  })

  // Load conversation history (full transcript, no compression)
  const messages = await repos.chats.getMessages(chatId)

  const conversationMessages: Array<{
    role: string
    content: string
    name?: string
    toolCallId?: string
    toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  }> = [
    { role: 'system', content: systemPrompt },
  ]

  for (const msg of messages) {
    if (msg.type === 'message') {
      const msgEvent = msg as MessageEvent
      if (msgEvent.role === 'USER') {
        conversationMessages.push({ role: 'user', content: msgEvent.content })
      } else if (msgEvent.role === 'ASSISTANT') {
        conversationMessages.push({ role: 'assistant', content: msgEvent.content })
      } else if (msgEvent.role === 'TOOL') {
        conversationMessages.push({ role: 'tool', content: msgEvent.content })
      }
    }
  }

  // Effective tools: native tools only when supported and not in text-block mode
  const effectiveTools = (!useTextBlockTools && modelSupportsNativeTools) ? tools : []

  // Agent loop
  let agentTurnCount = 0
  let fullResponse = ''
  const totalUsage = { promptTokens: 0, completionTokens: 0 }
  const toolCallHistory: string[] = []
  const MAX_DUPLICATE_TOOL_CALLS = 2

  // Reasoning ("thinking") accumulators — DISPLAY ONLY. Each agent turn is its
  // own streamMessage call, so the provider's cumulative `reasoningContent`
  // resets per turn; we fold completed turns into `priorReasoning` and emit the
  // growing `runReasoning` so the client watches one continuous chain and the
  // saved message keeps the whole thing.
  let priorReasoning = ''
  let runReasoning = ''

  while (agentTurnCount <= maxAgentTurns) {
    agentTurnCount++

    if (agentTurnCount === maxAgentTurns) {
      conversationMessages.push({ role: 'user', content: buildForceFinalMessage() })
    }

    let currentResponse = ''
    let turnReasoning = ''
    let streamUsage: { promptTokens?: number; completionTokens?: number; totalTokens?: number } | null = null
    let rawResponse: unknown = null

    for await (const chunk of streamMessage({
      messages: conversationMessages,
      connectionProfile,
      apiKey,
      modelParams: {},
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
        if (!turnReasoning) {
          logger.debug('Brahma Console streaming reasoning', { chatId, turn: agentTurnCount })
        }
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
    }

    // Fold this turn's reasoning into the run-level chain so the next turn's
    // cumulative thinking appends after it rather than overwriting it.
    if (turnReasoning.trim()) {
      priorReasoning = `${runReasoning}\n\n`
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
      // Stuck-loop guard: detect repeated identical tool calls
      const callSignature = JSON.stringify(toolCallsToProcess.map(tc => ({ name: tc.name, arguments: tc.arguments })))
      const duplicateCount = toolCallHistory.filter(sig => sig === callSignature).length
      toolCallHistory.push(callSignature)

      if (duplicateCount >= MAX_DUPLICATE_TOOL_CALLS) {
        logger.warn('Brahma Console agent stuck in tool call loop, forcing final response', {
          chatId,
          turn: agentTurnCount,
          duplicateCount: duplicateCount + 1,
          toolNames: toolCallsToProcess.map(tc => tc.name),
        })
        const lastToolResult = [...conversationMessages].reverse().find(m => m.role === 'tool')
        const toolDataReminder = lastToolResult
          ? `\n\nHere is the data you already received from your previous tool call:\n${lastToolResult.content}`
          : ''
        conversationMessages.push({ role: 'assistant', content: currentResponse })
        conversationMessages.push({
          role: 'user',
          content: `You have already called the same tool with the same arguments ${duplicateCount + 1} times and received the same result each time. You already have all the data you need — do NOT call any more tools. Please call the submit_final_response tool NOW with your answer based on the data you already received.${toolDataReminder}`,
        })
        continue
      }

      // Save the assistant message carrying the tool calls
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
        createdAt: new Date().toISOString(),
      }
      await repos.chats.addMessage(chatId, assistantMessage)
      conversationMessages.push({ role: 'assistant', content: currentResponse })

      // Execute the tools — operator surface (character-less, all-stores).
      const toolContext: ToolExecutionContext = {
        chatId,
        userId,
        operatorSurface: true,
        pendingWardrobeAnnouncements: new Set<string>(),
      }

      const toolResult = await processToolCalls(
        toolCallsToProcess,
        toolContext,
        controller,
        encoder,
        { characterName: 'Brahma Console', characterId: '' },
      )

      if (toolResult.toolMessages.length > 0) {
        await saveToolMessages(
          repos,
          chatId,
          userId,
          toolResult.toolMessages,
          toolResult.generatedImagePaths,
        )
        for (const tm of toolResult.toolMessages) {
          conversationMessages.push({
            role: 'tool',
            content: JSON.stringify({ tool: tm.toolName, success: tm.success, result: tm.content }),
          })
        }
      }

      continue
    }

    // No tool calls or final response — done
    fullResponse = currentResponse
    break
  }

  // Handle models that output submit_final_response as JSON text
  fullResponse = extractSubmitFinalResponseFromText(fullResponse)

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
      // Reasoning ("thinking") for the turn — DISPLAY ONLY, never re-fed to a
      // model. The Console renders it as a single leading block, so no
      // positioned reasoningSegments are needed.
      reasoningContent: runReasoning.trim() || null,
      createdAt: new Date().toISOString(),
    }
    await repos.chats.addMessage(chatId, assistantMessage)

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
 * Fire async background tasks after a Brahma Console turn. Context-summary
 * check (for auto-titling the past-chats list) only. Memory extraction is
 * deliberately omitted — the console forms no persistent memories.
 */
async function triggerAsyncTasks(
  repos: ReturnType<typeof getRepositories>,
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
