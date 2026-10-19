/**
 * The Inventory title lint — a title may not shadow a kind name or a live
 * gate key, and a title that stops answering rings a bell.
 *
 * `resolveInventoryRef` matches id → title → name and stops at the first
 * round that matches anything (`refs.ts`). A title equal to a string some
 * gate or reference means by NAME wins the title round, the name round never
 * runs, and the reference quietly lands on the wrong object — or a gated
 * tool goes dark — with no error anywhere.
 *
 * ## The event, not the field
 *
 * The lint is handed the object as it was before a write and as it will be
 * after (either may be null), and asks one question: **does the set of
 * reachable titled objects change?** A title enters when the object becomes
 * reachable under a title it did not answer to before — a create, a rename,
 * a restore from the archive, a move into `Inventory/` — or when its name
 * changes under a standing title (its own name is a kind name). A title
 * leaves when the object stops answering to it — a rename, an archive, a
 * delete, a move out. Anything else (a description, a folder) is neither.
 *
 * ## Entering: two protected sets, fail closed
 *
 * After {@link normalizeTitle}, an entering title is checked against:
 *
 *   1. **Kind names** — the resolved `name` of every object the writing
 *      location's pool reaches, the object's own included. Flat reject
 *      (`kind-name shadow`).
 *   2. **Gate keys in use** — every literal `inventory` / `inventoryCount`
 *      key in any tool's `availableWhen` / `withheldWhen`
 *      (`lib/pascal/tool-gate-keys.ts`), resolved against the pool with the
 *      object left out: landing on some other object is `live gate shadow`
 *      (reject); landing on nothing means the object is the gate's target
 *      (`gate key naming`, pass, one row).
 *
 * If the pool or any tool file cannot be read, an entering title is refused,
 * naming what could not be read: "could not look" is not "nothing to collide
 * with".
 *
 * ## Leaving: a bell, never a refusal
 *
 * A title that leaves while a gate keys on it gets a row, alert on: `gate
 * dark` (the key now resolves to nothing), `gate redirected: <owner>` (to some
 * other object), or `gate unverifiable: <what>` (a mount or tool file could
 * not be read, so which emergency it is cannot be told). `gate key moved`
 * (still lands on this object by name) is not an alert.
 *
 * ## Evidence
 *
 * Every invocation writes one `debug` census line naming the pools and tool
 * stores the protected set was built from and their sizes — so "the lint
 * looked and passed" is distinguishable from "the lint was never called".
 * Rows are `info`, written only after the write they describe succeeds
 * ({@link writeTitleLintRows}); a clean pass writes no row.
 *
 * Two layers call it: the Inventory mutations (`item-mutations.ts`) and the
 * document-write layer (`title-lint-documents.ts`), which catches edits made
 * with ordinary document tools.
 *
 * Server-only.
 *
 * @module lib/inventory/title-lint
 */

import { logger } from '@/lib/logger';
import { getRepositories, type RepositoryContainer } from '@/lib/repositories/factory';
import type { InventoryRecord, ResolvedInventoryItem } from '@/lib/schemas/inventory.types';
import {
  InventoryTitleCheckUnavailableError,
  InventoryTitleShadowError,
  type InventoryTitleCollision,
  type InventoryTitleLintUnread,
} from '@/lib/inventory/errors';
import type { InventoryLocation } from '@/lib/inventory/location';
import { loadPoolForLocation, type InventoryPool } from '@/lib/inventory/pool';
import { resolveInventoryRef, type ResolvedInventoryPool } from '@/lib/inventory/refs';
import { resolveItem } from '@/lib/inventory/resolve';
import type { ToolGateKeyCensus, ToolGateKeyUse } from '@/lib/pascal/tool-gate-keys';

type Repos = Pick<RepositoryContainer, 'characters' | 'chats'>;

/**
 * Fold a title for comparison: the resolver's own fold (`trim` +
 * `toLowerCase`) first, then whitespace collapsed, diacritics stripped and
 * case folded again. Starting from the resolver's fold guarantees the lint is
 * never looser than the door it guards: any two strings the resolver calls
 * equal, this calls equal. Punctuation, apostrophes included, is kept.
 */
