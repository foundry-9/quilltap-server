/**
 * Google Provider Implementation for Quilltap Plugin
 *
 * Provides chat completion functionality using Google's Generative AI API
 * Supports Gemini models with multimodal capabilities (text + images)
 */

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import type { LLMProvider, LLMParams, LLMResponse, StreamChunk, LLMMessage, ImageGenParams, ImageGenResponse, ModelMetadata } from './types';
import { createPluginLogger } from '@quilltap/plugin-utils';

const logger = createPluginLogger('qtap-plugin-google');

// Google Gemini supports image analysis
const GOOGLE_SUPPORTED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

export class GoogleProvider implements LLMProvider {
  readonly supportsFileAttachments = true;
  readonly supportedMimeTypes = GOOGLE_SUPPORTED_MIME_TYPES;
  readonly supportsImageGeneration = true;
  readonly supportsWebSearch = true;

  /**
   * Check if a model is a Gemini 3 thinking model that requires thought signatures
   * These models require thought signatures on ALL model responses when tools are enabled
   */
  private isThinkingModel(modelName: string): boolean {
    const thinkingModels = [
      'gemini-3-pro',
      'gemini-3-pro-preview',
      'gemini-3-pro-image-preview',
      'gemini-2.5-pro', // 2.5 Pro also has thinking capabilities
      'gemini-2.5-flash-preview-05-20', // Thinking preview
    ];
    return thinkingModels.some(m => modelName.toLowerCase().includes(m.toLowerCase()));
  }

  /**
   * Check if a model supports function calling (tools)
   * Some models like image-specialized models do not support function calling
   */
  private supportsToolCalling(modelName: string): boolean {
    // Models that explicitly do NOT support function calling
    const noToolsModels = [
      'gemini-2.5-flash-image', // Image generation model, no function calling
      'gemini-2.0-flash-exp-image-generation', // Experimental image model
      'imagen', // Imagen models don't support function calling
    ];
    const lowerName = modelName.toLowerCase();
    // Check explicit no-tools list
    if (noToolsModels.some(m => lowerName.includes(m.toLowerCase()))) {
      return false;
    }
    // Also disable for any model with "image" in the name that's not a vision model
    // Vision models (for analyzing images) do support tools, but generation models don't
    if (lowerName.includes('-image') && !lowerName.includes('vision')) {
      return false;
    }
    return true;
  }

