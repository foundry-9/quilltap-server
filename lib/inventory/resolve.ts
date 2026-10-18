/**
 * Inventory resolution — what an object *is* once its archetype is filled in.
 *
 * Inheritance is sparse overrides resolved at read time (spec §2): an
 * instance's file stores `parentId` plus only the fields it overrides; the
 * resolved object is the archetype's inheritable fields overlaid with the
 * instance's own, `metadata` merged shallowly key by key. Identity, shape,
 * filing and timestamps are always the instance's. A standalone, archetype or
 * kit resolves to itself. An instance whose archetype cannot be found
 * resolves to its own fields with `parentMissing: true`.
 *
 * Every reader outside the writer sees resolved objects.
 *
 * Client-safe: pure.
 *
 * @module lib/inventory/resolve
 */

import {
  INVENTORY_INHERITABLE_FIELDS,
  type InventoryInheritableField,
  type InventoryItem,
  type InventoryOrigin,
  type InventoryRecord,
  type KitState,
  type ResolvedInventoryItem,
} from '@/lib/schemas/inventory.types';

/** A record as a pool holds it: where it lives, alongside what it says. */
export type InventoryRecordWithOrigin = InventoryRecord & { origin: InventoryOrigin; mountPointId?: string };

/** Fill the schema defaults into a (possibly sparse) record. */
export function withInventoryDefaults(record: InventoryRecord): InventoryItem {
  const { fileStem, ...rest } = record;
  return {
    kind: 'item',
    equippedByDefault: false,
    maxEquipped: 1,
    canCopy: false,
    isArchetype: false,
    itemIds: [],
    metadata: {},
    ...stripUndefined(rest),
    name: rest.name ?? fileStem ?? 'Unnamed object',
    parentId: rest.parentId ?? null,
    folder: rest.folder ?? '',
  } as InventoryItem;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** The inheritable fields an instance's own file sets. */
export function overriddenFieldsOf(record: InventoryRecord): InventoryInheritableField[] {
  const source = record as unknown as Record<string, unknown>;
  return INVENTORY_INHERITABLE_FIELDS.filter((field) => source[field] !== undefined);
}

/**
 * Resolve one record. `lookup` finds the archetype by id (a pool walk, or an
 * instance-wide parent map). Pure.
 */
export function resolveItem(
  record: InventoryRecordWithOrigin | InventoryRecord,
  lookup: (id: string) => InventoryRecord | undefined,
): ResolvedInventoryItem {
  const origin = (record as InventoryRecordWithOrigin).origin;
  if (!record.parentId) {
    return { ...withInventoryDefaults(record), ...(origin && { origin }) };
  }

  const overriddenFields = overriddenFieldsOf(record);
  const parent = lookup(record.parentId);
  if (!parent || !parent.isArchetype) {
    return {
      ...withInventoryDefaults(record),
      kind: 'item',
      isArchetype: false,
      itemIds: [],
      overriddenFields,
      parentMissing: true,
      parentName: null,
      ...(origin && { origin }),
    };
  }

  const base = withInventoryDefaults(parent);
  const own = record as unknown as Record<string, unknown>;
  const inherited: Record<string, unknown> = {};
  for (const field of INVENTORY_INHERITABLE_FIELDS) {
    inherited[field] = own[field] !== undefined ? own[field] : (base as unknown as Record<string, unknown>)[field];
  }
  inherited.metadata = { ...(base.metadata ?? {}), ...((record.metadata as Record<string, unknown> | undefined) ?? {}) };

  return {
    ...(inherited as Pick<InventoryItem, InventoryInheritableField>),
    id: record.id,
    kind: 'item',
    isArchetype: false,
    parentId: record.parentId,
    itemIds: [],
    folder: record.folder ?? '',
    archivedAt: record.archivedAt ?? null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    overriddenFields,
    parentMissing: false,
    parentName: base.title || base.name,
    ...(origin && { origin }),
  } as ResolvedInventoryItem;
}

/** The display name: `Excalibur (sword)` when both differ, else the one there is. */
export function inventoryDisplayName(item: Pick<InventoryItem, 'name' | 'title'>): string {
  const title = item.title?.trim();
  if (title && title.toLowerCase() !== item.name.trim().toLowerCase()) return `${title} (${item.name})`;
  return title || item.name;
}

/** The short label: title, else name. */
export function inventoryLabel(item: Pick<InventoryItem, 'name' | 'title'>): string {
  return item.title?.trim() || item.name;
}

/** Kin share a resolved name, case-insensitively. */
export function isKin(a: Pick<InventoryItem, 'name'>, b: Pick<InventoryItem, 'name'>): boolean {
  return a.name.trim().toLowerCase() === b.name.trim().toLowerCase();
}

/** An object that can be carried: not an archetype, not a kit, not archived. */
export function isEquippable(item: Pick<InventoryItem, 'isArchetype' | 'kind' | 'archivedAt'>): boolean {
  return !item.isArchetype && item.kind !== 'kit' && !item.archivedAt;
}

/**
 * A kit's state in a chat: how many of its resolvable members are carried.
 * An archetype member counts as carried when an instance of it is.
 */
export function kitState(
  kit: Pick<InventoryItem, 'itemIds'>,
  equipped: readonly Pick<InventoryItem, 'id' | 'parentId'>[],
  resolvable: (id: string) => Pick<InventoryItem, 'isArchetype' | 'kind' | 'archivedAt'> | undefined,
): KitState {
  const ids = new Set(equipped.map((item) => item.id));
  const parents = new Set(equipped.map((item) => item.parentId).filter((id): id is string => !!id));
  let total = 0;
  let carried = 0;
  for (const memberId of kit.itemIds) {
    const member = resolvable(memberId);
    if (!member || member.kind === 'kit' || member.archivedAt) continue;
    total++;
    if (member.isArchetype ? parents.has(memberId) : ids.has(memberId)) carried++;
  }
  if (total === 0 || carried === 0) return 'none';
  return carried === total ? 'all' : 'some';
}
