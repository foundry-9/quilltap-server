/**
 * Unit tests for the shared pronoun → image-prompt gender helpers.
 */

import {
  figureGender,
  figureGenderNoun,
  figureGenderPrefix,
  genderFromPronouns,
  genderNounFromPronouns,
  genderPrefixFromPronouns,
} from '../pronoun-gender';

describe('pronoun-gender helpers', () => {
  describe('genderFromPronouns', () => {
    it('maps she → female and he → male', () => {
      expect(genderFromPronouns({ subject: 'she', object: 'her', possessive: 'her' })).toBe('female');
      expect(genderFromPronouns({ subject: 'he', object: 'him', possessive: 'his' })).toBe('male');
    });

    it('is case- and whitespace-insensitive', () => {
      expect(genderFromPronouns({ subject: '  She ', object: 'her', possessive: 'her' })).toBe('female');
      expect(genderFromPronouns({ subject: 'HE', object: 'him', possessive: 'his' })).toBe('male');
    });

    it('returns null for they / neopronouns / empty / unset', () => {
      expect(genderFromPronouns({ subject: 'they', object: 'them', possessive: 'their' })).toBeNull();
      expect(genderFromPronouns({ subject: 'ze', object: 'zir', possessive: 'zir' })).toBeNull();
      expect(genderFromPronouns(null)).toBeNull();
      expect(genderFromPronouns(undefined)).toBeNull();
    });
  });

  describe('genderNounFromPronouns', () => {
    it('maps to the gendered noun or null', () => {
      expect(genderNounFromPronouns({ subject: 'she', object: 'her', possessive: 'her' })).toBe('woman');
      expect(genderNounFromPronouns({ subject: 'he', object: 'him', possessive: 'his' })).toBe('man');
      expect(genderNounFromPronouns({ subject: 'they', object: 'them', possessive: 'their' })).toBeNull();
      expect(genderNounFromPronouns(null)).toBeNull();
    });
  });

  describe('genderPrefixFromPronouns', () => {
    it('produces a trailing-space sentence prefix or empty string', () => {
      expect(genderPrefixFromPronouns({ subject: 'she', object: 'her', possessive: 'her' })).toBe('A woman. ');
      expect(genderPrefixFromPronouns({ subject: 'he', object: 'him', possessive: 'his' })).toBe('A man. ');
      expect(genderPrefixFromPronouns({ subject: 'they', object: 'them', possessive: 'their' })).toBe('');
      expect(genderPrefixFromPronouns(undefined)).toBe('');
    });
  });
});

describe('figure* gender helpers', () => {
  const he = { subject: 'he', object: 'him', possessive: 'his' }

  it('answer as the pronoun helpers for a humanoid (or unflagged) character', () => {
    expect(figureGender({ pronouns: he })).toBe('male')
    expect(figureGenderNoun({ pronouns: he, physicalDescription: { humanoid: true } })).toBe('man')
    expect(figureGenderPrefix({ pronouns: he, physicalDescription: null })).toBe('A man. ')
  })

  it('answer no gender for a non-humanoid character, whatever its pronouns', () => {
    const spheres = { pronouns: he, physicalDescription: { humanoid: false } }
    expect(figureGender(spheres)).toBeNull()
    expect(figureGenderNoun(spheres)).toBeNull()
    expect(figureGenderPrefix(spheres)).toBe('')
  })
})

