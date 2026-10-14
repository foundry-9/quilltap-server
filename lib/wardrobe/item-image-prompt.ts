/**
 * Wardrobe item picture prompt.
 *
 * Builds the image-generation prompt for one wardrobe item or outfit:
 *
 *   - **Worn** — a character-owned item is drawn on its owner: the same
 *     identity block the avatar portrait opens with (`buildFigureIdentityBlock`),
 *     full length, the garment the point of the picture. A hair-slot item is
 *     framed head and shoulders instead.
 *   - **Catalogue** — a shared item (General, project, group) has no owner and
 *     is drawn alone: on a dress form or laid flat, no person.
 *
 * The cue per garment is `imagePrompt ?? title` (via `decorateOutfitItems`
 * with `titleOnly`), the rule every image pipeline follows; the Markdown
 * `description` never reaches a diffusion model. An outfit's cue is its
 * resolved leaves, phrased per slot through `describeOutfit` — empty slots are
 * omitted, so an ensemble without shoes is never told it is barefoot.
 *
 * @module lib/wardrobe/item-image-prompt
 */

import type { Character } from '@/lib/schemas/character.types';
import {
  WARDROBE_SLOT_TYPES,
  type WardrobeItem,
  type WardrobeItemType,
} from '@/lib/schemas/wardrobe.types';
import { resolveAesthetic } from '@/lib/image-gen/aesthetic';
import { buildFigureIdentityBlock, soloFigureIntro, withArtDirection } from '@/lib/image-gen/avatar-prompt';
import {
  buildOutfitSlotValues,
  decorateOutfitItems,
  describeOutfit,
} from '@/lib/wardrobe/outfit-description';

export type WardrobeImageSubject = 'worn' | 'catalogue';
export type WardrobeImageOrientation = 'portrait' | 'square';

export interface WardrobeItemImagePromptInput {
  item: WardrobeItem;
  /** Resolved leaves for a composite; `[]` for a garment. */
  components: WardrobeItem[];
  /** The wearer; null (or archived) → catalogue shot. */
  owner: Pick<Character, 'name' | 'physicalDescription' | 'pronouns' | 'archivedAt'> | null;
  /** The project's official store, for the project-tier aesthetic. */
  projectOfficialMountPointId?: string | null;
}

export interface WardrobeItemImagePrompt {
  prompt: string;
  orientation: WardrobeImageOrientation;
  subject: WardrobeImageSubject;
}

/** The first canonical slot an item covers — where it is listed in an outfit cue. */
function primarySlot(item: Pick<WardrobeItem, 'types'>): WardrobeItemType {
  return WARDROBE_SLOT_TYPES.find((slot) => item.types.includes(slot)) ?? 'accessories';
}

/** True when every slot the item (or its leaves) covers is hair. */
function isHairOnly(items: ReadonlyArray<Pick<WardrobeItem, 'types'>>): boolean {
  return items.length > 0 && items.every((i) => i.types.length > 0 && i.types.every((t) => t === 'hair'));
}

/**
 * The visual cue for the item: one garment's `imagePrompt ?? title`, or an
 * outfit's leaves listed per slot in canonical order.
 */
export function buildWardrobeItemCue(item: WardrobeItem, components: readonly WardrobeItem[]): string {
  if (components.length === 0) {
    return decorateOutfitItems([item], { titleOnly: true })[0];
  }

  const bySlot = buildOutfitSlotValues((slot) =>
    decorateOutfitItems(components.filter((c) => primarySlot(c) === slot), { titleOnly: true }),
  );
  const omit = WARDROBE_SLOT_TYPES.filter((slot) => bySlot[slot].length === 0);
  return describeOutfit(bySlot, { omit }).trimEnd();
}

/**
 * Build the prompt, orientation and subject for an item's picture.
 */
export async function buildWardrobeItemImagePrompt(
  input: WardrobeItemImagePromptInput,
): Promise<WardrobeItemImagePrompt> {
  const { item, components, owner } = input;
  const cue = buildWardrobeItemCue(item, components);
  const isOutfit = components.length > 0;
  // An outfit's cue is a Markdown list; a garment's is a phrase. Lists need a
  // blank line either side to stay lists.
  const cueInline = isOutfit ? `the following ensemble:\n\n${cue}\n\n` : `${cue}. `;
  const hairOnly = isHairOnly(isOutfit ? components : [item]);

  let prompt: string;
  let orientation: WardrobeImageOrientation;
  let subject: WardrobeImageSubject;

  if (owner && !owner.archivedAt) {
    subject = 'worn';
    orientation = 'portrait';
    const figure = buildFigureIdentityBlock(owner, hairOnly ? 'head-and-shoulders' : 'full-length');
    const framing = hairOnly
      ? 'Head-and-shoulders portrait, facing the viewer, showing the hairstyle clearly'
      : 'Full-length, standing, facing the viewer, head to toe in frame';
    const intro = `${soloFigureIntro('picture', figure.subjectNoun, owner.name)}. ${framing}.`;
    const physBlock = figure.physBlock ? ` ${figure.physBlock}` : '';
    const wearing = hairOnly ? `Wearing their hair as ${cueInline}` : `Wearing ${cueInline}`;
    const rest = hairOnly
      ? 'The hairstyle is the subject; neutral studio backdrop; even light.'
      : 'The rest of the attire plain and unremarkable so the garment is the subject; neutral studio backdrop; even light. Only one person in the image.';
    prompt = `${intro}${physBlock} ${wearing}${rest}`;
  } else {
    subject = 'catalogue';
    orientation = 'square';
    const display = hairOnly
      ? 'styled on a featureless mannequin head'
      : isOutfit
        ? 'arranged together on a dress form or laid flat'
        : 'on a dress form or laid flat';
    prompt = isOutfit
      ? `Product photograph of ${cueInline}Shown ${display}, no person, neutral ground, even light. The clothing is the subject.`
      : `Product photograph of ${cue}, ${display}, no person, neutral ground, even light. The garment is the subject.`;
  }

  // The same capped art-direction preamble the avatar portrait carries.
  prompt = withArtDirection(prompt, await resolveAesthetic({
    kind: 'aurora',
    projectOfficialMountPointId: input.projectOfficialMountPointId ?? undefined,
  }));

  return { prompt: prompt.trim(), orientation, subject };
}
