/**
 * Regression guards for two layout fixes that jsdom cannot measure, held at the
 * source so the class wiring cannot quietly come undone.
 *
 * - e773e82c9: the Markdown editor's toolbar scrolled away on long text. It is
 *   now `qt-doc-toolbar-sticky` (position: sticky), and its frame clips with
 *   `overflow-clip` — `overflow-hidden` would make the frame the scroll
 *   container and pin the toolbar to itself.
 * - 1747fe9ad: Calliope's panel and the Atelier's / gallery's section lists
 *   were sized from the viewport (100vh) although the Atelier scrolls inside
 *   the workspace pane, so their bottom sat under the footer. The scrollers
 *   now wear `qt-scroll-container` (container-type: size) and the panels size
 *   with `cqh`.
 */

import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** The declaration block of `.selector { … }` in a CSS file. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`${selector} not defined`)
  return match[1]
}

describe('Markdown editor toolbar stays in view', () => {
  const source = read('components/markdown-editor/MarkdownLexicalEditor.tsx')

  it('wears qt-doc-toolbar-sticky', () => {
    expect(source).toMatch(/className="qt-doc-toolbar qt-doc-toolbar-sticky"/)
  })

  it('clips its frame without becoming a scroll container', () => {
    const frame = source.match(/const frameClassName = \[([\s\S]*?)\]/)
    expect(frame).not.toBeNull()
    expect(frame![1]).toContain('overflow-clip')
    expect(frame![1]).not.toMatch(/overflow-(hidden|auto|scroll)/)
  })

  it('defines qt-doc-toolbar-sticky as a sticky, opaque bar', () => {
    const body = ruleBody(read('app/styles/qt-components/_chat.css'), '.qt-doc-toolbar-sticky')
    expect(body).toMatch(/position:\s*sticky/)
    expect(body).toMatch(/top:\s*0/)
    expect(body).toMatch(/background:\s*var\(--qt-content-bg\)/)
  })
})

describe('Atelier panels size to the scroll pane, not the window', () => {
  it('defines qt-scroll-container as a size container', () => {
    const body = ruleBody(read('app/styles/qt-components/_utilities.css'), '.qt-scroll-container')
    expect(body).toMatch(/container-type:\s*size/)
  })

  it.each([
    ['app/calliope/ThemeEditorView.tsx', 'theme-editor-panel'],
    ['app/calliope/specimens/SpecimenGalleryView.tsx', 'theme-specimens-panel'],
  ])('%s scroller is a qt-scroll-container', (file, testId) => {
    const source = read(file)
    const line = source.split('\n').find((l) => l.includes(`data-testid="${testId}"`))
    expect(line).toBeDefined()
    expect(line).toContain('overflow-y-auto')
    expect(line).toContain('qt-scroll-container')
  })

  it.each([
    'components/theme-editor/calliope/CalliopePanel.tsx',
    'components/theme-editor/DraftEditor.tsx',
    'app/calliope/specimens/SpecimenGalleryView.tsx',
  ])('%s sizes with cqh, never 100vh', (file) => {
    const source = read(file)
    expect(source).not.toMatch(/100vh/)
    expect(source).toMatch(/100cqh/)
  })
})
