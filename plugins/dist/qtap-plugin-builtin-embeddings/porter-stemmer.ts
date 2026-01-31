/**
 * Porter Stemmer Implementation
 *
 * Pure TypeScript implementation of the Porter Stemming Algorithm.
 * This algorithm reduces words to their root/stem form, which helps
 * improve matching in TF-IDF by treating variations of words as the same term.
 *
 * Example: "running", "runs", "ran" all stem to "run"
 *
 * Based on: Porter, M.F. (1980). An algorithm for suffix stripping.
 * Program, 14(3), 130-137.
 */

/**
 * Common English stop words to filter out during text processing
 */
export const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'with', 'about', 'against', 'between', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'to', 'from',
  'up', 'down', 'in', 'out', 'on', 'off', 'over', 'under', 'again',
  'further', 'once', 'here', 'there', 'where', 'why', 'how', 'all',
  'each', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 's', 't',
  'can', 'will', 'just', 'don', 'should', 'now', 'i', 'me', 'my',
  'myself', 'we', 'our', 'ours', 'ourselves', 'you', 'your', 'yours',
  'yourself', 'yourselves', 'he', 'him', 'his', 'himself', 'she', 'her',
  'hers', 'herself', 'it', 'its', 'itself', 'they', 'them', 'their',
  'theirs', 'themselves', 'what', 'which', 'who', 'whom', 'this', 'that',
  'these', 'those', 'am', 'is', 'are', 'was', 'were', 'be', 'been',
  'being', 'have', 'has', 'had', 'having', 'do', 'does', 'did', 'doing',
  'would', 'could', 'ought', 'of', 'as'
]);

/**
 * Check if a character is a consonant in the given word at position i
 */
function isConsonant(word: string, i: number): boolean {
  const c = word[i];
  if (c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u') {
    return false;
  }
  if (c === 'y') {
    return i === 0 || !isConsonant(word, i - 1);
  }
  return true;
}

/**
 * Calculate the "measure" of a word - the number of consonant sequences
 * A measure is the number of VC (vowel-consonant) pairs
 */
function measure(word: string): number {
  let m = 0;
  let i = 0;
  const len = word.length;

  // Skip initial consonants
  while (i < len && isConsonant(word, i)) {
    i++;
  }

  while (i < len) {
    // Count vowel sequence
    while (i < len && !isConsonant(word, i)) {
      i++;
    }
    if (i >= len) break;

    // Count consonant sequence and increment measure
    m++;
    while (i < len && isConsonant(word, i)) {
      i++;
    }
  }

  return m;
}

/**
 * Check if the stem contains a vowel
 */
function hasVowel(word: string): boolean {
  for (let i = 0; i < word.length; i++) {
    if (!isConsonant(word, i)) {
      return true;
    }
  }
  return false;
}

/**
 * Check if word ends with a double consonant
 */
function endsWithDoubleConsonant(word: string): boolean {
  if (word.length < 2) return false;
  const last = word.length - 1;
  return word[last] === word[last - 1] && isConsonant(word, last);
}

/**
 * Check if word ends with CVC pattern where final C is not w, x, or y
 */
function endsWithCVC(word: string): boolean {
  if (word.length < 3) return false;
  const last = word.length - 1;
  const c = word[last];
  return (
    isConsonant(word, last) &&
    !isConsonant(word, last - 1) &&
    isConsonant(word, last - 2) &&
    c !== 'w' &&
    c !== 'x' &&
    c !== 'y'
  );
}

/**
 * Replace suffix if conditions are met
 */
function replaceSuffix(
  word: string,
  suffix: string,
  replacement: string,
  condition?: (stem: string) => boolean
): string {
  if (!word.endsWith(suffix)) return word;
  const stem = word.slice(0, -suffix.length);
  if (condition && !condition(stem)) return word;
  return stem + replacement;
}

/**
 * Step 1a: Plural and -ed/-ing
 */
