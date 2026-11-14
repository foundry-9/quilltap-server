/**
 * Atlas refusals — every "no" the Atlas's mutations can say, each with the
 * `code` the routes answer with. A refusal is a 409 unless it says otherwise;
 * the routes map them in one place (`lib/atlas/routes/responses.ts`).
 *
 * Client-safe: plain classes.
 *
 * @module lib/atlas/errors
 */

export type AtlasRefusalCode = 'NAME_TAKEN' | 'INVALID_SHAPE';

/** The base of every Atlas refusal. */
export class AtlasRefusal extends Error {
  constructor(
    readonly code: AtlasRefusalCode,
    message: string,
    readonly status: 400 | 409 = 409,
    readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'AtlasRefusal';
  }
}

/** A malformed request the schema could not catch (a 400). */
export class AtlasShapeError extends AtlasRefusal {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super('INVALID_SHAPE', message, 400, details);
    this.name = 'AtlasShapeError';
  }
}

/** A live entry in this tier already has that canonical name, case-insensitively (a 409). */
export class AtlasNameTakenError extends AtlasRefusal {
  constructor(readonly entryName: string, readonly existingId: string) {
    super('NAME_TAKEN', `An entry named "${entryName}" is already filed in this tier`, 409, {
      name: entryName,
      existingId,
    });
    this.name = 'AtlasNameTakenError';
  }
}
