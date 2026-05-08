/**
 * Shared avatar prompt builder.
 *
 * Builds the portrait prompt used by both the background avatar-generation
 * job and the dialog's "preview avatar" endpoint. Single source of truth for
 * the prompt shape; callers differ only in how they obtain `equippedSlots`.
 */

import type { Character } from '@/lib/schemas/character.types';
import type { EquippedSlots } from '@/lib/schemas/wardrobe.types';
import type { getRepositories } from '@/lib/repositories/factory';
import { describeOutfit } from '@/lib/wardrobe/outfit-description';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';

interface BuildPromptOptions {
  /**
   * Equipped slots to describe. When `null`/`undefined`, no outfit is
   * appended — the prompt relies on physical descriptions alone.
   */
  equippedSlots?: EquippedSlots | null;
}

interface BuildPromptResult {
  /** Final portrait prompt suitable for an image-generation provider. */
  prompt: string;
  /** Whether any appearance data (physical description or wardrobe) was found. */
  hasAppearance: boolean;
  /** Per-slot leaf counts after composite expansion (for logging/debug). */
  leafCounts: { top: number; bottom: number; footwear: number; accessories: number };
}

/**
 * Build the portrait prompt for a character, optionally including their
 * equipped outfit. Composites in `equippedSlots` are expanded to leaves and
 * decorated with `(description)` where present.
 */
export async function buildCharacterAvatarPrompt(
  repos: ReturnType<typeof getRepositories>,
  character: Character,
  options: BuildPromptOptions = {},
): Promise<BuildPromptResult> {
  const { equippedSlots } = options;

  const leafCounts = { top: 0, bottom: 0, footwear: 0, accessories: 0 };

  // Physical descriptions — use the first available variant, falling back
  // through the canonical fields the avatar handler has always favored.
  let physicalText = '';
  const physicalDescriptions = character.physicalDescriptions || [];
  if (physicalDescriptions.length > 0) {
    const desc = physicalDescriptions[0];
    physicalText = (
      desc.mediumPrompt ||
      desc.shortPrompt ||
      desc.longPrompt ||
      desc.completePrompt ||
      desc.fullDescription ||
      ''
    ).trim();
  }

  let outfitText = '';
  if (equippedSlots) {
    const resolved = await resolveEquippedOutfitForCharacter(repos, character.id, equippedSlots);
    const decorate = (items: { title: string; description?: string | null }[]): string[] =>
      items.map((i) => (i.description ? `${i.title} (${i.description})` : i.title));

    outfitText = describeOutfit({
      top: decorate(resolved.leafItemsBySlot.top),
      bottom: decorate(resolved.leafItemsBySlot.bottom),
      footwear: decorate(resolved.leafItemsBySlot.footwear),
      accessories: decorate(resolved.leafItemsBySlot.accessories),
    }).trimEnd();

    leafCounts.top = resolved.leafItemsBySlot.top.length;
    leafCounts.bottom = resolved.leafItemsBySlot.bottom.length;
    leafCounts.footwear = resolved.leafItemsBySlot.footwear.length;
    leafCounts.accessories = resolved.leafItemsBySlot.accessories.length;
  }

  const hasAppearance = Boolean(physicalText) || Boolean(outfitText);
  let prompt = '';
  if (hasAppearance) {
    const intro = `Solo portrait of a single person: ${character.name}. Show exactly one figure, head-and-shoulders crop, three-quarter view.`;
    const outro = `Character portrait, detailed, high quality, natural lighting. Only one person in the image.`;
    // Strip any trailing terminal punctuation off the physical description so
    // we don't end up with "background.." once we re-append a period.
    const physBlock = physicalText ? `${physicalText.replace(/[.!?]+$/, '')}.` : '';
    // Outfit is a markdown list (lines starting with "- "). Markdown renderers
    // need a blank line before the first list item, so the outfit block is
    // separated from neighboring paragraphs by `\n\n` on each side.
    const outfitBlock = outfitText ? `\n\n${outfitText}\n\n` : ' ';
    prompt = physBlock
      ? `${intro} ${physBlock}${outfitBlock}${outro}`
      : `${intro}${outfitBlock}${outro}`;
  }

  return { prompt, hasAppearance, leafCounts };
}
