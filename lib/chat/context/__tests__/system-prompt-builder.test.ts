/**
 * Unit tests for the surface-level public-identity card used to tell one
 * character who is addressing them (e.g. Carina answerer attribution).
 */

import {
  buildPublicIdentityCard,
  NO_PUBLIC_IDENTITY_FALLBACK,
} from '@/lib/chat/context/system-prompt-builder';
import type { Character } from '@/lib/schemas/types';

function makeCharacter(overrides: Partial<Character>): Character {
  return {
    id: 'char-1',
    name: 'Abigail',
    aliases: [],
    ...overrides,
  } as unknown as Character;
}

describe('buildPublicIdentityCard', () => {
  it('surfaces name, title, pronouns, aliases, and the identity field', () => {
    const card = buildPublicIdentityCard(
      makeCharacter({
        name: 'Charlie',
        title: 'the captain',
        pronouns: { subject: 'he', object: 'him', possessive: 'his' },
        aliases: ['Charles', 'Cap'],
        identity: 'Master of The Covenant; a familiar voice on the bridge.',
      }),
    );

    expect(card).toContain('**Charlie**');
    expect(card).toContain('Title: the captain');
    expect(card).toContain('Pronouns: he/him/his');
    expect(card).toContain('Also known as: Charles, Cap');
    expect(card).toContain('Master of The Covenant; a familiar voice on the bridge.');
  });

  it('never leaks the private personality or manifesto vantage points', () => {
    const card = buildPublicIdentityCard(
      makeCharacter({
        name: 'Charlie',
        identity: 'A man of few words.',
        personality: 'SECRET-INTERNAL-DRIVE',
        manifesto: 'SECRET-AXIOM',
      }),
    );

    expect(card).not.toContain('SECRET-INTERNAL-DRIVE');
    expect(card).not.toContain('SECRET-AXIOM');
  });

  it('falls back to description when no identity is recorded', () => {
    const card = buildPublicIdentityCard(
      makeCharacter({
        name: 'Charlie',
        identity: null,
        description: 'Speaks slowly and watches the dials.',
      }),
    );

    expect(card).toContain('Speaks slowly and watches the dials.');
    expect(card).not.toContain(NO_PUBLIC_IDENTITY_FALLBACK);
  });

  it('falls back to the standard placeholder when neither identity nor description is set', () => {
    const card = buildPublicIdentityCard(
      makeCharacter({ name: 'Charlie', identity: null, description: null }),
    );

    expect(card).toContain('**Charlie**');
    expect(card).toContain(NO_PUBLIC_IDENTITY_FALLBACK);
  });

  it('omits optional rows that are absent rather than emitting empty labels', () => {
    const card = buildPublicIdentityCard(
      makeCharacter({ name: 'Charlie', title: null, pronouns: null, aliases: [], identity: 'Quiet.' }),
    );

    expect(card).not.toContain('Title:');
    expect(card).not.toContain('Pronouns:');
    expect(card).not.toContain('Also known as:');
  });

  it('resolves {{char}} to the card subject and {{user}} to the supplied name', () => {
    const card = buildPublicIdentityCard(
      makeCharacter({ name: 'Charlie', identity: 'I am {{char}}, and I serve {{user}}.' }),
      'Friday',
    );

    expect(card).toContain('I am Charlie, and I serve Friday.');
  });
});
