/**
 * Side-effect applier — where a custom tool's resolved effects actually land.
 *
 * The execution core (`executeCustomTool`) resolves a run's effects pure —
 * which effect fires, what value it writes — and both entrances hand the
 * result here. This module decides WHERE each write goes and issues the
 * writes, batched one per touched store.
 *
 * ## Progress writes ride inside the metadata replace
 *
 * A `progress.<id>.<field>` effect is a metadata write wearing a hat: the
 * `progressions` key lives inside `metadata.json`, so these fold into the very
 * same `metadataNext` copy and land in the ONE character write below. The
 * job-child contract is untouched — still one whole-object replace, still no
 * read-your-writes.
 *
 * Writing a field of an id nobody authored CREATES the progression with
 * defaults, and effects apply in file order against the local copy, so
 * `endTime` first and `startTime` second is fine: the second sees the first.
 * After every effect is folded, each touched entry is re-validated; one that
 * comes out invalid (an `endTime` no longer after its `startTime`, say) has
 * its writes DROPPED and its pre-run entry restored, with a warning — and the
 * roll still stands. Pascal announces either way; a broken countdown never
 * sinks a hand that has already been dealt.
 *
 * ## "Write where it lives"
 *
 * A `state.<path>` effect lands at the tier whose top-level first path segment
 * already exists, searched in cascade-precedence order chat → project → group
 * → general (the project tier only when the cascade carries a `projectId`, the
 * group tier only under the exactly-one rule, `groupTier.status === 'single'`).
 * A key found nowhere defaults to the CHAT tier — the most local store, the
 * least blast radius. The search runs against the local working copies, so an
 * earlier effect that minted a fresh key at the chat tier pins later writes of
 * that key there too.
 *
 * Known consequence, documented rather than fixed: with two or more applicable
 * groups the cascade's group tier contributes nothing (the exactly-one rule),
 * so a key living only in group state is invisible to this search and the
 * effect shadows it at the chat tier — consistent with what a read of the
 * merged cascade would have shown.
 *
 * ## Job-child safety
 *
 * Every write goes through the buffered `getRepositories()` proxy, and the
 * cascade and metadata snapshot are read once at run start and never re-read —
 * no read-your-writes anywhere (the BACKGROUND_JOBS_CHILD contract). State
 * tiers and character metadata are whole-object replaces, so an effect racing
 * a same-turn `state` call can lose one side; that is the pre-existing
 * accepted risk from state-cascade.md, and re-reading just before the write is
 * deliberately rejected because the job child forbids it.
 *
 * ## Never throws
 *
 * The roll already happened and Pascal still announces. Each store's write is
 * individually try/caught (including `CharacterVaultUnavailableError` when a
 * vault disappears mid-run); a failed store logs a warning and its effects
 * drop from the applied list.
 */

import { logger } from '@/lib/logger';
import { getRepositories } from '@/lib/repositories/factory';
import { writeGeneralState } from '@/lib/mount-index/general-state';
import { getErrorMessage } from '@/lib/error-utils';
import { getAtPath, setAtPath } from '@/lib/state/state-paths';
import type { StateCascadeResult } from '@/lib/state/state-cascade';
import { isApplicableEffect, type ResolvedEffect } from './custom-tools';
import { inferIncrement, UNIT_MS } from '@/lib/progressions/engine';
import {
  PROGRESSIONS_METADATA_KEY,
  ProgressionSchema,
  parseIsoInstant,
  type WritableProgressionField,
} from '@/lib/progressions/schema';

const CONTEXT = 'pascal.side-effects';

/** The four stores a state effect can land in. */
export type EffectTier = 'chat' | 'project' | 'group' | 'general';

/** One write that actually landed — the shape `pascalMeta.effects` records. */
export interface AppliedEffect {
  /** The effect's raw target ("state.encounter.count", "metadata.lockpick"). */
  target: string;
  /** What the store held before, when it held anything. */
  previous?: unknown;
  /** What was written. */
  next: unknown;
  /** Which store a state write landed in. Absent on metadata writes. */
  tier?: EffectTier;
}

export interface ApplyCustomToolEffectsParams {
  chatId: string;
  toolName: string;
  /** The core's resolved effects; skipped entries are ignored here. */
  effects: ResolvedEffect[];
  /**
   * The whole cascade, read once at run start — the RMW base for every state
   * tier. null (the cascade could not be read) → state effects skip fail-soft.
   */
  cascade: StateCascadeResult | null;
  /** The rolling character. null → metadata effects skip fail-soft. */
  characterId: string | null;
  /** The character's fact sheet, hydrated at run start — the metadata RMW base. */
  metadataSnapshot: Record<string, unknown>;
  /**
   * Epoch milliseconds at run start — the same reading `{{now}}` rendered
   * with. Every progression this run touches is stamped `updatedAt` with it,
   * so the character's next prompt reports the change regardless of cadence
   * (a re-armed cannon is announced immediately). Defaults to `Date.now()`.
   */
  nowMs?: number;
}

