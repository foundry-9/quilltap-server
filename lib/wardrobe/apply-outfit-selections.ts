/**
 * Apply Outfit Selections — Shared Helper
 *
 * Shared between the new-chat creation flow (`/api/v1/chats`) and the
 * add-participant flow (`/api/v1/chats/[id]?action=add-participant`).
 *
 * Resolves each character's `OutfitSelection` to a concrete `EquippedSlots`
 * record and persists it on the chat via `repos.chats.setEquippedOutfit`.
 *
 * Modes:
 * - `default`       — load wardrobe items marked default and equip them
 * - `manual`        — use the slot assignments provided on the selection
 * - `none`          — empty every slot (character starts undressed)
 * - `previous_chat` — copy from `context.sourceChatId` (continuation flow);
 *                     falls back to defaults when nothing is available
 * - `llm_choose`    — ask a cheap LLM to pick an outfit; falls back to defaults
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import type { EquippedSlots, OutfitSelection, WardrobeItem } from '@/lib/schemas/wardrobe.types';
import type { CheapLLMSettings } from '@/lib/schemas/settings.types';
import {
  getCheapLLMProvider,
  DEFAULT_CHEAP_LLM_CONFIG,
  type CheapLLMConfig,
} from '@/lib/llm/cheap-llm';
import { chooseLLMOutfit } from '@/lib/memory/cheap-llm-tasks/outfit-selection';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';
import type {
  CreationProgressEmitter,
  OutfitPreviewSlots,
} from '@/lib/chat/creation-progress';

type Repos = RepositoryContainer;

/**
 * Context needed for LLM-based outfit selection during chat creation or
 * participant addition.
 */
export interface OutfitSelectionContext {
  userId: string;
  scenarioText?: string | null;
  cheapLLMConfig?: CheapLLMConfig;
  /**
   * When the new chat is a continuation of an existing one, the source chat
   * ID flows through here so the `'previous_chat'` mode can copy each
   * character's equipped outfit forward. Falls back to default outfit when
   * the source chat has nothing equipped for a given character (e.g. a
   * newly-joined participant).
   */
  sourceChatId?: string | null;
  /**
   * Optional progress emitter for the chat-creation status dialog. Only the
   * `llm_choose` mode narrates (it's the slow, LLM-backed path): it announces
   * "consulting the wardrobe for <name>" before the call and publishes the
   * decided four-slot outfit afterwards. Inert when absent.
   */
  progress?: CreationProgressEmitter;
}

/**
 * Map a resolved outfit's per-slot leaf items into the lightweight preview DTO
 * the status dialog renders (no full `WardrobeItem` payloads over the wire).
 */
function toOutfitPreviewSlots(leafItemsBySlot: {
  top: WardrobeItem[];
  bottom: WardrobeItem[];
  footwear: WardrobeItem[];
  accessories: WardrobeItem[];
}): OutfitPreviewSlots {
  const map = (items: WardrobeItem[]) =>
    items.map((i) => ({
      id: i.id,
      title: i.title,
      isComposite: (i.componentItemIds?.length ?? 0) > 0,
    }));
  return {
    top: map(leafItemsBySlot.top),
    bottom: map(leafItemsBySlot.bottom),
    footwear: map(leafItemsBySlot.footwear),
    accessories: map(leafItemsBySlot.accessories),
  };
}

/**
 * Resolve the default outfit for a character from their wardrobe items marked as default.
 * Each default item's coverage types receive the item's ID appended to the slot's array.
 * Multiple defaults may share a slot (e.g. layered tops, several accessories) — order is
 * deterministic by `createdAt` ascending.
 */
export async function resolveDefaultOutfit(
  characterId: string,
  repos: Repos,
): Promise<EquippedSlots> {
  const defaultItems = await repos.wardrobe.findDefaultsForCharacter(characterId);

  if (defaultItems.length === 0) {
    return {
      top: [],
      bottom: [],
      footwear: [],
      accessories: [],
    };
  }

  const slots: EquippedSlots = {
    top: [],
    bottom: [],
    footwear: [],
    accessories: [],
  };

  // Deterministic order: oldest default first. Items lacking createdAt sort to the end.
  const orderedDefaults = [...defaultItems].sort((a, b) => {
    const aTime = a.createdAt ? Date.parse(a.createdAt) : Number.POSITIVE_INFINITY;
    const bTime = b.createdAt ? Date.parse(b.createdAt) : Number.POSITIVE_INFINITY;
    return aTime - bTime;
  });

  for (const item of orderedDefaults) {
    for (const slotType of item.types) {
      if (slotType in slots) {
        slots[slotType as keyof EquippedSlots].push(item.id);
      }
    }
  }

  return slots;
}

/**
 * Apply outfit selections to a chat.
 * Processes each selection based on its mode:
 * - 'default': Load default wardrobe items and append each to the slots it covers
 * - 'manual': Use the provided slot assignments directly (already arrays)
 * - 'none': Set every slot to an empty array
 * - 'previous_chat': Copy equipped state from the source chat (continuation flow)
 * - 'llm_choose': Ask a cheap LLM to pick an outfit, fall back to defaults on failure
 */
