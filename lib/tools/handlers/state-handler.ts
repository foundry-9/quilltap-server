/**
 * State Tool Handler
 *
 * Executes state operations for fetching, setting, and deleting
 * persistent state in chats and projects.
 *
 * Supports path-based access with dot notation and array indexing.
 * Chat state overrides project state when merged.
 */

import {
  StateToolInput,
  StateToolOutput,
  StateOperation,
  StateContext,
  validateStateInput,
} from '../state-tool';
import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';

/**
 * Context required for state tool execution
 */
export interface StateToolContext {
  /** User ID for authentication and logging */
  userId: string;
  /** Chat ID for state operations */
  chatId: string;
  /** Project ID (optional, for project state access) */
  projectId?: string;
}

/**
 * Error thrown during state execution
 */
export class StateError extends Error {
  constructor(
    message: string,
    public code: 'VALIDATION_ERROR' | 'EXECUTION_ERROR' | 'NOT_FOUND' | 'PERMISSION_DENIED'
  ) {
    super(message);
    this.name = 'StateError';
  }
}

/**
 * Parse a path string into an array of keys
 * Supports dot notation and array indexing: "player.inventory[0].name"
 */
export function parsePath(path: string | undefined): (string | number)[] {
  if (!path || path.trim() === '') {
    return [];
  }

  const result: (string | number)[] = [];
  // Match either:
  // - A word (property name): \w+
  // - Or an array index: \[(\d+)\]
  const regex = /(\w+)|\[(\d+)\]/g;
  let match;

  while ((match = regex.exec(path)) !== null) {
    if (match[1] !== undefined) {
      // Property name
      result.push(match[1]);
    } else if (match[2] !== undefined) {
      // Array index
      result.push(parseInt(match[2], 10));
    }
  }

  return result;
}

/**
 * Get a value at a path in an object
 * Returns undefined if path doesn't exist
 */
export function getAtPath(obj: Record<string, unknown>, path: (string | number)[]): unknown {
  if (path.length === 0) {
    return obj;
  }

  let current: unknown = obj;

  for (const key of path) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string | number, unknown>)[key];
  }

  return current;
}

/**
 * Set a value at a path in an object
 * Creates intermediate objects/arrays as needed
 * Returns the modified object (mutates in place)
 */
export function setAtPath(
  obj: Record<string, unknown>,
  path: (string | number)[],
  value: unknown
): Record<string, unknown> {
  if (path.length === 0) {
    // Setting root - value must be an object
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    throw new StateError('Cannot set root state to non-object value', 'VALIDATION_ERROR');
  }

  let current: Record<string | number, unknown> = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    const nextKey = path[i + 1];

    if (current[key] === undefined || current[key] === null) {
      // Create intermediate structure based on next key type
      current[key] = typeof nextKey === 'number' ? [] : {};
    } else if (typeof current[key] !== 'object') {
      // Overwrite primitive with structure
      current[key] = typeof nextKey === 'number' ? [] : {};
    }

    current = current[key] as Record<string | number, unknown>;
  }

  const lastKey = path[path.length - 1];
  current[lastKey] = value;

  return obj;
}

/**
 * Delete a value at a path in an object
 * Returns true if something was deleted, false otherwise
 */
export function deleteAtPath(
  obj: Record<string, unknown>,
  path: (string | number)[]
): boolean {
  if (path.length === 0) {
    // Cannot delete root
    return false;
  }

  let current: Record<string | number, unknown> = obj;

  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (current[key] === undefined || current[key] === null) {
      return false;
    }
    if (typeof current[key] !== 'object') {
      return false;
    }
    current = current[key] as Record<string | number, unknown>;
  }

  const lastKey = path[path.length - 1];
  if (!(lastKey in current)) {
    return false;
  }

  if (Array.isArray(current) && typeof lastKey === 'number') {
    current.splice(lastKey, 1);
  } else {
    delete current[lastKey];
  }

  return true;
}

