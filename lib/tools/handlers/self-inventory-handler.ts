/**
 * Self-Inventory Tool Handler
 *
 * Assembles the five-section introspection report. Each section is wrapped in
 * a try/catch so a single failing lookup yields an "unavailable" marker
 * rather than throwing the whole report away.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { isMountIndexDegraded } from '@/lib/database/backends/sqlite/mount-index-client';
import { buildSystemPrompt, buildOtherParticipantsInfo } from '@/lib/chat/context/system-prompt-builder';
import type { OtherParticipantInfo } from '@/lib/chat/context/system-prompt-builder';
import { resolveConnectionProfile } from '@/lib/chat/connection-resolver';
import { getModelContextLimit } from '@/lib/llm/model-context-data';
import type { Character, ChatParticipantBase } from '@/lib/schemas/types';
import {
  SelfInventoryToolInput,
  SelfInventoryToolOutput,
  SelfInventoryVaultSection,
  SelfInventoryVaultFile,
  SelfInventoryMemorySection,
  SelfInventoryChatSection,
  SelfInventoryPromptSection,
  SelfInventoryLastTurnSection,
  validateSelfInventoryInput,
} from '../self-inventory-tool';

export interface SelfInventoryToolContext {
  userId: string;
  chatId: string;
  characterId: string;
  callingParticipantId?: string;
}

const HIGH_IMPORTANCE_THRESHOLD = 0.7 as const;

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function roundPercent(n: number): number {
  return Math.round(n * 10) / 10;
}

function formatNumber(n: number): string {
  return n.toLocaleString('en-US');
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

async function buildVaultSection(
  character: Character
): Promise<SelfInventoryVaultSection> {
  if (isMountIndexDegraded()) {
    return {
      available: false,
      reason: 'mount_index_degraded',
      message: 'Mount index database is in degraded mode.',
    };
  }

  const mountPointId = character.characterDocumentMountPointId;
  if (!mountPointId) {
    return {
      available: false,
      reason: 'no_vault',
      message: 'Character has no vault mount point.',
    };
  }

  const repos = getRepositories();
  const mountPoint = await repos.docMountPoints.findById(mountPointId);
  if (!mountPoint) {
    return {
      available: false,
      reason: 'no_vault',
      message: `Mount point ${mountPointId} not found.`,
    };
  }

  const rows = await repos.docMountFiles.findByMountPointId(mountPointId);
  const files: SelfInventoryVaultFile[] = rows
    .map((row) => ({
      mountPointName: mountPoint.name,
      relativePath: row.relativePath,
      fileName: row.fileName,
      fileType: row.fileType,
      fileSizeBytes: row.fileSizeBytes,
      lastModified: row.lastModified,
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  return {
    available: true,
    mountPointName: mountPoint.name,
    mountPointId: mountPoint.id,
    fileCount: files.length,
    files,
  };
}

async function buildMemorySection(
  characterId: string
): Promise<SelfInventoryMemorySection> {
  const repos = getRepositories();
  const totalCount = await repos.memories.countByCharacterId(characterId);
  const highMemories = await repos.memories.findByImportance(
    characterId,
    HIGH_IMPORTANCE_THRESHOLD
  );
  const highImportanceCount = highMemories.length;
  const highImportancePercent =
    totalCount === 0 ? 0 : roundPercent((highImportanceCount / totalCount) * 100);

  return {
    available: true,
    totalCount,
    highImportanceCount,
    highImportancePercent,
    threshold: HIGH_IMPORTANCE_THRESHOLD,
  };
}

async function buildChatsSection(
  characterId: string
): Promise<SelfInventoryChatSection> {
  const repos = getRepositories();
  const chats = await repos.chats.findByCharacterId(characterId);
  if (chats.length === 0) {
    return {
      available: true,
      chatCount: 0,
      earliestCreatedAt: null,
      latestActivityAt: null,
    };
  }

  let earliestMs = Number.POSITIVE_INFINITY;
  let latestMs = Number.NEGATIVE_INFINITY;
  let earliestIso: string | null = null;
  let latestIso: string | null = null;

  for (const chat of chats) {
    const createdMs = Date.parse(chat.createdAt);
    if (Number.isFinite(createdMs) && createdMs < earliestMs) {
      earliestMs = createdMs;
      earliestIso = chat.createdAt;
    }

    const activityIso =
      chat.lastMessageAt ?? chat.updatedAt ?? chat.createdAt;
    const activityMs = Date.parse(activityIso);
    if (Number.isFinite(activityMs) && activityMs > latestMs) {
      latestMs = activityMs;
      latestIso = activityIso;
    }
  }

  return {
    available: true,
    chatCount: chats.length,
    earliestCreatedAt: earliestIso,
    latestActivityAt: latestIso,
  };
}

interface ResolvedRespondingContext {
  respondingParticipant: ChatParticipantBase;
  otherParticipants: OtherParticipantInfo[] | undefined;
  userCharacter: { name: string; description: string } | null;
}

async function resolveRespondingContext(
  chat: { participants: ChatParticipantBase[] },
  context: SelfInventoryToolContext
): Promise<ResolvedRespondingContext | null> {
  const repos = getRepositories();

  const respondingParticipant =
    chat.participants.find((p) => p.id === context.callingParticipantId) ??
    chat.participants.find(
      (p) =>
        p.type === 'CHARACTER' &&
        p.characterId === context.characterId &&
        p.controlledBy !== 'user'
    ) ??
    chat.participants.find(
      (p) => p.type === 'CHARACTER' && p.characterId === context.characterId
    );

  if (!respondingParticipant) {
    return null;
  }

  // User persona: a CHARACTER participant that is controlled by the user.
  let userCharacter: { name: string; description: string } | null = null;
  const userParticipant = chat.participants.find(
    (p) => p.type === 'CHARACTER' && p.controlledBy === 'user'
  );
  if (userParticipant?.characterId) {
    const uc = await repos.characters.findById(userParticipant.characterId);
    if (uc) {
      userCharacter = {
        name: uc.name,
        description: uc.description ?? '',
      };
    }
  }

  // Other participants for multi-character chats.
  let otherParticipants: OtherParticipantInfo[] | undefined;
  const otherCharacterParticipants = chat.participants.filter(
    (p) =>
      p.type === 'CHARACTER' &&
      p.id !== respondingParticipant.id &&
      p.controlledBy !== 'user'
  );
  if (otherCharacterParticipants.length > 0) {
    const characterMap = new Map<string, Character>();
    for (const p of otherCharacterParticipants) {
      if (!p.characterId) continue;
      const c = await repos.characters.findById(p.characterId);
      if (c) {
        characterMap.set(p.characterId, c);
      }
    }
    otherParticipants = buildOtherParticipantsInfo(
      respondingParticipant.id,
      chat.participants,
      characterMap
    );
    if (otherParticipants.length === 0) {
      otherParticipants = undefined;
    }
  }

  return { respondingParticipant, otherParticipants, userCharacter };
}

async function buildPromptSection(
  character: Character,
  context: SelfInventoryToolContext
): Promise<SelfInventoryPromptSection> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(context.chatId);
  if (!chat) {
    return {
      available: false,
      systemPrompt: null,
      characterCount: 0,
      approxTokens: null,
      message: 'Chat not found.',
    };
  }

  const resolved = await resolveRespondingContext(chat, context);
  if (!resolved) {
    return {
      available: false,
      systemPrompt: null,
      characterCount: 0,
      approxTokens: null,
      message: 'Responding participant not found for character in this chat.',
    };
  }

  const { respondingParticipant, otherParticipants, userCharacter } = resolved;

  let roleplayTemplate: { systemPrompt: string } | null = null;
  if (chat.roleplayTemplateId) {
    try {
      const tpl = await repos.roleplayTemplates.findById(chat.roleplayTemplateId);
      if (tpl && typeof (tpl as { systemPrompt?: unknown }).systemPrompt === 'string') {
        roleplayTemplate = { systemPrompt: (tpl as { systemPrompt: string }).systemPrompt };
      }
    } catch (err) {
      logger.debug('self_inventory: roleplay template lookup failed', {
        templateId: chat.roleplayTemplateId,
        error: getErrorMessage(err),
      });
    }
  }

  let projectContext: { name: string; description?: string | null; instructions?: string | null } | null = null;
  if (chat.projectId) {
    try {
      const project = await repos.projects.findById(chat.projectId);
      if (project) {
        projectContext = {
          name: project.name,
          description: project.description ?? null,
          instructions: project.instructions ?? null,
        };
      }
    } catch (err) {
      logger.debug('self_inventory: project lookup failed', {
        projectId: chat.projectId,
        error: getErrorMessage(err),
      });
    }
  }

  const systemPrompt = buildSystemPrompt(
    character,
    userCharacter,
    otherParticipants,
    roleplayTemplate,
    undefined,
    respondingParticipant.selectedSystemPromptId ?? null,
    chat.timestampConfig ?? null,
    false,
    projectContext,
    undefined,
    undefined,
    respondingParticipant.status,
    chat.scenarioText ?? null,
    undefined,
    undefined
  );

  const characterCount = systemPrompt.length;
  const approxTokens = Math.round(characterCount / 4);

  return {
    available: true,
    systemPrompt,
    characterCount,
    approxTokens,
  };
}

async function buildLastTurnSection(
  character: Character,
  context: SelfInventoryToolContext
): Promise<SelfInventoryLastTurnSection> {
  const repos = getRepositories();
  const logs = await repos.llmLogs.findByChatId(context.chatId);
  const lastLog = logs[0];

  if (lastLog) {
    const provider = lastLog.provider;
    const modelName = lastLog.modelName;
    const usage = lastLog.usage ?? null;
    const promptTokens = usage?.promptTokens ?? null;
    const completionTokens = usage?.completionTokens ?? null;
    const totalTokens = usage?.totalTokens ?? null;

    let contextWindow: number | null = null;
    try {
      contextWindow = getModelContextLimit(provider, modelName);
    } catch (err) {
      logger.debug('self_inventory: context window lookup failed', {
        provider,
        modelName,
        error: getErrorMessage(err),
      });
    }

    const utilizationPercent =
      totalTokens !== null && contextWindow && contextWindow > 0
        ? roundPercent((totalTokens / contextWindow) * 100)
        : null;

    return {
      available: true,
      source: 'llm_log',
      provider,
      modelName,
      promptTokens,
      completionTokens,
      totalTokens,
      contextWindow,
      utilizationPercent,
      loggedAt: lastLog.createdAt,
    };
  }

  // Fallback: resolve the profile that *would* run and report its shape.
  const chat = await repos.chats.findById(context.chatId);
  if (!chat) {
    return {
      available: false,
      source: null,
      provider: null,
      modelName: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      contextWindow: null,
      utilizationPercent: null,
      loggedAt: null,
      message: 'Chat not found.',
    };
  }

  const participant =
    chat.participants.find((p) => p.id === context.callingParticipantId) ??
    chat.participants.find(
      (p) => p.type === 'CHARACTER' && p.characterId === context.characterId
    );
  if (!participant) {
    return {
      available: false,
      source: null,
      provider: null,
      modelName: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      contextWindow: null,
      utilizationPercent: null,
      loggedAt: null,
      message: 'No LLM log and responding participant not found.',
    };
  }

  try {
    const profileId = resolveConnectionProfile(participant, character);
    const profile = await repos.connections.findById(profileId);
    if (!profile) {
      return {
        available: false,
        source: null,
        provider: null,
        modelName: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        contextWindow: null,
        utilizationPercent: null,
        loggedAt: null,
        message: `No LLM log and connection profile ${profileId} not found.`,
      };
    }

    const contextWindow =
      profile.maxContext ?? getModelContextLimit(profile.provider, profile.modelName);

    return {
      available: true,
      source: 'profile_fallback',
      provider: profile.provider,
      modelName: profile.modelName,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      contextWindow,
      utilizationPercent: 0,
      loggedAt: null,
    };
  } catch (err) {
    return {
      available: false,
      source: null,
      provider: null,
      modelName: null,
      promptTokens: null,
      completionTokens: null,
      totalTokens: null,
      contextWindow: null,
      utilizationPercent: null,
      loggedAt: null,
      message: `No LLM log and profile resolution failed: ${getErrorMessage(err)}`,
    };
  }
}

export async function executeSelfInventoryTool(
  input: unknown,
  context: SelfInventoryToolContext
): Promise<SelfInventoryToolOutput> {
  if (!validateSelfInventoryInput(input)) {
    logger.warn('self_inventory: invalid input', {
      context: 'self-inventory-handler',
      userId: context.userId,
    });
  }

  if (!context.characterId) {
    return {
      success: false,
      characterId: '',
      characterName: '',
      vault: { available: false, reason: 'error', message: 'Missing characterId.' },
      memory: {
        available: false,
        totalCount: 0,
        highImportanceCount: 0,
        highImportancePercent: 0,
        threshold: HIGH_IMPORTANCE_THRESHOLD,
        message: 'Missing characterId.',
      },
      chats: {
        available: false,
        chatCount: 0,
        earliestCreatedAt: null,
        latestActivityAt: null,
        message: 'Missing characterId.',
      },
      prompt: {
        available: false,
        systemPrompt: null,
        characterCount: 0,
        approxTokens: null,
        message: 'Missing characterId.',
      },
      lastTurn: {
        available: false,
        source: null,
        provider: null,
        modelName: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        contextWindow: null,
        utilizationPercent: null,
        loggedAt: null,
        message: 'Missing characterId.',
      },
      error: 'self_inventory requires a character context',
    };
  }

  const repos = getRepositories();
  const character = await repos.characters.findById(context.characterId);
  if (!character) {
    return {
      success: false,
      characterId: context.characterId,
      characterName: '',
      vault: { available: false, reason: 'error', message: 'Character not found.' },
      memory: {
        available: false,
        totalCount: 0,
        highImportanceCount: 0,
        highImportancePercent: 0,
        threshold: HIGH_IMPORTANCE_THRESHOLD,
        message: 'Character not found.',
      },
      chats: {
        available: false,
        chatCount: 0,
        earliestCreatedAt: null,
        latestActivityAt: null,
        message: 'Character not found.',
      },
      prompt: {
        available: false,
        systemPrompt: null,
        characterCount: 0,
        approxTokens: null,
        message: 'Character not found.',
      },
      lastTurn: {
        available: false,
        source: null,
        provider: null,
        modelName: null,
        promptTokens: null,
        completionTokens: null,
        totalTokens: null,
        contextWindow: null,
        utilizationPercent: null,
        loggedAt: null,
        message: 'Character not found.',
      },
      error: `Character ${context.characterId} not found`,
    };
  }

  logger.debug('self_inventory: assembling report', {
    context: 'self-inventory-handler',
    userId: context.userId,
    chatId: context.chatId,
    characterId: context.characterId,
  });

  const vault: SelfInventoryVaultSection = await buildVaultSection(character).catch(
    (err) => ({
      available: false as const,
      reason: 'error' as const,
      message: getErrorMessage(err),
    })
  );

  const memory: SelfInventoryMemorySection = await buildMemorySection(
    context.characterId
  ).catch((err) => ({
    available: false,
    totalCount: 0,
    highImportanceCount: 0,
    highImportancePercent: 0,
    threshold: HIGH_IMPORTANCE_THRESHOLD,
    message: getErrorMessage(err),
  }));

  const chats: SelfInventoryChatSection = await buildChatsSection(
    context.characterId
  ).catch((err) => ({
    available: false,
    chatCount: 0,
    earliestCreatedAt: null,
    latestActivityAt: null,
    message: getErrorMessage(err),
  }));

  const prompt: SelfInventoryPromptSection = await buildPromptSection(
    character,
    context
  ).catch((err) => ({
    available: false,
    systemPrompt: null,
    characterCount: 0,
    approxTokens: null,
    message: getErrorMessage(err),
  }));

  const lastTurn: SelfInventoryLastTurnSection = await buildLastTurnSection(
    character,
    context
  ).catch((err) => ({
    available: false,
    source: null,
    provider: null,
    modelName: null,
    promptTokens: null,
    completionTokens: null,
    totalTokens: null,
    contextWindow: null,
    utilizationPercent: null,
    loggedAt: null,
    message: getErrorMessage(err),
  }));

  return {
    success: true,
    characterId: character.id,
    characterName: character.name,
    vault,
    memory,
    chats,
    prompt,
    lastTurn,
  };
}

function formatVaultSection(section: SelfInventoryVaultSection): string {
  if (!section.available) {
    return `## Character Vault\nUnavailable — ${section.message}`;
  }

  const header = `## Character Vault\nMount point: ${section.mountPointName} (${section.fileCount} file${section.fileCount === 1 ? '' : 's'})`;
  if (section.files.length === 0) {
    return `${header}\n(no files)`;
  }

  const lines = section.files.map((f) => {
    const date = formatDate(f.lastModified);
    return `- ${f.relativePath}  [${f.fileType}, ${formatSize(f.fileSizeBytes)}, modified ${date}]`;
  });
  const footer = `(To read a file: doc_read_file with scope='document_store', mount_point='${section.mountPointName}', path='<relativePath>')`;
  return `${header}\n${lines.join('\n')}\n${footer}`;
}

function formatMemorySection(section: SelfInventoryMemorySection): string {
  if (!section.available) {
    return `## Memory Stats\nUnavailable — ${section.message ?? 'unknown error'}`;
  }
  return [
    `## Memory Stats`,
    `Total memories: ${formatNumber(section.totalCount)}`,
    `High-importance (>= ${section.threshold}): ${formatNumber(section.highImportanceCount)} (${section.highImportancePercent}%)`,
  ].join('\n');
}

function formatChatsSection(section: SelfInventoryChatSection): string {
  if (!section.available) {
    return `## Conversation Stats\nUnavailable — ${section.message ?? 'unknown error'}`;
  }
  if (section.chatCount === 0) {
    return `## Conversation Stats\nChats: 0\n(no conversations yet)`;
  }
  return [
    `## Conversation Stats`,
    `Chats: ${formatNumber(section.chatCount)}`,
    `Earliest created: ${section.earliestCreatedAt ?? '(unknown)'}`,
    `Most recent activity: ${section.latestActivityAt ?? '(unknown)'}`,
  ].join('\n');
}

function formatPromptSection(section: SelfInventoryPromptSection): string {
  if (!section.available) {
    return `## Assembled System Prompt\nUnavailable — ${section.message ?? 'unknown error'}`;
  }
  return [
    `## Assembled System Prompt`,
    `${formatNumber(section.characterCount)} chars, ~${formatNumber(section.approxTokens ?? 0)} tokens`,
    `(Excludes per-turn tool instructions, memory blocks, conversation history, and wardrobe/status notifications.)`,
    ``,
    `---`,
    section.systemPrompt ?? '',
    `---`,
  ].join('\n');
}

function formatLastTurnSection(section: SelfInventoryLastTurnSection): string {
  if (!section.available) {
    return `## Last-Turn LLM Usage\nUnavailable — ${section.message ?? 'unknown error'}`;
  }

  const sourceLabel =
    section.source === 'llm_log'
      ? `llm_log (logged ${section.loggedAt ?? 'unknown'})`
      : `profile_fallback (no LLM call recorded yet for this chat)`;

  const promptTokens = section.promptTokens ?? 0;
  const completionTokens = section.completionTokens ?? 0;
  const totalTokens = section.totalTokens ?? 0;

  const tokenLine = `Tokens: ${formatNumber(promptTokens)} prompt + ${formatNumber(completionTokens)} completion = ${formatNumber(totalTokens)} total`;
  const windowLine = section.contextWindow
    ? `Context window: ${formatNumber(section.contextWindow)} (utilization: ${section.utilizationPercent ?? 0}%)`
    : `Context window: (unknown)`;

  return [
    `## Last-Turn LLM Usage`,
    `Source: ${sourceLabel}`,
    `Provider: ${section.provider ?? '(unknown)'} / ${section.modelName ?? '(unknown)'}`,
    tokenLine,
    windowLine,
  ].join('\n');
}

export function formatSelfInventoryResults(output: SelfInventoryToolOutput): string {
  if (!output.success) {
    return `Self-Inventory Error: ${output.error ?? 'Unknown error'}`;
  }

  const lines = [
    `# Self-Inventory Report`,
    `Character: ${output.characterName} (id: ${output.characterId})`,
    ``,
    formatVaultSection(output.vault),
    ``,
    formatMemorySection(output.memory),
    ``,
    formatChatsSection(output.chats),
    ``,
    formatPromptSection(output.prompt),
    ``,
    formatLastTurnSection(output.lastTurn),
  ];

  return lines.join('\n');
}