export async function applyOutfitSelections(
  chatId: string,
  selections: OutfitSelection[],
  repos: Repos,
  context?: OutfitSelectionContext,
): Promise<void> {
  for (const selection of selections) {
    const { characterId, mode } = selection;

    switch (mode) {
      case 'default': {
        const slots = await resolveDefaultOutfit(characterId, repos);
        await repos.chats.setEquippedOutfit(chatId, characterId, slots);
        break;
      }

      case 'manual': {
        const slots: EquippedSlots = selection.slots ?? {
          top: [],
          bottom: [],
          footwear: [],
          accessories: [],
        };
        await repos.chats.setEquippedOutfit(chatId, characterId, slots);
        break;
      }

      case 'none': {
        await repos.chats.setEquippedOutfit(chatId, characterId, {
          top: [],
          bottom: [],
          footwear: [],
          accessories: [],
        });
        break;
      }

      case 'previous_chat': {
        let applied = false;
        if (context?.sourceChatId) {
          try {
            const previousSlots = await repos.chats.getEquippedOutfitForCharacter(
              context.sourceChatId,
              characterId,
            );
            if (previousSlots) {
              await repos.chats.setEquippedOutfit(chatId, characterId, previousSlots);
              applied = true;
            }
          } catch (error) {
            logger.warn('[applyOutfitSelections] Failed to copy previous-chat outfit; falling back to default', {
              chatId,
              characterId,
              sourceChatId: context.sourceChatId,
              error: getErrorMessage(error, 'Unknown error'),
            });
          }
        } else {
          logger.warn('[applyOutfitSelections] previous_chat outfit mode requested without sourceChatId; falling back to default', {
            chatId,
            characterId,
          });
        }
        if (!applied) {
          const slots = await resolveDefaultOutfit(characterId, repos);
          await repos.chats.setEquippedOutfit(chatId, characterId, slots);
        }
        break;
      }

      case 'llm_choose': {
        let applied = false;
        // Track whether we announced a consult so the fallback path can still
        // resolve the dialog's panel instead of leaving it spinning.
        let consulted = false;
        let consultedName = '';

        if (context) {
          try {
            const character = await repos.characters.findById(characterId);
            const wardrobeItems = await repos.wardrobe.findByCharacterId(characterId);

            if (character && wardrobeItems.length > 0) {
              const allProfiles = await repos.connections.findAll();
              const defaultProfile = allProfiles.find((p) => p.isDefault) || allProfiles[0];

              if (defaultProfile) {
                const cheapSelection = getCheapLLMProvider(
                  defaultProfile,
                  context.cheapLLMConfig || DEFAULT_CHEAP_LLM_CONFIG,
                  allProfiles,
                  false, // ollamaAvailable
                );

                // Narrate the slow bit: the dialog shows "Consulting the
                // wardrobe for <name>…" until the result lands.
                consulted = true;
                consultedName = character.name;
                context.progress?.wardrobeStart(characterId, character.name);

                const result = await chooseLLMOutfit(
                  character.name,
                  character.description || null,
                  character.personality || null,
                  character.manifesto || null,
                  wardrobeItems,
                  context.scenarioText || null,
                  cheapSelection,
                  context.userId,
                  chatId,
                  characterId,
                );

                if (result.success && result.result) {
                  await repos.chats.setEquippedOutfit(chatId, characterId, result.result);
                  applied = true;

                  // Publish the decided four-slot outfit for the status dialog.
                  if (context.progress) {
                    try {
                      const resolved = await resolveEquippedOutfitForCharacter(
                        repos,
                        characterId,
                        result.result,
                      );
                      context.progress.wardrobeResult(
                        characterId,
                        character.name,
                        toOutfitPreviewSlots(resolved.leafItemsBySlot),
                      );
                    } catch (resolveError) {
                      logger.warn('[applyOutfitSelections] Failed to resolve outfit for progress preview', {
                        chatId,
                        characterId,
                        error: getErrorMessage(resolveError, 'Unknown error'),
                      });
                    }
                  }
                } else {
                  logger.warn('[applyOutfitSelections] LLM outfit selection failed, falling back to defaults', {
                    chatId,
                    characterId,
                    error: result.error,
                  });
                }
              }
            }
          } catch (error) {
            logger.warn('[applyOutfitSelections] Error during LLM outfit selection, falling back to defaults', {
              chatId,
              characterId,
              error: getErrorMessage(error, 'Unknown error'),
            });
          }
        }

        if (!applied) {
          const slots = await resolveDefaultOutfit(characterId, repos);
          await repos.chats.setEquippedOutfit(chatId, characterId, slots);

          // If we already told the dialog we were consulting this character,
          // resolve their panel with the default we fell back to (and note it).
          if (consulted && context?.progress) {
            context.progress.log(
              `${consultedName} settled on their usual attire.`,
              'warn',
            );
            try {
              const resolved = await resolveEquippedOutfitForCharacter(repos, characterId, slots);
              context.progress.wardrobeResult(
                characterId,
                consultedName,
                toOutfitPreviewSlots(resolved.leafItemsBySlot),
              );
            } catch (resolveError) {
              logger.warn('[applyOutfitSelections] Failed to resolve fallback outfit for progress preview', {
                chatId,
                characterId,
                error: getErrorMessage(resolveError, 'Unknown error'),
              });
            }
          }
        }
        break;
      }

      default:
        logger.warn('[applyOutfitSelections] Unknown outfit selection mode', { chatId, characterId, mode });
        break;
    }
  }
}

/**
 * Build a CheapLLMConfig from a chatSettings row (or fall back to defaults).
 * Shared so callers don't have to repeat the same merge.
 */
export function buildCheapLLMConfig(
  chatSettings: { cheapLLMSettings?: CheapLLMSettings | null } | null | undefined,
): CheapLLMConfig {
  const settings = chatSettings?.cheapLLMSettings;
  if (!settings) return DEFAULT_CHEAP_LLM_CONFIG;
  return {
    ...DEFAULT_CHEAP_LLM_CONFIG,
    strategy: settings.strategy,
    fallbackToLocal: settings.fallbackToLocal,
    userDefinedProfileId: settings.userDefinedProfileId ?? undefined,
    defaultCheapProfileId: settings.defaultCheapProfileId ?? undefined,
  };
}
