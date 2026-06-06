/**
 * Unit tests for the pure filter helpers used by doc_list_files:
 *   isAutomaticImagePath, isOsCruftName
 */

import { isAutomaticImagePath, isOsCruftName } from '@/lib/files/folder-utils';

describe('isAutomaticImagePath', () => {
  // Should be treated as automatic images
  it('returns true for a webp in character-avatars', () => {
    expect(isAutomaticImagePath('character-avatars/my-char.webp')).toBe(true);
  });

  it('returns true for a png in story-backgrounds', () => {
    expect(isAutomaticImagePath('story-backgrounds/scene.png')).toBe(true);
  });

  it('returns true for a jpg nested inside character-avatars', () => {
    expect(isAutomaticImagePath('character-avatars/subdir/portrait.jpg')).toBe(true);
  });

  it('returns true for a jpeg in story-backgrounds', () => {
    expect(isAutomaticImagePath('story-backgrounds/bg.jpeg')).toBe(true);
  });

  it('returns true for a gif in story-backgrounds', () => {
    expect(isAutomaticImagePath('story-backgrounds/anim.gif')).toBe(true);
  });

  // Should NOT be treated as automatic images
  it('returns false for a markdown file in story-backgrounds', () => {
    expect(isAutomaticImagePath('story-backgrounds/readme.md')).toBe(false);
  });

  it('returns false for a non-image file in character-avatars', () => {
    expect(isAutomaticImagePath('character-avatars/notes.txt')).toBe(false);
  });

  it('returns false for an image file outside those folders', () => {
    expect(isAutomaticImagePath('docs/notes.md')).toBe(false);
  });

  it('returns false for a plain image at the root level', () => {
    expect(isAutomaticImagePath('portrait.png')).toBe(false);
  });

  it('does NOT false-match a folder with "character-avatars" as a substring', () => {
    // Segment is "my-character-avatars-notes", not "character-avatars"
    expect(isAutomaticImagePath('my-character-avatars-notes/photo.webp')).toBe(false);
  });

  it('does NOT false-match story-backgrounds as a substring segment', () => {
    expect(isAutomaticImagePath('old-story-backgrounds-archive/bg.png')).toBe(false);
  });
});

describe('isOsCruftName', () => {
  // Should be treated as OS cruft
  it('returns true for .DS_Store', () => {
    expect(isOsCruftName('.DS_Store')).toBe(true);
  });

  it('returns true for .Spotlight-V100', () => {
    expect(isOsCruftName('.Spotlight-V100')).toBe(true);
  });

  it('returns true for any dot-prefixed file', () => {
    expect(isOsCruftName('._foo')).toBe(true);
  });

  it('returns true for .hidden', () => {
    expect(isOsCruftName('.hidden')).toBe(true);
  });

  it('returns true for Thumbs.db (case-insensitive)', () => {
    expect(isOsCruftName('Thumbs.db')).toBe(true);
    expect(isOsCruftName('thumbs.db')).toBe(true);
    expect(isOsCruftName('THUMBS.DB')).toBe(true);
  });

  it('returns true for desktop.ini (case-insensitive)', () => {
    expect(isOsCruftName('desktop.ini')).toBe(true);
    expect(isOsCruftName('Desktop.INI')).toBe(true);
  });

  it('returns true for __MACOSX (case-insensitive)', () => {
    expect(isOsCruftName('__MACOSX')).toBe(true);
    expect(isOsCruftName('__macosx')).toBe(true);
  });

  // Should NOT be treated as OS cruft
  it('returns false for a normal markdown file', () => {
    expect(isOsCruftName('report.md')).toBe(false);
  });

  it('returns false for a normal image file', () => {
    expect(isOsCruftName('avatar.webp')).toBe(false);
  });

  it('returns false for a normal folder name', () => {
    expect(isOsCruftName('character-avatars')).toBe(false);
  });

  it('returns false for a file that starts with an underscore (not a dot)', () => {
    expect(isOsCruftName('_general')).toBe(false);
  });
});
