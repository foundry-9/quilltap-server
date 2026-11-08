/**
 * Wardrobe image-prompt optimizer.
 *
 * Reads a character's own wardrobe garments (never shared tiers, never
 * archived pieces, never composite outfits — an outfit's cue is its leaves),
 * asks the cheap LLM to check each item's `imagePrompt` against its title,
 * slots and description, and returns recommendations: fill a blank cue,
 * revise one that disagrees with the description, or shorten one over the
 * {@link WARDROBE_IMAGE_PROMPT_MAX_LENGTH} cap. Nothing is written here — the
 * operator chooses which recommendations to apply, and the route writes them
 * through `updateItemImagePrompts` (`item-mutations.ts`).
 *
 * Items go to the model in small batches, numbered rather than by id so a
 * small model cannot mangle a UUID. A batch that fails is reported, not
 * retried; the rest still stand.
 *
 * @module lib/wardrobe/prompt-optimizer
 */

import type { LLMMessage } from '@/lib/llm/base';
import type { CheapLLMSelection } from '@/lib/llm/cheap-llm';
import { parseLLMJsonObject } from '@/lib/llm/llm-json';
import { logger } from '@/lib/logger';
import { executeCheapLLMTask } from '@/lib/memory/cheap-llm-tasks/core-execution';
import type { WardrobeItem, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import {
  clampWardrobeImagePrompt,
  WARDROBE_IMAGE_PROMPT_MAX_LENGTH,
} from '@/lib/wardrobe/image-prompt-limit';

const moduleLogger = logger.child({ module: 'wardrobe-prompt-optimizer' });

/** Cheap-LLM task type (filed under IMAGE_PROMPT_CRAFTING in the LLM logs). */
export const WARDROBE_PROMPT_OPTIMIZER_TASK = 'optimize-wardrobe-image-prompts';

/** Items per cheap-LLM call: small enough for a small model to keep straight. */
export const OPTIMIZER_BATCH_SIZE = 12;

/** Batches in flight at once. */
const OPTIMIZER_CONCURRENCY = 2;

/** Generous for a batch of a dozen short JSON entries. */
const OPTIMIZER_MAX_TOKENS = 3000;

/** Why an item's cue is recommended for change. */
export type PromptRecommendationKind = 'fill' | 'revise' | 'shorten';

export interface PromptRecommendation {
  itemId: string;
  title: string;
  types: WardrobeItemType[];
  /** The stored cue; null when blank. */
  currentPrompt: string | null;
  /** The recommended cue, already clamped to the cap. */
  proposedPrompt: string;
  kind: PromptRecommendationKind;
  /** The model's one-line reason (or ours, for a mechanical shorten). */
  reason: string;
}

export interface PromptOptimizationResult {
  /** How many items were examined. */
  examined: number;
  recommendations: PromptRecommendation[];
  /** Items whose batch failed, so the wizard can say what went unread. */
  failedItemIds: string[];
}

/**
 * The garments the optimizer reads: not archived, not a composite. Multi-slot
 * garments (a dress, a jumpsuit) are leaves and stay in.
 */
export function selectOptimizableItems(items: readonly WardrobeItem[]): WardrobeItem[] {
  return items.filter((item) => !item.archivedAt && (item.componentItemIds?.length ?? 0) === 0);
}

const SYSTEM_PROMPT = `You review the image-generation prompts of wardrobe items for a character.

Each item has a title, the slots it covers, a human-written description, and an "imagePrompt". The imagePrompt is fed directly to an image-generation (diffusion) model IN PLACE OF the title whenever the item is drawn, joined with other garments into a comma-separated outfit list.

A good imagePrompt:
- Is a short, literal visual phrase naming the garment itself — colour, material, cut, notable visible details — e.g. "ankle-length emerald silk evening gown with a plunging back and beaded straps".
- Agrees with the description: it must not contradict its colours, materials, cut or details, and should carry the description's most important visual facts.
- Is at most ${WARDROBE_IMAGE_PROMPT_MAX_LENGTH} characters.
- Is plain text: no Markdown, no quotation marks, no trailing full stop, no sentence about mood, story, history or who wears it.
- Describes only the item — never a person, body, pose, setting or lighting.

For EVERY item, decide:
- "keep" — the current imagePrompt is already good. Only allowed when it is non-empty, within the limit, and agrees with the description.
- "revise" — write a better imagePrompt. Always revise when the current one is empty, too long, contradicts the description, or leaves out what makes the item recognisable.

Do not revise for trivial wording preferences; a sound prompt should be kept.

Respond with ONLY a JSON object, no other text:
{"items": [{"n": 1, "verdict": "keep"}, {"n": 2, "verdict": "revise", "imagePrompt": "...", "reason": "short reason"}]}`;

function describeItemForModel(item: WardrobeItem, n: number): string {
  const prompt = item.imagePrompt?.trim() ? item.imagePrompt.trim() : '(empty)';
  const description = item.description?.trim() ? item.description.trim() : '(none)';
  return [
    `Item ${n}`,
    `title: ${item.title}`,
    `slots: ${item.types.join(', ')}`,
    `description: ${description}`,
    `imagePrompt (${item.imagePrompt?.trim().length ?? 0} chars): ${prompt}`,
  ].join('\n');
}

export function buildOptimizerMessages(batch: readonly WardrobeItem[]): LLMMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    {
      role: 'user',
      content: `Review these ${batch.length} wardrobe items:\n\n${batch
        .map((item, i) => describeItemForModel(item, i + 1))
        .join('\n\n')}`,
    },
  ];
}

