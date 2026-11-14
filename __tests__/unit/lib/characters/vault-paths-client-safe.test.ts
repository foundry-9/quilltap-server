/**
 * Regression: `node:crypto` must stay out of the client bundle (4.13 release fix,
 * commit "keep node:crypto out of the client bundle").
 *
 * `lib/services/character-field-semantics.ts` once imported its vault path
 * constants from `lib/characters/vault/layout.ts`, which pulls the layout's
 * parsers — and through them `lib/utils/stable-uuid.ts` (`node:crypto`) — into
 * the Aurora new-character page's browser bundle. `next build --webpack`
 * failed in the release run. The constants now live in client-safe
 * `lib/characters/vault/paths.ts`.
 *
 * This walks the static (value) import graph from each client-reachable entry
 * and fails if any module on it imports a `node:`-scheme specifier. Bare
 * built-ins (`path`, `fs`) are stubbed or polyfilled for the browser by Next's
 * webpack config; a `node:` specifier is not, and fails the build with
 * UnhandledSchemeError. Type-only imports and dynamic `import()` are skipped,
 * as webpack skips them for the client chunk.
 *
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()

/** Entries that must be browser-safe end to end. */
const CLIENT_SAFE_ENTRIES = [
  'lib/characters/vault/paths.ts',
  'lib/services/character-field-semantics.ts',
  'components/prompt-fields/field-hints.ts',
  'app/aurora/new/NewCharacterView.tsx',
]

const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js']

function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else return null
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base
  for (const ext of EXTENSIONS) {
    if (fs.existsSync(base + ext)) return base + ext
  }
  return null
}

/** Value import / re-export specifiers in a source file (type-only excluded). */
function valueSpecifiers(source: string): string[] {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
  const specs: string[] = []
  const re = /^\s*(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped))) {
    if (m[2]) continue // `import type` / `export type`
    const clause = m[3]
    // `import { type A, type B } from` — every binding type-only
    const braces = clause.match(/^\{([\s\S]*)\}$/)
    if (braces) {
      const names = braces[1].split(',').map((s) => s.trim()).filter(Boolean)
      if (names.length > 0 && names.every((n) => n.startsWith('type '))) continue
    }
    specs.push(m[4])
  }
  const bare = /^\s*import\s+['"]([^'"]+)['"]/gm
  while ((m = bare.exec(stripped))) specs.push(m[1])
  return specs
}

/** Returns the chain from `entry` to the first `node:` import, or null. */
function findBuiltinChain(entry: string): string[] | null {
  const start = path.join(ROOT, entry)
  const seen = new Set<string>()
  const queue: Array<{ file: string; chain: string[] }> = [{ file: start, chain: [entry] }]
  while (queue.length) {
    const { file, chain } = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const source = fs.readFileSync(file, 'utf8')
    // A 'use server' module is an RPC boundary, not bundled code.
    if (/^\s*['"]use server['"]/.test(source)) continue
    for (const spec of valueSpecifiers(source)) {
      if (spec.startsWith('node:')) return [...chain, spec]
      const next = resolveLocal(spec, file)
      if (next && !seen.has(next)) {
        queue.push({ file: next, chain: [...chain, path.relative(ROOT, next)] })
      }
    }
  }
  return null
}

describe('client-safe vault paths', () => {
  it('paths.ts imports nothing at all', () => {
    const source = fs.readFileSync(path.join(ROOT, 'lib/characters/vault/paths.ts'), 'utf8')
    expect(valueSpecifiers(source)).toEqual([])
  })

  it('character-field-semantics takes its vault paths from paths.ts, not layout.ts', () => {
    const source = fs.readFileSync(
      path.join(ROOT, 'lib/services/character-field-semantics.ts'),
      'utf8'
    )
    const specs = valueSpecifiers(source)
    expect(specs).toContain('@/lib/characters/vault/paths')
    expect(specs).not.toContain('@/lib/characters/vault/layout')
  })

  it('layout.ts re-exports the same constants paths.ts defines', async () => {
    const paths = await import('@/lib/characters/vault/paths')
    const layout = await import('@/lib/characters/vault/layout')
    for (const [name, value] of Object.entries(paths)) {
      expect((layout as Record<string, unknown>)[name]).toBe(value)
    }
  })

  it.each(CLIENT_SAFE_ENTRIES)('%s reaches no node: import through value imports', (entry) => {
    expect(findBuiltinChain(entry)).toBeNull()
  })

  it('the walker does catch the original chain through layout.ts', () => {
    // Guard the guard: layout.ts is server-side and must be reported.
    const chain = findBuiltinChain('lib/characters/vault/layout.ts')
    expect(chain).not.toBeNull()
    expect(chain![chain!.length - 1]).toBe('node:crypto')
  })
})