/** Every store an application may touch, for the ordered commit below. */
type Store = EffectTier | 'metadata';

/**
 * Apply a run's resolved effects. Returns the writes that landed, in effect
 * order, for `pascalMeta.effects`. Never throws.
 */
export async function applyCustomToolEffects(
  params: ApplyCustomToolEffectsParams
): Promise<AppliedEffect[]> {
  const { chatId, toolName, effects, cascade, characterId, metadataSnapshot } = params;
  const nowMs = params.nowMs ?? Date.now();

  const applicable = effects.filter(isApplicableEffect);
  if (applicable.length === 0) return [];

  // Local working copies — read once, mutated in effect order, committed once
  // per touched store. Sequential effects see each other's values through
  // these, never through a store re-read.
  const tiers = cascade
    ? {
        chat: { ...cascade.chatState },
        project: { ...cascade.projectState },
        group: { ...cascade.groupState },
        general: { ...cascade.generalState },
      }
    : null;
  let metadataNext: Record<string, unknown> | null = null;
  /** Progression ids this run touched, and what each held before it did. */
  const progressionsTouched = new Map<string, unknown>();

  const skip = (reason: string, detail: Record<string, unknown> = {}): void => {
    logger.debug('Custom tool effect not applied', { context: CONTEXT, chatId, tool: toolName, reason, ...detail });
  };

  /** Applications in effect order, each tagged with the store it rode. */
  const pending: Array<{ store: Store; entry: AppliedEffect }> = [];

  for (const effect of applicable) {
    const { target, value } = effect;

    if (target.kind === 'metadata') {
      if (!characterId) {
        // A run nobody made writes to nobody's sheet.
        skip('no rolling character, metadata effect skipped', { target: target.raw });
        continue;
      }
      metadataNext ??= { ...metadataSnapshot };
      const previous = metadataNext[target.key];
      metadataNext[target.key] = value;
      pending.push({
        store: 'metadata',
        entry: { target: target.raw, ...(previous !== undefined ? { previous } : {}), next: value },
      });
      continue;
    }

    if (target.kind === 'progress') {
      if (!characterId) {
        // Same asymmetry as a metadata write: a run nobody made re-arms
        // nobody's cannon.
        skip('no rolling character, progress effect skipped', { target: target.raw });
        continue;
      }
      metadataNext ??= { ...metadataSnapshot };
      const applied = applyProgressWrite(metadataNext, target.id, target.field, value, nowMs, progressionsTouched);
      if (!applied.ok) {
        skip(applied.reason, { target: target.raw });
        continue;
      }
      logger.debug('Custom tool progress effect folded', {
        context: CONTEXT,
        chatId,
        tool: toolName,
        target: target.raw,
        previous: applied.previous,
        next: applied.next,
      });
      pending.push({
        store: 'metadata',
        entry: {
          target: target.raw,
          ...(applied.previous !== undefined ? { previous: applied.previous } : {}),
          next: applied.next,
        },
      });
      continue;
    }

    if (!tiers || !cascade) {
      skip('state cascade unavailable, state effect skipped', { target: target.raw });
      continue;
    }

    const first = target.path[0];

    // Underscore guard, re-checked at apply time — defense in depth behind the
    // load-time rejection in `parseEffectTarget`.
    if (typeof first === 'string' && first.startsWith('_')) {
      logger.warn('Custom tool effect refused — underscore-guarded state key', {
        context: CONTEXT,
        chatId,
        tool: toolName,
        target: target.raw,
      });
      continue;
    }

    const tier = resolveTier(tiers, cascade, String(first));
    const store = tiers[tier];
    const previous = getAtPath(store, target.path);
    setAtPath(store, target.path, value);
    pending.push({
      store: tier,
      entry: { target: target.raw, ...(previous !== undefined ? { previous } : {}), next: value, tier },
    });
  }

  // Post-validation. A progression that came out of this run's writes in a
  // state the schema refuses (an `endTime` no longer after its `startTime` is
  // the obvious one) has its entry restored to what it was and every write
  // that touched it struck from the applied list. The roll still stands.
  const droppedProgressions = new Set<string>();
  if (metadataNext && progressionsTouched.size > 0) {
    const record = (metadataNext[PROGRESSIONS_METADATA_KEY] ?? {}) as Record<string, unknown>;
    for (const [id, previous] of progressionsTouched) {
      const entry = record[id];
      // A removal leaves nothing to validate — an absent progression is a
      // perfectly legal outcome, and the only one `remove` can produce.
      if (entry === undefined) continue;
      const result = ProgressionSchema.safeParse(entry);
      if (result.success) continue;

      droppedProgressions.add(id);
      logger.warn('Custom tool progress writes dropped — the result would not validate', {
        context: CONTEXT,
        chatId,
        tool: toolName,
        progressionId: id,
        issue: result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '),
      });
      if (previous === undefined) delete record[id];
      else record[id] = previous;
    }
    // Every touched entry may have been rolled back; don't leave an empty
    // reserved key behind where the character had none.
    if (Object.keys(record).length === 0) delete metadataNext[PROGRESSIONS_METADATA_KEY];
  }

  const survived = (entry: AppliedEffect): boolean => {
    if (!entry.target.startsWith('progress.')) return true;
    const rest = entry.target.slice('progress.'.length);
    return !droppedProgressions.has(rest.slice(0, rest.indexOf('.')));
  };

  // Commit — at most one write per touched store, each individually fail-soft.
  const touched = new Set<Store>(pending.filter((p) => survived(p.entry)).map((p) => p.store));
  const failed = new Set<Store>();
  const repos = getRepositories();

  const commit = async (store: Store, write: () => Promise<unknown>): Promise<void> => {
    if (!touched.has(store)) return;
    try {
      await write();
    } catch (error) {
      failed.add(store);
      logger.warn('Custom tool effect write failed; those effects were dropped', {
        context: CONTEXT,
        chatId,
        tool: toolName,
        store,
        error: getErrorMessage(error),
      });
    }
  };

  await commit('chat', () => repos.chats.update(chatId, { state: tiers!.chat }));
  await commit('project', () => repos.projects.update(cascade!.projectId!, { state: tiers!.project }));
  await commit('group', () => repos.groups.update(cascade!.groupTier.appliedGroupId!, { state: tiers!.group }));
  await commit('general', () => writeGeneralState(tiers!.general));
  await commit('metadata', () => repos.characters.update(characterId!, { metadata: metadataNext! }));

  const applied = pending
    .filter((p) => !failed.has(p.store) && survived(p.entry))
    .map((p) => p.entry);

  if (applied.length > 0) {
    logger.debug('Custom tool effects applied', {
      context: CONTEXT,
      chatId,
      tool: toolName,
      applied: applied.map((entry) => entry.target),
    });
  }

  return applied;
}