/**
 * Merge project state into chat state (chat overrides project)
 * Only merges top-level keys
 */
function mergeState(
  projectState: Record<string, unknown>,
  chatState: Record<string, unknown>
): Record<string, unknown> {
  return { ...projectState, ...chatState };
}

/**
 * Execute the state tool
 *
 * @param input - The tool input parameters
 * @param context - Execution context including user ID, chat ID, and optional project ID
 * @returns Tool output with operation result
 */
export async function executeStateTool(
  input: unknown,
  context: StateToolContext
): Promise<StateToolOutput> {
  const repos = getRepositories();

  try {
    // Validate input
    if (!validateStateInput(input)) {
      logger.warn('State tool validation failed', {
        context: 'state-handler',
        userId: context.userId,
        input,
      });
      return {
        success: false,
        operation: typeof input === 'object' && input !== null && 'operation' in input
          ? (input as Record<string, unknown>).operation as StateOperation
          : 'fetch',
        error: 'Invalid input: operation is required and must be "fetch", "set", or "delete"',
      };
    }

    const { operation, context: stateContext, path, value } = input;
    const parsedPath = parsePath(path);

    // Fetch chat
    const chat = await repos.chats.findById(context.chatId);
    if (!chat || chat.userId !== context.userId) {
      logger.warn('State tool: chat not found or permission denied', {
        context: 'state-handler',
        chatId: context.chatId,
        userId: context.userId,
      });
      return {
        success: false,
        operation,
        error: 'Chat not found or permission denied',
      };
    }

    // Get project if available
    const projectId = context.projectId || chat.projectId;
    let project = null;
    if (projectId) {
      project = await repos.projects.findById(projectId);
      if (project && project.userId !== context.userId) {
        project = null; // Don't use project if not owned by user
      }
    }

    // Get current states
    const chatState = (chat.state || {}) as Record<string, unknown>;
    const projectState = project ? (project.state || {}) as Record<string, unknown> : {};

    // Handle operations
    switch (operation) {
      case 'fetch': {
        let resultValue: unknown;

        if (stateContext === 'chat') {
          resultValue = getAtPath(chatState, parsedPath);
        } else if (stateContext === 'project') {
          if (!project) {
            return {
              success: false,
              operation,
              context: stateContext,
              path,
              error: 'Chat is not part of a project',
            };
          }
          resultValue = getAtPath(projectState, parsedPath);
        } else {
          // Merged state (chat overrides project)
          const mergedState = mergeState(projectState, chatState);
          resultValue = getAtPath(mergedState, parsedPath);
        }

        logger.info('State fetch completed', {
          context: 'state-handler',
          userId: context.userId,
          chatId: context.chatId,
          stateContext,
          path,
          hasValue: resultValue !== undefined,
        });

        return {
          success: true,
          operation,
          context: stateContext,
          path,
          value: resultValue,
        };
      }

      case 'set': {
        // Check for underscore prefix (user-only keys)
        if (parsedPath.length > 0 && typeof parsedPath[0] === 'string' && parsedPath[0].startsWith('_')) {
          logger.warn('State tool: attempted to modify user-only key', {
            context: 'state-handler',
            userId: context.userId,
            chatId: context.chatId,
            path,
          });
          return {
            success: false,
            operation,
            context: stateContext,
            path,
            error: 'Keys starting with underscore are user-only and cannot be modified by AI',
          };
        }

        const targetContext = stateContext || 'chat';
        let previousValue: unknown;
        let newState: Record<string, unknown>;

        if (targetContext === 'project') {
          if (!project) {
            return {
              success: false,
              operation,
              context: targetContext,
              path,
              error: 'Chat is not part of a project',
            };
          }

          previousValue = getAtPath(projectState, parsedPath);
          newState = setAtPath({ ...projectState }, parsedPath, value);

          await repos.projects.update(project.id, { state: newState });
        } else {
          previousValue = getAtPath(chatState, parsedPath);
          newState = setAtPath({ ...chatState }, parsedPath, value);

          await repos.chats.update(chat.id, { state: newState });
        }

        logger.info('State set completed', {
          context: 'state-handler',
          userId: context.userId,
          chatId: context.chatId,
          targetContext,
          path,
          hadPreviousValue: previousValue !== undefined,
        });

        return {
          success: true,
          operation,
          context: targetContext,
          path,
          value,
          previousValue,
        };
      }

      case 'delete': {
        // Check for underscore prefix (user-only keys)
        if (parsedPath.length > 0 && typeof parsedPath[0] === 'string' && parsedPath[0].startsWith('_')) {
          logger.warn('State tool: attempted to delete user-only key', {
            context: 'state-handler',
            userId: context.userId,
            chatId: context.chatId,
            path,
          });
          return {
            success: false,
            operation,
            context: stateContext,
            path,
            error: 'Keys starting with underscore are user-only and cannot be deleted by AI',
          };
        }

        const targetContext = stateContext || 'chat';
        let previousValue: unknown;
        let deleted: boolean;

        if (targetContext === 'project') {
          if (!project) {
            return {
              success: false,
              operation,
              context: targetContext,
              path,
              error: 'Chat is not part of a project',
            };
          }

          previousValue = getAtPath(projectState, parsedPath);
          const newState = { ...projectState };
          deleted = deleteAtPath(newState, parsedPath);

          if (deleted) {
            await repos.projects.update(project.id, { state: newState });
          }
        } else {
          previousValue = getAtPath(chatState, parsedPath);
          const newState = { ...chatState };
          deleted = deleteAtPath(newState, parsedPath);

          if (deleted) {
            await repos.chats.update(chat.id, { state: newState });
          }
        }

        logger.info('State delete completed', {
          context: 'state-handler',
          userId: context.userId,
          chatId: context.chatId,
          targetContext,
          path,
          deleted,
        });

        return {
          success: true,
          operation,
          context: targetContext,
          path,
          previousValue,
        };
      }

      default:
        return {
          success: false,
          operation,
          error: `Unknown operation: ${operation}`,
        };
    }
  } catch (error) {
    logger.error('State tool execution failed', {
      context: 'state-handler',
      userId: context.userId,
      chatId: context.chatId,
    }, error instanceof Error ? error : undefined);

    return {
      success: false,
      operation: typeof input === 'object' && input !== null && 'operation' in input
        ? (input as Record<string, unknown>).operation as StateOperation
        : 'fetch',
      error: error instanceof Error ? error.message : 'Unknown error during state operation',
    };
  }
}

