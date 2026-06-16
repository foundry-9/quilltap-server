/**
 * Self-Inventory Tool Handler
 *
 * Assembles the eight-section introspection report. Each section is wrapped
 * in a try/catch so a single failing lookup yields an "unavailable" marker
 * rather than throwing the whole report away.
 */

import fs from 'fs';
import path from 'path';
import packageJson from '@/package.json';
import { logger } from '@/lib/logger';
import { formatBytes } from '@/lib/utils/format-bytes';
import { getRepositories } from '@/lib/repositories/factory';
import { isMountIndexDegraded } from '@/lib/database/backends/sqlite/mount-index-client';
import { buildSystemPrompt, buildOtherParticipantsInfo } from '@/lib/chat/context/system-prompt-builder';
import type { OtherParticipantInfo } from '@/lib/chat/context/system-prompt-builder';
import { resolveConnectionProfile } from '@/lib/chat/connection-resolver';
import { getModelContextLimit } from '@/lib/llm/model-context-data';
import { isParticipantPresent } from '@/lib/schemas/chat.types';
import type { Character, ChatParticipantBase } from '@/lib/schemas/types';
import type { LoadedMemoriesContext } from '@/lib/chat/tool-executor';
import { isAutomaticImagePath, isOsCruftName, IMAGE_FILE_EXTENSIONS } from '@/lib/files/folder-utils';
import { formatSelfUri, formatScopedUri, formatDocStoreUri } from '@/lib/doc-edit/qtap-uri';
import {
  isDockerEnvironment,
  isElectronShell,
  isLimaEnvironment,
  getElectronShellVersion,
} from '@/lib/paths';
import { isDevelopment } from '@/lib/env';
import {
  SELF_INVENTORY_SECTIONS,
  SelfInventoryToolInput,
  SelfInventoryToolOutput,
  SelfInventoryVaultSection,
  SelfInventoryVaultCharacterSection,
  SelfInventoryVaultGroupsSection,
  SelfInventoryVaultGroup,
  SelfInventoryVaultIncludedParts,
  SelfInventoryVaultFile,
  SelfInventoryVaultAccessSection,
  SelfInventoryVaultAccessCharacterSection,
  SelfInventoryVaultAccessGroupsSection,
  SelfInventoryGroupVaultAccess,
  SelfInventoryGroupVaultMember,
  SelfInventoryVaultAccessParticipant,
  SelfInventoryVaultAccessLevel,
  SelfInventoryMemorySection,
  SelfInventoryLoadedMemoriesSection,
  SelfInventoryChatSection,
  SelfInventoryPromptSection,
  SelfInventoryLastTurnSection,
  SelfInventoryCarinaSection,
  SelfInventoryQuilltapSection,
  SelfInventoryQuilltapIncludedParts,
  SelfInventoryRuntimeMode,
  SelfInventoryClientShell,
  SelfInventoryContextSection,
  SelfInventoryContextIncludedParts,
  SelfInventoryContextChat,
  SelfInventoryContextProject,
  SelfInventoryContextGroups,
  SelfInventoryContextGroup,
  SelfInventoryContextCharacters,
  SelfInventoryContextCharacter,
  SelfInventoryContextFiles,
  SelfInventoryContextFile,
  SelfInventoryContextMount,
  validateSelfInventoryInput,
  type SelfInventorySection,
} from '../self-inventory-tool';

