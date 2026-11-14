/**
 * The character page's save model, as a grep-test (§4 of the unification
 * spec): a control saves itself, a modal has a Save button, nothing else does.
 *
 * Under app/aurora/[id]/ no component submits a <form>, and a button whose
 * label is "Save" appears only inside a modal (a file that renders BaseModal).
 */

import fs from 'fs'
import path from 'path'

const ROOT = path.join(process.cwd(), 'app', 'aurora', '[id]')

function sources(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return sources(full)
    return /\.tsx?$/.test(entry.name) ? [full] : []
  })
}

describe('character page save model', () => {
  const files = sources(ROOT)

  it('finds the page sources', () => {
    expect(files.some((f) => f.endsWith('CharacterPage.tsx'))).toBe(true)
  })

  it('has no <form onSubmit> anywhere on the page', () => {
    const offenders = files.filter((f) => /<form[^>]*onSubmit/.test(fs.readFileSync(f, 'utf8')))
    expect(offenders).toEqual([])
  })

  it('shows a "Save" button only inside a modal', () => {
    const saveButton = />\s*(\{[^}]*\?\s*'Saving…'\s*:\s*)?'?Save( changes| Character)?'?\s*\}?\s*<\/button>/
    const offenders = files.filter((f) => {
      const text = fs.readFileSync(f, 'utf8')
      return saveButton.test(text) && !/<BaseModal\b/.test(text)
    })
    expect(offenders).toEqual([])
  })
})

/**
 * The client sends intent; the server owns the rules (D11 of
 * refactor-character-repository-and-vault.md). The page and the character
 * components used to re-derive which prompt is the default, mint
 * physical-description ids, and send whole scenario arrays — each a copy of a
 * server rule that could (and, for scenarios, did — #150) drift.
 */
describe('the client re-derives no server rule', () => {
  const clientRoots = [
    path.join(process.cwd(), 'app', 'aurora'),
    path.join(process.cwd(), 'components', 'characters'),
    path.join(process.cwd(), 'components', 'chat', 'CreateNPCDialog.tsx'),
  ]
  const clientFiles = clientRoots.flatMap((root) =>
    fs.statSync(root).isDirectory() ? sources(root) : [root],
  ).filter((f) => !f.includes('__tests__'))
  const read = (f: string) => fs.readFileSync(f, 'utf8')

  it('derives no default prompt: no first-is-default, no column-then-flag-then-first chain', () => {
    const patterns = [
      /isDefault:\s*[^,\n}]*length\s*===\s*0/, // "the first prompt is the default"
      /defaultSystemPromptId\)\??\.content\s*\?\?/, // the resolution order, by hand
      /systemPrompts\?*\.\[0\]/, // "else the first prompt"
      /resolveDefaultSystemPrompt/, // the server's resolver, borrowed
    ]
    const offenders = clientFiles.filter((f) => patterns.some((p) => p.test(read(f))))
    expect(offenders).toEqual([])
  })

  it('never sends a whole scenarios or systemPrompts array through the character PUT', () => {
    const offenders = clientFiles.filter((f) =>
      /(mainUpdates|updatePayload|body)\.(scenarios|systemPrompts)\s*=/.test(read(f)),
    )
    expect(offenders).toEqual([])
  })

  it('never mints a physical description id', () => {
    const offenders = clientFiles.filter((f) =>
      /physicalDescription[\s\S]{0,200}id:\s*crypto\.randomUUID\(\)|id:\s*stored\?\.id\s*\?\?\s*crypto\.randomUUID\(\)/.test(read(f)),
    )
    expect(offenders).toEqual([])
  })
})
