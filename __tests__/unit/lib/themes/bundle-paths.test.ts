import { isBundleRelativePath } from '@/lib/themes/bundle-paths';

describe('isBundleRelativePath', () => {
  it.each(['a.png', 'images/a.png', './a.png', 'a/b/c.css', 'name with space.png', 'a..b/c', '..a/b', 'a/b..'])(
    'accepts %p',
    (p) => expect(isBundleRelativePath(p)).toBe(true),
  );

  it.each([
    ['empty', ''],
    ['NUL byte', 'a\0b'],
    ['leading slash', '/etc/passwd'],
    ['leading backslash', '\\a\\b'],
    ['drive letter', 'C:\\a'],
    ['lowercase drive letter', 'c:/a'],
    ['bare drive', 'C:'],
    ['dot-dot only', '..'],
    ['leading dot-dot', '../a'],
    ['middle dot-dot', 'a/../b'],
    ['trailing dot-dot', 'a/..'],
    ['backslash dot-dot', 'a\\..\\b'],
    ['mixed separators', 'a/..\\b'],
  ])('refuses %s', (_label, p) => {
    expect(isBundleRelativePath(p)).toBe(false);
  });
});