/** The default span a created-on-write progression gets: an hour from now. */
const CREATED_PROGRESSION_SPAN_MS = UNIT_MS.hour;

/** What one folded progress write did, or why it did nothing. */
type ProgressWriteResult =
  | { ok: true; previous: unknown; next: unknown }
  | { ok: false; reason: string };

/**
 * Fold one `progress.<id>.<field>` write into the local metadata copy.
 *
 * Creates the progression when the id is new, with defaults chosen so a
 * countdown a tool armed out of nothing is immediately reportable: the id as
 * its name, now as its start, an hour out as its end, and the increment
 * INFERRED from the resulting span. Because effects see each other through
 * this same copy, an `endTime` written first and a `startTime` second both
 * land, and the increment is re-inferred each time either moves — so
 * `{{now}}` / `{{now}} + 600000` yields a recharge that speaks in minutes
 * without the author saying so.
 *
 * Time fields take a NUMBER (epoch milliseconds, the `{{now}} + 600000` idiom)
 * or an ISO string, and normalise to ISO on write.
 *
 * Never throws: a value of the wrong shape declines the write, and the caller
 * logs it as a skip.
 */
function applyProgressWrite(
  metadataNext: Record<string, unknown>,
  id: string,
  field: WritableProgressionField,
  value: unknown,
  nowMs: number,
  touched: Map<string, unknown>
): ProgressWriteResult {
  const existingRecord = metadataNext[PROGRESSIONS_METADATA_KEY];
  const record: Record<string, unknown> =
    typeof existingRecord === 'object' && existingRecord !== null && !Array.isArray(existingRecord)
      ? { ...(existingRecord as Record<string, unknown>) }
      : {};
  metadataNext[PROGRESSIONS_METADATA_KEY] = record;

  // Remember the PRE-RUN entry the first time this run touches this id, so a
  // post-validation rollback restores what the character actually had rather
  // than a half-written intermediate.
  if (!touched.has(id)) touched.set(id, record[id]);

  if (field === 'remove') {
    // Only a truthy write removes: `progress.cannon.remove = false` is most
    // naturally read as "don't remove it", and silently deleting there would
    // be a nasty surprise.
    if (value !== true) return { ok: false, reason: 'progress remove effect wrote a value other than true' };
    const previous = record[id];
    if (previous === undefined) return { ok: false, reason: 'progress remove effect names no such progression' };
    delete record[id];
    return { ok: true, previous, next: null };
  }

  const before = record[id];
  const entry: Record<string, unknown> =
    typeof before === 'object' && before !== null && !Array.isArray(before)
      ? { ...(before as Record<string, unknown>) }
      : {
          name: id,
          startTime: new Date(nowMs).toISOString(),
          endTime: new Date(nowMs + CREATED_PROGRESSION_SPAN_MS).toISOString(),
          timeIncrement: inferIncrement(CREATED_PROGRESSION_SPAN_MS),
        };

  const previous = readProgressionField(entry, field);

  if (field === 'startTime' || field === 'endTime') {
    const iso = normaliseInstant(value);
    if (iso === null) {
      return { ok: false, reason: 'progress time effect wrote neither epoch milliseconds nor an ISO instant' };
    }
    entry[field] = iso;
  } else if (field.startsWith('quantity.')) {
    const quantityKey = field.slice('quantity.'.length);
    const existingQuantity = entry.quantity;
    const quantity: Record<string, unknown> =
      typeof existingQuantity === 'object' && existingQuantity !== null && !Array.isArray(existingQuantity)
        ? { ...(existingQuantity as Record<string, unknown>) }
        : { total: 1, unit: 'units', precision: 1 };
    quantity[quantityKey] = value;
    entry.quantity = quantity;
  } else {
    entry[field] = value;
  }

  // A moved boundary re-infers the increment ONLY on an entry this RUN
  // created: an author who chose 'week' keeps 'week' when a tool nudges a due
  // date, but a countdown minted from nothing has nobody's choice to respect.
  //
  // The test is the PRE-RUN entry, not `before` — by the second effect of a
  // `startTime` then `endTime` pair, `before` is the entry the first effect
  // just minted, and reading it would freeze the increment at the default
  // hour's 'minute' however long the span turned out to be.
  const createdThisRun = touched.get(id) === undefined;
  if (createdThisRun && (field === 'startTime' || field === 'endTime')) {
    const start = parseIsoInstant(entry.startTime);
    const end = parseIsoInstant(entry.endTime);
    if (Number.isFinite(start) && Number.isFinite(end)) entry.timeIncrement = inferIncrement(end - start);
  }

  // Stamped on every touched entry so the next prompt reports the change
  // regardless of cadence — cadence rule 2.
  entry.updatedAt = new Date(nowMs).toISOString();
  record[id] = entry;

  return { ok: true, previous, next: readProgressionField(entry, field) };
}

