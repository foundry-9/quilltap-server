import { WARDROBE_SLOT_TYPES, isSlotReportedWhenEmpty, makeEmptyEquippedSlots } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';
import { describeOutfit } from '@/lib/wardrobe/outfit-description';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';
import { notifyWardrobeChanged } from '@/lib/wardrobe/outfit-change-effects';
import { loadWearablePool, type WearablePool } from '@/lib/wardrobe/pool';
import { getRepositories } from '@/lib/repositories/factory';

export { wardrobeItemNotFoundMessage } from '@/lib/wardrobe/wear-ops';

/**
 * The context every `wardrobe_*` tool runs in. The executor builds it once
 * from the tool-execution context, so the turn's announcement set reaches
 * every tool that changes an outfit — none can be the one that forgets it.
 */
export interface WardrobeToolContext {
  userId: string;
  chatId: string;
  characterId: string;
  /** Per-turn announcement queue the orchestrator threads through. */
  pendingWardrobeAnnouncements?: Set<string>;
}

/** The full repository container the wardrobe tool handlers operate on. */
export type WardrobeRepos = ReturnType<typeof getRepositories>;

/**
 * Sentinels an LLM sometimes emits for "no item". Treated as undefined so a
 * stray `item_id: "none"` doesn't get looked up as a real id.
 */
const NO_ITEM_SENTINELS = new Set(['none', 'null', '']);

export function normalizeNoItemSentinel(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return NO_ITEM_SENTINELS.has(value.trim().toLowerCase()) ? undefined : value;
}

/**
 * The wearable pool a character's tool call sees: their own vault, their
 * groups' stores, the chat's project stores (behind the project roster), and
 * Quilltap General. One read per tier for the whole tool call.
 */
export function loadToolPool(
  repos: WardrobeRepos,
  chatId: string,
  characterId: string,
): Promise<WearablePool> {
  return loadWearablePool(repos, characterId, undefined, { chatId });
}

/**
 * Find every slot the item is equipped in. Slots are arrays, so a single item
 * can occupy multiple slots (a multi-slot dress) and we want them all.
 */
export function findEquippedSlots(
  itemId: string,
  equippedSlots: EquippedSlots | null,
): string[] {
  if (!equippedSlots) return [];
  const slots: string[] = [];
  for (const slot of WARDROBE_SLOT_TYPES) {
    if ((equippedSlots[slot] ?? []).includes(itemId)) {
      slots.push(slot);
    }
  }
  return slots;
}

/**
 * What a wardrobe mutation did to the slots it touched, reported back to the
 * LLM so it knows whether existing items survived.
 *
 *   - `layered`  — the item was added on top; whatever was already in those
 *                  slots stayed (the item's `replace` flag is off).
 *   - `replaced` — those slots were cleared and set to just this item.
 *   - `removed`  — a named item was taken off; any other layers stayed.
 *   - `cleared`  — the slot(s) were emptied entirely.
 */
export type WardrobeEffect = 'layered' | 'replaced' | 'removed' | 'cleared';

/**
 * One-sentence, model-facing description of what a wardrobe mutation just did.
 * Phrased identically across the wardrobe tools so the LLM gets a consistent
 * read on layer-vs-replace.
 */
export function describeWardrobeEffect(
  effect: WardrobeEffect,
  slots: readonly string[],
  itemTitle?: string | null,
): string {
  const slotList = slots.length > 0 ? slots.join(', ') : 'the slot';
  const those = slots.length > 1 ? 'those slots' : 'that slot';
  const title = itemTitle ? `"${itemTitle}"` : 'the item';
  switch (effect) {
    case 'layered':
      return `Layered ${title} into ${slotList}. The item's replace flag is off, so whatever was already in ${those} was kept.`;
    case 'replaced':
      return `Replaced ${slotList} with ${title} — anything previously in ${those} was cleared.`;
    case 'removed':
      return itemTitle
        ? `Took ${title} off ${slotList}; any other layers there stayed.`
        : `Cleared ${slotList}.`;
    case 'cleared':
      return `Cleared ${slotList} entirely.`;
  }
}

/**
 * The shape shared by `wardrobe_wear` / `wardrobe_take_off` outputs, as far as
 * the context formatter cares.
 */
interface WardrobeMutationOutput {
  success: boolean;
  operations: Array<{ error?: string; effect_summary?: string }>;
  current_state: EquippedSlots;
  coverage_summary: string;
  error?: string;
}

/**
 * Render the equipped state as indented per-slot lines for LLM-facing output.
 * Shared by the mutation formatter below and the create handler so the slot
 * presentation (including the hair suppression rule) can never drift.
 */