  /**
   * Extract thought signature from Google Gemini response
   * Gemini 3 thinking models return thoughtSignature in the first part of the response
   * This must be stored and passed back for multi-turn function calling conversations
   */
  private extractThoughtSignature(response: any): string | undefined {
    try {
      const candidates = response?.candidates;
      if (!candidates || !Array.isArray(candidates) || candidates.length === 0) {
        return undefined;
      }

      const parts = candidates[0]?.content?.parts;
      if (!parts || !Array.isArray(parts) || parts.length === 0) {
        return undefined;
      }

      // The thoughtSignature is typically on the first part
      const firstPart = parts[0];
      if (firstPart?.thoughtSignature) {
        return firstPart.thoughtSignature;
      }

      // Also check for functionCall parts which may have signatures
      for (const part of parts) {
        if (part?.functionCall?.thoughtSignature) {
          return part.functionCall.thoughtSignature;
        }
      }

      return undefined;
    } catch (error) {
      logger.warn('Error extracting thought signature', {
        context: 'GoogleProvider.extractThoughtSignature',
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private async formatMessagesWithAttachments(
    messages: LLMMessage[],
    modelName: string,
    hasTools: boolean
  ): Promise<{ messages: any[]; systemInstruction?: string; shouldDisableTools: boolean; attachmentResults: { sent: string[]; failed: { id: string; error: string }[] } }> {
    const sent: string[] = [];
    const failed: { id: string; error: string }[] = [];

    const isThinking = this.isThinkingModel(modelName);

    // Extract system message to use as systemInstruction (better for Google API)
    let systemInstruction: string | undefined;
    let nonSystemMessages = messages;

    const systemMessages = messages.filter(m => m.role === 'system');
    if (systemMessages.length > 0) {
      systemInstruction = systemMessages.map(m => m.content).join('\n\n');
      nonSystemMessages = messages.filter(m => m.role !== 'system');
    }

    // Check if this model supports function calling at all
    // Some models (like image generation models) don't support tools
    let filteredMessages = nonSystemMessages;
    let shouldDisableTools = false;

    if (hasTools && !this.supportsToolCalling(modelName)) {
      shouldDisableTools = true;
      logger.info('Disabling tools - model does not support function calling', {
        context: 'GoogleProvider.formatMessagesWithAttachments',
        modelName,
      });
    }

    // For thinking models with tools, we need to handle assistant messages without thought signatures.
    // Gemini 3 thinking models require thought signatures on ALL model responses when tools are enabled.
    //
    // Strategy: Check if ANY assistant message lacks a thought signature. If so, we'll signal to
    // disable tools for this request (to preserve conversation context) rather than filter messages.
    // Once the conversation has proper thought signatures, tools will work normally.
    if (!shouldDisableTools && isThinking && hasTools) {
      const assistantMessages = nonSystemMessages.filter(m => m.role === 'assistant');
      const assistantWithoutSig = assistantMessages.filter(m => !m.thoughtSignature);

      if (assistantWithoutSig.length > 0) {
        // Instead of filtering messages (which loses context), disable tools for this request
        // This allows the model to respond normally while preserving conversation history
        shouldDisableTools = true;
        logger.warn('Disabling tools for thinking model due to legacy messages without thought signatures', {
          context: 'GoogleProvider.formatMessagesWithAttachments',
          legacyMessageCount: assistantWithoutSig.length,
          totalAssistantMessages: assistantMessages.length,
          modelName,
        });
      }
    }

    // Google API requires alternating user/model roles - merge consecutive user messages if any exist
    // (This shouldn't happen often with our new approach of disabling tools instead of filtering)
    const mergedMessages: LLMMessage[] = [];
    for (const msg of filteredMessages) {
      const lastMsg = mergedMessages[mergedMessages.length - 1];
      if (lastMsg && lastMsg.role === 'user' && msg.role === 'user') {
        // Merge consecutive user messages
        lastMsg.content = lastMsg.content + '\n\n' + msg.content;
        // Merge attachments if any
        if (msg.attachments) {
          lastMsg.attachments = [...(lastMsg.attachments || []), ...msg.attachments];
        }
      } else {
        mergedMessages.push({ ...msg });
      }
    }

    // Debug: log what messages we're actually sending
    const formattedMessages: any[] = [];
    for (const msg of mergedMessages) {
      const formattedMessage: any = {
        role: msg.role === 'assistant' ? 'model' : 'user',
        parts: [],
      };

      // Add text content
      if (msg.content) {
        formattedMessage.parts.push({ text: msg.content });
      }

      // Add thought signature for assistant messages (required for Gemini 3 thinking models)
      // The thoughtSignature must be included in the parts for multi-turn function calling
      if (msg.role === 'assistant' && msg.thoughtSignature) {
        // Add thought signature to the first text part if it exists
        if (formattedMessage.parts.length > 0 && formattedMessage.parts[0].text !== undefined) {
          formattedMessage.parts[0].thoughtSignature = msg.thoughtSignature;
        }
      }

      // Add image attachments
      if (msg.attachments && msg.attachments.length > 0) {
        for (const attachment of msg.attachments) {
          if (!this.supportedMimeTypes.includes(attachment.mimeType)) {
            logger.warn('Unsupported attachment type', {
              context: 'GoogleProvider.formatMessagesWithAttachments',
              mimeType: attachment.mimeType,
            });
            failed.push({
              id: attachment.id,
              error: `Unsupported file type: ${attachment.mimeType}. Google supports: ${this.supportedMimeTypes.join(', ')}`,
            });
            continue;
          }

          if (!attachment.data) {
            logger.warn('Attachment data not loaded', {
              context: 'GoogleProvider.formatMessagesWithAttachments',
              attachmentId: attachment.id,
            });
            failed.push({
              id: attachment.id,
              error: 'File data not loaded',
            });
            continue;
          }

          formattedMessage.parts.push({
            inlineData: {
              mimeType: attachment.mimeType,
              data: attachment.data,
            },
          });
          sent.push(attachment.id);
        }
      }

      formattedMessages.push(formattedMessage);
    }
    return { messages: formattedMessages, systemInstruction, shouldDisableTools, attachmentResults: { sent, failed } };
  }

  async sendMessage(params: LLMParams, apiKey: string): Promise<LLMResponse> {
    const client = new GoogleGenerativeAI(apiKey);

    // Build tools array first so we can pass hasTools to formatMessagesWithAttachments
    const tools: any[] = [];

    // Add function declarations if provided
    if (params.tools && params.tools.length > 0) {
      tools.push({
        functionDeclarations: params.tools.map((tool: any) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'OBJECT',
            properties: tool.parameters?.properties || {},
            required: tool.parameters?.required || [],
          },
        })),
      });
    }

    // Add Google Search grounding if web search is enabled
    // Uses googleSearch for Gemini 2.0+ models
    if (params.webSearchEnabled) {
      tools.push({ googleSearch: {} });
    }

    const hasTools = tools.length > 0;
    const { messages, systemInstruction, shouldDisableTools, attachmentResults } = await this.formatMessagesWithAttachments(params.messages, params.model, hasTools);

    const modelConfig: any = {
      model: params.model,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    };

    // Add systemInstruction if we extracted one from system messages
    if (systemInstruction) {
      modelConfig.systemInstruction = systemInstruction;
    }

    // Only add tools if we have them AND we shouldn't disable them
    // shouldDisableTools is true when conversation has legacy messages without thought signatures
    if (hasTools && !shouldDisableTools) {
      modelConfig.tools = tools;
    } else if (shouldDisableTools) {
      logger.info('Tools disabled for this request due to legacy messages without thought signatures', {
        context: 'GoogleProvider.sendMessage',
        toolCount: tools.length,
      });
    }

    const model = client.getGenerativeModel(modelConfig);

    // Normalize stop sequences to array format
    const stopSequences = params.stop
      ? (Array.isArray(params.stop) ? params.stop : [params.stop])
      : undefined;

    const response = (await model.generateContent({
      contents: messages,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 4096,
        topP: params.topP ?? 1,
        stopSequences,
      },
    })) as any;

    const text = response.text?.() ?? '';
    const finishReason = response.candidates?.[0]?.finishReason ?? 'STOP';
    const usage = response.usageMetadata;

    // Extract thought signature for Gemini 3 thinking models
    const thoughtSignature = this.extractThoughtSignature(response.response ?? response);
    return {
      content: text,
      finishReason,
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      },
      raw: response,
      attachmentResults,
      thoughtSignature,
    };
  }

  async *streamMessage(params: LLMParams, apiKey: string): AsyncGenerator<StreamChunk> {
    const client = new GoogleGenerativeAI(apiKey);

    // Build tools array first so we can pass hasTools to formatMessagesWithAttachments
    const tools: any[] = [];

    // Add function declarations if provided
    if (params.tools && params.tools.length > 0) {
      tools.push({
        functionDeclarations: params.tools.map((tool: any) => ({
          name: tool.name,
          description: tool.description,
          parameters: {
            type: 'OBJECT',
            properties: tool.parameters?.properties || {},
            required: tool.parameters?.required || [],
          },
        })),
      });
    }

    // Add Google Search grounding if web search is enabled
    if (params.webSearchEnabled) {
      tools.push({ googleSearch: {} });
    }

    const hasTools = tools.length > 0;
    const { messages, systemInstruction, shouldDisableTools, attachmentResults } = await this.formatMessagesWithAttachments(params.messages, params.model, hasTools);

    const modelConfig: any = {
      model: params.model,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    };

    // Add systemInstruction if we extracted one from system messages
    if (systemInstruction) {
      modelConfig.systemInstruction = systemInstruction;
    }

    // Only add tools if we have them AND we shouldn't disable them
    // shouldDisableTools is true when conversation has legacy messages without thought signatures
    if (hasTools && !shouldDisableTools) {
      modelConfig.tools = tools;
    } else if (shouldDisableTools) {
      logger.info('Tools disabled for this stream request due to legacy messages without thought signatures', {
        context: 'GoogleProvider.streamMessage',
        toolCount: tools.length,
      });
    }

    const model = client.getGenerativeModel(modelConfig);

    // Normalize stop sequences to array format
    const stopSequences = params.stop
      ? (Array.isArray(params.stop) ? params.stop : [params.stop])
      : undefined;

    const stream = await model.generateContentStream({
      contents: messages,
      generationConfig: {
        temperature: params.temperature ?? 0.7,
        maxOutputTokens: params.maxTokens ?? 4096,
        topP: params.topP ?? 1,
        stopSequences,
      },
    });

    let chunkCount = 0;
    for await (const chunk of stream.stream) {
      chunkCount++;
      const text = (chunk as any).text?.() ?? '';
      if (text) {
        yield {
          content: text,
          done: false,
        };
      }
    }

    // Final chunk with usage info
    const response = (await stream.response) as any;
    const usage = response.usageMetadata;

    // Extract thought signature for Gemini 3 thinking models
    const thoughtSignature = this.extractThoughtSignature(response);

    // Debug: log full response structure for troubleshooting
    const candidates = response?.candidates;
    const firstCandidate = candidates?.[0];
    const parts = firstCandidate?.content?.parts || [];
    const hasFunctionCall = parts.some((p: any) => p.functionCall);
    const finishReason = firstCandidate?.finishReason;
    yield {
      content: '',
      done: true,
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        completionTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      },
      attachmentResults,
      rawResponse: response,
      thoughtSignature,
    };
  }

  async validateApiKey(apiKey: string): Promise<boolean> {
    try {
      const client = new GoogleGenerativeAI(apiKey);
      // Try to get a simple model to validate the API key
      const model = client.getGenerativeModel({ model: 'gemini-2.5-flash' });
      await model.generateContent('test');
      return true;
    } catch (error) {
      logger.error('Google API key validation failed', { context: 'GoogleProvider.validateApiKey' }, error instanceof Error ? error : undefined);
      return false;
    }
  }

  async getAvailableModels(apiKey: string): Promise<string[]> {
    try {
      // Return known Google models that support chat
      const models = [
        'gemini-2.5-flash-image',
        'gemini-3-pro-image-preview',
        'imagen-4',
        'imagen-4-fast',
        'gemini-2.5-flash',
        'gemini-pro-vision',
      ];
      return models;
    } catch (error) {
      logger.error('Failed to fetch Google models', { context: 'GoogleProvider.getAvailableModels' }, error instanceof Error ? error : undefined);
      return [];
    }
  }

  async generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse> {
    const client = new GoogleGenerativeAI(apiKey);

    // Use the specified model or default to gemini-2.5-flash-image
    const modelName = params.model ?? 'gemini-2.5-flash-image';
    const model = client.getGenerativeModel({
      model: modelName,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    });

    const config: any = {
      temperature: 0.7,
    };

    if (params.aspectRatio) {
      config.aspectRatio = params.aspectRatio;
    }

    const response = (await model.generateContent({
      contents: [
        {
          role: 'user',
          parts: [{ text: params.prompt }],
        },
      ],
      generationConfig: config,
    })) as any;

    const images: Array<{ data: string; mimeType: string; revisedPrompt?: string }> = [];

    // Extract images from response - check candidates array
    const candidates = response.candidates ?? [];
    for (const candidate of candidates) {
      const parts = candidate.content?.parts ?? [];
      for (const part of parts) {
        if ('inlineData' in part && part.inlineData) {
          images.push({
            data: part.inlineData.data,
            mimeType: part.inlineData.mimeType || 'image/png',
          });
        }
      }
    }

    if (images.length === 0) {
      logger.error('No images generated in response', { context: 'GoogleProvider.generateImage' });
      throw new Error('No images generated in response');
    }
    return {
      images,
      raw: response,
    };
  }

  /**
   * Get metadata for a specific model, including warnings and recommendations.
   * Returns warnings for models with known issues or limitations.
   */
  getModelMetadata(modelId: string): ModelMetadata | undefined {
    const lowerModelId = modelId.toLowerCase();

    // Gemini 3 thinking models with known issues
    if (lowerModelId.includes('gemini-3-pro')) {
      return {
        id: modelId,
        displayName: 'Gemini 3 Pro',
        experimental: true,
        warnings: [
          {
            level: 'warning',
            message: 'This thinking model may return empty responses due to a known Gemini API issue. Thought signature support is experimental.',
          },
        ],
        missingCapabilities: lowerModelId.includes('-image') ? ['reliable-responses'] : undefined,
      };
    }

    // Image generation models that don't support function calling
    if (lowerModelId.includes('-image') && !lowerModelId.includes('vision')) {
      return {
        id: modelId,
        displayName: modelId.includes('2.5') ? 'Gemini 2.5 Flash Image' : 'Image Model',
        warnings: [
          {
            level: 'info',
            message: 'This model is optimized for image generation and does not support function calling (tools like memory search will be disabled).',
          },
        ],
        missingCapabilities: ['function-calling', 'tools'],
      };
    }

    // Imagen models
    if (lowerModelId.includes('imagen')) {
      return {
        id: modelId,
        displayName: modelId.includes('4-fast') ? 'Imagen 4 Fast' : 'Imagen 4',
        warnings: [
          {
            level: 'info',
            message: 'Imagen models are specialized for image generation only and do not support chat or function calling.',
          },
        ],
        missingCapabilities: ['chat', 'function-calling', 'tools'],
      };
    }

    return undefined;
  }

  /**
   * Get metadata for all models with special warnings or recommendations.
   */
  async getModelsWithMetadata(_apiKey: string): Promise<ModelMetadata[]> {
    // Return metadata for all models that have warnings
    const modelsWithWarnings = [
      'gemini-3-pro-image-preview',
      'gemini-2.5-flash-image',
      'imagen-4',
      'imagen-4-fast',
    ];

    return modelsWithWarnings
      .map(modelId => this.getModelMetadata(modelId))
      .filter((m): m is ModelMetadata => m !== undefined);
  }
}
