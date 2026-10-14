/**
 * The one file-name sanitiser for vault and store documents: path separators
 * and the characters Windows refuses (`\/:*?"<>|`) become `_`, runs of
 * whitespace collapse, and the result is capped at 100 characters (`untitled`
 * when nothing is left). Wardrobe item files and wardrobe folder segments
 * share it, so a folder name can never smuggle a separator into a path.
 *
 * Client-safe: pure, no imports.
 *
 * @module lib/mount-index/sanitize-file-name
 */

export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.slice(0, 100) || 'untitled';
}
