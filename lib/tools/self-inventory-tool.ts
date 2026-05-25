/**
 * Self-Inventory Tool Definition
 *
 * Lets a character introspect their own configuration during a chat: the files
 * in their character vault, memory statistics, conversation statistics, the
 * static system prompt that goes into every turn, the memories that were
 * loaded into this turn's prompt, who has access to this character's vault
 * right now, and token usage from the most recent LLM call.
 */

import { z } from 'zod'
import { zodToOpenAISchema } from './zod-to-openai-schema'

export const SELF_INVENTORY_SECTIONS = [
  'vault',
  'vaultAccess',
  'memory',
  'loadedMemories',
  'chats',
  'prompt',
  'lastTurn',
  'quilltap',
] as const;

export type SelfInventorySection = typeof SELF_INVENTORY_SECTIONS[number];

/**
 * Zod schema for the self inventory tool's input.
 */
export const selfInventoryToolInputSchema = z.object({
  sections: z.array(
    z.enum(SELF_INVENTORY_SECTIONS)
      .describe(
        'Which section(s) to include. Options: ' +
        '"vault" (files in your character vault), ' +
        '"vaultAccess" (who can read/write your vault in this chat), ' +
        '"memory" (total and high-importance memory counts), ' +
        '"loadedMemories" (memories actually loaded into this turn\'s prompt), ' +
        '"chats" (conversation count and date range), ' +
        '"prompt" (the static system prompt assembled for every turn), ' +
        '"lastTurn" (provider/model/token usage from the most recent LLM call), ' +
        '"quilltap" (Quilltap version, release notes, changelog, runtime environment, and client shell).'
      )
  ).optional()
    .describe(
      'Optional list of section names to return. If omitted or empty, all eight sections are returned. ' +
      'Pass one or more section names to receive only those sections — useful for saving tokens when ' +
      'you only need specific information.'
    ),
});

export type SelfInventoryToolInput = z.infer<typeof selfInventoryToolInputSchema>;

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

export interface SelfInventorySemanticMemoryItem {
  summary: string;
  importance: number;
  score: number;
  effectiveWeight: number;
}

export interface SelfInventoryInterCharacterMemoryItem {
  aboutCharacterName: string;
  summary: string;
  importance: number;
}

export type SelfInventoryLoadedMemoriesSection =
  | {
      available: true;
      semanticMemories: SelfInventorySemanticMemoryItem[];
      interCharacterMemories: SelfInventoryInterCharacterMemoryItem[];
      recap: string | null;
    }
  | {
      available: false;
      message: string;
    };

export type SelfInventoryVaultAccessLevel = 'read_write' | 'read_only';

export interface SelfInventoryVaultAccessParticipant {
  participantId: string;
  characterId: string;
  characterName: string;
  controlledBy: 'llm' | 'user';
  status: 'active' | 'silent' | 'absent' | 'removed';
  isSelf: boolean;
  access: SelfInventoryVaultAccessLevel;
}

export type SelfInventoryVaultAccessSection =
  | {
      available: true;
      mountPointName: string;
      sharedVaultsEnabled: boolean;
      participants: SelfInventoryVaultAccessParticipant[];
    }
  | {
      available: false;
      sharedVaultsEnabled: boolean;
      message: string;
    };

export type SelfInventoryLastTurnSource = 'llm_log' | 'profile_fallback';

export type SelfInventoryRuntimeMode =
  | 'local-dev'
  | 'local-production'
  | 'docker'
  | 'vm'
  | 'electron'
  | 'electron-docker'
  | 'electron-vm';

export type SelfInventoryClientShell =
  | { type: 'electron'; shellVersion: string }
  | { type: 'browser' }
  | { type: 'unknown' };

export interface SelfInventoryQuilltapSection {
  available: boolean;
  version: string;
  runtimeMode: SelfInventoryRuntimeMode;
  clientShell: SelfInventoryClientShell;
  releaseNotes: string | null;
  releaseNotesVersion: string | null;
  changelog: string | null;
  message?: string;
}

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
  quilltapVersion: string;
  characterId: string;
  characterName: string;
  vault?: SelfInventoryVaultSection;
  vaultAccess?: SelfInventoryVaultAccessSection;
  memory?: SelfInventoryMemorySection;
  loadedMemories?: SelfInventoryLoadedMemoriesSection;
  chats?: SelfInventoryChatSection;
  prompt?: SelfInventoryPromptSection;
  lastTurn?: SelfInventoryLastTurnSection;
  quilltap?: SelfInventoryQuilltapSection;
  error?: string;
}

export const selfInventoryToolDefinition = {
  type: 'function',
  function: {
    name: 'self_inventory',
    description:
      'Return an introspection report about yourself in this chat. Eight sections are available: ' +
      '"vault" (every file in your character vault, with metadata for doc_read_file), ' +
      '"vaultAccess" (who in this chat can read or write your vault right now), ' +
      '"memory" (total and high-importance memory counts), ' +
      '"loadedMemories" (the actual memories loaded into this turn\'s prompt), ' +
      '"chats" (conversation count and date range), ' +
      '"prompt" (the static system prompt assembled for every turn), ' +
      '"lastTurn" (provider/model/token usage from the most recent LLM call), ' +
      '"quilltap" (Quilltap version, release notes for the current or most recent release, ' +
      'the current changelog, runtime environment, and client shell). ' +
      'Pass a "sections" array to request only specific sections and save tokens; ' +
      'omit it to receive all eight. Use this when you need to know what source material ' +
      'you have access to, how you are currently configured, or how close the last turn was ' +
      'to the context window limit.',
    parameters: zodToOpenAISchema(selfInventoryToolInputSchema),
  },
};

export function validateSelfInventoryInput(
  input: unknown
): input is SelfInventoryToolInput {
  return selfInventoryToolInputSchema.safeParse(input).success;
}
