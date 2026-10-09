/**
 * Shared avatar prompt builder.
 *
 * Builds the portrait prompt used by both the background avatar-generation
 * job and the dialog's "preview avatar" endpoint. Single source of truth for
 * the prompt shape; callers differ only in how they obtain `equippedSlots`.
 *
 * Also the home of what every solo picture of a character shares with the
 * wardrobe item picture (`lib/wardrobe/item-image-prompt.ts`): the identity
 * block, the solo-figure opening and the capped art-direction preamble.
 *
 * @module image-gen/avatar-prompt
 */

import type { Character } from '@/lib/schemas/character.types';
import { WARDROBE_SLOT_TYPES, bySlot } from '@/lib/schemas/wardrobe.types';
import type { EquippedSlots, WardrobeItemType } from '@/lib/schemas/wardrobe.types';
import type { getRepositories } from '@/lib/repositories/factory';
import {
  describeOutfit,
  decorateOutfitItems,
  buildOutfitSlotValues,
} from '@/lib/wardrobe/outfit-description';
import { resolveEquippedOutfitForCharacter } from '@/lib/wardrobe/resolve-equipped';
import { loadWearablePool } from '@/lib/wardrobe/pool';
import { genderNounFromPronouns } from '@/lib/characters/pronoun-gender';
import { pickPhysicalDescription } from '@/lib/characters/physical-description';

interface BuildPromptOptions {
  /**
   * Equipped slots to describe. When `null`/`undefined`, no outfit is
   * appended — the prompt relies on physical descriptions alone.
   */
  equippedSlots?: EquippedSlots | null;
  /**
   * Project document stores in scope, so equipped items that live in a project
   * store resolve. The character's group stores are resolved here from their own
   * memberships; Quilltap General and the character's vault are always in scope.
   * Omit when there is no project context.
   */
  projectMountPointIds?: string[];
  /**
   * Resolved Aurora character aesthetic (from `aurora-aesthetics.md`,
   * project-over-global). Avatars have no LLM rewrite step, so this is
   * prepended as a short capped art-direction preamble. The Ariel Clause
   * (`depiction-guidelines.md`) does NOT apply to avatars.
   */
  characterAesthetic?: string | null;
}

/**
 * How much of the figure a picture shows. Drives which physical-description
 * variant leads: a head-and-shoulders crop prefers the dedicated
 * head-and-shoulders prompt (it avoids sending below-the-crop anatomy that
 * image-provider moderation rejects); a full-length shot prefers the fuller
 * variants.
 */
export type FigureFraming = 'head-and-shoulders' | 'full-length';

export interface FigureIdentityBlock {
  /**
   * "woman" / "man" from the character's pronouns, else "person" — never a
   * binary presentation forced onto a character who hasn't declared one.
   */
  subjectNoun: string;
  /** The chosen physical-description text, trimmed ('' when none). */
  physicalText: string;
  /** `physicalText` with exactly one closing period ('' when none). */
  physBlock: string;
}

/**
 * The identity block every picture of a character opens with: the physical
 * description and the pronoun-derived sex anchor. Shared by the avatar
 * portrait and the wardrobe item picture (`lib/wardrobe/item-image-prompt.ts`)
 * so the two prompts cannot drift on who the figure is.
 */
export function buildFigureIdentityBlock(
  character: Pick<Character, 'physicalDescription' | 'pronouns'>,
  framing: FigureFraming,
): FigureIdentityBlock {
  // The framing names its own variant order (`pickPhysicalDescription`).
  const physicalText = pickPhysicalDescription(character.physicalDescription, framing);

  // Anchor the figure's apparent sex from the character's pronouns. Without
  // it, a gender-neutral physical description plus an outfit cue (e.g. a
  // "men's" shirt) can make the generator render the wrong sex. `they`/
  // neopronouns/unset → no anchor, leaving "person".
  const subjectNoun = genderNounFromPronouns(character.pronouns) ?? 'person';

  // Strip any trailing terminal punctuation off the physical description so
  // we don't end up with "background.." once we re-append a period.
  const physBlock = physicalText ? `${physicalText.replace(/[.!?]+$/, '')}.` : '';

  return { subjectNoun, physicalText, physBlock };
}

/**
 * The opening every solo picture of a character shares: what kind of picture,
 * the pronoun-anchored figure, the name, and the one-figure instruction.
 * Returned without closing punctuation; each caller appends its own framing
 * (`, head-and-shoulders crop…` / `. Full-length, standing…`).
 */
export function soloFigureIntro(medium: 'portrait' | 'picture', subjectNoun: string, name: string): string {
  return `Solo ${medium} of a single ${subjectNoun}: ${name}. Show exactly one figure`;
}

/**
 * Cap for the Aurora aesthetic preamble — a long doc can't blow the provider's
 * prompt budget. Shared by the avatar portrait and the wardrobe item picture.
 */
export const FIGURE_AESTHETIC_MAX_CHARS = 600;

/**
 * Prepend the Aurora character aesthetic as a capped art-direction preamble.
 * No LLM compresses these prompts, so the cap is what keeps a long aesthetic
 * doc from dominating them. A blank aesthetic leaves the prompt untouched.
 */
