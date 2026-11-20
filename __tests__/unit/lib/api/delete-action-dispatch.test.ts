/**
 * Every v1 `DELETE` goes through the action dispatcher.
 *
 * A `DELETE` handler that never looks at `?action=` deletes the entity when a
 * client sends an action it does not answer — a typo, or an action that lives
 * on another verb. `dispatchAction` / `withActionDispatch` /
 * `withCollectionActionDispatch` (`lib/api/middleware/actions.ts`) make that a
 * 400 instead. A DELETE with no actions still wraps its handler as the
 * no-action fallback: `withActionDispatch({}, handler)`.
 *
 * This walks every `app/api/v1/**\/route.ts` that exports a DELETE — inline,
 * through `./handlers` (`handlers/delete.ts`), or destructured from a route
 * factory — and checks the code that defines it names a dispatcher.
 */

import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '../../../..')
const API_ROOT = path.join(ROOT, 'app', 'api', 'v1')
const DISPATCH = /\b(dispatchAction|withActionDispatch|withCollectionActionDispatch)\b/

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (entry.name === 'route.ts') out.push(full)
  }
  return out
}

/** The text from `start` to the next top-level `export` (or the end). */
function segmentFrom(text: string, start: number): string {
  const next = text.indexOf('\nexport ', start + 1)
  return text.slice(start, next === -1 ? undefined : next)
}

/** Resolve an import specifier from `fromFile` to a `.ts` file on disk. */
function resolveImport(fromFile: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? path.join(ROOT, spec.slice(2)) : path.resolve(path.dirname(fromFile), spec)
  for (const candidate of [`${base}.ts`, path.join(base, 'index.ts'), base]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
  }
  return null
}

/** Why this route's DELETE is not dispatched, or null when it is. */
function problemWith(routeFile: string): string | null {
  const text = fs.readFileSync(routeFile, 'utf8')

  const inline = text.search(/export (const|async function) DELETE\b/)
  if (inline !== -1) {
    const segment = segmentFrom(text, inline)
    if (DISPATCH.test(segment)) return null
    // `handleDelete` from `./handlers`: the dispatch lives in `handlers/delete.ts`.
    if (/\bhandleDelete\b/.test(segment) && /from '\.\/handlers'/.test(text)) {
      const handler = path.join(path.dirname(routeFile), 'handlers', 'delete.ts')
      if (fs.existsSync(handler) && DISPATCH.test(fs.readFileSync(handler, 'utf8'))) return null
      return 'handlers/delete.ts does not dispatch'
    }
    return 'inline DELETE does not dispatch'
  }

  const destructured = text.match(/export const \{[^}]*\bDELETE\b[^}]*\}\s*=\s*(\w+)\s*[<(]/)
  if (destructured) {
    const factory = destructured[1]
    const imported = text.match(new RegExp(`import \\{[^}]*\\b${factory}\\b[^}]*\\} from '([^']+)'`))
    if (!imported) return `cannot find the import of ${factory}`
    const factoryFile = resolveImport(routeFile, imported[1])
    if (!factoryFile) return `cannot resolve ${imported[1]}`
    const factoryText = fs.readFileSync(factoryFile, 'utf8')
    const at = factoryText.search(/const DELETE = /)
    if (at === -1) return `${factory} defines no \`const DELETE\``
    // The dispatcher wraps the handler right at the definition.
    if (DISPATCH.test(factoryText.slice(at, at + 300))) return null
    return `${path.relative(ROOT, factoryFile)}'s DELETE does not dispatch`
  }

  return null
}

describe('v1 DELETE action dispatch', () => {
  const routes = walk(API_ROOT).filter((file) =>
    /export (const|async function) DELETE\b|export const \{[^}]*\bDELETE\b/.test(fs.readFileSync(file, 'utf8')),
  )

  it('finds the DELETE routes', () => {
    expect(routes.length).toBeGreaterThan(30)
  })

  it('every DELETE answers an unknown ?action= with a 400, never a deletion', () => {
    const offenders = routes
      .map((file) => ({ file: path.relative(ROOT, file), problem: problemWith(file) }))
      .filter((r) => r.problem !== null)
      .map((r) => `${r.file}: ${r.problem}`)
    expect(offenders).toEqual([])
  })
})
