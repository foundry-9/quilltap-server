/**
 * The character vault chokepoint fence (refactor-character-repository-and-vault.md §7).
 *
 * The vault layout is described once, in `lib/characters/vault/layout.ts`. It
 * used to be spelled in nine places, each commented "mirrors the other", and
 * adding one enum touched seven server files. These fences keep it in one:
 *
 *   (a) only the vault module spells a character vault file path;
 *   (b) nothing outside it writes a layout file through the document store;
 *   (c) `writeCharacterVaultManagedFields` — the whole-character projection —
 *       has exactly its two sanctioned callers (never a raw row, #148);
 *   (d) no file hand-lists the managed fields as a literal set.
 *
 * @jest-environment node
 */

import fs from 'fs'
import path from 'path'

const ROOT = process.cwd()
const SCAN_DIRS = ['lib', 'app', 'components', 'hooks']
const VAULT_DIR = 'lib/characters/vault/'

/**
 * Other stores with their own layouts that happen to share a file name
 * (a project's or a group's `description.md` / `properties.json`).
 */
const OTHER_LAYOUTS = ['lib/projects/project-store/', 'lib/groups/group-store/']

const VAULT_PATHS = [
  'properties.json', 'metadata.json', 'identity.md', 'description.md', 'manifesto.md',
  'personality.md', 'example-dialogues.md', 'physical-description.md', 'physical-prompts.json',
]

const LAYOUT_CONSTANTS = [
  'CHARACTER_PROPERTIES_JSON_PATH', 'CHARACTER_METADATA_JSON_PATH', 'CHARACTER_IDENTITY_MD_PATH',
  'CHARACTER_DESCRIPTION_MD_PATH', 'CHARACTER_MANIFESTO_MD_PATH', 'CHARACTER_PERSONALITY_MD_PATH',
  'CHARACTER_EXAMPLE_DIALOGUES_MD_PATH', 'CHARACTER_PHYSICAL_DESCRIPTION_MD_PATH', 'CHARACTER_PHYSICAL_PROMPTS_JSON_PATH',
]

function walk(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '__tests__') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full)
  }
}

function sourceFiles(): Array<{ rel: string; text: string }> {
  const files: string[] = []
  for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), files)
  return files
    .map((file) => path.relative(ROOT, file).split(path.sep).join('/'))
    .map((rel) => ({ rel, text: fs.readFileSync(path.join(ROOT, rel), 'utf8') }))
}

/** Source with comments removed, so a docblock naming a file is not a spelling. */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const outsideVault = () => sourceFiles().filter(({ rel }) => !rel.startsWith(VAULT_DIR))

describe('the character vault layout is spelled once', () => {
  it('(a) no file outside lib/characters/vault/ spells a vault file path', () => {
    const offenders: string[] = []
    for (const { rel, text } of outsideVault()) {
      if (OTHER_LAYOUTS.some((dir) => rel.startsWith(dir))) continue
      const body = code(text)
      for (const p of VAULT_PATHS) {
        if (body.includes(`'${p}'`) || body.includes(`"${p}"`)) offenders.push(`${rel}: ${p}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('(b) no file outside lib/characters/vault/ writes a layout file through the document store', () => {
    const offenders: string[] = []
    const write = /writeDatabaseDocument\(\s*[^,]+,\s*([A-Z_]+)/g
    for (const { rel, text } of outsideVault()) {
      for (const m of code(text).matchAll(write)) {
        if (LAYOUT_CONSTANTS.includes(m[1])) offenders.push(`${rel}: ${m[1]}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('(c) the whole-character projection has exactly its two sanctioned callers', () => {
    const callers: string[] = []
    const files = [...sourceFiles(), ...fs.readdirSync(path.join(ROOT, 'migrations/scripts'))
      .filter((f) => f.endsWith('.ts'))
      .map((f) => ({ rel: `migrations/scripts/${f}`, text: fs.readFileSync(path.join(ROOT, 'migrations/scripts', f), 'utf8') }))]
    for (const { rel, text } of files) {
      const count = (code(text).match(/\bwriteCharacterVaultManagedFields\(/g) ?? []).length
      const declared = rel === `${VAULT_DIR}write.ts` ? 1 : 0
      for (let i = declared; i < count; i++) callers.push(rel)
    }
    expect(callers.sort()).toEqual([
      'lib/characters/vault/binding.ts', // the repository binding: create, and the restore fallback
      'migrations/scripts/cutover-characters-to-vault.ts', // the frozen 4.6 cutover
    ])
  })

  it('(d) no file hand-lists the managed fields', () => {
    const offenders: string[] = []
    // A list of TEXT fields (a template scan, a wizard's field picker) is a
    // different concept and fine. The managed SET mixes text fields with the
    // vault's settings and sub-collections: three of each in one list is a
    // hand-kept copy of it.
    const text = ['identity', 'description', 'manifesto', 'personality', 'exampleDialogues', 'firstMessage', 'title']
    const settings = ['talkativeness', 'systemPrompts', 'scenarios', 'metadata', 'pronouns', 'aliases', 'birthday', 'canChooseOutfit', 'canDrawDiagrams', 'diagramStyle', 'kind', 'physicalDescription']
    const quoted = (body: string, n: string) => new RegExp(`['"]${n}['"]`).test(body)
    for (const { rel, text: src } of outsideVault()) {
      if (rel === 'lib/schemas/character.types.ts') continue
      for (const list of code(src).matchAll(/\[([^\[\]]{0,800})\]/g)) {
        const t = text.filter((n) => quoted(list[1], n))
        const v = settings.filter((n) => quoted(list[1], n))
        if (t.length >= 3 && v.length >= 3) offenders.push(`${rel}: ${[...t, ...v].join(', ')}`)
      }
    }
    expect(offenders).toEqual([])
  })
})
