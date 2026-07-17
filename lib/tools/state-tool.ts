/**
 * State Tool Definition
 *
 * Provides a tool interface for LLMs to manage persistent state:
 * - Fetch state (from chat, project, or merged)
 * - Set state at a path
 * - Delete state at a path
 *
 * State can be used for games, inventory tracking, session data,
 * and any other persistent information needed during roleplay.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

/**
 * Operation types for state management
 */
export type StateOperation = 'fetch' | 'set' | 'delete';

/**
 * Context for state operations
 * - 'chat': Operates on chat-specific state only
 * - 'project': Operates on project state only
 * - When not specified for fetch: Returns merged state (chat overrides project)
 */
export type StateContext = 'chat' | 'project';

/**
 * Zod schema for the state tool's input.
 */
export const stateToolInputSchema = z.object({
  operation: z
    .enum(['fetch', 'set', 'delete'])
    .describe(
      'Operation to perform: "fetch" reads state, "set" updates a value, "delete" removes a value.'
    ),
  context: z
    .enum(['chat', 'project'])
    .describe(
      'Where to operate: "chat" for chat-specific state, "project" for project state. ' +
      'For fetch without context, returns merged state (chat values override project values).'
    )
    .optional(),
  path: z
    .string()
    .describe(
      'Path to the state value using dot notation and array indexing. ' +
      'Examples: "player.health", "inventory[0].name", "gameState.turn". ' +
      'Omit or use empty string to access root state object.'
    )
    .optional(),
  value: z
    .unknown()
    .describe(
      'Value to set at the path (required for "set" operation). Can be any JSON value.'
    )
    .optional(),
})

/**
 * Input parameters for the state tool
 */
export type StateToolInput = z.infer<typeof stateToolInputSchema>;

/**
 * Output from the state tool
 */
export interface StateToolOutput {
  success: boolean;
  operation: StateOperation;
  context?: StateContext;
  /** Path that was accessed/modified */
  path?: string;
  /** Current value at path (for fetch/set) */
  value?: unknown;
  /** Previous value at path (for set/delete) */
  previousValue?: unknown;
  /** Error message if operation failed */
  error?: string;
}

/**
 * Tool definition compatible with OpenAI's tool_calls format
 */
export const stateToolDefinition = {
  type: 'function',
  function: {
    name: 'state',
    description:
      'Manage persistent state for games, inventory, session data, and other information that should persist across messages. ' +
      'State is stored per-chat and optionally per-project (project state is inherited by chats). ' +
      'Use "fetch" to read state, "set" to update values, "delete" to remove values. ' +
      'Paths support dot notation (player.health) and array indexing (inventory[0]). ' +
      'Keys starting with underscore (_) are user-only and should not be modified by AI.',
    parameters: zodToOpenAISchema(stateToolInputSchema),
  },
};

/**
 * Helper to validate tool input parameters
 */
export function validateStateInput(input: unknown): StateToolInput | null {
  const parsed = stateToolInputSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}
