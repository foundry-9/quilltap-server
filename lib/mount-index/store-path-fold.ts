/**
 * The path-equality rule for database-backed document stores.
 *
 * Pure and client-safe (no Node imports), so the item-store kernel's
 * client-safe rules can use it as well as the repositories.
 *
 * @module lib/mount-index/store-path-fold
 */

/**
 * Fold a database-store path for equality the way SQLite's `COLLATE NOCASE`
 * does: ASCII `A`–`Z` become `a`–`z` and every other character is left
 * exactly as it is. This is THE path-equality rule for database-backed
 * stores — the link, document and folder rows are looked up and uniquely
 * indexed `NOCASE`, so any JS comparison that decides "is this the same
 * stored path" must use this fold, never `toLowerCase()` (which folds all of
 * Unicode: `Café.md` and `CAFÉ.md` are one path to `toLowerCase()` and two
 * rows to the store — #224).
 *
 * Filesystem mounts are a different namespace (the disk decides) and are not
 * governed by this rule.
 */
export function foldStorePath(p: string): string {
  return p.replace(/[A-Z]+/g, (run) => run.toLowerCase());
}

/** True when two database-store paths name the same row ({@link foldStorePath}). */
export function sameStorePath(a: string, b: string): boolean {
  return a === b || foldStorePath(a) === foldStorePath(b);
}
