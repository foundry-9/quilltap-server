/**
 * The Green Room's inventory pass — what a character chooses to carry into
 * a scene.
 *
 * When the operator lets a character choose their own opening outfit
 * (`llm_choose`), the Green Room also looks over the objects the character
 * can reach and decides, against the scenario, their nature, the seat's
 * subprompts and what they have just put on, which of them they walk in
 * with. The decision is a plain list of ids; {@link applyInventoryDefaults}
 * equips it at arrival (leniently, silently), and falls back to the
 * equipped-by-default objects when this returns `null`.
 *
 * What is offered is the character's own reach: carriable objects and kits,
 * never archetypes or archived objects, and nothing from the project's shelf
 * when the project's roster does not admit them (`roster-gate.ts`).
 *
 * Never throws: every failure is a `null` (use the defaults), logged.
 *
 * Server-only.
 *
 * @module lib/inventory/green-room
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import type { CreationProgressEmitter } from '@/lib/chat/creation-progress';
import { DEFAULT_CHEAP_LLM_CONFIG, type CheapLLMConfig } from '@/lib/llm/cheap-llm';
import { chooseLLMInventory } from '@/lib/memory/cheap-llm-tasks/inventory-selection';
import { resolveProjectMountPointIds } from '@/lib/mount-index/tiered-mount-pool';
import {
  GREEN_ROOM_LLM_TIMEOUT_MS,
  GREEN_ROOM_TIMED_OUT,
  resolveGreenRoomSubprompts,
  selectGreenRoomLLM,
  withGreenRoomTimeout,
} from '@/lib/wardrobe/green-room-model';
import { loadWearablePool } from '@/lib/wardrobe/pool';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';
import { WARDROBE_SLOT_TYPES } from '@/lib/schemas/wardrobe.types';
import type { EquipChat } from '@/lib/inventory/equip';
import { loadInventoryPool } from '@/lib/inventory/pool';
import { inventoryLabel } from '@/lib/inventory/resolve';
import { projectShelfOpenTo } from '@/lib/inventory/roster-gate';

/** Who the Green Room packs for, and what it knows about the scene. */
export interface InventoryGreenRoomOptions {
  /** The characters whose outfit mode is `llm_choose`. */
  characterIds: readonly string[];
  scenarioText?: string | null;
  cheapLLMConfig?: CheapLLMConfig;
  /** The chat-creation status dialog; inert when absent. */
  progress?: CreationProgressEmitter;
}

/** The objects a character may choose from: carriable objects and kits within their own reach. */
export function greenRoomCandidates(
  resolved: readonly ResolvedInventoryItem[],
  projectShelfOpen: boolean,
): ResolvedInventoryItem[] {
  return resolved.filter(
    (item) =>
      !item.isArchetype &&
      !item.archivedAt &&
      (projectShelfOpen || item.origin?.scope !== 'project'),
  );
}

/** What the character has on, by title, so the model can see what they have pockets in. Soft-fails to none. */
async function wornTitles(
  repos: RepositoryContainer,
  chat: EquipChat,
  characterId: string,
): Promise<string[]> {
  try {
    const slots = await repos.chats.getEquippedOutfitForCharacter(chat.id, characterId);
    if (!slots) return [];
    const pool = await loadWearablePool(repos, characterId, await resolveProjectMountPointIds(chat.projectId ?? null));
    const resolved = resolveEquippedOutfitForCharacter(pool, slots);
    const titles = new Set<string>();
    for (const slot of WARDROBE_SLOT_TYPES) {
      for (const item of resolved.leafItemsBySlot[slot] ?? []) titles.add(item.title);
    }
    return Array.from(titles);
  } catch (error) {
    logger.debug('[InventoryGreenRoom] Could not read the outfit for the inventory pass; continuing without', {
      chatId: chat.id,
      characterId,
      context: 'inventory',
      error: getErrorMessage(error, 'Unknown error'),
    });
    return [];
  }
}

