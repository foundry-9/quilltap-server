/**
 * The `inventoryAggregate` subject — a derived sheet over everything in one
 * scope of the rolling character's bag (spec pascal-gate-broadening §5.1–5.3).
 *
 * Where `inventory` asks about ONE named object, an aggregate key reads ONE
 * attribute across every object in a scope:
 *
 * - `equipped.names` — the names of everything equipped in this chat;
 * - `owned.metadata.toolAbilities` — every owned object's `toolAbilities`, as a list;
 * - `equipped.metadata.toolVersion.max` — the largest numeric `toolVersion` equipped.
 *
 * The key is `<scope>.<field>`, exactly as a `progress` key is `<id>.<field>`,
 * and the value is compared through the one comparison table
 * (`metadataComparatorHolds`), which compares a list entry by entry. This
 * module only parses keys and builds values; it never compares.
 *
 * Fail-soft in the inventory direction: with no context every test declines;
 * with a real context an empty scope is a fact (a count of 0, an empty list,
 * absent folds).
 *
 * CLIENT-SAFE: pure, no logger, no node built-ins. The Workbench runs it in
 * the browser against the bench's mock bag.
 *
 * @module lib/pascal/inventory-aggregate
 */

import type { MetadataComparator } from './custom-tool.types';
import { isPrimitive, metadataComparatorHolds, type MetadataMatchHooks, type Primitive } from './metadata-match';
import type { InventoryContext } from '@/lib/inventory/refs';

/** Which objects a fold runs over. Cumulative: equipped ⊆ owned ⊆ reachable. */
export const AGGREGATE_SCOPES = ['equipped', 'owned', 'reachable'] as const;
export type AggregateScope = (typeof AGGREGATE_SCOPES)[number];

/** The numeric folds a `metadata.<key>` field may end in. */
export const AGGREGATE_FOLDS = ['min', 'max', 'sum', 'count'] as const;
export type AggregateFold = (typeof AGGREGATE_FOLDS)[number];

/** What an aggregate key reads off each object in its scope. */
export type AggregateField =
  | { kind: 'count' }
  | { kind: 'names' }
  | { kind: 'titles' }
  /** The list of the objects' values for one metadata key. */
  | { kind: 'metadata'; key: string; fold?: undefined }
  /** A number folded from those values. */
  | { kind: 'metadata'; key: string; fold: AggregateFold };

export interface ParsedAggregateKey {
  scope: AggregateScope;
  field: AggregateField;
}

/** One object as the aggregate sheet reads it. */
export interface AggregateObject {
  name: string;
  /** Title, else name — the `{{inventory.<ref>.title}}` rule. */
  title: string;
  metadata: Readonly<Record<string, unknown>>;
}

const METADATA_PREFIX = 'metadata.';

function isScope(value: string): value is AggregateScope {
  return (AGGREGATE_SCOPES as readonly string[]).includes(value);
}

function isFold(value: string): value is AggregateFold {
  return (AGGREGATE_FOLDS as readonly string[]).includes(value);
}

/**
 * Parse `<scope>.<field>`. The one place the grammar lives: the schema's
 * load-time check, the Workbench's validator and the evaluator all delegate
 * here.
 *
 * In a `metadata.` field, a LAST dotted segment that is a fold word (with
 * something before it) is the fold; otherwise the whole rest is the key. So
 * `equipped.metadata.toolVersion.max` folds `toolVersion`, and
 * `equipped.metadata.a.b` lists the key `a.b`.
 */
export function parseAggregateKey(
  key: string
): { ok: true; parsed: ParsedAggregateKey } | { ok: false; reason: string } {
  const dot = key.indexOf('.');
  if (dot <= 0) {
    return { ok: false, reason: `"${key}" must be <scope>.<field>, where the scope is ${AGGREGATE_SCOPES.join(', ')}` };
  }
  const scope = key.slice(0, dot);
  if (!isScope(scope)) {
    return { ok: false, reason: `"${scope}" is not a scope; use ${AGGREGATE_SCOPES.join(', ')}` };
  }
  const rest = key.slice(dot + 1);
  if (rest === 'count' || rest === 'names' || rest === 'titles') {
    return { ok: true, parsed: { scope, field: { kind: rest } } };
  }
  if (rest.startsWith(METADATA_PREFIX) && rest.length > METADATA_PREFIX.length) {
    const path = rest.slice(METADATA_PREFIX.length);
    const lastDot = path.lastIndexOf('.');
    if (lastDot > 0) {
      const last = path.slice(lastDot + 1);
      if (isFold(last)) {
        return { ok: true, parsed: { scope, field: { kind: 'metadata', key: path.slice(0, lastDot), fold: last } } };
      }
    }
    return { ok: true, parsed: { scope, field: { kind: 'metadata', key: path } } };
  }
  return {
    ok: false,
    reason: `"${rest}" is not a field; use count, names, titles, or metadata.<key> (optionally ending .min, .max, .sum or .count)`,
  };
}

