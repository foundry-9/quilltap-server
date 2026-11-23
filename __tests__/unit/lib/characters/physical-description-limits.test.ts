/**
 * @jest-environment node
 */

import {
  fitToCharacterLimit,
  fitPhysicalPrompt,
  PHYSICAL_PROMPT_LIMITS,
} from '@/lib/characters/physical-description-limits';
import { PhysicalDescriptionSchema } from '@/lib/schemas/character.types';

describe('fitToCharacterLimit', () => {
  it('returns text that already fits, trimmed', () => {
    expect(fitToCharacterLimit('  short and sweet  ', 50)).toBe('short and sweet');
  });

  it('treats null and undefined as empty', () => {
    expect(fitToCharacterLimit(null, 10)).toBe('');
    expect(fitToCharacterLimit(undefined, 10)).toBe('');
  });

  it('cuts at the last sentence end inside the limit', () => {
    const text = 'Dark hair falls to the shoulders. Grey eyes, steady. A small pale burn scar on the forearm.';
    const fitted = fitToCharacterLimit(text, 60);
    expect(fitted).toBe('Dark hair falls to the shoulders. Grey eyes, steady.');
    expect(fitted.length).toBeLessThanOrEqual(60);
  });

  it('falls back to a clause break and drops the dangling comma', () => {
    const text = 'dark hair, grey eyes, olive skin, slender build, small pale round burn scar on inside of left forearm';
    const fitted = fitToCharacterLimit(text, 60);
    expect(fitted).toBe('dark hair, grey eyes, olive skin, slender build');
    expect(fitted.length).toBeLessThanOrEqual(60);
  });

  it('falls back to a word break, never mid-word (regression: "Small p")', () => {
    const text = 'Old grey-blue ink shadow in right hand skin to wrist Small pale round burn scar';
    const fitted = fitToCharacterLimit(text, 55);
    expect(fitted.length).toBeLessThanOrEqual(55);
    expect(text.startsWith(fitted)).toBe(true);
    expect(text[fitted.length]).toBe(' ');
  });

  it('cuts hard only when there is no boundary at all', () => {
    expect(fitToCharacterLimit('x'.repeat(30), 10)).toBe('x'.repeat(10));
  });
});

describe('fitPhysicalPrompt', () => {
  it('keeps every field inside the character schema caps', () => {
    const long = 'tall, lean, angular face, '.repeat(80);
    const pd: Record<string, unknown> = {
      id: '00000000-0000-4000-8000-000000000000',
      createdAt: '2026-11-18T00:00:00.000Z',
      updatedAt: '2026-11-18T00:00:00.000Z',
    };
    for (const field of Object.keys(PHYSICAL_PROMPT_LIMITS) as Array<keyof typeof PHYSICAL_PROMPT_LIMITS>) {
      pd[field] = fitPhysicalPrompt(field, long);
      expect((pd[field] as string).length).toBeLessThanOrEqual(PHYSICAL_PROMPT_LIMITS[field]);
    }
    expect(PhysicalDescriptionSchema.safeParse(pd).success).toBe(true);
  });
});
