/**
 * Shared LLM-facing wording for the picture fields on wardrobe and inventory
 * tools.
 *
 * The image pipelines (avatars, the Lantern's story backgrounds, item
 * pictures) never read an item's prose `description` — a wardrobe item is
 * drawn from `image_prompt ?? title`, an inventory object from its
 * `image_description`. A model that pours everything into the description and
 * leaves the cue blank gets a picture built from a bare title, so the tools
 * say so plainly and ask for the cue every time.
 *
 * @module tools/image-cue-guidance
 */

/** Soft length target for a cue; stated to the model, not enforced. */
export const IMAGE_CUE_TARGET_CHARS = 200;

const CUE_STYLE =
  `${IMAGE_CUE_TARGET_CHARS} characters or fewer of literal, comma-separated ` +
  'visual detail — colour, material, cut, notable features — as a painter would ' +
  'need it. No story, mood, history, feelings, names or Markdown.';

/** Gloss for `wardrobe_create`'s `image_prompt`. */
export const WARDROBE_CREATE_IMAGE_PROMPT_GUIDANCE =
  'Portrait Cue — ALWAYS supply this for a new garment. It is the ONLY text ' +
  'about the item that avatars, story backgrounds and item pictures ever see ' +
  '(the description is never shown to them; without a cue they get only the ' +
  `title). ${CUE_STYLE} E.g. "ankle-length emerald silk gown, square neckline, ` +
  'gold beaded sash". It is joined into a comma-separated outfit list. ' +
  'May be omitted for a composite, whose components speak for it.';

/** Gloss for `wardrobe_update`'s `image_prompt`. */
export const WARDROBE_UPDATE_IMAGE_PROMPT_GUIDANCE =
  'New Portrait Cue — the only text about the item the image generator sees ' +
  `(never the description). ${CUE_STYLE} Supply one whenever the item has ` +
  'none or its look changes. Omit to leave unchanged.';

/** Gloss for the wardrobe tools' `description`. */
export const WARDROBE_DESCRIPTION_GUIDANCE =
  'Prose for you and the other characters to read. It is NEVER used for ' +
  'pictures — put what the item looks like in image_prompt as well.';

/** Gloss for the inventory tools' `image_description`. */
export const INVENTORY_IMAGE_DESCRIPTION_GUIDANCE =
  'How the object looks, for pictures — the ONLY text about it the image ' +
  'generator sees (never the description). Supply it whenever the object ' +
  `would be visible in a portrait or scene. ${CUE_STYLE} E.g. "dented brass ` +
  'pocket compass on a short chain".';
