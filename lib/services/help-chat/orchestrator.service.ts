/**
 * Help Chat Orchestrator Service
 *
 * Simplified orchestrator for help chat message handling.
 * Reuses streaming, tool execution, and memory services from the
 * main chat system but skips Salon-specific complexity:
 * no turn manager, whispers, Concierge, scene state, story backgrounds,
 * RNG, or compression.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { requiresApiKey } from '@/lib/plugins/provider-validation'
import { stripCharacterNamePrefix } from '@/lib/llm/message-formatter'
import type { getRepositories } from '@/lib/repositories/factory'
import type { MessageEvent, ChatMetadataBase } from '@/lib/schemas/types'
import { isParticipantPresent } from '@/lib/schemas/chat.types'
import type { HelpChatSendOptions } from './types'
import {
  buildTools,
  streamMessage,
  encodeContentChunk,
  encodeDoneEvent,
  encodeErrorEvent,
  encodeTurnStartEvent,
  encodeTurnCompleteEvent,
  encodeChainCompleteEvent,
  safeEnqueue,
  safeClose,
} from '@/lib/services/chat-message/streaming.service'
import {
  processToolCalls,
  saveToolMessages,
  detectToolCallsInResponse,
  createToolContext,
} from '@/lib/services/chat-message/tool-execution.service'
import {
  buildNativeToolSystemInstructions,
  checkShouldUseTextBlockTools,
  buildTextBlockSystemInstructions,
  parseTextBlocksFromResponse,
  stripTextBlockMarkersFromResponse,
  determineTextBlockToolOptions,
} from '@/lib/services/chat-message/pseudo-tool.service'
import { hasTextBlockMarkers } from '@/lib/tools'
import {
  buildAgentModeInstructions,
  buildForceFinalMessage,
} from '@/lib/services/chat-message/agent-mode-resolver.service'
import {
  triggerMemoryExtraction,
  triggerContextSummaryCheck,
} from '@/lib/services/chat-message/memory-trigger.service'
import { trackMessageTokenUsage } from '@/lib/services/token-tracking.service'
import { estimateMessageCost } from '@/lib/services/cost-estimation.service'
import { buildHelpChatSystemPrompt } from '@/lib/help-chat/system-prompt-builder'
import { resolveAllHelpContentForUrl } from '@/lib/help-chat/context-resolver'

const logger = createServiceLogger('HelpChatOrchestrator')

/**
 * Handle sending a message in a help chat and streaming the response.
 * All selected help characters respond sequentially.
 */