/** Read one writable field off a progression entry, `quantity.x` included. */
function readProgressionField(entry: Record<string, unknown>, field: WritableProgressionField): unknown {
  if (!field.startsWith('quantity.')) return entry[field];
  const quantity = entry.quantity;
  if (typeof quantity !== 'object' || quantity === null || Array.isArray(quantity)) return undefined;
  return (quantity as Record<string, unknown>)[field.slice('quantity.'.length)];
}

/**
 * A time an effect wrote, as ISO. Epoch milliseconds (what `{{now}} + 600000`
 * evaluates to) and an ISO string are both accepted and both stored as ISO, so
 * the file stays readable however the tool expressed itself.
 */
function normaliseInstant(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'string') {
    const ms = parseIsoInstant(value);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  return null;
}

/**
 * "Write where it lives": the first tier, in cascade-precedence order, whose
 * top-level object already carries the key. Found nowhere → the chat tier.
 */
function resolveTier(
  tiers: Record<EffectTier, Record<string, unknown>>,
  cascade: StateCascadeResult,
  firstSegment: string
): EffectTier {
  const searchable: EffectTier[] = ['chat'];
  if (cascade.projectId) searchable.push('project');
  if (cascade.groupTier.status === 'single') searchable.push('group');
  searchable.push('general');

  for (const tier of searchable) {
    if (Object.prototype.hasOwnProperty.call(tiers[tier], firstSegment)) return tier;
  }
  return 'chat';
}
