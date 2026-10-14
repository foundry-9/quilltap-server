/**
 * Wardrobe folder rules (`lib/wardrobe/folders.ts`): normalisation, the
 * reserved `images` segment, the depth cap, path derivation, and
 * case-insensitive sameness.
 */

import { describe, expect, it } from '@jest/globals';
import {
  folderCrumb,
  folderName,
  folderOfWardrobePath,
  isSameFolder,
  isUnderFolder,
  isSafeWardrobeFolderPath,
  isValidWardrobeFolderPath,
  joinFolder,
  normalizeWardrobeFolderName,
  normalizeWardrobeFolderPath,
  normalizeWardrobeFolderPathOrRoot,
  parentFolder,
  rebaseFolder,
  resolveWardrobeFolder,
  WARDROBE_FOLDER_MAX_DEPTH,
  WardrobeFolderPathError,
  wardrobeFolderStorePath,
} from '@/lib/wardrobe/folders';

describe('normalizeWardrobeFolderPath', () => {
  it('reads empty, whitespace and null as the root', () => {
    expect(normalizeWardrobeFolderPath('')).toBe('');
    expect(normalizeWardrobeFolderPath('   ')).toBe('');
    expect(normalizeWardrobeFolderPath('/')).toBe('');
    expect(normalizeWardrobeFolderPath(null)).toBe('');
    expect(normalizeWardrobeFolderPath(undefined)).toBe('');
  });

  it('trims segments and drops empty ones and stray slashes', () => {
    expect(normalizeWardrobeFolderPath(' /Formal// Evening / ')).toBe('Formal/Evening');
    expect(normalizeWardrobeFolderPath('Formal\\Evening')).toBe('Formal/Evening');
  });

  it('sanitises each segment with the file-name rule', () => {
    expect(normalizeWardrobeFolderPath('Rainy: days?')).toBe('Rainy_ days_');
    expect(normalizeWardrobeFolderPath('a'.repeat(150))).toBe('a'.repeat(100));
  });

  it('refuses . and ..', () => {
    expect(() => normalizeWardrobeFolderPath('Formal/..')).toThrow(WardrobeFolderPathError);
    expect(() => normalizeWardrobeFolderPath('./Formal')).toThrow(WardrobeFolderPathError);
  });

  it('refuses the reserved images segment at any depth, in any casing', () => {
    expect(() => normalizeWardrobeFolderPath('images')).toThrow(WardrobeFolderPathError);
    expect(() => normalizeWardrobeFolderPath('Formal/IMAGES')).toThrow(WardrobeFolderPathError);
    expect(normalizeWardrobeFolderPath('Images of me')).toBe('Images of me');
  });

  it(`caps nesting at ${WARDROBE_FOLDER_MAX_DEPTH} segments`, () => {
    const eight = Array.from({ length: 8 }, (_, i) => `L${i}`).join('/');
    expect(normalizeWardrobeFolderPath(eight)).toBe(eight);
    expect(() => normalizeWardrobeFolderPath(`${eight}/L8`)).toThrow(WardrobeFolderPathError);
  });
});

describe('normalizeWardrobeFolderName', () => {
  it('takes exactly one segment', () => {
    expect(normalizeWardrobeFolderName(' Dress ')).toBe('Dress');
    expect(() => normalizeWardrobeFolderName('A/B')).toThrow(WardrobeFolderPathError);
    expect(() => normalizeWardrobeFolderName('   ')).toThrow(WardrobeFolderPathError);
  });
});

describe('normalizeWardrobeFolderPathOrRoot', () => {
  it('falls back to the root for a path that cannot be normal', () => {
    expect(normalizeWardrobeFolderPathOrRoot('Formal/Evening')).toBe('Formal/Evening');
    expect(normalizeWardrobeFolderPathOrRoot('Formal/images')).toBe('');
  });
});

describe('isValidWardrobeFolderPath', () => {
  it('accepts only paths already in normal form', () => {
    expect(isValidWardrobeFolderPath('')).toBe(true);
    expect(isValidWardrobeFolderPath('Formal/Evening')).toBe(true);
    expect(isValidWardrobeFolderPath('/Formal')).toBe(false);
    expect(isValidWardrobeFolderPath('Formal/')).toBe(false);
    expect(isValidWardrobeFolderPath('images')).toBe(false);
    expect(isValidWardrobeFolderPath('a:b')).toBe(false);
  });
});

