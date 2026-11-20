import { isAvatarFile, isStoryBackgroundFile } from '@/lib/photos/generated-image-kind';

describe('isStoryBackgroundFile', () => {
  it('recognises the story-backgrounds folder even with no mount paths', () => {
    expect(isStoryBackgroundFile({ folderPath: '/story-backgrounds/' }, [])).toBe(true);
  });

  it('recognises a generated/ mount path, case-insensitively', () => {
    expect(isStoryBackgroundFile({ folderPath: '/' }, ['generated/a.webp'])).toBe(true);
    expect(isStoryBackgroundFile({ folderPath: '/' }, ['Generated/a.webp'])).toBe(true);
  });

  it('matches any one of several paths', () => {
    expect(isStoryBackgroundFile({ folderPath: '/' }, ['other/x.png', 'generated/y.png'])).toBe(true);
  });

  it('only matches generated/ as a prefix, not elsewhere in the path', () => {
    expect(isStoryBackgroundFile({ folderPath: '/' }, ['images/generated/a.webp'])).toBe(false);
    expect(isStoryBackgroundFile({ folderPath: '/' }, ['generatedfoo/a.webp'])).toBe(false);
  });

  it('requires an exact folderPath match', () => {
    expect(isStoryBackgroundFile({ folderPath: '/story-backgrounds' }, [])).toBe(false);
    expect(isStoryBackgroundFile({ folderPath: '/other/' }, [])).toBe(false);
  });

  it('is false with no paths and an unrelated folder', () => {
    expect(isStoryBackgroundFile({ folderPath: '/' }, [])).toBe(false);
  });
});

describe('isAvatarFile', () => {
  it('recognises the legacy character-avatars folder', () => {
    expect(isAvatarFile({ folderPath: '/character-avatars/' }, [])).toBe(true);
  });

  it('recognises images/history/ mount paths, case-insensitively', () => {
    expect(isAvatarFile({ folderPath: '/' }, ['images/history/a.webp'])).toBe(true);
    expect(isAvatarFile({ folderPath: '/' }, ['Images/History/a.webp'])).toBe(true);
  });

  it('does not match images/ without history, or history nested deeper', () => {
    expect(isAvatarFile({ folderPath: '/' }, ['images/a.webp'])).toBe(false);
    expect(isAvatarFile({ folderPath: '/' }, ['x/images/history/a.webp'])).toBe(false);
  });

  it('is not confused by the story-background markers', () => {
    expect(isAvatarFile({ folderPath: '/story-backgrounds/' }, ['generated/a.webp'])).toBe(false);
    expect(isStoryBackgroundFile({ folderPath: '/character-avatars/' }, ['images/history/a.webp'])).toBe(false);
  });
});
