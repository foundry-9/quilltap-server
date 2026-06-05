/**
 * Regression tests for "manifesto is nullable / optional".
 *
 * The manifesto is a character's axiomatic core, synced as `manifesto.md` in the
 * vault. It was added in 4.4.0 as a nullable TEXT column (null = not set). A
 * later bug (commit 12811c18) flagged manifesto-less characters as "incomplete"
 * because manifesto had been treated as required. These tests lock the invariant
 * at the two layers that actually decide it:
 *
 *  1. The data model — `CharacterSchema` must accept a null, undefined, or
 *     string manifesto, and a fully-valid character with NO manifesto must parse.
 *  2. The vault read overlay — an empty `manifesto.md` must collapse to `null`
 *     (the "unset" state the nullable schema expects), not an empty string that
 *     would read as "present but blank".
 *
 * If someone makes manifesto required again — in the schema or by changing the
 * empty-string collapse — one of these fails.
 */

import { describe, it, expect } from '@jest/globals';
import { CharacterSchema } from '@/lib/schemas/character.types';
import { markdownToNullable } from '@/lib/database/repositories/vault-overlay/parsers';

// A minimal, otherwise-complete character. CharacterSchema requires only
// id/userId/name/createdAt/updatedAt; everything else is optional or defaulted.
function baseCharacter(overrides: Record<string, unknown> = {}) {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    name: 'Test Character',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('manifesto nullability — CharacterSchema', () => {
  it('accepts an explicit null manifesto', () => {
    const result = CharacterSchema.safeParse(baseCharacter({ manifesto: null }));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.manifesto).toBeNull();
    }
  });

  it('accepts an omitted manifesto (undefined)', () => {
    // Note: baseCharacter() deliberately omits manifesto entirely.
    const result = CharacterSchema.safeParse(baseCharacter());
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.manifesto).toBeUndefined();
    }
  });

  it('accepts a string manifesto', () => {
    const result = CharacterSchema.safeParse(
      baseCharacter({ manifesto: 'I exist to protect the lighthouse.' })
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.manifesto).toBe('I exist to protect the lighthouse.');
    }
  });

  it('validates a fully-complete character that has no manifesto (the "incomplete" regression)', () => {
    // The 12811c18 bug reported valid, content-rich characters as incomplete
    // purely because manifesto was absent. A populated character minus manifesto
    // must be unambiguously valid.
    const result = CharacterSchema.safeParse(
      baseCharacter({
        identity: 'A retired sea captain.',
        description: 'Speaks in clipped, salt-worn sentences.',
        personality: 'Fiercely loyal, privately grieving.',
        firstMessage: 'You again. Sit, then.',
        // manifesto intentionally absent
      })
    );
    expect(result.success).toBe(true);
  });

  it('round-trips a null manifesto through parse', () => {
    const parsed = CharacterSchema.parse(baseCharacter({ manifesto: null }));
    expect(parsed.manifesto).toBeNull();
  });

  it('rejects a non-string, non-null manifesto (it stays a nullable string field)', () => {
    const result = CharacterSchema.safeParse(baseCharacter({ manifesto: 123 }));
    expect(result.success).toBe(false);
  });
});

describe('manifesto nullability — vault overlay empty→null collapse', () => {
  it('collapses an empty manifesto.md to null (unset)', () => {
    expect(markdownToNullable('')).toBeNull();
  });

  it('preserves non-empty manifesto.md content', () => {
    expect(markdownToNullable('The load-bearing truth.')).toBe('The load-bearing truth.');
  });

  it('produces a value the schema accepts for both the empty and populated cases', () => {
    // The overlay output must always be a legal manifesto value.
    const empty = markdownToNullable('');
    const populated = markdownToNullable('Some manifesto');

    expect(CharacterSchema.safeParse(baseCharacter({ manifesto: empty })).success).toBe(true);
    expect(CharacterSchema.safeParse(baseCharacter({ manifesto: populated })).success).toBe(true);
  });
});