describe('path helpers', () => {
  it('derives the folder from a Wardrobe document path', () => {
    expect(folderOfWardrobePath('Wardrobe/Coat.md')).toBe('');
    expect(folderOfWardrobePath('Wardrobe/Formal/Evening/Coat.md')).toBe('Formal/Evening');
    expect(folderOfWardrobePath('wardrobe/Formal/Coat.md')).toBe('Formal');
    expect(folderOfWardrobePath('Notes/Coat.md')).toBe('');
  });

  it('builds store paths, parents, names and joins', () => {
    expect(wardrobeFolderStorePath('')).toBe('Wardrobe');
    expect(wardrobeFolderStorePath('Formal/Evening')).toBe('Wardrobe/Formal/Evening');
    expect(parentFolder('Formal/Evening')).toBe('Formal');
    expect(parentFolder('Formal')).toBe('');
    expect(parentFolder('')).toBe('');
    expect(folderName('Formal/Evening')).toBe('Evening');
    expect(folderName('')).toBe('');
    expect(joinFolder('', 'Coat.md')).toBe('Coat.md');
    expect(joinFolder('Formal', 'Coat.md')).toBe('Formal/Coat.md');
    expect(folderCrumb('Formal/Evening')).toBe('Formal › Evening');
  });

  it('compares folders case-insensitively', () => {
    expect(isSameFolder('Formal', 'formal')).toBe(true);
    expect(isSameFolder('', null)).toBe(true);
    expect(isSameFolder('Formal', 'Formal/Evening')).toBe(false);
    expect(isUnderFolder('Formal/Evening', 'formal')).toBe(true);
    expect(isUnderFolder('Formal', 'Formal')).toBe(true);
    expect(isUnderFolder('Formalwear', 'Formal')).toBe(false);
    expect(isUnderFolder('Anything', '')).toBe(true);
  });

  it('re-roots a folder from one ancestor to another', () => {
    expect(rebaseFolder('Formal/Evening', 'Formal/Evening', 'Formal')).toBe('Formal');
    expect(rebaseFolder('Formal/Evening/Gala', 'Formal/Evening', 'Formal')).toBe('Formal/Gala');
    expect(rebaseFolder('Formal', 'Formal', '')).toBe('');
    expect(rebaseFolder('Casual', 'Formal', '')).toBe('Casual');
  });
});

describe('isSafeWardrobeFolderPath', () => {
  it('accepts any folder a real store can hold, hand-made spellings included', () => {
    expect(isSafeWardrobeFolderPath('')).toBe(true);
    expect(isSafeWardrobeFolderPath('Hats: Summer')).toBe(true);
    expect(isSafeWardrobeFolderPath('Formal/images')).toBe(true);
  });

  it('refuses paths that climb, are empty-segmented, or sit under images/', () => {
    expect(isSafeWardrobeFolderPath('../escape')).toBe(false);
    expect(isSafeWardrobeFolderPath('Formal//Evening')).toBe(false);
    expect(isSafeWardrobeFolderPath('/Formal')).toBe(false);
    expect(isSafeWardrobeFolderPath('images/abc')).toBe(false);
    expect(isSafeWardrobeFolderPath('A\\B')).toBe(false);
  });
});

describe('resolveWardrobeFolder', () => {
  const EXISTING = ['Formal', 'Formal/Evening', 'Hats: Summer', 'Accessories/images'];

  it('answers an existing folder exactly as stored, in any casing', () => {
    expect(resolveWardrobeFolder(EXISTING, 'formal/evening')).toBe('Formal/Evening');
    expect(resolveWardrobeFolder(EXISTING, 'hats: summer')).toBe('Hats: Summer');
    expect(resolveWardrobeFolder(EXISTING, '/accessories/images/')).toBe('Accessories/images');
  });

  it('keeps an existing ancestor as stored and normalises only the new part', () => {
    expect(resolveWardrobeFolder(EXISTING, 'Hats: Summer/Straw: boaters')).toBe('Hats: Summer/Straw_ boaters');
    expect(() => resolveWardrobeFolder(EXISTING, 'Formal/images')).toThrow(WardrobeFolderPathError);
  });

  it('normalises a wholly new folder, and reads empty as the root', () => {
    expect(resolveWardrobeFolder(EXISTING, ' Rainy: days ')).toBe('Rainy_ days');
    expect(resolveWardrobeFolder(EXISTING, '')).toBe('');
    expect(() => resolveWardrobeFolder(EXISTING, 'images')).toThrow(WardrobeFolderPathError);
  });

  it('holds the depth cap across an existing ancestor', () => {
    const deep = Array.from({ length: 7 }, (_, i) => `L${i}`).join('/');
    expect(resolveWardrobeFolder([deep], `${deep}/L7`)).toBe(`${deep}/L7`);
    expect(() => resolveWardrobeFolder([deep], `${deep}/L7/L8`)).toThrow(WardrobeFolderPathError);
  });
});
