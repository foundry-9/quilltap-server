/**
 * @jest-environment node
 *
 * `resolveInside` is the one containment check for caller-supplied relative
 * paths: absolute and NUL-bearing paths are refused, `..` may not climb out,
 * a sibling directory sharing the base's prefix is outside, and with
 * `realpath` a symlink inside the base cannot lead out of it — whether or not
 * the final file exists yet.
 */

jest.mock('@/lib/logger', () => {
  const mock = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), child: jest.fn() }
  mock.child.mockReturnValue(mock)
  return { logger: mock }
})

import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  PathOutsideBaseError,
  isInside,
  resolveInside,
  resolveInsideDetailed,
  resolveInsideSync,
} from '@/lib/paths/resolve-inside'

let root: string
let base: string
let outside: string

beforeAll(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'resolve-inside-')))
  base = path.join(root, 'theme')
  outside = path.join(root, 'theme-other')
  fs.mkdirSync(path.join(base, 'fonts'), { recursive: true })
  fs.mkdirSync(outside, { recursive: true })
  fs.writeFileSync(path.join(base, 'fonts', 'a.woff2'), 'x')
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret')
  // A directory link and a file link that both leave the base.
  fs.symlinkSync(outside, path.join(base, 'escape-dir'))
  fs.symlinkSync(path.join(outside, 'secret.txt'), path.join(base, 'escape-file'))
  // A dangling link whose (missing) target is outside the base.
  fs.symlinkSync(path.join(outside, 'not-yet.txt'), path.join(base, 'dangling-out'))
  // A link that stays inside the base.
  fs.symlinkSync(path.join(base, 'fonts'), path.join(base, 'fonts-alias'))
})

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function reasonOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (err) {
    return err instanceof PathOutsideBaseError ? err.reason : `other:${(err as Error).message}`
  }
  return undefined
}

async function asyncReasonOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p
  } catch (err) {
    return err instanceof PathOutsideBaseError ? err.reason : `other:${(err as NodeJS.ErrnoException).code}`
  }
  return undefined
}

describe('isInside', () => {
  it('is separator-aware', () => {
    expect(isInside('/a/theme', '/a/theme/x')).toBe(true)
    expect(isInside('/a/theme', '/a/theme-evil/x')).toBe(false)
    expect(isInside('/a/theme', '/a/theme')).toBe(true)
    expect(isInside('/a/theme', '/a/theme', false)).toBe(false)
    expect(isInside('/a/theme', '/a/theme/..foo')).toBe(true)
    expect(isInside('/a/theme', '/a')).toBe(false)
  })
})

describe('resolveInside (lexical)', () => {
  it('resolves an ordinary relative path', async () => {
    await expect(resolveInside(base, 'fonts/a.woff2')).resolves.toBe(path.join(base, 'fonts', 'a.woff2'))
    expect(resolveInsideSync(base, './fonts/../fonts/a.woff2')).toBe(path.join(base, 'fonts', 'a.woff2'))
  })

  it('refuses traversal out of the base', () => {
    expect(reasonOf(() => resolveInsideSync(base, '../theme-other/secret.txt'))).toBe('outside-base')
    expect(reasonOf(() => resolveInsideSync(base, 'fonts/../../etc/passwd'))).toBe('outside-base')
    expect(reasonOf(() => resolveInsideSync(base, '..'))).toBe('outside-base')
  })

  it('refuses a sibling directory that shares the base prefix', () => {
    expect(reasonOf(() => resolveInsideSync(base, '../theme-other'))).toBe('outside-base')
  })

  it('refuses absolute paths rather than re-rooting them', () => {
    expect(reasonOf(() => resolveInsideSync(base, '/etc/passwd'))).toBe('absolute')
    expect(reasonOf(() => resolveInsideSync(base, path.join(base, 'fonts')))).toBe('absolute')
  })

  it('refuses NUL bytes and non-strings', () => {
    expect(reasonOf(() => resolveInsideSync(base, 'fonts/a\0.woff2'))).toBe('nul-byte')
    expect(reasonOf(() => resolveInsideSync(base, undefined as unknown as string))).toBe('invalid')
  })

  it('treats the base itself as inside unless allowBase is false', () => {
    expect(resolveInsideSync(base, '')).toBe(base)
    expect(reasonOf(() => resolveInsideSync(base, '.', { allowBase: false }))).toBe('outside-base')
  })

  it('does not follow symlinks without the realpath option', () => {
    expect(resolveInsideSync(base, 'escape-file')).toBe(path.join(base, 'escape-file'))
  })
})

describe('resolveInside (realpath)', () => {
  it('refuses a symlinked directory that leads out, even for a missing leaf', async () => {
    expect(await asyncReasonOf(resolveInside(base, 'escape-dir/secret.txt', { realpath: true }))).toBe('outside-base')
    expect(await asyncReasonOf(resolveInside(base, 'escape-dir/new/deeper.txt', { realpath: true }))).toBe('outside-base')
    expect(reasonOf(() => resolveInsideSync(base, 'escape-dir/new.txt', { realpath: true }))).toBe('outside-base')
  })

  it('refuses a symlinked file that leads out', async () => {
    expect(await asyncReasonOf(resolveInside(base, 'escape-file', { realpath: true }))).toBe('outside-base')
    expect(reasonOf(() => resolveInsideSync(base, 'escape-file', { realpath: true }))).toBe('outside-base')
  })

  it('refuses a dangling symlink whose target is outside', async () => {
    expect(await asyncReasonOf(resolveInside(base, 'dangling-out', { realpath: true }))).toBe('outside-base')
    expect(reasonOf(() => resolveInsideSync(base, 'dangling-out', { realpath: true }))).toBe('outside-base')
  })

  it('accepts a link that stays inside and a leaf that does not exist yet', async () => {
    const detailed = await resolveInsideDetailed(base, 'fonts-alias/a.woff2', { realpath: true })
    expect(detailed.absolutePath).toBe(path.join(base, 'fonts-alias', 'a.woff2'))
    expect(detailed.realPath).toBe(path.join(base, 'fonts', 'a.woff2'))
    await expect(resolveInside(base, 'fonts/new/b.woff2', { realpath: true })).resolves.toBe(
      path.join(base, 'fonts', 'new', 'b.woff2')
    )
  })

  it('compares against the real base when the base itself is reached through a link', async () => {
    const linkedBase = path.join(root, 'linked-theme')
    fs.symlinkSync(base, linkedBase)
    await expect(resolveInside(linkedBase, 'fonts/a.woff2', { realpath: true })).resolves.toBe(
      path.join(linkedBase, 'fonts', 'a.woff2')
    )
    expect(await asyncReasonOf(resolveInside(linkedBase, 'escape-file', { realpath: true }))).toBe('outside-base')
  })
})

describe('mustExist', () => {
  it('throws ENOENT for a missing path after containment passes', async () => {
    expect(await asyncReasonOf(resolveInside(base, 'fonts/missing.woff2', { mustExist: true }))).toBe('other:ENOENT')
    await expect(resolveInside(base, 'fonts/a.woff2', { mustExist: true })).resolves.toBe(
      path.join(base, 'fonts', 'a.woff2')
    )
    expect(reasonOf(() => resolveInsideSync(base, 'fonts/missing.woff2', { mustExist: true }))).toMatch(/^other:ENOENT/)
  })
})