export interface SelfInventoryToolContext {
  userId: string;
  chatId: string;
  characterId: string;
  /** Project the chat belongs to, when known (for the `context` section). */
  projectId?: string;
  callingParticipantId?: string;
  loadedMemories?: LoadedMemoriesContext;
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

function formatDate(iso: string): string {
  return iso.slice(0, 10);
}

function isImageFileName(basename: string): boolean {
  const ext = basename.includes('.') ? basename.slice(basename.lastIndexOf('.')).toLowerCase() : '';
  return (IMAGE_FILE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Predicate for which vault files to surface. OS cruft is always dropped.
 * Auto-generated images are dropped unless the caller opts in via
 * `includeAutomaticImages`. "Auto-generated" covers two storage conventions:
 *  - document stores (group vaults): images under `character-avatars/` or
 *    `story-backgrounds/` (the shared `isAutomaticImagePath` rule), and
 *  - character vaults: images under the top-level `images/` folder, where the
 *    avatar (`images/avatar.webp`) and generated wardrobe history live. This
 *    convention is private to character vaults, so it is gated behind
 *    `treatImagesFolderAsGenerated` rather than baked into the shared helper.
 */
function keepVaultFile(
  relativePath: string,
  includeAutomaticImages: boolean,
  treatImagesFolderAsGenerated: boolean
): boolean {
  const segments = relativePath.split('/');
  const basename = segments[segments.length - 1] ?? '';
  if (isOsCruftName(basename)) return false;
  if (includeAutomaticImages) return true;
  if (isAutomaticImagePath(relativePath)) return false;
  if (treatImagesFolderAsGenerated && segments[0] === 'images' && isImageFileName(basename)) {
    return false;
  }
  return true;
}

type DocMountFileRow = {
  relativePath: string;
  fileName: string;
  fileType: string;
  fileSizeBytes: number;
  lastModified: string;
};

function mapVaultFiles(
  rows: DocMountFileRow[],
  mountPointName: string,
  includeAutomaticImages: boolean,
  treatImagesFolderAsGenerated: boolean,
  makeUri: (relativePath: string) => string
): SelfInventoryVaultFile[] {
  return rows
    .filter((row) =>
      keepVaultFile(row.relativePath, includeAutomaticImages, treatImagesFolderAsGenerated)
    )
    .map((row) => ({
      mountPointName,
      relativePath: row.relativePath,
      fileName: row.fileName,
      fileType: row.fileType,
      fileSizeBytes: row.fileSizeBytes,
      lastModified: row.lastModified,
      uri: makeUri(row.relativePath),
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function buildVaultCharacterSection(
  character: Character,
  includeAutomaticImages: boolean
): Promise<SelfInventoryVaultCharacterSection> {
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
  // The character's own vault → the stable, readable self form.
  const files = mapVaultFiles(rows, mountPoint.name, includeAutomaticImages, true, (rel) =>
    formatSelfUri(rel)
  );

  logger.debug('self_inventory: vault.character built', {
    context: 'self-inventory-handler',
    characterId: character.id,
    mountPointId: mountPoint.id,
    totalRows: rows.length,
    fileCount: files.length,
    includeAutomaticImages,
  });

  return {
    available: true,
    mountPointName: mountPoint.name,
    mountPointId: mountPoint.id,
    fileCount: files.length,
    files,
  };
}

/** A group the calling character belongs to, with its resolved store ids. */
interface ResolvedGroup {
  groupId: string;
  groupName: string;
  /** Official store + any linked stores, de-duplicated. */
  mountPointIds: string[];
}

/**
 * Resolve the groups the character belongs to and each group's document
 * stores. Shared by `vault.groups`, `vaultAccess.groups`, and `context.groups`.
 * A group whose store is unavailable (throws) is skipped, not fatal.
 */
async function resolveMyGroups(characterId: string): Promise<ResolvedGroup[]> {
  const repos = getRepositories();
  const memberships = await repos.groupCharacterMembers.findByCharacterId(characterId);
  const resolved: ResolvedGroup[] = [];

  for (const membership of memberships) {
    let group;
    try {
      group = await repos.groups.findById(membership.groupId);
    } catch (err) {
      logger.debug('self_inventory: skipping group with unavailable store', {
        context: 'self-inventory-handler',
        groupId: membership.groupId,
        error: getErrorMessage(err),
      });
      continue;
    }
    if (!group) continue;

    const mountPointIds = new Set<string>();
    if (group.officialMountPointId) mountPointIds.add(group.officialMountPointId);
    const links = await repos.groupDocMountLinks.findByGroupId(membership.groupId);
    for (const link of links) mountPointIds.add(link.mountPointId);

    resolved.push({
      groupId: group.id,
      groupName: group.name,
      mountPointIds: [...mountPointIds],
    });
  }

  resolved.sort((a, b) => a.groupName.localeCompare(b.groupName));
  return resolved;
}

async function buildVaultGroupsSection(
  characterId: string,
  includeAutomaticImages: boolean
): Promise<SelfInventoryVaultGroupsSection> {
  if (isMountIndexDegraded()) {
    return {
      available: false,
      reason: 'mount_index_degraded',
      message: 'Mount index database is in degraded mode.',
    };
  }

  const repos = getRepositories();
  const groups = await resolveMyGroups(characterId);
  if (groups.length === 0) {
    return {
      available: false,
      reason: 'no_groups',
      message: 'You are not a member of any groups.',
    };
  }

  const out: SelfInventoryVaultGroup[] = [];
  for (const group of groups) {
    for (const mountPointId of group.mountPointIds) {
      const mountPoint = await repos.docMountPoints.findById(mountPointId);
      if (!mountPoint) continue;
      const rows = await repos.docMountFiles.findByMountPointId(mountPointId);
      // A group store, not the acting character's own vault → address by name.
      const files = mapVaultFiles(rows, mountPoint.name, includeAutomaticImages, false, (rel) =>
        formatDocStoreUri({ mountPointName: mountPoint.name, mountPointId: mountPoint.id, path: rel })
      );
      out.push({
        groupId: group.groupId,
        groupName: group.groupName,
        mountPointId: mountPoint.id,
        mountPointName: mountPoint.name,
        fileCount: files.length,
        files,
      });
    }
  }

  logger.debug('self_inventory: vault.groups built', {
    context: 'self-inventory-handler',
    characterId,
    groupCount: groups.length,
    storeCount: out.length,
    includeAutomaticImages,
  });

  return { available: true, groups: out };
}

async function buildVaultAccessGroupsSection(
  characterId: string
): Promise<SelfInventoryVaultAccessGroupsSection> {
  const repos = getRepositories();
  const groups = await resolveMyGroups(characterId);
  if (groups.length === 0) {
    return {
      available: false,
      reason: 'no_groups',
      message: 'You are not a member of any groups.',
    };
  }

  const out: SelfInventoryGroupVaultAccess[] = [];
  for (const group of groups) {
    const members = await repos.groupCharacterMembers.findByGroupId(group.groupId);
    const memberInfos: SelfInventoryGroupVaultMember[] = [];
    const seen = new Set<string>();

    for (const member of members) {
      if (seen.has(member.characterId)) continue;
      seen.add(member.characterId);

      let characterName = 'Unknown';
      try {
        const c = await repos.characters.findById(member.characterId);
        if (c) characterName = c.name;
      } catch {
        // Member's vault is broken — still list them by id, name unknown.
      }

      memberInfos.push({
        characterId: member.characterId,
        characterName,
        isSelf: member.characterId === characterId,
        access: 'read_write',
      });
    }

    memberInfos.sort((a, b) => {
      if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
      return a.characterName.localeCompare(b.characterName);
    });

    out.push({ groupId: group.groupId, groupName: group.groupName, members: memberInfos });
  }

  logger.debug('self_inventory: vaultAccess.groups built', {
    context: 'self-inventory-handler',
    characterId,
    groupCount: out.length,
  });

  return { available: true, groups: out };
}

async function buildVaultAccessCharacterSection(
  character: Character,
  context: SelfInventoryToolContext
): Promise<SelfInventoryVaultAccessCharacterSection> {
  const repos = getRepositories();
  const chat = await repos.chats.findById(context.chatId);
  const sharedVaultsEnabled = Boolean(chat?.allowCrossCharacterVaultReads);

  if (!character.characterDocumentMountPointId) {
    return {
      available: false,
      sharedVaultsEnabled,
      message: 'Character has no vault mount point.',
    };
  }
  if (!chat) {
    return {
      available: false,
      sharedVaultsEnabled,
      message: 'Chat not found.',
    };
  }

  const mountPoint = await repos.docMountPoints.findById(character.characterDocumentMountPointId);
  if (!mountPoint) {
    return {
      available: false,
      sharedVaultsEnabled,
      message: `Mount point ${character.characterDocumentMountPointId} not found.`,
    };
  }

  const participants: SelfInventoryVaultAccessParticipant[] = [];
  const seenCharacterIds = new Set<string>();

  for (const p of chat.participants) {
    if (p.type !== 'CHARACTER') continue;
    if (!p.characterId) continue;
    if (!isParticipantPresent(p.status)) continue;
    if (seenCharacterIds.has(p.characterId)) continue;
    seenCharacterIds.add(p.characterId);

    const isSelf = p.characterId === character.id;
    const isUser = p.controlledBy === 'user';

    // Self and the user persona always have read/write; the user reaches peer
    // vaults via document mode even when tool-level cross-character reads are
    // off. Other peer characters only get read access when shared vaults is on.
    let access: SelfInventoryVaultAccessLevel | null = null;
    if (isSelf || isUser) {
      access = 'read_write';
    } else if (sharedVaultsEnabled) {
      access = 'read_only';
    }
    if (!access) continue;

    let characterName = 'Unknown';
    const c = await repos.characters.findById(p.characterId);
    if (c) characterName = c.name;

    participants.push({
      participantId: p.id,
      characterId: p.characterId,
      characterName,
      controlledBy: p.controlledBy,
      status: p.status,
      isSelf,
      access,
    });
  }

  // Sort: self first, then user persona, then others alphabetically.
  participants.sort((a, b) => {
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
    const aUser = a.controlledBy === 'user' ? 0 : 1;
    const bUser = b.controlledBy === 'user' ? 0 : 1;
    if (aUser !== bUser) return aUser - bUser;
    return a.characterName.localeCompare(b.characterName);
  });

  return {
    available: true,
    mountPointName: mountPoint.name,
    sharedVaultsEnabled,
    participants,
  };
}

function buildLoadedMemoriesSection(
  loaded: LoadedMemoriesContext | undefined
): SelfInventoryLoadedMemoriesSection {
  if (!loaded) {
    return {
      available: false,
      message: 'No loaded-memory data available for this turn (tool was invoked outside of a prompt-building flow).',
    };
  }
  return {
    available: true,
    semanticMemories: (loaded.semantic ?? []).map((m) => ({
      summary: m.summary,
      importance: m.importance,
      score: m.score,
      effectiveWeight: m.effectiveWeight,
    })),
    interCharacterMemories: (loaded.interCharacter ?? []).map((m) => ({
      aboutCharacterName: m.aboutCharacterName,
      summary: m.summary,
      importance: m.importance,
    })),
    recap: loaded.recap ?? null,
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
    }
  }

  const systemPrompt = buildSystemPrompt({
    character,
    userCharacter,
    roleplayTemplate,
    selectedSystemPromptId: respondingParticipant.selectedSystemPromptId ?? null,
    timestampConfig: chat.timestampConfig ?? null,
    isInitialMessage: false,
    scenarioText: chat.scenarioText ?? null,
  });

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

async function buildCarinaSection(
  characterId: string
): Promise<SelfInventoryCarinaSection> {
  const repos = getRepositories();

  // canBeCarina is a DB column, not a vault field — use the overlay-free raw
  // read so a single broken character vault can't sink the whole listing. This
  // mirrors the orchestrator's per-turn Carina-answerer probe.
  const rawCharacters = await repos.characters.findAllRaw();

  const selfEnabled = rawCharacters.some(
    (c) => c.id === characterId && c.canBeCarina === true
  );

  // A Carina line opens when EITHER side is an answerer. So an enabled self can
  // reach EVERY other character; a non-enabled self can reach only the answerers.
  const others = rawCharacters.filter((c) => c.id !== characterId);
  const pool = selfEnabled ? others : others.filter((c) => c.canBeCarina === true);

  const reachable = pool
    .map((c) => ({ name: c.name, isAnswerer: c.canBeCarina === true }))
    .sort((a, b) => a.name.localeCompare(b.name));

  logger.debug('self_inventory: carina section built', {
    context: 'self-inventory-handler',
    characterId,
    selfEnabled,
    reachableCount: reachable.length,
  });

  return { available: true, selfEnabled, reachable };
}

function resolveRuntimeMode(): SelfInventoryRuntimeMode {
  const shell = isElectronShell();
  const docker = isDockerEnvironment();
  const vm = isLimaEnvironment();

  if (shell && vm) return 'electron-vm';
  if (shell && docker) return 'electron-docker';
  if (shell) return 'electron';
  if (vm) return 'vm';
  if (docker) return 'docker';
  if (isDevelopment) return 'local-dev';
  return 'local-production';
}

function resolveClientShell(): SelfInventoryClientShell {
  const shellVersion = getElectronShellVersion();
  if (shellVersion) return { type: 'electron', shellVersion };
  if (isElectronShell()) return { type: 'electron', shellVersion: 'unknown' };
  return { type: 'browser' };
}

function parseSemanticVersion(version: string): [number, number, number] {
  const base = version.split('-')[0];
  const parts = base.split('.').map(Number);
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

function findReleaseNotesFile(version: string): { filePath: string; version: string } | null {
  const releasesDir = path.join(process.cwd(), 'docs', 'releases');

  let files: string[];
  try {
    files = fs.readdirSync(releasesDir).filter((f) => f.endsWith('.md'));
  } catch {
    return null;
  }

  const [targetMajor, targetMinor, targetPatch] = parseSemanticVersion(version);

  const candidates: { file: string; version: string; major: number; minor: number; patch: number }[] = [];
  for (const file of files) {
    const stem = file.replace(/\.md$/, '');
    const parts = stem.split('.').map(Number);
    if (parts.some(isNaN)) continue;

    const major = parts[0] ?? 0;
    const minor = parts[1] ?? 0;
    const patch = parts[2] ?? 0;

    if (
      major < targetMajor ||
      (major === targetMajor && minor < targetMinor) ||
      (major === targetMajor && minor === targetMinor && patch <= targetPatch)
    ) {
      candidates.push({ file, version: stem, major, minor, patch });
    }
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.major !== b.major) return b.major - a.major;
    if (a.minor !== b.minor) return b.minor - a.minor;
    return b.patch - a.patch;
  });

  return {
    filePath: path.join(releasesDir, candidates[0].file),
    version: candidates[0].version,
  };
}

function buildQuilltapSection(
  includedParts: SelfInventoryQuilltapIncludedParts
): SelfInventoryQuilltapSection {
  // The top-level identity (version + runtime + clientShell) is always cheap
  // to compute and lives at the top of the section header in the formatter,
  // so we resolve it unconditionally. The two file reads (release notes,
  // changelog) are skipped when not requested — saves an fs.readFileSync on
  // a potentially large changelog when the caller only asked for the version.
  const version = packageJson.version;
  const runtimeMode = resolveRuntimeMode();
  const clientShell = resolveClientShell();

  let releaseNotes: string | null = null;
  let releaseNotesVersion: string | null = null;
  if (includedParts.releaseNotes) {
    const found = findReleaseNotesFile(version);
    if (found) {
      try {
        releaseNotes = fs.readFileSync(found.filePath, 'utf-8');
        releaseNotesVersion = found.version;
      } catch {
        // File disappeared between readdir and readFile
      }
    }
  }

  let changelog: string | null = null;
  if (includedParts.changelog) {
    try {
      changelog = fs.readFileSync(path.join(process.cwd(), 'docs', 'CHANGELOG.md'), 'utf-8');
    } catch {
      // Changelog not available (e.g. standalone/Docker build without docs)
    }
  }

  return {
    available: true,
    includedParts,
    version,
    runtimeMode,
    clientShell,
    releaseNotes,
    releaseNotesVersion,
    changelog,
  };
}

function resolveQuilltapIncludedParts(
  requested: Set<SelfInventorySection>
): SelfInventoryQuilltapIncludedParts | null {
  const wantsAll = requested.has('quilltap');
  const wantsVersion = wantsAll || requested.has('quilltap.version');
  const wantsReleaseNotes = wantsAll || requested.has('quilltap.releaseNotes');
  const wantsChangelog = wantsAll || requested.has('quilltap.changelog');

  if (!wantsVersion && !wantsReleaseNotes && !wantsChangelog) {
    return null;
  }

  return {
    version: wantsVersion,
    releaseNotes: wantsReleaseNotes,
    changelog: wantsChangelog,
  };
}

async function buildVaultWrapper(
  character: Character,
  parts: SelfInventoryVaultIncludedParts,
  includeAutomaticImages: boolean
): Promise<SelfInventoryVaultSection> {
  const out: SelfInventoryVaultSection = { includedParts: parts };
  if (parts.character) {
    out.character = await buildVaultCharacterSection(character, includeAutomaticImages).catch(
      (err) => ({
        available: false as const,
        reason: 'error' as const,
        message: getErrorMessage(err),
      })
    );
  }
  if (parts.groups) {
    out.groups = await buildVaultGroupsSection(character.id, includeAutomaticImages).catch(
      (err) => ({
        available: false as const,
        reason: 'error' as const,
        message: getErrorMessage(err),
      })
    );
  }
  return out;
}

async function buildVaultAccessWrapper(
  character: Character,
  context: SelfInventoryToolContext,
  parts: SelfInventoryVaultIncludedParts
): Promise<SelfInventoryVaultAccessSection> {
  const out: SelfInventoryVaultAccessSection = { includedParts: parts };
  if (parts.character) {
    out.character = await buildVaultAccessCharacterSection(character, context).catch((err) => ({
      available: false as const,
      sharedVaultsEnabled: false,
      message: getErrorMessage(err),
    }));
  }
  if (parts.groups) {
    out.groups = await buildVaultAccessGroupsSection(character.id).catch((err) => ({
      available: false as const,
      reason: 'error' as const,
      message: getErrorMessage(err),
    }));
  }
  return out;
}

async function resolveMountNames(
  mountPointIds: string[]
): Promise<SelfInventoryContextMount[]> {
  const repos = getRepositories();
  const mounts: SelfInventoryContextMount[] = [];
  for (const id of mountPointIds) {
    const mp = await repos.docMountPoints.findById(id);
    if (mp) mounts.push({ mountPointId: mp.id, name: mp.name });
  }
  return mounts;
}

async function buildContextProject(
  projectId: string | null | undefined
): Promise<SelfInventoryContextProject> {
  if (!projectId) return { available: true, present: false };

  const repos = getRepositories();
  const project = await repos.projects.findById(projectId);
  if (!project) return { available: true, present: false };

  const mountPointIds = new Set<string>();
  if (project.officialMountPointId) mountPointIds.add(project.officialMountPointId);
  try {
    const links = await repos.projectDocMountLinks.findByProjectId(projectId);
    for (const link of links) mountPointIds.add(link.mountPointId);
  } catch {
    // Mount index unavailable — report the project with whatever stores we have.
  }

  const mountPoints = await resolveMountNames([...mountPointIds]);
  return { available: true, present: true, id: project.id, name: project.name, mountPoints };
}

async function buildContextGroups(characterId: string): Promise<SelfInventoryContextGroups> {
  const groups = await resolveMyGroups(characterId);
  const out: SelfInventoryContextGroup[] = [];
  for (const group of groups) {
    const mountPoints = await resolveMountNames(group.mountPointIds);
    out.push({ id: group.groupId, name: group.groupName, mountPoints });
  }
  return { available: true, groups: out };
}

async function buildContextCharacters(
  self: Character,
  chat: { participants: ChatParticipantBase[] } | null
): Promise<SelfInventoryContextCharacters> {
  if (!chat) return { available: false, message: 'Chat not found.' };

  const repos = getRepositories();
  const out: SelfInventoryContextCharacter[] = [];
  const seen = new Set<string>();

  for (const p of chat.participants) {
    if (p.type !== 'CHARACTER') continue;
    if (!p.characterId) continue;
    if (!isParticipantPresent(p.status)) continue;
    if (p.characterId === self.id) continue; // others present with you, not yourself
    if (seen.has(p.characterId)) continue;
    seen.add(p.characterId);

    let c: Character | null = null;
    try {
      c = await repos.characters.findById(p.characterId);
    } catch (err) {
      logger.debug('self_inventory: context.characters skipping unavailable character', {
        context: 'self-inventory-handler',
        characterId: p.characterId,
        error: getErrorMessage(err),
      });
      continue;
    }
    if (!c) continue;

    out.push({
      id: c.id,
      name: c.name,
      aliases: c.aliases ?? [],
      identity: c.identity ?? null,
      isUserPersona: p.controlledBy === 'user',
    });
  }

  out.sort((a, b) => a.name.localeCompare(b.name));
  return { available: true, characters: out };
}

/**
 * Build the canonical qtap:// URI for a chat-context document from the triple
 * stored on the chat_documents row. The row carries only the mount-point
 * *name* (or the reserved 'self' literal, or null), so document-store URIs use
 * the name form; that is enough for a copy-pasteable hint.
 */
function buildContextFileUri(
  scope: 'project' | 'document_store' | 'general',
  mountPoint: string | null,
  filePath: string
): string {
  if (scope === 'project' || scope === 'general') {
    return formatScopedUri(scope, filePath);
  }
  if (!mountPoint || mountPoint.toLowerCase() === 'self') {
    return formatSelfUri(filePath);
  }
  return formatDocStoreUri({ mountPointName: mountPoint, mountPointId: '', path: filePath });
}

function buildHowToReach(uri: string): string {
  return `doc_read_file({ uri: "${uri}" })`;
}

async function buildContextFiles(chatId: string): Promise<SelfInventoryContextFiles> {
  const repos = getRepositories();
  const docs = await repos.chatDocuments.findByChatId(chatId);
  const files: SelfInventoryContextFile[] = docs
    .map((d) => {
      const uri = buildContextFileUri(d.scope, d.mountPoint ?? null, d.filePath);
      return {
        scope: d.scope,
        mountPoint: d.mountPoint ?? null,
        filePath: d.filePath,
        displayTitle: d.displayTitle ?? null,
        uri,
        howToReach: buildHowToReach(uri),
      };
    })
    .sort((a, b) => a.filePath.localeCompare(b.filePath));

  return { available: true, files };
}

async function buildContextSection(
  character: Character,
  context: SelfInventoryToolContext,
  parts: SelfInventoryContextIncludedParts
): Promise<SelfInventoryContextSection> {
  const repos = getRepositories();
  const out: SelfInventoryContextSection = { includedParts: parts };
  const chat = await repos.chats.findById(context.chatId);

  if (parts.chat) {
    const chatSection: SelfInventoryContextChat = chat
      ? { available: true, chatId: chat.id, title: chat.title ?? null }
      : { available: false, chatId: context.chatId, title: null, message: 'Chat not found.' };
    out.chat = chatSection;
  }

  if (parts.project) {
    out.project = await buildContextProject(context.projectId ?? chat?.projectId ?? null).catch(
      (err) => ({ available: false as const, message: getErrorMessage(err) })
    );
  }

  if (parts.groups) {
    out.groups = await buildContextGroups(character.id).catch((err) => ({
      available: false as const,
      message: getErrorMessage(err),
    }));
  }

  if (parts.characters) {
    out.characters = await buildContextCharacters(character, chat).catch((err) => ({
      available: false as const,
      message: getErrorMessage(err),
    }));
  }

  if (parts.files) {
    out.files = await buildContextFiles(context.chatId).catch((err) => ({
      available: false as const,
      message: getErrorMessage(err),
    }));
  }

  logger.debug('self_inventory: context section built', {
    context: 'self-inventory-handler',
    characterId: character.id,
    chatId: context.chatId,
    parts,
  });

  return out;
}

function resolveVaultIncludedParts(
  requested: Set<SelfInventorySection>
): SelfInventoryVaultIncludedParts | null {
  const wantsAll = requested.has('vault');
  const character = wantsAll || requested.has('vault.character');
  const groups = wantsAll || requested.has('vault.groups');
  if (!character && !groups) return null;
  return { character, groups };
}

function resolveVaultAccessIncludedParts(
  requested: Set<SelfInventorySection>
): SelfInventoryVaultIncludedParts | null {
  const wantsAll = requested.has('vaultAccess');
  const character = wantsAll || requested.has('vaultAccess.character');
  const groups = wantsAll || requested.has('vaultAccess.groups');
  if (!character && !groups) return null;
  return { character, groups };
}

function resolveContextIncludedParts(
  requested: Set<SelfInventorySection>
): SelfInventoryContextIncludedParts | null {
  const wantsAll = requested.has('context');
  const chat = wantsAll || requested.has('context.chat');
  const project = wantsAll || requested.has('context.project');
  const groups = wantsAll || requested.has('context.groups');
  const characters = wantsAll || requested.has('context.characters');
  const files = wantsAll || requested.has('context.files');
  if (!chat && !project && !groups && !characters && !files) return null;
  return { chat, project, groups, characters, files };
}

function resolveRequestedSections(input: unknown): Set<SelfInventorySection> {
  const parsed = input as { sections?: SelfInventorySection[] } | null | undefined;
  const requested = parsed?.sections;
  if (!requested || requested.length === 0) {
    return new Set(SELF_INVENTORY_SECTIONS);
  }
  return new Set(requested);
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

  const requested = resolveRequestedSections(input);

  if (!context.characterId) {
    return {
      success: false,
      quilltapVersion: packageJson.version,
      characterId: '',
      characterName: '',
      error: 'self_inventory requires a character context',
    };
  }

  const repos = getRepositories();
  const character = await repos.characters.findById(context.characterId);
  if (!character) {
    return {
      success: false,
      quilltapVersion: packageJson.version,
      characterId: context.characterId,
      characterName: '',
      error: `Character ${context.characterId} not found`,
    };
  }

  const result: SelfInventoryToolOutput = {
    success: true,
    quilltapVersion: packageJson.version,
    characterId: character.id,
    characterName: character.name,
  };

  const includeAutomaticImages = Boolean(
    (input as { includeAutomaticImages?: boolean } | null | undefined)?.includeAutomaticImages
  );

  const vaultParts = resolveVaultIncludedParts(requested);
  if (vaultParts) {
    result.vault = await buildVaultWrapper(character, vaultParts, includeAutomaticImages);
  }

  const vaultAccessParts = resolveVaultAccessIncludedParts(requested);
  if (vaultAccessParts) {
    result.vaultAccess = await buildVaultAccessWrapper(character, context, vaultAccessParts);
  }

  if (requested.has('memory')) {
    result.memory = await buildMemorySection(
      context.characterId
    ).catch((err) => ({
      available: false,
      totalCount: 0,
      highImportanceCount: 0,
      highImportancePercent: 0,
      threshold: HIGH_IMPORTANCE_THRESHOLD,
      message: getErrorMessage(err),
    }));
  }

  if (requested.has('loadedMemories')) {
    result.loadedMemories = buildLoadedMemoriesSection(
      context.loadedMemories
    );
  }

  if (requested.has('chats')) {
    result.chats = await buildChatsSection(
      context.characterId
    ).catch((err) => ({
      available: false,
      chatCount: 0,
      earliestCreatedAt: null,
      latestActivityAt: null,
      message: getErrorMessage(err),
    }));
  }

  if (requested.has('prompt')) {
    result.prompt = await buildPromptSection(
      character,
      context
    ).catch((err) => ({
      available: false,
      systemPrompt: null,
      characterCount: 0,
      approxTokens: null,
      message: getErrorMessage(err),
    }));
  }

  if (requested.has('lastTurn')) {
    result.lastTurn = await buildLastTurnSection(
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
  }

  if (requested.has('carina')) {
    result.carina = await buildCarinaSection(
      context.characterId
    ).catch((err) => ({
      available: false as const,
      message: getErrorMessage(err),
    }));
  }

  const includedQuilltapParts = resolveQuilltapIncludedParts(requested);
  if (includedQuilltapParts) {
    try {
      result.quilltap = buildQuilltapSection(includedQuilltapParts);
    } catch (err) {
      result.quilltap = {
        available: false,
        includedParts: includedQuilltapParts,
        version: packageJson.version,
        runtimeMode: 'local-dev',
        clientShell: { type: 'unknown' },
        releaseNotes: null,
        releaseNotesVersion: null,
        changelog: null,
        message: getErrorMessage(err),
      };
    }
  }

  const contextParts = resolveContextIncludedParts(requested);
  if (contextParts) {
    result.context = await buildContextSection(character, context, contextParts).catch(() => ({
      includedParts: contextParts,
    }));
  }

  return result;
}

function formatVaultFileLine(f: SelfInventoryVaultFile): string {
  return `- ${f.relativePath}  [${f.fileType}, ${formatBytes(f.fileSizeBytes)}, modified ${formatDate(f.lastModified)}]`;
}

function formatVaultCharacter(section: SelfInventoryVaultCharacterSection): string {
  if (!section.available) {
    return `## Character Vault\nUnavailable — ${section.message}`;
  }

  const header = `## Character Vault\nMount point: ${section.mountPointName} (${section.fileCount} file${section.fileCount === 1 ? '' : 's'})`;
  if (section.files.length === 0) {
    return `${header}\n(no files)`;
  }

  const lines = section.files.map(formatVaultFileLine);
  const footer = `(To read one of these files: doc_read_file({ uri: "qtap://self/<relativePath>" }) — the reserved authority 'self' always addresses your own vault, whatever its name. The triple form doc_read_file(scope='document_store', mount_point='self', path='<relativePath>') still works, as do the name '${section.mountPointName}' and its ID.)`;
  return `${header}\n${lines.join('\n')}\n${footer}`;
}

function formatVaultGroups(section: SelfInventoryVaultGroupsSection): string {
  if (!section.available) {
    return `## Group Vaults\nUnavailable — ${section.message}`;
  }
  if (section.groups.length === 0) {
    return `## Group Vaults\n(no group vaults)`;
  }

  const blocks = section.groups.map((g) => {
    const head = `### ${g.groupName} — ${g.mountPointName} (${g.fileCount} file${g.fileCount === 1 ? '' : 's'})`;
    if (g.files.length === 0) {
      return `${head}\n(no files)`;
    }
    const lines = g.files.map(formatVaultFileLine);
    const footer = `(To read a file: doc_read_file({ uri: "qtap://${g.mountPointName}/<relativePath>" }) — or doc_read_file(scope='document_store', mount_point='${g.mountPointName}', path='<relativePath>'))`;
    return `${head}\n${lines.join('\n')}\n${footer}`;
  });

  return [`## Group Vaults`, ...blocks].join('\n\n');
}

function formatVaultSection(section: SelfInventoryVaultSection): string {
  const parts: string[] = [];
  if (section.character) parts.push(formatVaultCharacter(section.character));
  if (section.groups) parts.push(formatVaultGroups(section.groups));
  return parts.join('\n\n');
}

function formatVaultAccessCharacter(section: SelfInventoryVaultAccessCharacterSection): string {
  if (!section.available) {
    return `## Vault Access — Character (this chat)\nUnavailable — ${section.message}`;
  }

  const toggleLine = section.sharedVaultsEnabled
    ? `Shared Vaults: ON — other present characters can read this vault.`
    : `Shared Vaults: OFF — only the owner and user persona can access this vault via chat tools.`;

  const readWrite = section.participants.filter((p) => p.access === 'read_write');
  const readOnly = section.participants.filter((p) => p.access === 'read_only');

  const formatParticipant = (p: SelfInventoryVaultAccessParticipant): string => {
    const tags: string[] = [];
    if (p.isSelf) tags.push('self');
    if (p.controlledBy === 'user') tags.push('user persona');
    if (p.status === 'silent') tags.push('silent');
    const tagSuffix = tags.length > 0 ? ` (${tags.join(', ')})` : '';
    return `- ${p.characterName}${tagSuffix}`;
  };

  const rwBlock =
    readWrite.length === 0
      ? '(none)'
      : readWrite.map(formatParticipant).join('\n');
  const roBlock =
    readOnly.length === 0
      ? '(none)'
      : readOnly.map(formatParticipant).join('\n');

  return [
    `## Vault Access — Character (this chat)`,
    `Mount point: ${section.mountPointName}`,
    toggleLine,
    `Read/Write:`,
    rwBlock,
    `Read-only:`,
    roBlock,
  ].join('\n');
}

function formatVaultAccessGroups(section: SelfInventoryVaultAccessGroupsSection): string {
  if (!section.available) {
    return `## Vault Access — Groups\nUnavailable — ${section.message}`;
  }
  if (section.groups.length === 0) {
    return `## Vault Access — Groups\n(no groups)`;
  }

  const blocks = section.groups.map((g) => {
    const head = `### ${g.groupName}`;
    if (g.members.length === 0) {
      return `${head}\n(no members)`;
    }
    const lines = g.members.map(
      (m) => `- ${m.characterName}${m.isSelf ? ' (self)' : ''} — read/write`
    );
    return `${head}\nAll members can read and write this group's vault, in any chat:\n${lines.join('\n')}`;
  });

  return [`## Vault Access — Groups`, ...blocks].join('\n\n');
}

function formatVaultAccessSection(section: SelfInventoryVaultAccessSection): string {
  const parts: string[] = [];
  if (section.character) parts.push(formatVaultAccessCharacter(section.character));
  if (section.groups) parts.push(formatVaultAccessGroups(section.groups));
  return parts.join('\n\n');
}

function formatLoadedMemoriesSection(section: SelfInventoryLoadedMemoriesSection): string {
  if (!section.available) {
    return `## Memories Loaded This Turn\nUnavailable — ${section.message}`;
  }

  const parts: string[] = [`## Memories Loaded This Turn`];

  if (section.recap) {
    parts.push(`### Memory Recap`);
    parts.push(section.recap);
  }

  if (section.semanticMemories.length > 0) {
    parts.push(`### Relevant Memories (${section.semanticMemories.length})`);
    for (const m of section.semanticMemories) {
      parts.push(
        `- [importance ${m.importance.toFixed(2)}, score ${m.score.toFixed(2)}, weight ${m.effectiveWeight.toFixed(2)}] ${m.summary}`
      );
    }
  } else {
    parts.push(`### Relevant Memories\n(none loaded this turn)`);
  }

  if (section.interCharacterMemories.length > 0) {
    parts.push(`### Memories About Other Characters (${section.interCharacterMemories.length})`);
    for (const m of section.interCharacterMemories) {
      parts.push(`- About ${m.aboutCharacterName} [importance ${m.importance.toFixed(2)}]: ${m.summary}`);
    }
  }

  return parts.join('\n');
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

function formatCarinaSection(section: SelfInventoryCarinaSection): string {
  if (!section.available) {
    return `## Carina\nUnavailable — ${section.message}`;
  }

  const selfLine = section.selfEnabled
    ? `You ARE a Carina answerer — others can put quick questions to you with @YourName: (public) or @YourName? (whisper), and the ask_carina tool can route to you. Because you are an answerer, a Carina line opens to ANY character (a line opens when either side is an answerer), so you can reach everyone listed below. Queries reach the other party in isolation (no chat history), and the reply renders under the answerer's own avatar.`
    : `You are NOT a Carina answerer — you cannot be addressed with @-queries or reached via the ask_carina tool. You can still reach the Carina answerers listed below (a line opens when either side is an answerer).`;

  let reachBlock: string;
  if (section.reachable.length === 0) {
    reachBlock = section.selfEnabled
      ? `Characters you can reach via Carina: (none — there are no other characters)`
      : `Carina answerers you can reach: (none)`;
  } else if (section.selfEnabled) {
    reachBlock = [
      `Characters you can reach via Carina (${section.reachable.length}):`,
      ...section.reachable.map(
        (r) => `- ${r.name}${r.isAnswerer ? ' (also a Carina answerer)' : ''}`
      ),
    ].join('\n');
  } else {
    reachBlock = [
      `Carina answerers you can reach (${section.reachable.length}):`,
      ...section.reachable.map((r) => `- ${r.name}`),
    ].join('\n');
  }

  return [`## Carina`, selfLine, ``, reachBlock].join('\n');
}

const RUNTIME_MODE_LABELS: Record<SelfInventoryRuntimeMode, string> = {
  'local-dev': 'Local (development)',
  'local-production': 'Local (production)',
  'docker': 'Docker',
  'vm': 'VM (Lima/WSL2)',
  'electron': 'Electron desktop app',
  'electron-docker': 'Electron + Docker',
  'electron-vm': 'Electron + VM',
};

function formatQuilltapSection(section: SelfInventoryQuilltapSection): string {
  if (!section.available) {
    return `## Quilltap\nUnavailable — ${section.message ?? 'unknown error'}`;
  }

  const parts: string[] = [`## Quilltap`];

  if (section.includedParts.version) {
    parts.push(
      `Version: ${section.version}`,
      `Runtime: ${RUNTIME_MODE_LABELS[section.runtimeMode] ?? section.runtimeMode}`,
    );
    if (section.clientShell.type === 'electron') {
      parts.push(`Client: Electron shell v${section.clientShell.shellVersion}`);
    } else if (section.clientShell.type === 'browser') {
      parts.push(`Client: Web browser`);
    } else {
      parts.push(`Client: (unknown)`);
    }
  }

  if (section.includedParts.releaseNotes) {
    if (section.releaseNotes) {
      parts.push('', `### Release Notes (v${section.releaseNotesVersion})`, section.releaseNotes);
    } else {
      parts.push('', `### Release Notes`, '(no release notes found for this version)');
    }
  }

  if (section.includedParts.changelog) {
    if (section.changelog) {
      parts.push('', `### Changelog`, section.changelog);
    } else {
      parts.push('', `### Changelog`, '(changelog not available)');
    }
  }

  return parts.join('\n');
}

function formatContextChat(chat: SelfInventoryContextChat): string {
  if (!chat.available) {
    return `### This Chat\nUnavailable — ${chat.message ?? 'unknown error'}`;
  }
  return [`### This Chat`, `- Name: ${chat.title ?? '(untitled)'}`, `- ID: ${chat.chatId}`].join('\n');
}

function formatContextProject(project: SelfInventoryContextProject): string {
  if (!project.available) {
    return `### Project\nUnavailable — ${project.message}`;
  }
  if (!project.present) {
    return `### Project\n(this chat is not part of a project)`;
  }
  const stores =
    project.mountPoints.length > 0
      ? project.mountPoints.map((m) => m.name).join(', ')
      : '(none)';
  return [
    `### Project`,
    `- Name: ${project.name}`,
    `- ID: ${project.id}`,
    `- Linked stores: ${stores}`,
  ].join('\n');
}

function formatContextGroups(groups: SelfInventoryContextGroups): string {
  if (!groups.available) {
    return `### Your Groups\nUnavailable — ${groups.message}`;
  }
  if (groups.groups.length === 0) {
    return `### Your Groups\n(you are not a member of any groups)`;
  }
  const lines = groups.groups.map((g) => {
    const stores = g.mountPoints.length > 0 ? g.mountPoints.map((m) => m.name).join(', ') : '(none)';
    return `- ${g.name} (id: ${g.id}) — linked stores: ${stores}`;
  });
  return [`### Your Groups`, ...lines].join('\n');
}

function formatContextCharacters(characters: SelfInventoryContextCharacters): string {
  if (!characters.available) {
    return `### Characters Present\nUnavailable — ${characters.message}`;
  }
  if (characters.characters.length === 0) {
    return `### Characters Present\n(no other characters are present in this chat)`;
  }
  const lines = characters.characters.map((c) => {
    const personaTag = c.isUserPersona ? ' (user persona)' : '';
    const aliasTag = c.aliases.length > 0 ? ` [aka ${c.aliases.join(', ')}]` : '';
    const identityLine = c.identity ? `\n    Identity: ${c.identity}` : '';
    return `- ${c.name}${personaTag}${aliasTag} (id: ${c.id})${identityLine}`;
  });
  return [`### Characters Present`, ...lines].join('\n');
}

function formatContextFiles(files: SelfInventoryContextFiles): string {
  if (!files.available) {
    return `### Attached Files\nUnavailable — ${files.message}`;
  }
  if (files.files.length === 0) {
    return `### Attached Files\n(no files are attached to this chat)`;
  }
  const lines = files.files.map((f) => {
    const title = f.displayTitle ? ` "${f.displayTitle}"` : '';
    const mountTag = f.mountPoint ? `, mount_point=${f.mountPoint}` : '';
    return `- ${f.filePath}${title} [scope=${f.scope}${mountTag}]\n    Reach it: ${f.howToReach}`;
  });
  return [`### Attached Files`, ...lines].join('\n');
}

function formatContextSection(section: SelfInventoryContextSection): string {
  const parts: string[] = [`## Context`];
  if (section.chat) parts.push('', formatContextChat(section.chat));
  if (section.project) parts.push('', formatContextProject(section.project));
  if (section.groups) parts.push('', formatContextGroups(section.groups));
  if (section.characters) parts.push('', formatContextCharacters(section.characters));
  if (section.files) parts.push('', formatContextFiles(section.files));
  return parts.join('\n');
}

export function formatSelfInventoryResults(output: SelfInventoryToolOutput): string {
  if (!output.success) {
    return `You are running on Quilltap v${output.quilltapVersion}.\n\nSelf-Inventory Error: ${output.error ?? 'Unknown error'}`;
  }

  const lines = [
    `You are running on Quilltap v${output.quilltapVersion}.`,
    ``,
    `# Self-Inventory Report`,
    `Character: ${output.characterName} (id: ${output.characterId})`,
  ];

  if (output.vault) {
    lines.push('', formatVaultSection(output.vault));
  }
  if (output.vaultAccess) {
    lines.push('', formatVaultAccessSection(output.vaultAccess));
  }
  if (output.memory) {
    lines.push('', formatMemorySection(output.memory));
  }
  if (output.loadedMemories) {
    lines.push('', formatLoadedMemoriesSection(output.loadedMemories));
  }
  if (output.chats) {
    lines.push('', formatChatsSection(output.chats));
  }
  if (output.prompt) {
    lines.push('', formatPromptSection(output.prompt));
  }
  if (output.lastTurn) {
    lines.push('', formatLastTurnSection(output.lastTurn));
  }
  if (output.carina) {
    lines.push('', formatCarinaSection(output.carina));
  }
  if (output.quilltap) {
    lines.push('', formatQuilltapSection(output.quilltap));
  }
  if (output.context) {
    lines.push('', formatContextSection(output.context));
  }

  return lines.join('\n');
}
