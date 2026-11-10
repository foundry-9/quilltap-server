/**
 * Atlas matching — the one place a text is tested for Atlas terms.
 *
 * A term is an entry's canonical name or one of its aliases. Matching is whole
 * word, case-insensitive, Unicode letter-bounded, longest term first, with no
 * stemming: "car" matches "the car" and "Car", never "cars" or "carpet"
 * (`buildNameMatcher` with `caseInsensitive`). One term resolves to exactly one
 * entry: an entry whose canonical name is the term beats one holding it as an
 * alias; then the order of `entries` (callers pass the strongest tier first).
 * `excludeTerms` removes terms outright — a term a character answers to is the
 * person's, not the thing's.
 *
 * A grep-test holds that nothing outside this module builds an Atlas matcher.
 *
 * Pure and client-safe.
 *
 * @module lib/atlas/match
 */

import { buildNameMatcher } from '@/lib/chat/name-mentions';

/** What matching needs of an entry. */
export interface MatchableAtlasEntry {
  id: string;
  name: string;
  aliases?: readonly string[] | null;
}

/** One matcher over a set of entries' terms. */
export interface AtlasMatcher<E extends MatchableAtlasEntry = MatchableAtlasEntry> {
  regex: RegExp;
  /** Folded term → the one entry it resolves to. */
  byTerm: ReadonlyMap<string, E>;
  /** How many terms the matcher holds. */
  termCount: number;
}

/** One entry named in a scan. */
export interface NamedAtlasEntry<E extends MatchableAtlasEntry = MatchableAtlasEntry> {
  entry: E;
  /** The matched text as written. */
  text: string;
  /** Which of the scanned texts it was first found in. */
  textIndex: number;
  /** Where in that text. */
  offset: number;
}

/** A term folded for comparison. */
export function foldAtlasTerm(term: string): string {
  return term.trim().toLowerCase();
}

/** Every term of an entry: its name, then its aliases. */
export function atlasTermsOf(entry: MatchableAtlasEntry): string[] {
  return [entry.name, ...(entry.aliases ?? [])].map((t) => t?.trim()).filter((t): t is string => !!t);
}

/**
 * Build one matcher over every term of `entries`, or null when no term is
 * left. `entries` come strongest first.
 */
export function buildAtlasMatcher<E extends MatchableAtlasEntry>(
  entries: readonly E[],
  opts: { excludeTerms?: Iterable<string | null | undefined> } = {},
): AtlasMatcher<E> | null {
  const excluded = new Set<string>();
  for (const term of opts.excludeTerms ?? []) {
    if (term && term.trim()) excluded.add(foldAtlasTerm(term));
  }
  const byTerm = new Map<string, E>();
  const spelled = new Map<string, string>();
  const claim = (term: string, entry: E) => {
    const key = foldAtlasTerm(term);
    if (!key || excluded.has(key) || byTerm.has(key)) return;
    byTerm.set(key, entry);
    spelled.set(key, term.trim());
  };
  // Names first, so a canonical name beats an alias wherever it sits.
  for (const entry of entries) claim(entry.name, entry);
  for (const entry of entries) for (const alias of entry.aliases ?? []) claim(alias, entry);
  const regex = buildNameMatcher(Array.from(spelled.values()), { caseInsensitive: true });
  if (!regex) return null;
  return { regex, byTerm, termCount: byTerm.size };
}

/**
 * The entries named in `texts` (priority order), each once, with the matched
 * text as written and the index of the text it was first found in. Within one
 * text, entries come in the order they appear.
 */
export function findNamedEntries<E extends MatchableAtlasEntry>(
  texts: ReadonlyArray<string | null | undefined>,
  matcher: AtlasMatcher<E> | null,
): NamedAtlasEntry<E>[] {
  if (!matcher) return [];
  const out: NamedAtlasEntry<E>[] = [];
  const seen = new Set<string>();
  texts.forEach((text, textIndex) => {
    if (!text) return;
    matcher.regex.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = matcher.regex.exec(text)) !== null) {
      const entry = matcher.byTerm.get(foldAtlasTerm(m[0]));
      if (entry && !seen.has(entry.id)) {
        seen.add(entry.id);
        out.push({ entry, text: m[0], textIndex, offset: m.index });
      }
      if (m[0].length === 0) matcher.regex.lastIndex++;
    }
  });
  return out;
}

/** The first Atlas term in `text`, resolved, or null (the chips). */
export function firstAtlasMention<E extends MatchableAtlasEntry>(
  text: string,
  matcher: AtlasMatcher<E> | null,
): { entry: E; text: string; offset: number } | null {
  if (!matcher || !text) return null;
  matcher.regex.lastIndex = 0;
  const m = matcher.regex.exec(text);
  if (!m) return null;
  const entry = matcher.byTerm.get(foldAtlasTerm(m[0]));
  return entry ? { entry, text: m[0], offset: m.index } : null;
}

/** Every entry named anywhere in `text`, in order of first appearance. */
export function allAtlasMentions<E extends MatchableAtlasEntry>(
  text: string,
  matcher: AtlasMatcher<E> | null,
): Array<{ entry: E; text: string; offset: number }> {
  return findNamedEntries([text], matcher).map(({ entry, text: matched, offset }) => ({ entry, text: matched, offset }));
}

/** Every term people answer to — names and aliases — for `excludeTerms`. */
export function personTerms(
  people: ReadonlyArray<{ name?: string | null; aliases?: readonly string[] | null }>,
): string[] {
  const out: string[] = [];
  for (const person of people) {
    if (person.name?.trim()) out.push(person.name.trim());
    for (const alias of person.aliases ?? []) if (alias?.trim()) out.push(alias.trim());
  }
  return out;
}
