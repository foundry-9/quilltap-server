/**
 * Translating a user's search box into an FTS5 `MATCH` expression.
 *
 * ## The search-behaviour contract
 *
 * `LIKE '%x%'` is SUBSTRING matching. FTS5 `unicode61` is TOKEN matching.
 * Swapping one for the other changes what the search bar finds, and this is
 * the contract we commit to (also stated for users in `help/search.md`):
 *
 * - Search matches **whole words and word prefixes**, not arbitrary
 *   substrings. `walk` finds *walking* and *walked*; it no longer finds
 *   *sidewalk*.
 * - **Accents fold**: `café` and `cafe` find each other. Case folding now
 *   covers non-ASCII letters too, where `LIKE` folded ASCII only.
 * - **Punctuation is not indexed.** A query that is only punctuation, or only
 *   one-character tokens, falls back to the slower exact scan.
 * - Queries containing `.`, `+`, `(` and friends **start working**: the old
 *   regex→LIKE conversion turned `.` into `_` with no `ESCAPE` clause, so
 *   `Mr. Smith` silently matched nothing.
 * - Results stay capped and stay ordered `createdAt DESC` — **not** by FTS
 *   rank. Relevance ordering is a deliberate follow-up, not a side effect.
 *
 * ## Why the whole query is one quoted phrase with a trailing star
 *
 * Measured against 20,000 real messages:
 *
 * | User types    | `LIKE` hits | FTS bare | FTS prefix |
 * |---------------|------------:|---------:|-----------:|
 * | `djinn`       |         657 |      651 |        651 |
 * | `the estate`  |        2504 |     2503 |       2503 |
 * | `walk`        |        2010 | **1089** |   **2007** |
 * | `café`        |          10 |       34 |         35 |
 * | `C++`         |           0 |      152 |  **14260** |
 *
 * A PHRASE (adjacent tokens, in order) is the token-level equivalent of a
 * substring, which is why `the estate` lands within one hit of `LIKE`. The
 * trailing `*` is mandatory: without it `walk` loses half its hits, because
 * `LIKE` was matching *walking*. Quoting also means a user who types FTS5
 * operator syntax (`OR`, `NEAR`, `-`, `:`) gets a literal search rather than a
 * syntax error or a surprise.
 *
 * `C++` is the case the star cannot save: it collapses to the single token
 * `c`, which matches 14,260 rows as a prefix — worse than useless. Queries
 * whose tokens are all shorter than two characters fall back to an exact scan.
 *
 * @module lib/database/repositories/fts-query
 */

import { escapeLikeLiteral } from './like-escape';

/** Tokens shorter than this cannot usefully drive a prefix query. */
const MIN_USEFUL_TOKEN_LENGTH = 2;

/**
 * Split like FTS5's `unicode61` tokenizer: everything outside letters and
 * numbers is a separator.
 *
 * This is an APPROXIMATION and deliberately so — it only decides *whether* to
 * use the index, and positions snippets. The index itself is tokenized by
 * SQLite, not by this function, so small disagreements cost nothing.
 */
export function tokenizeLikeUnicode61(query: string): string[] {
  return query.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** Use the index: `match` goes straight into `chat_messages_fts MATCH ?`. */
export interface FtsMatchPlan {
  kind: 'fts';
  match: string;
  tokens: string[];
}

/** Don't use the index: `likePattern` goes into `LIKE ? ESCAPE '\'`. */
export interface FtsFallbackPlan {
  kind: 'fallback';
  likePattern: string;
  tokens: string[];
  reason: 'no-tokens' | 'tokens-too-short';
}

export type FtsQueryPlan = FtsMatchPlan | FtsFallbackPlan;

/**
 * Decide how to run a user's query.
 *
 * Returns an FTS plan for anything with at least one token of two or more
 * characters, and a `LIKE` fallback otherwise. The fallback is slow, correct
 * and rare.
 */
export function buildFtsMatchExpression(query: string): FtsQueryPlan {
  const tokens = tokenizeLikeUnicode61(query);
  const likePattern = `%${escapeLikeLiteral(query)}%`;

  if (tokens.length === 0) {
    return { kind: 'fallback', likePattern, tokens, reason: 'no-tokens' };
  }
  if (tokens.every((t) => t.length < MIN_USEFUL_TOKEN_LENGTH)) {
    return { kind: 'fallback', likePattern, tokens, reason: 'tokens-too-short' };
  }

  // One phrase, quotes doubled, prefix star on the final token.
  return { kind: 'fts', match: `"${query.replace(/"/g, '""')}"*`, tokens };
}