/** True when an aggregate key reads as a list (and so declines ordering). */
export function isListAggregate(parsed: ParsedAggregateKey): boolean {
  const { field } = parsed;
  return field.kind === 'names' || field.kind === 'titles' || (field.kind === 'metadata' && field.fold === undefined);
}

/**
 * True when a `metadata.<key>` field's own last segment is a fold word — the
 * key `stats.max` cannot be read as a plain list, because the parser takes
 * `.max` as the fold. The Workbench warns about it.
 */
export function aggregateKeyEndsInFold(parsed: ParsedAggregateKey): boolean {
  return parsed.field.kind === 'metadata' && parsed.field.fold !== undefined;
}

/** The primitives one object contributes for a metadata key: a primitive, or each primitive of an array. */
function entriesOf(value: unknown): Primitive[] {
  if (isPrimitive(value)) return [value];
  if (Array.isArray(value)) return value.filter(isPrimitive);
  return [];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The aggregate sheet's value for one parsed key: a number, a list of
 * primitives, or `undefined` (absent — a fold with nothing numeric to fold).
 */
export function aggregateValue(
  parsed: ParsedAggregateKey,
  objects: readonly AggregateObject[]
): number | Primitive[] | undefined {
  const { field } = parsed;
  switch (field.kind) {
    case 'count':
      return objects.length;
    case 'names':
      return objects.map((object) => object.name);
    case 'titles':
      return objects.map((object) => object.title);
    case 'metadata': {
      const perObject = objects
        .filter((object) => Object.prototype.hasOwnProperty.call(object.metadata, field.key))
        .map((object) => entriesOf(object.metadata[field.key]));
      if (field.fold === undefined) return perObject.flat();

      const numericPerObject = perObject.map((entries) => entries.filter(isFiniteNumber));
      if (field.fold === 'count') return numericPerObject.filter((entries) => entries.length > 0).length;
      const numbers = numericPerObject.flat();
      if (numbers.length === 0) return undefined;
      if (field.fold === 'min') return Math.min(...numbers);
      if (field.fold === 'max') return Math.max(...numbers);
      return numbers.reduce((total, n) => total + n, 0);
    }
  }
}

/**
 * Whether one `inventoryAggregate` test holds. Builds the sheet value and
 * hands it to the one comparison table — a number compares as a number, a
 * list entry by entry, an absent fold declines.
 */
export function inventoryAggregateHolds(
  comparator: MetadataComparator,
  key: string,
  ctx: InventoryContext | null | undefined,
  hooks: MetadataMatchHooks
): boolean {
  if (!ctx) {
    hooks.onDecline?.('no inventory to aggregate (nobody in particular rolled, or the vault could not be read)');
    return false;
  }
  const parsed = parseAggregateKey(key);
  if (!parsed.ok) {
    hooks.onDecline?.(parsed.reason);
    return false;
  }
  const value = aggregateValue(parsed.parsed, ctx.scopeObjects(parsed.parsed.scope));
  return metadataComparatorHolds(comparator, key, value === undefined ? {} : { [key]: value }, hooks);
}

/** The sheet value for a key against a context, for a caller that logs it. Null when it cannot be read. */
export function describeAggregateValue(
  key: string,
  ctx: InventoryContext | null | undefined
): number | string | null {
  if (!ctx) return null;
  const parsed = parseAggregateKey(key);
  if (!parsed.ok) return null;
  const value = aggregateValue(parsed.parsed, ctx.scopeObjects(parsed.parsed.scope));
  if (value === undefined) return 'absent';
  return Array.isArray(value) ? `list of ${value.length}` : value;
}
