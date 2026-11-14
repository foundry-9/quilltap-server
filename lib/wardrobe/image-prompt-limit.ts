/**
 * The wardrobe item `imagePrompt` length rule — one place for the cap and the
 * clamp, shared by the item editor (its counter and `maxLength`), the
 * import-from-image analysis and the image-prompt optimizer.
 *
 * Client-safe: no server imports.
 *
 * @module lib/wardrobe/image-prompt-limit
 */

/** The longest an item's image-generation cue may be. */
export const WARDROBE_IMAGE_PROMPT_MAX_LENGTH = 200;

/**
 * Normalise model-written cue text into a storable `imagePrompt`: Markdown
 * emphasis, quotes and line breaks stripped, whitespace collapsed, a trailing
 * full stop dropped, and the result held to
 * {@link WARDROBE_IMAGE_PROMPT_MAX_LENGTH} — cut at the last comma or space
 * that keeps it whole words, never mid-word. Empty in, empty out.
 */
export function clampWardrobeImagePrompt(text: string | null | undefined): string {
  if (typeof text !== 'string') return '';
  let cleaned = text
    .replace(/[*_`#>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim()
    .replace(/\.+$/, '')
    .trim();
  if (cleaned.length <= WARDROBE_IMAGE_PROMPT_MAX_LENGTH) return cleaned;

  cleaned = cleaned.slice(0, WARDROBE_IMAGE_PROMPT_MAX_LENGTH + 1);
  const comma = cleaned.lastIndexOf(',', WARDROBE_IMAGE_PROMPT_MAX_LENGTH);
  const space = cleaned.lastIndexOf(' ', WARDROBE_IMAGE_PROMPT_MAX_LENGTH);
  // Prefer a comma break when it keeps most of the cue; else the last space.
  const cut = comma >= WARDROBE_IMAGE_PROMPT_MAX_LENGTH * 0.6 ? comma : space > 0 ? space : WARDROBE_IMAGE_PROMPT_MAX_LENGTH;
  return cleaned.slice(0, cut).replace(/[\s,;:–—-]+$/, '').trim();
}
