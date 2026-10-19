/**
 * Inventory refusals — every "no" the Inventory's mutations and equip can
 * say, each with the `code` the routes answer with (spec §5.8). A refusal is
 * a 409 unless it says otherwise; the routes map them in one place.
 *
 * Client-safe: plain classes.
 *
 * @module lib/inventory/errors
 */

export type InventoryRefusalCode =
  | 'ARCHETYPE_IN_USE'
  | 'ARCHIVED_DEPENDENTS'
  | 'NOT_COPYABLE'
  | 'CAP_EXCEEDED'
  | 'INVALID_PARENT'
  | 'KIT_NESTING'
  | 'KIT_STRANDED'
  | 'NOT_EQUIPPABLE'
  | 'INVALID_SHAPE'
  | 'NOT_A_PARTICIPANT'
  | 'OFF_ROSTER';

/** The base of every Inventory refusal. */
export class InventoryRefusal extends Error {
  constructor(
    readonly code: InventoryRefusalCode,
    message: string,
    readonly status: 400 | 409 = 409,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'InventoryRefusal';
  }
}

/**
 * A character's own gesture (a tool call, a custom tool's effect) reached for
 * an object on the project's shelf while the project's roster does not admit
 * them (`lib/inventory/roster-gate.ts`).
 */
export class InventoryOffRosterError extends InventoryRefusal {
  constructor(readonly itemNames: string[]) {
    super(
      'OFF_ROSTER',
      `${itemNames.map((name) => `"${name}"`).join(', ')} ${itemNames.length === 1 ? 'is' : 'are'} on the project's shelf, and you are not on this project's character roster. Ask the user to add you to the roster in the project's Characters card.`,
      409,
      { itemNames },
    );
    this.name = 'InventoryOffRosterError';
  }
}

/** A holder of one archetype's instance. */
export interface DependentHolder {
  scope: string;
  ownerId: string | null;
  ownerName: string | null;
}

/** An archetype with instances cannot be deleted (or stop being one) without `force`. */
export class InventoryArchetypeInUseError extends InventoryRefusal {
  constructor(readonly dependents: number, readonly holders: DependentHolder[]) {
    super(
      'ARCHETYPE_IN_USE',
      `${dependents} ${dependents === 1 ? 'object derives' : 'objects derive'} from it`,
      409,
      { dependents, holders },
    );
    this.name = 'InventoryArchetypeInUseError';
  }
}

/** A forced delete or detach-all would have to write an archived character's vault. */
export class InventoryArchivedDependentsError extends InventoryRefusal {
  constructor(readonly characters: Array<{ id: string | null; name: string | null }>) {
    super(
      'ARCHIVED_DEPENDENTS',
      `Instances live in archived characters' vaults, which cannot be changed: ${characters
        .map((c) => c.name ?? c.id ?? 'unknown')
        .join(', ')}`,
      409,
      { characters },
    );
    this.name = 'InventoryArchivedDependentsError';
  }
}

/** The object has `canCopy: false`. */
export class InventoryNotCopyableError extends InventoryRefusal {
  constructor(readonly itemIds: string[]) {
    super('NOT_COPYABLE', `Cannot be copied: ${itemIds.join(', ')}`, 409, { itemIds });
    this.name = 'InventoryNotCopyableError';
  }
}

/** Equipping would carry more kin than the object's `maxEquipped`. */
export class InventoryCapExceededError extends InventoryRefusal {
  constructor(readonly itemId: string, readonly itemName: string, readonly cap: number) {
    super(
      'CAP_EXCEEDED',
      `"${itemName}" can be carried at most ${cap} at a time`,
      409,
      { itemId, itemName, cap },
    );
    this.name = 'InventoryCapExceededError';
  }
}

/** A parent that is not a reachable archetype, or an archetype flag where none may be. */
export class InventoryInvalidParentError extends InventoryRefusal {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('INVALID_PARENT', message, 409, details);
    this.name = 'InventoryInvalidParentError';
  }
}

/** A kit may not name a kit. */
export class InventoryKitNestingError extends InventoryRefusal {
  constructor(readonly memberIds: string[]) {
    super('KIT_NESTING', `A kit cannot contain another kit: ${memberIds.join(', ')}`, 409, { memberIds });
    this.name = 'InventoryKitNestingError';
  }
}

/**
 * A move would leave kits naming an object they could no longer reach from
 * their own tier (a vault kit's member sent to another character, say).
 */
export class InventoryKitStrandedError extends InventoryRefusal {
  constructor(
    readonly itemId: string,
    readonly kits: Array<{ id: string; name: string | null; ownerName: string | null }>,
  ) {
    super(
      'KIT_STRANDED',
      `Moving this would strand it from ${kits.length} kit${kits.length === 1 ? '' : 's'} that name it: ${kits
        .map((k) => k.name ?? k.id)
        .join(', ')}`,
      409,
      { itemId, kits },
    );
    this.name = 'InventoryKitStrandedError';
  }
}

/** An archetype or an archived object cannot be equipped. */
export class InventoryNotEquippableError extends InventoryRefusal {
  constructor(readonly itemId: string, reason: 'archetype' | 'archived' | 'kit' | 'missing') {
    super('NOT_EQUIPPABLE', `Object ${itemId} cannot be carried (${reason})`, 409, { itemId, reason });
    this.name = 'InventoryNotEquippableError';
  }
}

/** The object breaks the shape rules, or names members that do not exist (a 400). */
export class InventoryShapeError extends InventoryRefusal {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('INVALID_SHAPE', message, 400, details);
    this.name = 'InventoryShapeError';
  }
}