export function withArtDirection(prompt: string, aesthetic: string | null | undefined): string {
  const trimmed = aesthetic?.trim();
  if (!trimmed) return prompt;
  const capped = trimmed.length > FIGURE_AESTHETIC_MAX_CHARS
    ? trimmed.slice(0, FIGURE_AESTHETIC_MAX_CHARS)
    : trimmed;
  return `Art direction (apply this overall style): ${capped}\n\n${prompt}`;
}

interface BuildPromptResult {
  /** Final portrait prompt suitable for an image-generation provider. */
  prompt: string;
  /** Whether any appearance data (physical description or wardrobe) was found. */
  hasAppearance: boolean;
  /** Per-slot leaf counts after composite expansion (for logging/debug). */
  leafCounts: Record<WardrobeItemType, number>;
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

  const leafCounts = bySlot(() => 0);

  const figure = buildFigureIdentityBlock(character, 'head-and-shoulders');
  const physicalText = figure.physicalText;

  let outfitText = '';
  // Whether the character's upper body is bare (no item bubbles up into the
  // top slot). Drives a tighter crop below so a bare chest is never in frame.
  let topIsBare = false;
  if (equippedSlots) {
    // Avatars are head-and-shoulders only. We pass the FULL equipped slots in
    // so the resolver can route coverage by each leaf's own `types` — an item
    // sitting in slots.bottom whose types include "top" still bubbles up into
    // the rendered top. We then `omit` bottom/footwear at render time so the
    // image generator doesn't paste shoes/pants onto a cropped torso.
    // No project context reads as no project tier — never a chat lookup.
    const resolved = resolveEquippedOutfitForCharacter(
      await loadWearablePool(repos, character.id, projectMountPointIds ?? []),
      equippedSlots,
    );

    topIsBare = resolved.leafItemsBySlot.top.length === 0;
    const accessories = decorateOutfitItems(resolved.leafItemsBySlot.accessories, { titleOnly: true });
    // A hairdo is the most visible thing in a head-and-shoulders portrait, so
    // it rides along on BOTH branches below.
    const hair = decorateOutfitItems(resolved.leafItemsBySlot.hair, { titleOnly: true });

    if (topIsBare) {
      // Bare-topped character. We deliberately do NOT emit "topless"/"naked"
      // wardrobe language: it trips SFW image-provider moderation and implies
      // breasts in frame. The tighter collarbone crop in the intro conveys the
      // exposure honestly (bare shoulders, chest out of frame); here we only
      // list any accessories that sit at or above the collar, plus a styled
      // hairdo. We also avoid describeOutfit's "completely naked and unadorned"
      // fallback, which would fire (and reintroduce nudity language) when
      // accessories AND hair are both empty.
      outfitText = accessories.length > 0 || hair.length > 0
        ? describeOutfit(
            buildOutfitSlotValues((slot) =>
              slot === 'accessories' ? accessories : slot === 'hair' ? hair : [],
            ),
            { omit: ['top', 'bottom', 'footwear'] },
          ).trimEnd()
        : '';
    } else {
      outfitText = describeOutfit(
        buildOutfitSlotValues((slot) =>
          slot === 'accessories'
            ? accessories
            : slot === 'hair'
              ? hair
              : decorateOutfitItems(resolved.leafItemsBySlot[slot], { titleOnly: true }),
        ),
        // Hair is deliberately NOT omitted — the hairdo belongs in a portrait.
        { omit: ['bottom', 'footwear'] },
      ).trimEnd();
    }

    for (const slot of WARDROBE_SLOT_TYPES) {
      leafCounts[slot] = resolved.leafItemsBySlot[slot].length;
    }
  }

  const hasAppearance = Boolean(physicalText) || Boolean(outfitText);
  let prompt = '';
  if (hasAppearance) {
    const { subjectNoun } = figure;
    // For a bare-topped character, crop higher — at the collarbone — so the
    // chest is physically out of frame. Bare shoulders and neck are unremarkable
    // to SFW image providers; a bare chest is what gets refused. The framing
    // constraint keeps the portrait generatable without any "topless" wording.
    const opening = soloFigureIntro('portrait', subjectNoun, character.name);
    const intro = topIsBare
      ? `${opening}. Close-up headshot cropped at the collarbone — only the face, neck, and bare shoulders are visible; the chest and torso are outside the frame.`
      : `${opening}, head-and-shoulders crop, three-quarter view.`;
    const outro = `Character portrait, detailed, high quality, natural lighting. Only one person in the image.`;
    const { physBlock } = figure;
    // Outfit is a markdown list (lines starting with "- "). Markdown renderers
    // need a blank line before the first list item, so the outfit block is
    // separated from neighboring paragraphs by `\n\n` on each side.
    const outfitBlock = outfitText ? `\n\n${outfitText}\n\n` : ' ';
    prompt = physBlock
      ? `${intro} ${physBlock}${outfitBlock}${outro}`
      : `${intro}${outfitBlock}${outro}`;

    prompt = withArtDirection(prompt, options.characterAesthetic);
  }

  return { prompt, hasAppearance, leafCounts };
}
