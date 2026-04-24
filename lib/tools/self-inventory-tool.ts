/**
 * Self-Inventory Tool Definition
 *
 * Lets a character introspect their own configuration during a chat: the files
 * in their character vault, memory statistics, conversation statistics, the
 * static system prompt that goes into every turn, and token usage from the
 * most recent LLM call.
 */

export type SelfInventoryToolInput = Record<string, never>;

export interface SelfInventoryVaultFile {
  mountPointName: string;
  relativePath: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  lastModified: string;
}

export type SelfInventoryVaultSection =
  | {
      available: true;
      mountPointName: string;
      mountPointId: string;
      fileCount: number;
      files: SelfInventoryVaultFile[];
    }
  | {
      available: false;
      reason: 'no_vault' | 'mount_index_degraded' | 'error';
      message: string;
    };

export interface SelfInventoryMemorySection {
  available: boolean;
  totalCount: number;
  highImportanceCount: number;
  highImportancePercent: number;
  threshold: 0.7;
  message?: string;
}

export interface SelfInventoryChatSection {
  available: boolean;
  chatCount: number;
  earliestCreatedAt: string | null;
  latestActivityAt: string | null;
  message?: string;
}

export interface SelfInventoryPromptSection {
  available: boolean;
  systemPrompt: string | null;
  characterCount: number;
  approxTokens: number | null;
  message?: string;
}

export type SelfInventoryLastTurnSource = 'llm_log' | 'profile_fallback';

export interface SelfInventoryLastTurnSection {
  available: boolean;
  source: SelfInventoryLastTurnSource | null;
  provider: string | null;
  modelName: string | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  contextWindow: number | null;
  utilizationPercent: number | null;
  loggedAt: string | null;
  message?: string;
}

export interface SelfInventoryToolOutput {
  success: boolean;
  characterId: string;
  characterName: string;
  vault: SelfInventoryVaultSection;
  memory: SelfInventoryMemorySection;
  chats: SelfInventoryChatSection;
  prompt: SelfInventoryPromptSection;
  lastTurn: SelfInventoryLastTurnSection;
  error?: string;
}

export const selfInventoryToolDefinition = {
  type: 'function',
  function: {
    name: 'self_inventory',
    description:
      'Return an introspection report about yourself in this chat: every file in your character vault ' +
      '(with the metadata needed to read it via doc_read_file), memory statistics (total and high-importance), ' +
      'conversation statistics (chat count and date range), the static system prompt assembled for every turn, ' +
      'and provider/model/token usage from the most recent LLM call. Takes no arguments. Use this when you need ' +
      'to know what source material you have access to, how you are currently configured, or how close the last ' +
      'turn was to the context window limit.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
};

export function validateSelfInventoryInput(
  input: unknown
): input is SelfInventoryToolInput {
  if (input === undefined || input === null) {
    return true;
  }
  return typeof input === 'object';
}