interface RawVerdict {
  n?: unknown;
  verdict?: unknown;
  imagePrompt?: unknown;
  reason?: unknown;
}

/**
 * Turn one batch's answer into recommendations. A blank or over-long cue is
 * always recommended for change: a blank one the model failed to fill is
 * left out (it could not be fixed), an over-long one it kept is clamped.
 */
export function parseOptimizerResponse(
  content: string,
  batch: readonly WardrobeItem[],
): PromptRecommendation[] {
  const parsed = parseLLMJsonObject<{ items?: RawVerdict[] }>(content);
  const verdicts = Array.isArray(parsed?.items) ? parsed.items : [];
  const byNumber = new Map<number, RawVerdict>();
  for (const verdict of verdicts) {
    const n = typeof verdict?.n === 'number' ? verdict.n : Number(verdict?.n);
    if (Number.isInteger(n) && n >= 1 && n <= batch.length && !byNumber.has(n)) byNumber.set(n, verdict);
  }

  const recommendations: PromptRecommendation[] = [];
  batch.forEach((item, i) => {
    const current = item.imagePrompt?.trim() ? item.imagePrompt.trim() : null;
    const verdict = byNumber.get(i + 1);
    const proposedRaw = verdict?.verdict === 'revise' && typeof verdict.imagePrompt === 'string'
      ? clampWardrobeImagePrompt(verdict.imagePrompt)
      : '';
    const reason = typeof verdict?.reason === 'string' ? verdict.reason.trim() : '';

    const base = { itemId: item.id, title: item.title, types: item.types, currentPrompt: current };

    if (proposedRaw && proposedRaw !== current) {
      recommendations.push({
        ...base,
        proposedPrompt: proposedRaw,
        kind: current === null ? 'fill' : current.length > WARDROBE_IMAGE_PROMPT_MAX_LENGTH ? 'shorten' : 'revise',
        reason: reason || (current === null ? 'No prompt yet.' : 'Better matches the description.'),
      });
      return;
    }

    // The model kept (or skipped) a cue that breaks the length rule.
    if (current && current.length > WARDROBE_IMAGE_PROMPT_MAX_LENGTH) {
      recommendations.push({
        ...base,
        proposedPrompt: clampWardrobeImagePrompt(current),
        kind: 'shorten',
        reason: `Over the ${WARDROBE_IMAGE_PROMPT_MAX_LENGTH}-character limit; trimmed.`,
      });
      return;
    }

    if (current === null) {
      moduleLogger.debug('[PromptOptimizer] Model left a blank prompt unfilled', { itemId: item.id });
    }
  });
  return recommendations;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface OptimizeWardrobeImagePromptsInput {
  items: readonly WardrobeItem[];
  selection: CheapLLMSelection;
  userId: string;
  characterId: string;
}

/**
 * Review every optimizable item and return the recommended changes.
 */
export async function optimizeWardrobeImagePrompts(
  input: OptimizeWardrobeImagePromptsInput,
): Promise<PromptOptimizationResult> {
  const items = selectOptimizableItems(input.items);
  const batches = chunk(items, OPTIMIZER_BATCH_SIZE);
  moduleLogger.debug('[PromptOptimizer] Starting review', {
    characterId: input.characterId,
    items: items.length,
    batches: batches.length,
    provider: input.selection.provider,
    model: input.selection.modelName,
  });

  const recommendations: PromptRecommendation[][] = new Array(batches.length);
  const failedItemIds: string[] = [];
  let next = 0;

  const worker = async () => {
    while (next < batches.length) {
      const index = next++;
      const batch = batches[index];
      const result = await executeCheapLLMTask(
        input.selection,
        buildOptimizerMessages(batch),
        input.userId,
        (content) => parseOptimizerResponse(content, batch),
        WARDROBE_PROMPT_OPTIMIZER_TASK,
        undefined,
        undefined,
        undefined,
        OPTIMIZER_MAX_TOKENS,
        input.characterId,
        { latency: 'interactive' },
      );
      if (result.success && result.result) {
        recommendations[index] = result.result;
      } else {
        recommendations[index] = [];
        failedItemIds.push(...batch.map((item) => item.id));
        moduleLogger.warn('[PromptOptimizer] Batch failed', {
          characterId: input.characterId,
          batch: index,
          size: batch.length,
          error: result.error,
        });
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(OPTIMIZER_CONCURRENCY, batches.length) }, worker));

  const flat = recommendations.flat();
  moduleLogger.info('[PromptOptimizer] Review complete', {
    characterId: input.characterId,
    examined: items.length,
    recommended: flat.length,
    failed: failedItemIds.length,
  });
  return { examined: items.length, recommendations: flat, failedItemIds };
}
