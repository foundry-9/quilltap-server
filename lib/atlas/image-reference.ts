/**
 * Pictures that mention things — the **only** module an image path may read
 * the Atlas through (a grep-test holds it).
 *
 * A named thing's graphic prompt is handed to an image prompt crafter as a
 * reference: "if this thing is in the picture, it looks like this". It is
 * never appended to a crafted prompt — the crafter decides whether the thing
 * is in the frame, so a Convertible named only in the scenario is not painted
 * into every background. The one exception is a path with no crafter and an
 * operator-typed prompt that names the thing ({@link appendKnownThings}).
 *
 * Never read by avatars, wardrobe or Inventory item pictures, or an entry's
 * own picture. Entry pictures are never sent as references.
 *
 * Server-only (the loaders read the stores); the renderers are pure.
 *
 * @module lib/atlas/image-reference
 */

import { logger } from '@/lib/logger';
import { getErrorMessage } from '@/lib/error-utils';
import type { RepositoryContainer } from '@/lib/repositories/factory';
import { buildAtlasMatcher, findNamedEntries, foldAtlasTerm, personTerms } from '@/lib/atlas/match';
import { loadAtlasViewFor, loadCastAtlasView, type AtlasPool, type AtlasViewChat } from '@/lib/atlas/pool';

/** One thing a crafter is told about. */
export interface KnownThing {
  name: string;
  aliases: string[];
  /** The graphic prompt. */
  look: string;
}

/** The most things one picture is told about. */
export const KNOWN_THINGS_MAX = 8;

/** The block's lead line. */
export const KNOWN_THINGS_LEAD = 'Known things. If one of these is in the picture, draw it as described. Do not add one that is not in the scene.';

type ViewRepos = Pick<RepositoryContainer, 'characters'> & Partial<Pick<RepositoryContainer, 'projects'>>;

/**
 * The view a picture reads: the chat's cast view when there is a chat,
 * otherwise General plus the project's tier. Never throws: a failure is an
 * empty view.
 */
export async function loadImageAtlasView(
  repos: ViewRepos,
  opts: { chat?: AtlasViewChat | null; projectId?: string | null; path: string },
): Promise<AtlasPool> {
  try {
    if (opts.chat) return await loadCastAtlasView(repos, { chat: opts.chat });
    return await loadAtlasViewFor(repos, { characterIds: [], projectId: opts.projectId ?? null });
  } catch (error) {
    logger.warn('[AtlasImageReference] Could not load the Atlas for a picture; continuing without it', {
      path: opts.path,
      chatId: opts.chat?.id ?? null,
      context: 'atlas',
      error: getErrorMessage(error),
    });
    return { entries: [], shadowedCount: 0, unread: [] };
  }
}

/**
 * The things named in `texts` (priority order) that have a graphic prompt,
 * at most `max`. Terms people answer to are excluded when `people` is given.
 */
export function resolveAtlasImageReferences(input: {
  view: AtlasPool;
  texts: ReadonlyArray<string | null | undefined>;
  people?: ReadonlyArray<{ name?: string | null; aliases?: readonly string[] | null }>;
  max?: number;
  /** For the log line. */
  path?: string;
}): KnownThing[] {
  const max = input.max ?? KNOWN_THINGS_MAX;
  const withLook = input.view.entries.filter((entry) => entry.graphicPrompt?.trim());
  if (withLook.length === 0) return [];
  const matcher = buildAtlasMatcher(withLook, { excludeTerms: personTerms(input.people ?? []) });
  const things = findNamedEntries(input.texts, matcher)
    .slice(0, max)
    .map(({ entry }) => ({ name: entry.name, aliases: [...entry.aliases], look: (entry.graphicPrompt as string).trim() }));
  logger.debug('[AtlasImageReference] Resolved things for a picture', {
    path: input.path ?? 'unknown',
    texts: input.texts.filter(Boolean).length,
    candidates: withLook.length,
    things: things.map((t) => t.name),
    context: 'atlas',
  });
  return things;
}

/** The block both crafters receive, or `''`. Pure. */
export function renderKnownThings(things: readonly KnownThing[] | null | undefined): string {
  if (!things || things.length === 0) return '';
  const lines = things.map((t) => `- ${t.name}${t.aliases.length > 0 ? ` (also: ${t.aliases.join(', ')})` : ''}: ${t.look}`);
  return `${KNOWN_THINGS_LEAD}\n${lines.join('\n')}`;
}

/** For a path with no crafter: `"<prompt> <Name>: <look>."` per thing. Pure. */
export function appendKnownThings(prompt: string, things: readonly KnownThing[] | null | undefined): string {
  if (!things || things.length === 0) return prompt;
  const tail = things.map((t) => `${t.name}: ${t.look.replace(/[.\s]+$/, '')}.`).join(' ');
  return `${prompt.replace(/\s+$/, '')} ${tail}`;
}

/**
 * Resolve `{{Name}}` placeholders that name an Atlas term (and no character):
 * each becomes the entry's canonical name, and the entry joins the
 * references. `isCharacter(name)` says whether a placeholder belongs to a
 * character — characters win. Returns the rewritten prompt and the entries'
 * names. Pure.
 */
export function resolveAtlasPlaceholders(
  prompt: string,
  view: AtlasPool,
  isCharacter: (name: string) => boolean,
): { prompt: string; names: string[] } {
  const byTerm = new Map<string, string>();
  for (const entry of view.entries) {
    for (const term of [entry.name, ...entry.aliases]) {
      const key = foldAtlasTerm(term);
      if (key && !byTerm.has(key)) byTerm.set(key, entry.name);
    }
  }
  const names: string[] = [];
  const out = prompt.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (whole, inner: string) => {
    if (isCharacter(inner)) return whole;
    const name = byTerm.get(foldAtlasTerm(inner));
    if (!name) return whole;
    if (!names.includes(name)) names.push(name);
    return name;
  });
  return { prompt: out, names };
}
