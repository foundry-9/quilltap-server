/**
 * Tool Execution Service
 *
 * Handles detection and execution of LLM tool calls,
 * including processing results and saving tool messages.
 */

import { createServiceLogger } from '@/lib/logging/create-logger'
import { detectToolCalls, executeToolCallWithContext, type ToolExecutionContext } from '@/lib/chat/tool-executor'
import type { getRepositories } from '@/lib/repositories/factory'
import type { ToolMessage, GeneratedImage, ToolProcessingResult } from './types'

const logger = createServiceLogger('ToolExecutionService')

/**
 * Stream controller interface for sending tool updates
 */
export interface StreamController {
  enqueue: (data: Uint8Array) => void
}

/**
 * Process tool calls and stream results
 */
export async function processToolCalls(
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>,
  toolContext: ToolExecutionContext,
  controller: StreamController,
  encoder: TextEncoder
): Promise<ToolProcessingResult> {
  const toolMessages: ToolMessage[] = []
  const generatedImagePaths: GeneratedImage[] = []

  // Send tool detection info with tool names for proper UI handling
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({
      toolsDetected: toolCalls.length,
      toolNames: toolCalls.map(tc => tc.name),
      toolArguments: toolCalls.map(tc => tc.arguments),
    })}\n\n`)
  )

  for (let toolIndex = 0; toolIndex < toolCalls.length; toolIndex++) {
    const toolCall = toolCalls[toolIndex]
    const toolResult = await executeToolCallWithContext(toolCall, toolContext)

    // Debug: Log what we received from executeToolCallWithContext

    if (toolResult.success && Array.isArray(toolResult.result)) {
      for (const img of toolResult.result) {
        if (img.filepath && img.id) {
          generatedImagePaths.push({
            id: img.id,
            filename: img.filename,
            filepath: img.filepath,
            mimeType: img.mimeType || 'image/png',
            size: img.size || 0,
            width: img.width,
            height: img.height,
            sha256: img.sha256,
          })
        }
      }
    }

    // Handle permission-required case differently - don't add to toolMessages yet
    // The frontend will show a prompt, and when user approves/denies,
    // the /api/files/write-permission/complete endpoint will handle the rest
    if (toolResult.requiresPermission) {
      logger.info('Tool requires permission, sending pending status to frontend', {
        toolName: toolResult.toolName,
        pendingWrite: toolResult.pendingWrite,
      })

      // Send SSE event for frontend to show permission prompt
      // Don't add to toolMessages - we don't want LLM to see an error yet
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            toolResult: {
              index: toolIndex,
              name: toolResult.toolName,
              success: false,
              requiresPermission: true,
              pendingWrite: toolResult.pendingWrite,
              status: 'pending_approval',
            },
          })}\n\n`
        )
      )

      // Add a placeholder message indicating we're waiting for approval
      // This prevents the LLM from thinking the tool errored
      toolMessages.push({
        toolName: toolResult.toolName,
        success: true, // Mark as success so LLM doesn't see it as an error
        content: 'File write request sent to user for approval. Waiting for response.',
        arguments: toolCall.arguments,
        metadata: toolResult.metadata,
      })
      continue
    }

    // Handle sudo approval requirement
    if (toolResult.requiresSudoApproval) {
      logger.info('Sudo command requires approval, sending to frontend', {
        toolName: toolResult.toolName,
        pendingSudoCommand: toolResult.pendingSudoCommand,
      })

      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            toolResult: {
              index: toolIndex,
              name: toolResult.toolName,
              success: false,
              requiresSudoApproval: true,
              pendingSudoCommand: toolResult.pendingSudoCommand,
              status: 'pending_approval',
            },
          })}\n\n`
        )
      )

      toolMessages.push({
        toolName: toolResult.toolName,
        success: true,
        content: 'Sudo command sent to user for approval. Waiting for response.',
        arguments: toolCall.arguments,
        metadata: toolResult.metadata,
      })
      continue
    }

    // Handle workspace acknowledgement requirement
    if (toolResult.requiresWorkspaceAcknowledgement) {
      logger.info('Workspace acknowledgement required, sending to frontend', {
        toolName: toolResult.toolName,
      })

      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            toolResult: {
              index: toolIndex,
              name: toolResult.toolName,
              success: false,
              requiresWorkspaceAcknowledgement: true,
              status: 'pending_acknowledgement',
            },
          })}\n\n`
        )
      )

      toolMessages.push({
        toolName: toolResult.toolName,
        success: true,
        content: 'Workspace acknowledgement required. Waiting for user confirmation.',
        arguments: toolCall.arguments,
        metadata: toolResult.metadata,
      })
      continue
    }

    let resultText: string
    if (!toolResult.success) {
      resultText = `Error: ${toolResult.error || 'Unknown error'}${toolResult.message ? ` - ${toolResult.message}` : ''}`
    } else if (toolResult.toolName === 'generate_image') {
      resultText = `Generated ${(toolResult.result as unknown[])?.length || 1} image(s)`
    } else {
      resultText = JSON.stringify(toolResult.result, null, 2)
    }

    toolMessages.push({
      toolName: toolResult.toolName,
      success: toolResult.success,
      content: resultText,
      arguments: toolCall.arguments,
      metadata: toolResult.metadata,
    })

    // Build tool result payload
    const toolResultPayload: Record<string, unknown> = {
      index: toolIndex,
      name: toolResult.toolName,
      success: toolResult.success,
      result: toolResult.result,
    };

    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({
          toolResult: toolResultPayload,
        })}\n\n`
      )
    )
  }

  return { toolMessages, generatedImagePaths }
}

/**
 * Save tool messages to the chat and link generated images
 */
export async function saveToolMessages(
  repos: ReturnType<typeof getRepositories>,
  chatId: string,
  _userId: string,
  toolMessages: ToolMessage[],
  generatedImagePaths: GeneratedImage[],
  characterId?: string
): Promise<{ firstToolMessageId: string | null; generatedImageIds: string[] }> {
  let firstToolMessageId: string | null = null
  const generatedImageIds: string[] = generatedImagePaths.map(img => img.id)

  for (const toolMsg of toolMessages) {
    const toolMessageId = crypto.randomUUID()
    // Include image IDs as attachments on the tool message
    const toolAttachments = toolMsg.toolName === 'generate_image'
      ? generatedImageIds
      : []

    const toolMessage = {
      id: toolMessageId,
      type: 'message' as const,
      role: 'TOOL' as const,
      content: JSON.stringify({
        toolName: toolMsg.toolName,
        success: toolMsg.success,
        result: toolMsg.content,
        arguments: toolMsg.arguments,
        provider: toolMsg.metadata?.provider,
        model: toolMsg.metadata?.model,
        prompt: toolMsg.metadata?.expandedPrompt,
      }),
      createdAt: new Date().toISOString(),
      attachments: toolAttachments,
    }
    await repos.chats.addMessage(chatId, toolMessage)

    if (!firstToolMessageId) {
      firstToolMessageId = toolMessageId
    }
  }

  // Link generated images to the tool message and add character tag
  for (const imageId of generatedImageIds) {
    try {
      // Link to the tool message
      if (firstToolMessageId) {
        await repos.files.addLink(imageId, firstToolMessageId)
      }
      // Add character tag so it shows up in character's gallery
      if (characterId) {
        await repos.files.addTag(imageId, characterId)
      }
    } catch (error) {
      logger.warn('Failed to link/tag generated image', {
        imageId,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return { firstToolMessageId, generatedImageIds }
}

/**
 * Detect tool calls in a response
 */
export function detectToolCallsInResponse(
  response: unknown,
  provider: string
): Array<{ name: string; arguments: Record<string, unknown> }> {
  return detectToolCalls(response, provider)
}

/**
 * Create tool execution context
 */
export function createToolContext(
  chatId: string,
  userId: string,
  characterId: string,
  characterParticipantId: string,
  imageProfileId?: string | null,
  embeddingProfileId?: string,
  projectId?: string | null
): ToolExecutionContext {
  return {
    chatId,
    userId,
    imageProfileId: imageProfileId || undefined,
    characterId,
    embeddingProfileId,
    callingParticipantId: characterParticipantId,
    projectId: projectId || undefined,
  }
}
