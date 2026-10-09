/**
 * Unit tests for the gender anchor on the avatar prompt.
 *
 * Avatars have no LLM rewrite step and a character's physical description is
 * often gender-neutral in wording, so an outfit cue (e.g. a "men's" shirt) can
 * make the generator render the wrong sex. The builder anchors the figure's
 * apparent sex from the character's pronouns to prevent that.
 */

import { buildCharacterAvatarPrompt } from '../avatar-prompt';
import type { Character } from '@/lib/schemas/character.types';

const repos = {} as never;

function char(overrides: Partial<Character> = {}): Character {
  return {
    id: 'c1',
    name: 'Friday',
    physicalDescription: { headAndShouldersPrompt: 'oval face, hazel eyes, strawberry-blonde wavy hair' },
    ...overrides,
  } as never;
}

describe('buildCharacterAvatarPrompt — gender anchor', () => {
  it('renders "a single woman" for she/her pronouns', async () => {
    const { prompt } = await buildCharacterAvatarPrompt(
      repos,
      char({ pronouns: { subject: 'she', object: 'her', possessive: 'her' } }),
    );
    expect(prompt).toContain('Solo portrait of a single woman: Friday.');
    expect(prompt).not.toContain('single person');
  });

  it('renders "a single man" for he/him pronouns', async () => {
    const { prompt } = await buildCharacterAvatarPrompt(
      repos,
      char({ name: 'Charlie', pronouns: { subject: 'he', object: 'him', possessive: 'his' } }),
    );
    expect(prompt).toContain('Solo portrait of a single man: Charlie.');
  });

  it('falls back to "a single person" for they/neopronouns/unset', async () => {
    const they = await buildCharacterAvatarPrompt(
      repos,
      char({ pronouns: { subject: 'they', object: 'them', possessive: 'their' } }),
    );
    expect(they.prompt).toContain('Solo portrait of a single person: Friday.');

    const unset = await buildCharacterAvatarPrompt(repos, char({ pronouns: null }));
    expect(unset.prompt).toContain('Solo portrait of a single person: Friday.');
  });
});
