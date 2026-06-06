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
import { describeOutfit, decorateOutfitItems } from '@/lib/wardrobe/outfit-description';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';

interface BuildPromptOptions {
  /**
   * Equipped slots to describe. When `null`/`undefined`, no outfit is
   * appended — the prompt relies on physical descriptions alone.
   */
  equippedSlots?: EquippedSlots | null;
  /**
   * Project document stores in scope, so equipped items that live in a project
   * store (not just the character vault or Quilltap General) resolve. Omit when
   * there is no project context (two-tier fallback).
   */
  projectMountPointIds?: string[];
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
  const projectMountPointIds = options.projectMountPointIds;

  const leafCounts = { top: 0, bottom: 0, footwear: 0, accessories: 0 };

  // Physical description — fall back through the canonical fields the avatar
  // handler has always favored.
  let physicalText = '';
  const desc = character.physicalDescription;
  if (desc) {
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
    // Avatars are head-and-shoulders only. We pass the FULL equipped slots in
    // so the resolver can route coverage by each leaf's own `types` — an item
    // sitting in slots.bottom whose types include "top" still bubbles up into
    // the rendered top. We then `omit` bottom/footwear at render time so the
    // image generator doesn't paste shoes/pants onto a cropped torso.
    const resolved = await resolveEquippedOutfitForCharacter(repos, character.id, equippedSlots, {
      projectMountPointIds,
    });

    outfitText = describeOutfit({
      top: decorateOutfitItems(resolved.leafItemsBySlot.top, { titleOnly: true }),
      bottom: decorateOutfitItems(resolved.leafItemsBySlot.bottom, { titleOnly: true }),
      footwear: decorateOutfitItems(resolved.leafItemsBySlot.footwear, { titleOnly: true }),
      accessories: decorateOutfitItems(resolved.leafItemsBySlot.accessories, { titleOnly: true }),
    }, { omit: ['bottom', 'footwear'] }).trimEnd();

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