/**
 * Format state results for inclusion in conversation context
 *
 * @param output - State tool output to format
 * @returns Formatted string suitable for LLM context and display
 */
export function formatStateResults(output: StateToolOutput): string {
  if (!output.success) {
    return `State Error: ${output.error || 'Unknown error'}`;
  }

  const { operation, context, path, value, previousValue } = output;
  const pathDisplay = path || '(root)';
  const contextDisplay = context ? ` [${context}]` : '';

  switch (operation) {
    case 'fetch':
      if (value === undefined) {
        return `State${contextDisplay} at "${pathDisplay}": (not set)`;
      }
      return `State${contextDisplay} at "${pathDisplay}": ${JSON.stringify(value, null, 2)}`;

    case 'set':
      if (previousValue === undefined) {
        return `State${contextDisplay} set "${pathDisplay}" to: ${JSON.stringify(value)}`;
      }
      return `State${contextDisplay} updated "${pathDisplay}": ${JSON.stringify(previousValue)} → ${JSON.stringify(value)}`;

    case 'delete':
      if (previousValue === undefined) {
        return `State${contextDisplay} delete "${pathDisplay}": (was not set)`;
      }
      return `State${contextDisplay} deleted "${pathDisplay}" (was: ${JSON.stringify(previousValue)})`;

    default:
      return `State operation completed`;
  }
}
