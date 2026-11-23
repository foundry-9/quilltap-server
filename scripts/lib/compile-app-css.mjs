/**
 * Compiles app/globals.css with Tailwind's own compiler the way the app's
 * PostCSS pipeline (`@tailwindcss/postcss`) does: imports inlined, `@apply`
 * expanded, and candidates scanned from the same sources (the repository,
 * less what `.gitignore` and the stylesheet's `@source not` exclude). The
 * scan matters: a Tailwind theme variable such as `--radius-xl` is emitted
 * only when something uses it, and app or theme CSS that references it
 * resolves differently without it.
 *
 * Plain Node only: `@tailwindcss/node` registers module hooks that Jest's
 * loader refuses, so tests run this in a child process.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export const APP_ENTRY = 'app/globals.css'

/** Compile the app stylesheet; `root` is the repository root. */
export async function compileAppCss(root) {
  const require = createRequire(path.join(root, 'package.json'))
  const { compile } = require('@tailwindcss/node')
  const { Scanner } = require('@tailwindcss/oxide')
  const entry = path.join(root, APP_ENTRY)
  const compiler = await compile(readFileSync(entry, 'utf8'), {
    base: path.dirname(entry),
    onDependency() {},
  })
  const sources = (
    compiler.root === 'none'
      ? []
      : compiler.root === null
        ? [{ base: root, pattern: '**/*', negated: false }]
        : [{ ...compiler.root, negated: false }]
  ).concat(compiler.sources)
  const candidates = new Scanner({ sources }).scan()
  return compiler.build(candidates)
}

// `node scripts/lib/compile-app-css.mjs` writes the compiled CSS to stdout.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(await compileAppCss(process.cwd()))
}
