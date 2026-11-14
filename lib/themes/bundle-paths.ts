/**
 * Bundle-relative paths, shared by the version 1 schemas (lib/themes/types.ts)
 * and the version 2 engine (lib/themes/engine/).
 *
 * @module themes/bundle-paths
 */

/**
 * Whether `p` names a file inside a theme bundle: relative, no NUL byte, no
 * leading separator or drive letter, and no `..` segment (either separator
 * counts, so `a\\..\\b` is refused too). The loaders still resolve every path
 * through `resolveInside`; this keeps an unusable manifest from validating.
 */
export function isBundleRelativePath(p: string): boolean {
  if (p.length === 0 || p.includes('\0')) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  if (/^[A-Za-z]:/.test(p)) return false;
  return !p.split(/[\\/]/).includes('..');
}
