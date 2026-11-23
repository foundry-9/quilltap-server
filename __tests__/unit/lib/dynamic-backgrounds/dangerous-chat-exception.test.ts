/**
 * @jest-environment node
 *
 * The isDangerousChat exception (spec §5): classifier telemetry is read for
 * dynamic backgrounds in exactly one place, `lib/dynamic-backgrounds/eligibility.ts`.
 */

import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../../..')

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full)
  }
  return out
}

function code(file: string): string {
  return fs.readFileSync(file, 'utf-8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

describe('dynamic backgrounds read isDangerousChat only in eligibility.ts', () => {
  it('no other file under lib/dynamic-backgrounds reads it', () => {
    const offenders = walk(path.join(ROOT, 'lib/dynamic-backgrounds'))
      .filter((f) => !f.endsWith(`${path.sep}eligibility.ts`))
      .filter((f) => /isDangerousChat/.test(code(f)))
    expect(offenders).toEqual([])
  })

  it('no feature file under app/ or components/ reads it', () => {
    const feature = [
      ...walk(path.join(ROOT, 'app')),
      ...walk(path.join(ROOT, 'components')),
      path.join(ROOT, 'hooks/useDynamicBackground.ts'),
    ].filter((f) => /dynamic-?backgrounds?|DynamicBackground/i.test(code(f)) || /dynamic-backgrounds|DynamicBackground/.test(f))
    const offenders = feature.filter((f) => /isDangerousChat/.test(code(f)))
    expect(offenders).toEqual([])
  })

  it('eligibility.ts does read it, inside one function', () => {
    const src = code(path.join(ROOT, 'lib/dynamic-backgrounds/eligibility.ts'))
    expect(src.match(/isDangerousChat/g)).toHaveLength(1)
  })
})