export async function handleHelpChatMessage(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  options: HelpChatSendOptions
): Promise<ReadableStream<Uint8Array>> {
  const encoder = new TextEncoder()

  return new ReadableStream({
    async start(controller) {
      try {
        // Get chat metadata
        const chat = await repos.chats.findById(chatId)
        if (!chat) throw new Error('Chat not found')
        if (chat.userId !== userId) throw new Error('Unauthorized')
        if (chat.chatType !== 'help') throw new Error('Not a help chat')


        // Save user message
        const userMessage: MessageEvent = {
          type: 'message',
          id: crypto.randomUUID(),
          role: 'USER',
          content: options.content,
          attachments: [],
          createdAt: new Date().toISOString(),
        }
        await repos.chats.addMessage(chatId, userMessage)

        // Get active LLM-controlled participants sorted by displayOrder
        const activeParticipants = chat.participants
          .filter(p => isParticipantPresent(p.status) && p.controlledBy === 'llm')
          .sort((a, b) => a.displayOrder - b.displayOrder)

        if (activeParticipants.length === 0) {
          throw new Error('No active help characters in chat')
        }

        const isMultiCharacter = activeParticipants.length > 1

        // Resolve page context from help files
        const pageUrl = chat.helpPageUrl || '/'
        const allPageContexts = await resolveAllHelpContentForUrl(pageUrl)
        const primaryContext = allPageContexts[0] || null
        const additionalContexts = allPageContexts.slice(1)


        // Process each participant sequentially
        for (let i = 0; i < activeParticipants.length; i++) {
          const participant = activeParticipants[i]

          if (isMultiCharacter && i > 0) {
            // Send turn start event for subsequent characters
            const charData = await repos.characters.findById(participant.characterId)
            safeEnqueue(controller, encodeTurnStartEvent(encoder, {
              participantId: participant.id,
              characterName: charData?.name || 'Unknown',
              chainDepth: i,
            }))
          }

          try {
            const messageId = await processHelpResponse(
              repos, chatId, userId, chat, participant,
              primaryContext, additionalContexts,
              activeParticipants, controller, encoder
            )

            if (isMultiCharacter && i > 0) {
              safeEnqueue(controller, encodeTurnCompleteEvent(encoder, {
                participantId: participant.id,
                messageId: messageId || '',
                chainDepth: i,
              }))
            }
          } catch (error) {
            logger.error('Error processing help response for participant', {
              chatId,
              participantId: participant.id,
              error: error instanceof Error ? error.message : String(error),
            })
            safeEnqueue(controller, encodeErrorEvent(
              encoder,
              error instanceof Error ? error.message : 'Failed to generate response',
              'processing_error',
              ''
            ))
          }
        }

        if (isMultiCharacter) {
          safeEnqueue(controller, encodeChainCompleteEvent(encoder, {
            reason: 'cycle_complete',
            nextSpeakerId: null,
            chainDepth: activeParticipants.length - 1,
          }))
        }

        // Trigger async background tasks
        triggerAsyncTasks(repos, chatId, userId, chat, activeParticipants[0])

        safeClose(controller)
      } catch (error) {
        logger.error('Help chat message error', {
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
 * Process a single help character's response, including agent-mode tool loops.
 */
async function processHelpResponse(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  chat: ChatMetadataBase,
  participant: ChatMetadataBase['participants'][number],
  primaryContext: Awaited<ReturnType<typeof resolveAllHelpContentForUrl>>[number] | null,
  additionalContexts: Awaited<ReturnType<typeof resolveAllHelpContentForUrl>>,
  allParticipants: ChatMetadataBase['participants'],
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): Promise<string | null> {
  // Load character data
  const character = await repos.characters.findById(participant.characterId)
  if (!character) throw new Error('Character not found')


  // Load connection profile
  if (!participant.connectionProfileId) throw new Error('No connection profile for help character')
  const connectionProfile = await repos.connections.findById(participant.connectionProfileId)
  if (!connectionProfile) throw new Error('Connection profile not found')

  // Get API key
  let apiKey = ''
  if (requiresApiKey(connectionProfile.provider)) {
    if (!connectionProfile.apiKeyId) throw new Error('No API key configured')
    const apiKeyData = await repos.connections.findApiKeyById(connectionProfile.apiKeyId)
    if (!apiKeyData) throw new Error('API key not found')
    apiKey = apiKeyData.key_value
  }

  // Get persona (user profile)
  const userSettings = await repos.users.findById(userId)
  const persona = userSettings ? { name: userSettings.name || 'User', description: '' } : null

  // Get other character names for multi-character context
  const otherCharacterNames: string[] = []
  for (const p of allParticipants) {
    if (p.id !== participant.id) {
      const otherChar = await repos.characters.findById(p.characterId)
      if (otherChar) otherCharacterNames.push(otherChar.name)
    }
  }

  // Build tools — agent mode always enabled for help chats, help tools always enabled
  const { tools, modelSupportsNativeTools } = await buildTools(
    connectionProfile,
    null, // imageProfileId
    null, // imageProfile
    userId,
    null, // projectId
    false, // requestFullContext
    [], // disabledTools
    [], // disabledToolGroups
    true, // agentModeEnabled
    allParticipants.length > 1, // isMultiCharacter
    true, // helpToolsEnabled
  )


  // Determine tool mode (native vs text-block)
  const useTextBlockTools = checkShouldUseTextBlockTools(modelSupportsNativeTools)

  // Build tool instructions
  let toolInstructions = ''
  if (useTextBlockTools) {
    const textBlockOptions = determineTextBlockToolOptions(
      null, // imageProfileId
      false, // allowWebSearch
      allParticipants.length > 1, // isMultiCharacter
      false, // hasProject
      true, // helpToolsEnabled
    )
    toolInstructions = buildTextBlockSystemInstructions(textBlockOptions)
  } else if (tools.length > 0) {
    toolInstructions = buildNativeToolSystemInstructions()
  }

  // Build agent mode instructions (always enabled for help chats)
  const maxAgentTurns = 10
  const agentInstructions = buildAgentModeInstructions(maxAgentTurns)
  toolInstructions = toolInstructions
    ? `${toolInstructions}\n\n${agentInstructions}`
    : agentInstructions

  // Build help-specific system prompt
  const systemPrompt = buildHelpChatSystemPrompt({
    character,
    persona,
    pageContext: primaryContext,
    additionalPageContexts: additionalContexts,
    otherCharacterNames: otherCharacterNames.length > 0 ? otherCharacterNames : undefined,
    toolInstructions,
  })

  // Get messages for context — simplified history, no compression
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

  // Add message history
  for (const msg of messages) {
    if (msg.type === 'message') {
      const msgEvent = msg as MessageEvent
      if (msgEvent.role === 'USER') {
        conversationMessages.push({
          role: 'user',
          content: msgEvent.content,
        })
      } else if (msgEvent.role === 'ASSISTANT') {
        conversationMessages.push({
          role: 'assistant',
          content: msgEvent.content,
        })
      } else if (msgEvent.role === 'TOOL') {
        conversationMessages.push({
          role: 'tool',
          content: msgEvent.content,
        })
      }
    }
  }

  // Effective tools: native tools only when supported and not in text-block mode
  const effectiveTools = (!useTextBlockTools && modelSupportsNativeTools) ? tools : []

  // Agent mode loop
  let agentTurnCount = 0
  let fullResponse = ''
  let finalMessageId: string | null = null
  const totalUsage = { promptTokens: 0, completionTokens: 0 }
  const toolCallHistory: string[] = [] // Track tool call signatures for loop detection
  const MAX_DUPLICATE_TOOL_CALLS = 2 // Force response after this many identical calls

  while (agentTurnCount <= maxAgentTurns) {
    agentTurnCount++


    // Force final response if at turn limit
    if (agentTurnCount === maxAgentTurns) {
      const forceMessage = buildForceFinalMessage()
      conversationMessages.push({ role: 'user', content: forceMessage })
    }

    // Stream the response
    let currentResponse = ''
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
      characterId: character.id,
    })) {
      if (chunk.content) {
        currentResponse += chunk.content
        safeEnqueue(controller, encodeContentChunk(encoder, chunk.content))
      }
      if (chunk.usage) streamUsage = chunk.usage
      if (chunk.rawResponse) rawResponse = chunk.rawResponse
    }

    totalUsage.promptTokens += streamUsage?.promptTokens || 0
    totalUsage.completionTokens += streamUsage?.completionTokens || 0

    // Check for tool calls
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

    // Check for submit_final_response (agent mode completion)
    let isSubmitFinal = toolCallsToProcess?.some((tc) =>
      tc.name === 'submit_final_response'
    ) ?? false

    if (isSubmitFinal && toolCallsToProcess) {
      // Extract the final response content from the tool call
      const submitCall = toolCallsToProcess.find((tc) =>
        tc.name === 'submit_final_response'
      )
      const finalContent = (submitCall?.arguments?.response as string) || currentResponse
      if (finalContent && finalContent !== currentResponse) {
        // The LLM put the response in the tool call, send it as content
        safeEnqueue(controller, encodeContentChunk(encoder, finalContent))
        currentResponse = finalContent
      }
      fullResponse = currentResponse
      hasToolCalls = false // Don't process submit_final_response as a tool

    }

    // Fallback: some models output submit_final_response as JSON text instead
    // of a proper tool call (e.g., {"response":"actual content here"})
    if (!isSubmitFinal && !hasToolCalls) {
      const extracted = extractSubmitFinalResponseFromText(currentResponse)
      if (extracted !== currentResponse) {
        isSubmitFinal = true
        currentResponse = extracted
        fullResponse = extracted
        hasToolCalls = false

        logger.debug('Agent submitted final response as JSON text (fallback extraction)', {
          chatId,
          characterName: character.name,
          turn: agentTurnCount,
          responseLength: fullResponse.length,
        })
      }
    }

    if (hasToolCalls && !isSubmitFinal && toolCallsToProcess && agentTurnCount < maxAgentTurns) {
      // Detect repeated identical tool calls (stuck agent loop)
      const callSignature = JSON.stringify(toolCallsToProcess.map(tc => ({ name: tc.name, arguments: tc.arguments })))
      const duplicateCount = toolCallHistory.filter(sig => sig === callSignature).length
      toolCallHistory.push(callSignature)

      if (duplicateCount >= MAX_DUPLICATE_TOOL_CALLS) {
        logger.warn('Agent stuck in tool call loop, forcing final response', {
          chatId,
          characterName: character.name,
          turn: agentTurnCount,
          duplicateCount: duplicateCount + 1,
          toolNames: toolCallsToProcess.map(tc => tc.name),
        })

        // Find the most recent tool result in conversation to echo back to the model
        const lastToolResult = [...conversationMessages].reverse().find(m => m.role === 'tool')
        const toolDataReminder = lastToolResult
          ? `\n\nHere is the data you already received from your previous tool call:\n${lastToolResult.content}`
          : ''

        // Nudge the model: inject a message telling it to use the data it already has
        conversationMessages.push({ role: 'assistant', content: currentResponse })
        conversationMessages.push({
          role: 'user',
          content: `You have already called the same tool with the same arguments ${duplicateCount + 1} times and received the same result each time. You already have all the data you need — do NOT call any more tools. Please call the submit_final_response tool NOW with your answer based on the data you already received. Read the tool results carefully and include the actual data in your response.${toolDataReminder}`,
        })
        continue
      }

      // Save assistant message with tool calls
      const assistantMessage: MessageEvent = {
        type: 'message',
        id: crypto.randomUUID(),
        role: 'ASSISTANT',
        content: currentResponse,
        participantId: participant.id,
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

      // Per-tool status updates are now emitted inside processToolCalls

      // Execute tools
      const toolContext = createToolContext(
        chatId,
        userId,
        character.id,
        participant.id,
        null, // imageProfileId
        undefined, // embeddingProfileId
        null, // projectId
      )

      const toolResult = await processToolCalls(
        toolCallsToProcess,
        toolContext,
        controller,
        encoder,
        { characterName: character.name, characterId: character.id },
      )

      // Save tool messages
      if (toolResult.toolMessages.length > 0) {
        await saveToolMessages(
          repos,
          chatId,
          userId,
          toolResult.toolMessages,
          toolResult.generatedImagePaths,
          character.id,
        )

        // Add tool results to conversation for next iteration
        for (const tm of toolResult.toolMessages) {
          conversationMessages.push({
            role: 'tool',
            content: JSON.stringify({ tool: tm.toolName, success: tm.success, result: tm.content }),
          })
        }
      }


      // Continue agent loop
      continue
    }

    // No tool calls or final response — done
    fullResponse = currentResponse
    break
  }

  // Clean up response — strip character name prefix if present
  fullResponse = stripCharacterNamePrefix(fullResponse, character.name)

  // Handle models that output submit_final_response as JSON text instead of
  // a proper tool call (e.g., {"response":"actual content here"})
  fullResponse = extractSubmitFinalResponseFromText(fullResponse)

  // Save final assistant message
  if (fullResponse) {
    const assistantMessage: MessageEvent = {
      type: 'message',
      id: crypto.randomUUID(),
      role: 'ASSISTANT',
      content: fullResponse,
      participantId: participant.id,
      provider: connectionProfile.provider,
      modelName: connectionProfile.modelName,
      promptTokens: totalUsage.promptTokens,
      completionTokens: totalUsage.completionTokens,
      tokenCount: totalUsage.promptTokens + totalUsage.completionTokens,
      attachments: [],
      createdAt: new Date().toISOString(),
    }
    await repos.chats.addMessage(chatId, assistantMessage)
    finalMessageId = assistantMessage.id

    // Estimate cost for token tracking
    const costResult = await estimateMessageCost(
      connectionProfile.provider,
      connectionProfile.modelName,
      totalUsage.promptTokens,
      totalUsage.completionTokens,
      userId
    )

    // Send done event
    safeEnqueue(controller, encodeDoneEvent(encoder, {
      messageId: assistantMessage.id,
      participantId: participant.id,
      usage: totalUsage,
      cacheUsage: null,
      attachmentResults: null,
      toolsExecuted: agentTurnCount > 1,
    }))

    // Track token usage
    await trackMessageTokenUsage(
      chatId,
      connectionProfile.id,
      totalUsage,
      costResult.cost,
      costResult.source
    )

  }

  return finalMessageId
}

/**
 * Extract the response text from a submit_final_response JSON that was
 * output as plain text instead of a proper tool call.
 * Some models (e.g., ChatGPT-5) sometimes output the tool call arguments
 * as raw JSON text: {"response":"actual content here"}
 */
function extractSubmitFinalResponseFromText(text: string): string {
  const trimmed = text.trim()
  if (!trimmed.startsWith('{"response"')) return text

  try {
    const parsed = JSON.parse(trimmed)
    if (typeof parsed?.response === 'string' && parsed.response.length > 0) {
      return parsed.response
    }
  } catch {
    // Not valid JSON, return as-is
  }
  return text
}

/**
 * Trigger async background tasks after help chat message processing.
 * Fires context summary check (re-titling) and memory extraction.
 */
async function triggerAsyncTasks(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  userId: string,
  chat: ChatMetadataBase,
  firstParticipant: ChatMetadataBase['participants'][number]
): Promise<void> {
  try {
    const chatSettings = await repos.chatSettings.findByUserId(userId)
    if (!chatSettings?.cheapLLMSettings) {
      logger.debug('No cheap LLM settings, skipping async tasks', { chatId })
      return
    }

    if (!firstParticipant.connectionProfileId) {
      logger.debug('No connection profile on first participant, skipping async tasks', { chatId })
      return
    }

    const connectionProfile = await repos.connections.findById(firstParticipant.connectionProfileId)
    if (!connectionProfile) {
      logger.debug('Connection profile not found, skipping async tasks', { chatId })
      return
    }

    // Trigger context summary check (for auto re-titling)
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

    // Trigger memory extraction for the first participant's character
    if (firstParticipant.characterId) {
      const character = await repos.characters.findById(firstParticipant.characterId)
      if (character) {
        // Get the last user message and assistant message for memory extraction
        const messages = await repos.chats.getMessages(chatId)
        const recentMessages = messages.filter(m => m.type === 'message') as MessageEvent[]
        const lastUserMsg = [...recentMessages].reverse().find(m => m.role === 'USER')
        const lastAssistantMsg = [...recentMessages].reverse().find(
          m => m.role === 'ASSISTANT' && m.participantId === firstParticipant.id
        )

        if (lastUserMsg && lastAssistantMsg) {
          triggerMemoryExtraction(repos, {
            characterId: character.id,
            characterName: character.name,
            characterPronouns: character.pronouns,
            personaName: (await repos.users.findById(userId))?.name || 'User',
            chatId,
            userMessage: lastUserMsg.content,
            assistantMessage: lastAssistantMsg.content,
            sourceMessageId: lastAssistantMsg.id,
            userId,
            connectionProfile,
            chatSettings: { cheapLLMSettings: chatSettings.cheapLLMSettings },
          }).catch(error => {
            logger.warn('Failed to trigger memory extraction', {
              chatId,
              characterId: character.id,
              error: error instanceof Error ? error.message : String(error),
            })
          })
        }
      }
    }
  } catch (error) {
    logger.warn('Failed to trigger async tasks', {
      chatId,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}