export function normalizeTitle(value: string | null | undefined): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** Which door the write came through; for logs and the census line. */
export type TitleLintDoor =
  | 'create'
  | 'update'
  | 'archive'
  | 'delete'
  | 'document-write'
  | 'document-delete'
  | 'document-move';

export interface TitleLintRequest {
  door: TitleLintDoor;
  /** The object as stored before the write; null on a create. */
  before: InventoryRecord | null;
  /** The object as it will be stored after the write; null on a delete or a move out. */
  after: InventoryRecord | null;
}

/** A row to write once the write succeeds. */
export type TitleLintRow =
  | { reason: 'gate key naming'; title: string; tools: string[] }
  | { reason: 'gate dark'; gateKey: string; tools: string[] }
  | { reason: 'gate redirected'; gateKey: string; tools: string[]; newOwners: string[] }
  | { reason: 'gate unverifiable'; gateKey: string; tools: string[]; unread: string[] }
  | { reason: 'gate key moved'; gateKey: string; tools: string[] };

export interface TitleLintVerdict {
  /** What the write did to the reachable titled set. */
  event: { entering: boolean; leaving: boolean };
  rows: TitleLintRow[];
}

export interface TitleLintOptions {
  /** The location's pool, when the caller already has it. */
  pool?: InventoryPool;
  /** The project context a character's pool is read in. */
  context?: { projectId?: string | null; chatId?: string | null };
  /** Injected census (tests); otherwise `collectToolGateKeys`. */
  census?: () => Promise<ToolGateKeyCensus>;
}

/** The resolved view of one side of the write. */
interface Side {
  id: string;
  title: string;
  name: string;
  reachable: boolean;
}

async function takeCensus(opts: TitleLintOptions): Promise<ToolGateKeyCensus> {
  if (opts.census) return opts.census();
  // Imported lazily: the custom-tools module reaches back into the Inventory
  // (gate subjects, effects), and the census is needed only on a lint call.
  const { collectToolGateKeys } = await import('@/lib/pascal/tool-gate-keys');
  return collectToolGateKeys();
}

async function mountName(mountPointId: string): Promise<string | null> {
  try {
    return (await getRepositories().docMountPoints.findById(mountPointId))?.name ?? null;
  } catch {
    return null;
  }
}

const storeLabel = (id: string, name: string | null) => (name ? `store "${name}"` : `store ${id}`);

/** How an object is named in a message or row. */
function describeItem(item: ResolvedInventoryItem): string {
  const label = item.title || item.name;
  return item.origin?.name ? `${label} (${item.origin.name})` : label;
}

/** What one lint call read: the pool and census, and everything it could not read. */
interface Reading {
  pool: InventoryPool | null;
  census: ToolGateKeyCensus | null;
  /** Unread pools and tool files, by name; non-empty means the protected set is incomplete. */
  unread: InventoryTitleLintUnread[];
  /** Pools read, by name. */
  pools: string[];
}

/**
 * Read the pool and the census, never throwing: every failure lands in
 * `unread`, named. A consulted store that does not exist reads as an empty
 * folder, so it is checked for and counted as unread too.
 */
