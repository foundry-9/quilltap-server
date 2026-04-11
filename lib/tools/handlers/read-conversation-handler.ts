/**
 * Read Conversation Tool Handler
 * Project Scriptorium
 *
 * Executes the read_conversation tool by loading the rendered Markdown
 * for a chat, optionally merging or stripping annotations, and returning
 * the result with message/interchange counts.
 */

import {
  ReadConversationToolInput,
  ReadConversationToolOutput,
  validateReadConversationInput,
} from '../read-conversation-tool';
import { mergeAnnotations, stripAnnotations } from '@/lib/scriptorium';
import { createServiceLogger } from '@/lib/logging/create-logger';
import { getRepositories } from '@/lib/repositories/factory';

const logger = createServiceLogger('ReadConversationHandler');

/**
 * Context required for read conversation tool execution
 */
export interface ReadConversationToolContext {
  /** User ID for authentication and logging */
  userId: string;
  /** Chat ID to read the conversation from */
  chatId: string;
}

/**
 * Execute the read conversation tool
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID and chat ID
 * @returns Tool output with rendered markdown and counts
 */
export async function executeReadConversationTool(
  input: unknown,
  context: ReadConversationToolContext
): Promise<ReadConversationToolOutput> {
  const repos = getRepositories();

  try {
    // Validate input
    if (!validateReadConversationInput(input)) {
      logger.warn('Read conversation tool validation failed', {
        context: 'read-conversation-handler',
        userId: context.userId,
        chatId: context.chatId,
        input,
      });
      return {
        success: false,
        error: 'Invalid input: exclude_annotations must be a boolean if provided.',
      };
    }

    const { exclude_annotations } = input as ReadConversationToolInput;

    // Load chat
    const chat = await repos.chats.findById(context.chatId);
    if (!chat) {
      logger.warn('Read conversation tool: chat not found', {
        context: 'read-conversation-handler',
        chatId: context.chatId,
        userId: context.userId,
      });
      return {
        success: false,
        error: 'Chat not found.',
      };
    }

    if (!chat.renderedMarkdown) {
      logger.debug('Read conversation tool: no rendered markdown available', {
        context: 'read-conversation-handler',
        chatId: context.chatId,
      });
      return {
        success: false,
        error: 'Conversation has not been rendered yet.',
      };
    }

    let markdown = chat.renderedMarkdown;

    if (exclude_annotations) {
      // Strip any inline annotations that may have been stored
      markdown = stripAnnotations(markdown);
      logger.debug('Stripped annotations from rendered markdown', {
        context: 'read-conversation-handler',
        chatId: context.chatId,
      });
    } else {
      // Load and merge annotations
      const annotations = await repos.conversationAnnotations.findByChatId(context.chatId);
      if (annotations.length > 0) {
        markdown = mergeAnnotations(markdown, annotations);
        logger.debug('Merged annotations into rendered markdown', {
          context: 'read-conversation-handler',
          chatId: context.chatId,
          annotationCount: annotations.length,
        });
      }
    }

    // Count messages and interchanges from the markdown
    const messageMatches = markdown.match(/^### Message \d+/gm);
    const interchangeMatches = markdown.match(/^## Interchange \d+/gm);
    const messageCount = messageMatches ? messageMatches.length : 0;
    const interchangeCount = interchangeMatches ? interchangeMatches.length : 0;

    logger.info('Read conversation tool completed', {
      context: 'read-conversation-handler',
      userId: context.userId,
      chatId: context.chatId,
      messageCount,
      interchangeCount,
      markdownLength: markdown.length,
      excludeAnnotations: !!exclude_annotations,
    });

    return {
      success: true,
      markdown,
      messageCount,
      interchangeCount,
    };
  } catch (error) {
    logger.error('Read conversation tool execution failed', {
      context: 'read-conversation-handler',
      userId: context.userId,
      chatId: context.chatId,
    }, error instanceof Error ? error : undefined);

    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error reading conversation.',
    };
  }
}

/**
 * Format read conversation results for inclusion in conversation context
 *
 * @param output - Read conversation tool output to format
 * @returns Formatted string suitable for LLM context and display
 */
export function formatReadConversationResults(output: ReadConversationToolOutput): string {
  if (!output.success) {
    return output.error || 'Unknown error reading conversation.';
  }

  if (!output.markdown) {
    return 'No conversation content available.';
  }

  const markdown = output.markdown;

  // Truncate if over 50000 characters
  if (markdown.length > 50000) {
    return (
      markdown.slice(0, 50000) +
      '\n\n---\n*[Conversation truncated. ' +
      `Showing first 50000 of ${markdown.length} characters. ` +
      `${output.messageCount} messages across ${output.interchangeCount} interchanges total.]*`
    );
  }

  return markdown;
}