export function formatEquippedSlotLines(state: EquippedSlots): string[] {
  const lines: string[] = [];
  for (const slotKey of WARDROBE_SLOT_TYPES) {
    const ids = state[slotKey] ?? [];
    // An unreported-if-blank slot (hair) is omitted entirely when empty rather
    // than listed as "(empty)" — the model must never read that as baldness.
    if (ids.length === 0 && !isSlotReportedWhenEmpty(slotKey)) continue;
    lines.push(`  ${slotKey}: ${ids.length === 0 ? '(empty)' : ids.join(', ')}`);
  }
  return lines;
}

/**
 * Format a wear/take-off result for conversation context: the per-operation
 * effect lines, then the resulting per-slot outfit, then the coverage summary.
 * Identical presentation for both tools so the LLM reads them the same way.
 */
export function formatWardrobeMutationResults(output: WardrobeMutationOutput): string {
  if (!output.success && output.operations.length === 0) {
    return `Wardrobe Error: ${output.error || 'Unknown error'}`;
  }

  const lines: string[] = [];
  for (const op of output.operations) {
    if (op.error) {
      lines.push(`Failed: ${op.error}`);
    } else if (op.effect_summary) {
      lines.push(op.effect_summary);
    }
  }

  lines.push('');
  lines.push('Current outfit:');
  lines.push(...formatEquippedSlotLines(output.current_state));
  lines.push('');
  lines.push(`Summary: ${output.coverage_summary}`);

  return lines.join('\n');
}

/**
 * The validation-failure shape shared by `wardrobe_wear` / `wardrobe_take_off`:
 * no operations, an empty equipped state, and the error message.
 */
export function buildWardrobeMutationFailure(error: string): {
  success: false;
  operations: never[];
  current_state: EquippedSlots;
  coverage_summary: string;
  error: string;
} {
  return {
    success: false,
    operations: [],
    current_state: makeEmptyEquippedSlots(),
    coverage_summary: '',
    error,
  };
}

/**
 * Finalize a wear/take-off mutation: fire the outfit-change side effects ONCE
 * (only if at least one operation actually landed), then reload the equipped
 * state and coverage summary and assemble the tool output. Generic over the
 * per-operation result type so both tools share it.
 */
export async function finalizeWardrobeMutation<TOpResult>(
  repos: WardrobeRepos,
  context: {
    userId: string;
    chatId: string;
    characterId: string;
    pendingWardrobeAnnouncements?: Set<string>;
  },
  sourceContext: string,
  args: {
    appliedCount: number;
    results: TOpResult[];
    failedError: string | undefined;
    pool: WearablePool;
  },
): Promise<{
  success: boolean;
  operations: TOpResult[];
  current_state: EquippedSlots;
  coverage_summary: string;
  error?: string;
}> {
  if (args.appliedCount > 0) {
    await notifyWardrobeChanged(repos, context, sourceContext);
  }

  const currentState = await loadCurrentWardrobeState(repos, context.chatId, context.characterId);
  const coverageSummary = buildWardrobeCoverageSummaryFromState(args.pool, currentState);

  return {
    success: args.failedError === undefined,
    operations: args.results,
    current_state: currentState,
    coverage_summary: coverageSummary,
    ...(args.failedError ? { error: args.failedError } : {}),
  };
}

export async function loadCurrentWardrobeState(
  repos: Pick<WardrobeRepos, 'chats'>,
  chatId: string,
  characterId: string,
): Promise<EquippedSlots> {
  const equippedOutfit = await repos.chats.getEquippedOutfitForCharacter(chatId, characterId);
  return equippedOutfit ?? makeEmptyEquippedSlots();
}

/**
 * Build the human-readable `coverage_summary` returned to the LLM in wardrobe
 * tool results — the same canonical resolution Aurora uses (composites
 * expanded, multi-slot items routed by their own `types`).
 */
export function buildWardrobeCoverageSummaryFromState(pool: WearablePool, slots: EquippedSlots): string {
  return describeOutfit(resolveEquippedOutfitForCharacter(pool, slots).outfitValues);
}

/**
 * The refusal returned when the model tries to mutate a shared (project /
 * Quilltap General) wardrobe item. Phrased identically across
 * `wardrobe_update` (`verb: 'changed'`) and `wardrobe_archive`
 * (`verb: 'archived'`).
 */
export function sharedWardrobeItemReadOnlyMessage(
  title: string,
  verb: 'changed' | 'archived',
): string {
  return (
    `"${title}" is a shared wardrobe item — you can wear it but not edit or retire it. ` +
    `Only items in your own wardrobe can be ${verb}.`
  );
}
