/**
 * @jest-environment node
 *
 * Pins the shape of what scripts/lib/storybook-css.mjs gets back from
 * Tailwind's compiler, so a Tailwind upgrade that changes it fails here rather
 * than as a theme-storybook that quietly looks different from Quilltap.
 */

import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { markComments, restoreComments } from '../../../scripts/lib/storybook-css.mjs'

const REPO_ROOT = path.resolve(__dirname, '../../..')
const LIB_URL = pathToFileURL(path.join(REPO_ROOT, 'scripts/lib/storybook-css.mjs')).href

/**
 * Run `compileEntry` in a plain Node child. `@tailwindcss/node` registers
 * module hooks when it loads, which Jest's sandboxed loader refuses, so the
 * compiler half of the generator is exercised the way the scripts run it.
 */
function compileEntry(entry: string): string {
  const program = `
    import { compileEntry } from ${JSON.stringify(LIB_URL)}
    let input = ''
    for await (const chunk of process.stdin) input += chunk
    process.stdout.write(await compileEntry(input, { base: ${JSON.stringify(REPO_ROOT)} }))
  `
  return execFileSync(process.execPath, ['--input-type=module', '-e', program], {
    cwd: REPO_ROOT,
    input: entry,
    encoding: 'utf8',
  })
}

/** The app's own token map, inlined so the fixture needs no files. */
const TOKENS = `@theme inline {
  --color-accent: var(--theme-accent);
  --color-muted-foreground: var(--theme-muted-foreground);
}`

describe('storybook CSS generator', () => {
  it('expands @apply against the token map and media-gates hover', () => {
    const entry = `@reference "tailwindcss";
${TOKENS}
@layer components {
  .qt-fixture-a { @apply rounded-md p-2; }
  .qt-fixture-b { @apply text-muted-foreground hover:bg-accent; }
  .qt-fixture-c { color: red; }
}
`
    const css = compileEntry(entry)

    expect(css).not.toContain('@apply')
    expect(css).toContain('@layer components')
    expect(css).toMatch(/\.qt-fixture-a \{\s*border-radius: [^;]+;\s*padding: calc\(var\(--spacing, 0\.25rem\) \* 2\);\s*\}/)
    expect(css).toContain('color: var(--theme-muted-foreground);')
    expect(css).toMatch(/&:hover \{\s*@media \(hover: hover\) \{\s*background-color: var\(--theme-accent\);/)
    expect(css).toMatch(/\.qt-fixture-c \{\s*color: red;\s*\}/)
  })

  it('carries statement-level comments through compilation and drops the rest', () => {
    const source = `/* top banner */
@layer components {
  /* ===== SECTION ===== */
  .qt-a { /* inside a rule */ @apply p-1; }
}
/* before a plain rule */
.qt-b { color: blue; }
`
    const comments: Array<{ text: string; col: number }> = []
    const marked = markComments(source, comments, '/* file */')
    expect(comments.map((c) => c.text)).toEqual([
      '/* file */',
      '/* top banner */',
      '/* ===== SECTION ===== */',
      '/* before a plain rule */',
    ])

    const compiled = compileEntry(`@reference "tailwindcss";\n${marked}`)
    const out = restoreComments(compiled, comments)

    expect(out).not.toContain('__qtsb-')
    expect(out).not.toContain('inside a rule')
    const order = ['/* file */', '/* top banner */', '/* ===== SECTION ===== */', '.qt-a', '/* before a plain rule */', '.qt-b']
    const positions = order.map((s) => out.indexOf(s))
    expect(positions.every((p) => p >= 0)).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })
})