/** A list of labels in prose: "a, b and c". */
function listing(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('');
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * Ask the Green Room which objects `characterId` carries into `chat`.
 * Returns the chosen ids (possibly none — empty-handed is a choice), or
 * `null` when the defaults should apply: nothing to choose from, no model,
 * a failed or unreadable answer, or the {@link GREEN_ROOM_LLM_TIMEOUT_MS}
 * deadline.
 */
export async function chooseArrivalInventory(
  repos: RepositoryContainer,
  chat: EquipChat,
  characterId: string,
  userId: string,
  opts: InventoryGreenRoomOptions,
): Promise<string[] | null> {
  let characterName = '';
  let consulted = false;
  try {
    const character = await repos.characters.findById(characterId);
    if (!character) return null;
    characterName = character.name;

    const pool = await loadInventoryPool(repos, { characterId, chatId: chat.id, projectId: chat.projectId ?? null });
    const shelfOpen = await projectShelfOpenTo(chat.projectId, characterId);
    const candidates = greenRoomCandidates(pool.resolved(), shelfOpen);
    if (candidates.length === 0) {
      logger.debug('[InventoryGreenRoom] Nothing within reach; the defaults stand', {
        chatId: chat.id,
        characterId,
        context: 'inventory',
      });
      return null;
    }

    const chosenModel = selectGreenRoomLLM(
      await repos.connections.findAll(),
      opts.cheapLLMConfig ?? DEFAULT_CHEAP_LLM_CONFIG,
    );
    if (!chosenModel) {
      logger.debug('[InventoryGreenRoom] No model for the Green Room; the defaults stand', {
        chatId: chat.id,
        characterId,
        context: 'inventory',
      });
      return null;
    }

    consulted = true;
    const [subprompts, wearing] = await Promise.all([
      resolveGreenRoomSubprompts(repos, chat.id, characterId),
      wornTitles(repos, chat, characterId),
    ]);

    const startedAt = Date.now();
    const result = await withGreenRoomTimeout(
      chooseLLMInventory({
        characterName: character.name,
        characterDescription: character.description || null,
        characterPersonality: character.personality || null,
        characterManifesto: character.manifesto || null,
        items: candidates,
        scenarioText: opts.scenarioText ?? null,
        selection: chosenModel.selection,
        userId,
        chatId: chat.id,
        characterId,
        subprompts,
        wearing,
      }),
    );

    if (result === GREEN_ROOM_TIMED_OUT) {
      logger.warn('[InventoryGreenRoom] Inventory choice timed out; the defaults stand', {
        chatId: chat.id,
        characterId,
        timeoutMs: GREEN_ROOM_LLM_TIMEOUT_MS,
        poolSize: candidates.length,
        context: 'inventory',
      });
    } else if (!result.success || !result.result) {
      logger.warn('[InventoryGreenRoom] Inventory choice failed; the defaults stand', {
        chatId: chat.id,
        characterId,
        error: result.error,
        poolSize: candidates.length,
        elapsedMs: Date.now() - startedAt,
        context: 'inventory',
      });
    } else {
      const ids = result.result.ids;
      const byId = new Map(candidates.map((item) => [item.id, item]));
      const labels = ids.map((id) => byId.get(id)).filter((item): item is ResolvedInventoryItem => !!item).map(inventoryLabel);
      logger.debug('[InventoryGreenRoom] The Green Room chose what to carry', {
        chatId: chat.id,
        characterId,
        chosen: ids,
        poolSize: candidates.length,
        source: chosenModel.source,
        elapsedMs: Date.now() - startedAt,
        context: 'inventory',
      });
      opts.progress?.log(
        labels.length > 0
          ? `${character.name} takes up ${listing(labels)}.`
          : `${character.name} walks on empty-handed.`,
        'info',
      );
      return ids;
    }
  } catch (error) {
    logger.warn('[InventoryGreenRoom] Error during the inventory choice; the defaults stand', {
      chatId: chat.id,
      characterId,
      context: 'inventory',
      error: getErrorMessage(error, 'Unknown error'),
    });
  }
  if (consulted) opts.progress?.log(`${characterName} gathers up their usual effects.`, 'warn');
  return null;
}