async function read(repos: Repos, location: InventoryLocation, opts: TitleLintOptions): Promise<Reading> {
  const unread: InventoryTitleLintUnread[] = [];
  const pools: string[] = [];

  let pool: InventoryPool | null = null;
  try {
    pool = opts.pool ?? (await loadPoolForLocation(repos, location, opts.context ?? {}));
  } catch (error) {
    unread.push({
      pool: `the ${location.scope} inventory "${location.origin.name || location.mountPointId}"`,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  if (pool) {
    const failed = new Set(pool.unreadMounts.map((u) => u.mountPointId));
    for (const { mountPointId, error } of pool.unreadMounts) {
      unread.push({ pool: `the inventory in ${storeLabel(mountPointId, await mountName(mountPointId))}`, reason: error });
    }
    for (const mountPointId of new Set(pool.consultedMounts)) {
      if (failed.has(mountPointId)) continue;
      const name = await mountName(mountPointId);
      if (name === null) {
        unread.push({ pool: `the inventory in store ${mountPointId}`, reason: 'no such store; an empty read from it is not an answer' });
      } else {
        pools.push(storeLabel(mountPointId, name));
      }
    }
  }

  let census: ToolGateKeyCensus | null = null;
  try {
    census = await takeCensus(opts);
    for (const u of census.unread) unread.push({ pool: `${u.definitionPath} in store "${u.mountName}"`, reason: u.reason });
  } catch (error) {
    unread.push({ pool: "the custom tools' Tools/ folders", reason: error instanceof Error ? error.message : String(error) });
  }

  return { pool, census, unread, pools };
}

/** One side of the write, resolved against the pool (raw when the pool could not be read). */
function sideOf(record: InventoryRecord | null, pool: InventoryPool | null): Side | null {
  if (!record) return null;
  const resolved = pool ? pool.resolve(record) : resolveItem(record, () => undefined);
  return {
    id: record.id,
    title: resolved.title?.trim() ?? '',
    name: resolved.name ?? '',
    // An archetype counts: its title is inherited by every instance that does not override it.
    reachable: !resolved.archivedAt,
  };
}

/** The pool as the resolver sees it, the object replaced by `replacement` (or left out). */
function resolvedWith(pool: InventoryPool, itemId: string, replacement: Side | null): ResolvedInventoryPool {
  const items = pool.resolved().flatMap((item) => {
    if (item.id !== itemId) return [item];
    return replacement?.reachable ? [{ ...item, title: replacement.title || null, name: replacement.name }] : [];
  });
  return { items, owns: (id) => pool.owns(id) };
}

/** Gate uses for one normalized key, grouped by the ref as written. */
function usesOf(census: ToolGateKeyCensus, key: string): Map<string, ToolGateKeyUse[]> {
  const out = new Map<string, ToolGateKeyUse[]>();
  for (const use of census.keys) {
    if (normalizeTitle(use.ref) !== key) continue;
    out.set(use.ref, [...(out.get(use.ref) ?? []), use]);
  }
  return out;
}

const uniqueTools = (uses: readonly ToolGateKeyUse[]) => Array.from(new Set(uses.map((u) => u.toolName))).sort();

/**
 * Lint one write. Throws {@link InventoryTitleShadowError} on a collision
 * and {@link InventoryTitleCheckUnavailableError} when an entering title
 * cannot be checked; otherwise returns the rows to write once the write
 * succeeds.
 */
export async function lintInventoryTitle(
  repos: Repos,
  location: InventoryLocation,
  request: TitleLintRequest,
  opts: TitleLintOptions = {},
): Promise<TitleLintVerdict> {
  const reading = await read(repos, location, opts);
  const { pool, census } = reading;
  const before = sideOf(request.before, pool);
  const after = sideOf(request.after, pool);
  const itemId = (after ?? before)?.id ?? '';

  const beforeKey = before?.reachable ? normalizeTitle(before.title) : '';
  const afterKey = after?.reachable ? normalizeTitle(after.title) : '';
  const nameChanged = !!before && !!after && normalizeTitle(before.name) !== normalizeTitle(after.name);
  const entering = !!afterKey && (afterKey !== beforeKey || nameChanged);
  const leaving = !!beforeKey && beforeKey !== afterKey;

  const meta = { door: request.door, itemId, scope: location.scope, mountPointId: location.mountPointId, context: 'inventory' };
  logger.debug('[InventoryTitleLint] Census', {
    ...meta,
    entering,
    leaving,
    pools: reading.pools,
    reachableObjects: pool?.byId.size ?? null,
    toolStores: census?.storesConsulted ?? [],
    gateKeys: census?.keys.length ?? null,
    unread: reading.unread,
  });

  const rows: TitleLintRow[] = [];

  if (entering) {
    const title = after!.title;
    if (reading.unread.length > 0 || !pool || !census) {
      logger.info('[InventoryTitleLint] Title refused: protected set incomplete', { ...meta, title, unread: reading.unread });
      throw new InventoryTitleCheckUnavailableError(title, reading.unread);
    }
    const collisions: InventoryTitleCollision[] = [];

    // 1. Kind names: every reachable object's name, the object's own (new) one included.
    const kindNames = new Map<string, string>([[normalizeTitle(after!.name), after!.name]]);
    for (const record of pool.byId.values()) {
      if (record.id === itemId) continue;
      const { name } = pool.resolve(record);
      const key = normalizeTitle(name);
      if (key && !kindNames.has(key)) kindNames.set(key, name);
    }
    const kindName = kindNames.get(afterKey);
    if (kindName !== undefined) collisions.push({ reason: 'kind-name shadow', kindName });

    // 2. Gate keys: shadowing when the key lands elsewhere, naming when it lands nowhere.
    const naming: ToolGateKeyUse[] = [];
    const others = resolvedWith(pool, itemId, null);
    for (const [ref, refUses] of usesOf(census, afterKey)) {
      const hits = resolveInventoryRef(ref, others, new Set());
      if (hits.length === 0) {
        naming.push(...refUses);
        continue;
      }
      for (const toolName of uniqueTools(refUses)) {
        collisions.push({ reason: 'live gate shadow', toolName, ref, landsOn: hits.map((h) => describeItem(h.item)) });
      }
    }

    if (collisions.length > 0) {
      logger.info('[InventoryTitleLint] Title rejected', { ...meta, title, collisions });
      throw new InventoryTitleShadowError(title, collisions);
    }
    if (naming.length > 0) rows.push({ reason: 'gate key naming', title, tools: uniqueTools(naming) });
  }

  if (leaving) rows.push(...leavingRows(reading, before!, after, itemId));

  return { event: { entering, leaving }, rows };
}

/** Where the gate keys a leaving title leaves behind now land. */
function leavingRows(reading: Reading, before: Side, after: Side | null, itemId: string): TitleLintRow[] {
  const { pool, census } = reading;
  const unreadNames = reading.unread.map((u) => u.pool);
  if (!census) {
    // The tool files themselves could not be listed: whether this title was a gate key is unknown.
    return [{ reason: 'gate unverifiable', gateKey: before.title, tools: [], unread: unreadNames }];
  }
  const rows: TitleLintRow[] = [];
  for (const [ref, refUses] of usesOf(census, normalizeTitle(before.title))) {
    const tools = uniqueTools(refUses);
    if (!pool) {
      rows.push({ reason: 'gate unverifiable', gateKey: ref, tools, unread: unreadNames });
      continue;
    }
    const hits = resolveInventoryRef(ref, resolvedWith(pool, itemId, after), new Set());
    const others = hits.filter((h) => h.item.id !== itemId);
    if (others.length > 0) {
      rows.push({ reason: 'gate redirected', gateKey: ref, tools, newOwners: others.map((h) => describeItem(h.item)) });
    } else if (hits.length > 0) {
      rows.push({ reason: 'gate key moved', gateKey: ref, tools });
    } else if (reading.unread.length > 0) {
      // Dark here, but an unread mount may hold the title: which emergency cannot be told.
      rows.push({ reason: 'gate unverifiable', gateKey: ref, tools, unread: unreadNames });
    } else {
      rows.push({ reason: 'gate dark', gateKey: ref, tools });
    }
  }
  if (census.unread.length > 0 && rows.length === 0) {
    // A tool file that could not be read may key on this title.
    rows.push({ reason: 'gate unverifiable', gateKey: before.title, tools: [], unread: unreadNames });
  }
  return rows;
}

const ALERTS: ReadonlySet<TitleLintRow['reason']> = new Set(['gate dark', 'gate redirected', 'gate unverifiable']);

/** Write a verdict's rows, once the write they describe has succeeded. */
export function writeTitleLintRows(
  verdict: TitleLintVerdict,
  itemId: string,
  location: Pick<InventoryLocation, 'scope' | 'mountPointId'>,
): void {
  for (const row of verdict.rows) {
    const reason =
      row.reason === 'gate redirected'
        ? `gate redirected: ${row.newOwners.join(', ')}`
        : row.reason === 'gate unverifiable'
          ? `gate unverifiable: ${row.unread.join('; ')}`
          : row.reason;
    const message =
      row.reason === 'gate key naming'
        ? 'Title doubles as address and gate key'
        : row.reason === 'gate key moved'
          ? 'A gate key was left behind; it still lands on this object by name'
          : 'A gate key was left behind';
    logger.info(`[InventoryTitleLint] ${message}`, {
      ...row,
      reason,
      itemId,
      scope: location.scope,
      mountPointId: location.mountPointId,
      alert: ALERTS.has(row.reason),
      context: 'inventory',
    });
  }
}
