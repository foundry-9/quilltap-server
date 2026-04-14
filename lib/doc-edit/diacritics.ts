/**
 * Diacritics Normalization
 *
 * Provides Unicode normalization for text matching operations.
 * Allows base characters to match their accented variants,
 * essential for fiction vaults with character names containing
 * diacritical marks (e.g., "Nimue" matches "Nimuë").
 *
 * @module doc-edit/diacritics
 */

import { createServiceLogger } from '@/lib/logging/create-logger';

const logger = createServiceLogger('DocEdit:Diacritics');

/**
 * Strip combining marks from NFD-decomposed text.
 * "Nimuë" → NFD → "Nimue\u0308" → strip → "Nimue"
 */
export function normalizeDiacritics(text: string): string {
  // NFD decompose, then strip Unicode combining marks (category M)
  // Ranges: \u0300-\u036f (Combining Diacritical Marks)
  //         \u1AB0-\u1AFF (Combining Diacritical Marks Extended)
  //         \u1DC0-\u1DFF (Combining Diacritical Marks Supplement)
  //         \u20D0-\u20FF (Combining Diacritical Marks for Symbols)
  //         \uFE20-\uFE2F (Combining Half Marks)
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g, '');
}

/**
 * Options for diacritics-aware text matching
 */
export interface DiacriticsMatchOptions {
  /** Whether to normalize diacritics for matching (default: true) */
  normalizeDiacritics?: boolean;
  /** Whether the match is case-sensitive (default: true) */
  caseSensitive?: boolean;
}

/**
 * Build a mapping from normalized string positions back to original string positions.
 * Used to convert match positions in the normalized string to positions in the original.
 *
 * @param original The original string
 * @param normalized The diacritics-normalized version of the original
 * @returns Array where index[i] = position in original string of character at position i in normalized
 */
function buildNormalizationMap(original: string, normalized: string): number[] {
  const map: number[] = [];

  // Process the original string character-by-character in NFD form
  let normalizedPos = 0;
  for (let originalPos = 0; originalPos < original.length; originalPos++) {
    const char = original[originalPos];
    const nfdChar = char.normalize('NFD');

    // Remove combining marks to see how many characters in normalized string
    // correspond to this original character
    const strippedChar = nfdChar.replace(
      /[\u0300-\u036f\u1AB0-\u1AFF\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]/g,
      ''
    );

    // Map each resulting normalized character back to this original position
    for (let i = 0; i < strippedChar.length; i++) {
      map[normalizedPos] = originalPos;
      normalizedPos++;
    }
  }

  return map;
}

/**
 * Find ALL occurrences of needle in haystack with optional diacritics normalization.
 * Returns array of { index, length } for each match in the ORIGINAL haystack.
 *
 * The tricky part: when diacritics normalization is on, the indices in the
 * normalized string don't correspond 1:1 to the original string. We build
 * a character-level mapping from normalized positions back to original positions.
 */
export function findAllMatches(
  haystack: string,
  needle: string,
  options: DiacriticsMatchOptions = {}
): Array<{ index: number; length: number }> {
  const { normalizeDiacritics: shouldNormalize = true, caseSensitive = true } = options;

  if (!needle) {
    logger.debug('Empty needle provided to findAllMatches');
    return [];
  }

  // Handle simple case: no normalization needed
  if (!shouldNormalize && caseSensitive) {
    const matches: Array<{ index: number; length: number }> = [];
    let searchIndex = 0;
    while ((searchIndex = haystack.indexOf(needle, searchIndex)) !== -1) {
      matches.push({ index: searchIndex, length: needle.length });
      searchIndex += 1;
    }
    return matches;
  }

  // Build normalized versions
  let normalizedHaystack = haystack;
  let normalizedNeedle = needle;
  let haystackMap: number[] | null = null;

  if (shouldNormalize) {
    normalizedHaystack = normalizeDiacritics(haystack);
    normalizedNeedle = normalizeDiacritics(needle);
    haystackMap = buildNormalizationMap(haystack, normalizedHaystack);
  }

  if (!caseSensitive) {
    normalizedHaystack = normalizedHaystack.toLowerCase();
    normalizedNeedle = normalizedNeedle.toLowerCase();
  }

  const matches: Array<{ index: number; length: number }> = [];

  if (!normalizedNeedle) {
    logger.debug('Needle became empty after normalization');
    return matches;
  }

  // Find all matches in the normalized string
  let searchIndex = 0;
  while ((searchIndex = normalizedHaystack.indexOf(normalizedNeedle, searchIndex)) !== -1) {
    let originalIndex: number;
    let originalLength: number;

    if (haystackMap) {
      // Map normalized positions back to original string
      originalIndex = haystackMap[searchIndex];

      // Find the original length by mapping the end position
      // The match extends from searchIndex to searchIndex + normalizedNeedle.length - 1
      const normalizedEndPos = searchIndex + normalizedNeedle.length - 1;
      const originalEndPos = haystackMap[normalizedEndPos];

      // Original length is from start to end, inclusive
      originalLength = originalEndPos - originalIndex + 1;
    } else {
      originalIndex = searchIndex;
      originalLength = normalizedNeedle.length;
    }

    matches.push({ index: originalIndex, length: originalLength });
    searchIndex += 1;
  }

  logger.debug(
    `Found ${matches.length} matches for needle in haystack (normalize=${shouldNormalize}, caseSensitive=${caseSensitive})`
  );
  return matches;
}

/**
 * Find a UNIQUE match of needle in haystack.
 * Returns the match if exactly one exists, or an error descriptor.
 * This is the core matching function for str_replace's uniqueness constraint.
 */
export function findUniqueMatch(
  haystack: string,
  needle: string,
  options: DiacriticsMatchOptions = {}
): { found: true; index: number; length: number } | { found: false; count: number } {
  const matches = findAllMatches(haystack, needle, options);

  if (matches.length === 1) {
    logger.debug('Found exactly one unique match');
    return { found: true, ...matches[0] };
  }

  logger.debug(`Expected unique match but found ${matches.length} matches`);
  return { found: false, count: matches.length };
}
