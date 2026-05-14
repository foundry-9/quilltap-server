/**
 * Parsed semver triple. Pre-release suffixes (e.g. `-beta.1`) are ignored;
 * only the `major.minor.patch` portion is captured.
 */
export interface ParsedVersion {
  major: number
  minor: number
  patch: number
}

/**
 * Parse a semver string into {major, minor, patch}. Returns null for input
 * that does not contain a `\d+\.\d+\.\d+` prefix (after stripping a leading
 * `v`). Anything after the third number — pre-release tags, build metadata,
 * extra dotted segments — is ignored.
 */
export function parseVersion(version: string): ParsedVersion | null {
  const cleaned = version.replace(/^v/, '')
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(cleaned)
  if (!match) return null
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
  }
}

/**
 * Compare two semver strings. Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Falls back to string comparison when either input fails to parse.
 */
export function compareVersions(a: string, b: string): number {
  const parsedA = parseVersion(a)
  const parsedB = parseVersion(b)
  if (!parsedA || !parsedB) return a.localeCompare(b)
  if (parsedA.major !== parsedB.major) return parsedA.major < parsedB.major ? -1 : 1
  if (parsedA.minor !== parsedB.minor) return parsedA.minor < parsedB.minor ? -1 : 1
  if (parsedA.patch !== parsedB.patch) return parsedA.patch < parsedB.patch ? -1 : 1
  return 0
}
