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
