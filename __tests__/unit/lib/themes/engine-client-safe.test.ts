/**
 * The theme engine's browser entry (`lib/themes/engine/client.ts`) must not
 * reach PostCSS, a Node built-in or the logger through its value imports —
 * the live preview runs it in the browser (Calliope Live, Spec D 0.1).
 *
 * Walks the static value-import graph (type-only imports skipped, as webpack
 * skips them for the client chunk) and reports the chain to the first
 * forbidden specifier.
 *
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const EXTENSIONS = ['.ts', '.tsx', '.js', '.mjs', '/index.ts', '/index.tsx', '/index.js']
const FORBIDDEN_PACKAGES = new Set(['postcss', 'fs', 'path', 'crypto', 'os', 'child_process'])
const FORBIDDEN_FILES = [path.join(ROOT, 'lib/logger')]

function resolveLocal(spec: string, fromFile: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = path.join(ROOT, spec.slice(2))
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec)
  else return null
  if (fs.existsSync(base) && fs.statSync(base).isFile()) return base
  for (const ext of EXTENSIONS) if (fs.existsSync(base + ext)) return base + ext
  return null
}

function valueSpecifiers(source: string): string[] {
  const stripped = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const specs: string[] = []
  const re = /^\s*(import|export)\s+(type\s+)?([\s\S]*?)\s*from\s*['"]([^'"]+)['"]/gm
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped))) {
    if (m[2]) continue
    const braces = m[3].match(/^\{([\s\S]*)\}$/)
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

function isForbidden(spec: string, resolved: string | null): boolean {
  if (spec.startsWith('node:')) return true
  if (FORBIDDEN_PACKAGES.has(spec.split('/')[0])) return true
  return resolved !== null && FORBIDDEN_FILES.some((f) => resolved === f || resolved.startsWith(`${f}.`) || resolved.startsWith(`${f}/`))
}

function findForbiddenChain(entry: string): string[] | null {
  const seen = new Set<string>()
  const queue: Array<{ file: string; chain: string[] }> = [{ file: path.join(ROOT, entry), chain: [entry] }]
  while (queue.length) {
    const { file, chain } = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    for (const spec of valueSpecifiers(fs.readFileSync(file, 'utf8'))) {
      const next = resolveLocal(spec, file)
      if (isForbidden(spec, next)) return [...chain, spec]
      if (next && !seen.has(next)) queue.push({ file: next, chain: [...chain, path.relative(ROOT, next)] })
    }
  }
  return null
}

describe('theme engine browser entry', () => {
  it('reaches no postcss, Node built-in or logger', () => {
    expect(findForbiddenChain('lib/themes/engine/client.ts')).toBeNull()
  })

  it('the walker catches the server entry reaching postcss', () => {
    const chain = findForbiddenChain('lib/themes/engine/index.ts')
    expect(chain).not.toBeNull()
    expect(chain![chain!.length - 1]).toBe('postcss')
  })

  it('the walker catches the bundle loader reaching the logger', () => {
    const chain = findForbiddenChain('lib/themes/theme-bundle.ts')
    expect(chain).not.toBeNull()
  })
})
