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
 * Input parameters for the state tool
 */
export interface StateToolInput {
  /** Operation to perform */
  operation: StateOperation;
  /** Context for the operation (chat or project). For fetch without context, returns merged state. */
  context?: StateContext;
  /** Path to the state value (e.g., "player.health", "inventory[0]"). Empty/omitted for root. */
  path?: string;
  /** Value to set (required for 'set' operation) */
  value?: unknown;
}

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
    parameters: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['fetch', 'set', 'delete'],
          description:
            'Operation to perform: "fetch" reads state, "set" updates a value, "delete" removes a value.',
        },
        context: {
          type: 'string',
          enum: ['chat', 'project'],
          description:
            'Where to operate: "chat" for chat-specific state, "project" for project state. ' +
            'For fetch without context, returns merged state (chat values override project values).',
        },
        path: {
          type: 'string',
          description:
            'Path to the state value using dot notation and array indexing. ' +
            'Examples: "player.health", "inventory[0].name", "gameState.turn". ' +
            'Omit or use empty string to access root state object.',
        },
        value: {
          description:
            'Value to set at the path (required for "set" operation). Can be any JSON value.',
        },
      },
      required: ['operation'],
    },
  },
};

/**
 * Tool definition compatible with Anthropic's tool_use format
 */
export const anthropicStateToolDefinition = {
  name: 'state',
  description:
    'Manage persistent state for games, inventory, session data, and other information that should persist across messages. ' +
    'State is stored per-chat and optionally per-project (project state is inherited by chats). ' +
    'Use "fetch" to read state, "set" to update values, "delete" to remove values. ' +
    'Paths support dot notation (player.health) and array indexing (inventory[0]). ' +
    'Keys starting with underscore (_) are user-only and should not be modified by AI.',
  input_schema: {
    type: 'object' as const,
    properties: {
      operation: {
        type: 'string',
        enum: ['fetch', 'set', 'delete'],
        description:
          'Operation to perform: "fetch" reads state, "set" updates a value, "delete" removes a value.',
      },
      context: {
        type: 'string',
        enum: ['chat', 'project'],
        description:
          'Where to operate: "chat" for chat-specific state, "project" for project state. ' +
          'For fetch without context, returns merged state (chat values override project values).',
      },
      path: {
        type: 'string',
        description:
          'Path to the state value using dot notation and array indexing. ' +
          'Examples: "player.health", "inventory[0].name", "gameState.turn". ' +
          'Omit or use empty string to access root state object.',
      },
      value: {
        description:
          'Value to set at the path (required for "set" operation). Can be any JSON value.',
      },
    },
    required: ['operation'],
  },
};

/**
 * Helper to get tool definition in OpenAI format
 */
export function getOpenAIStateTool() {
  return stateToolDefinition;
}

/**
 * Helper to get tool definition in Anthropic format
 */
export function getAnthropicStateTool() {
  return anthropicStateToolDefinition;
}

/**
 * Helper to get Google/Gemini format tool definition
 */
export function getGoogleStateTool() {
  return {
    name: anthropicStateToolDefinition.name,
    description: anthropicStateToolDefinition.description,
    parameters: anthropicStateToolDefinition.input_schema,
  };
}

/**
 * Helper to validate tool input parameters
 */
export function validateStateInput(input: unknown): input is StateToolInput {
  if (typeof input !== 'object' || input === null) {
    return false;
  }

  const obj = input as Record<string, unknown>;

  // operation is required
  if (obj.operation === undefined) {
    return false;
  }

  // Validate operation
  if (typeof obj.operation !== 'string') {
    return false;
  }
  if (!['fetch', 'set', 'delete'].includes(obj.operation)) {
    return false;
  }

  // Validate context if provided
  if (obj.context !== undefined) {
    if (typeof obj.context !== 'string') {
      return false;
    }
    if (!['chat', 'project'].includes(obj.context)) {
      return false;
    }
  }

  // Validate path if provided
  if (obj.path !== undefined && typeof obj.path !== 'string') {
    return false;
  }

  // value can be any type, no validation needed

  return true;
}