function step1a(word: string): string {
  if (word.endsWith('sses')) return word.slice(0, -2);
  if (word.endsWith('ies')) return word.slice(0, -2);
  if (word.endsWith('ss')) return word;
  if (word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/**
 * Step 1b: -ed and -ing
 */
function step1b(word: string): string {
  if (word.endsWith('eed')) {
    const stem = word.slice(0, -3);
    if (measure(stem) > 0) return stem + 'ee';
    return word;
  }

  let stem = '';
  let hadSuffix = false;

  if (word.endsWith('ed')) {
    stem = word.slice(0, -2);
    hadSuffix = hasVowel(stem);
  } else if (word.endsWith('ing')) {
    stem = word.slice(0, -3);
    hadSuffix = hasVowel(stem);
  }

  if (hadSuffix) {
    word = stem;

    if (word.endsWith('at') || word.endsWith('bl') || word.endsWith('iz')) {
      return word + 'e';
    }

    if (
      endsWithDoubleConsonant(word) &&
      !word.endsWith('l') &&
      !word.endsWith('s') &&
      !word.endsWith('z')
    ) {
      return word.slice(0, -1);
    }

    if (measure(word) === 1 && endsWithCVC(word)) {
      return word + 'e';
    }
  }

  return word;
}

/**
 * Step 1c: -y to -i
 */
function step1c(word: string): string {
  if (word.endsWith('y') && hasVowel(word.slice(0, -1))) {
    return word.slice(0, -1) + 'i';
  }
  return word;
}

/**
 * Step 2: Map double suffixes to single ones
 */
function step2(word: string): string {
  const mappings: [string, string][] = [
    ['ational', 'ate'],
    ['tional', 'tion'],
    ['enci', 'ence'],
    ['anci', 'ance'],
    ['izer', 'ize'],
    ['abli', 'able'],
    ['alli', 'al'],
    ['entli', 'ent'],
    ['eli', 'e'],
    ['ousli', 'ous'],
    ['ization', 'ize'],
    ['ation', 'ate'],
    ['ator', 'ate'],
    ['alism', 'al'],
    ['iveness', 'ive'],
    ['fulness', 'ful'],
    ['ousness', 'ous'],
    ['aliti', 'al'],
    ['iviti', 'ive'],
    ['biliti', 'ble'],
  ];

  for (const [suffix, replacement] of mappings) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 0) {
        return stem + replacement;
      }
      return word;
    }
  }
  return word;
}

/**
 * Step 3: Handle -ic-, -full, -ness, etc.
 */
function step3(word: string): string {
  const mappings: [string, string][] = [
    ['icate', 'ic'],
    ['ative', ''],
    ['alize', 'al'],
    ['iciti', 'ic'],
    ['ical', 'ic'],
    ['ful', ''],
    ['ness', ''],
  ];

  for (const [suffix, replacement] of mappings) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 0) {
        return stem + replacement;
      }
      return word;
    }
  }
  return word;
}

/**
 * Step 4: Remove -ant, -ence, etc.
 */
function step4(word: string): string {
  const suffixes = [
    'al', 'ance', 'ence', 'er', 'ic', 'able', 'ible', 'ant', 'ement',
    'ment', 'ent', 'ion', 'ou', 'ism', 'ate', 'iti', 'ous', 'ive', 'ize'
  ];

  for (const suffix of suffixes) {
    if (word.endsWith(suffix)) {
      const stem = word.slice(0, -suffix.length);
      if (measure(stem) > 1) {
        // Special case for -ion: preceding char must be s or t
        if (suffix === 'ion') {
          if (stem.endsWith('s') || stem.endsWith('t')) {
            return stem;
          }
        } else {
          return stem;
        }
      }
      return word;
    }
  }
  return word;
}

/**
 * Step 5a: Remove trailing -e
 */
function step5a(word: string): string {
  if (word.endsWith('e')) {
    const stem = word.slice(0, -1);
    const m = measure(stem);
    if (m > 1) return stem;
    if (m === 1 && !endsWithCVC(stem)) return stem;
  }
  return word;
}

/**
 * Step 5b: Remove trailing double consonant (-> -ll)
 */
function step5b(word: string): string {
  if (measure(word) > 1 && endsWithDoubleConsonant(word) && word.endsWith('l')) {
    return word.slice(0, -1);
  }
  return word;
}

/**
 * Apply the Porter Stemming algorithm to a word
 *
 * @param word The word to stem
 * @returns The stemmed word
 */
export function stem(word: string): string {
  // Handle short words
  if (word.length <= 2) return word;

  // Apply all steps
  let result = word.toLowerCase();
  result = step1a(result);
  result = step1b(result);
  result = step1c(result);
  result = step2(result);
  result = step3(result);
  result = step4(result);
  result = step5a(result);
  result = step5b(result);

  return result;
}

/**
 * Tokenize text into words, apply stemming, and filter stop words
 *
 * @param text The text to tokenize
 * @param removeStopWords Whether to remove stop words (default: true)
 * @returns Array of stemmed tokens
 */
export function tokenize(text: string, removeStopWords = true): string[] {
  // Convert to lowercase and extract words
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);

  // Filter stop words and apply stemming
  const tokens: string[] = [];
  for (const word of words) {
    if (removeStopWords && STOP_WORDS.has(word)) {
      continue;
    }
    if (word.length < 2) {
      continue;
    }
    tokens.push(stem(word));
  }

  return tokens;
}

/**
 * Generate bigrams from an array of tokens
 *
 * @param tokens Array of tokens
 * @returns Array of bigram strings (e.g., "word1_word2")
 */
export function generateBigrams(tokens: string[]): string[] {
  const bigrams: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    bigrams.push(`${tokens[i]}_${tokens[i + 1]}`);
  }
  return bigrams;
}
