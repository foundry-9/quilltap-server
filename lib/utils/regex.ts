/**
 * Escape special regex characters in a string so it can be embedded inside a
 * `new RegExp(...)` literal as a fixed substring.
 */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
