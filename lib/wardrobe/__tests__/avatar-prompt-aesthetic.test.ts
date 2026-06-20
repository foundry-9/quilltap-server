/**
 * Unit tests for the Aurora character-aesthetic preamble on the avatar prompt.
 * Avatars have no LLM rewrite step, so the aesthetic is prepended as a capped
 * preamble. The Ariel Clause (depiction-guidelines) is deliberately NOT part of
 * this path — the function has no parameter for it.
 */

// ── Subject ───────────────────────────────────────────────────────────────────
import { buildCharacterAvatarPrompt } from '../avatar-prompt';
import type { Character } from '@/lib/schemas/character.types';

const repos = {} as never;

function char(overrides: Partial<Character> = {}): Character {
  return {
    id: 'c1',
    name: 'Ariel',
    physicalDescription: { mediumPrompt: 'flowing red hair' },
    ...overrides,
  } as never;
}

describe('buildCharacterAvatarPrompt — Aurora aesthetic preamble', () => {
  it('prepends the aesthetic as an art-direction preamble', async () => {
    const { prompt, hasAppearance } = await buildCharacterAvatarPrompt(repos, char(), {
      characterAesthetic: '1920s art-deco illustration',
    });
    expect(hasAppearance).toBe(true);
    expect(prompt.startsWith('Art direction (apply this overall style): 1920s art-deco illustration')).toBe(true);
    expect(prompt).toContain('flowing red hair');
  });

  it('caps the preamble at 600 characters', async () => {
    const long = 'z'.repeat(800);
    const { prompt } = await buildCharacterAvatarPrompt(repos, char(), { characterAesthetic: long });
    expect(prompt).toContain('z'.repeat(600));
    expect(prompt).not.toContain('z'.repeat(601));
  });

  it('adds no preamble when no aesthetic is provided', async () => {
    const { prompt } = await buildCharacterAvatarPrompt(repos, char(), {});
    expect(prompt).not.toContain('Art direction');
  });

  it('returns an empty prompt (no preamble) when there is no appearance data', async () => {
    const { prompt, hasAppearance } = await buildCharacterAvatarPrompt(
      repos,
      char({ physicalDescription: null }),
      { characterAesthetic: '1920s art-deco illustration' },
    );
    expect(hasAppearance).toBe(false);
    expect(prompt).toBe('');
  });
});
