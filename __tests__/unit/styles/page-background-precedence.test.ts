/**
 * Regression tests for the CSS that lets a story or dynamic background take
 * precedence over a theme's own page and home pictures.
 *
 * - 3a8df9d51: the page-background rule in `_base.css` counted
 *   `--story-background-url` markers inside hidden (kept-alive) workspace tabs,
 *   so a story background in a tab that was not on screen hid the theme's page
 *   background on every other tab. Markers under
 *   `.qt-tab-pane[aria-hidden="true"]` no longer count.
 * - a6ed5800c: Madman's Box's home photograph (`.qt-homepage-container::before`)
 *   still showed over a collage; it now applies only without
 *   `qt-homepage-backdrop`.
 *
 * The selectors are read from the shipped CSS and evaluated against a DOM, so
 * the test follows the real rule rather than a copy of it.
 */

import fs from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../..')
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

/** The `body…` selector of the page-background image rule in `_base.css`. */
function pageBackgroundBodySelector(): string {
  const css = read('app/styles/qt-components/_base.css')
  const match = css.match(/:root\[data-qt-page-background\]\s+(body[^{]*?)\s*\{\s*background-image:\s*var\(--qt-page-background-image\)/)
  if (!match) throw new Error('page-background rule not found in _base.css')
  return match[1]
}

/** Every page-background rule's `body…` prefix (image, transparent surfaces, texture). */
function allPageBackgroundBodySelectors(): string[] {
  const css = read('app/styles/qt-components/_base.css')
  const found = [...css.matchAll(/:root\[data-qt-page-background\]\s+(body:not\(:has\(.*?\)\)\))/g)].map((m) => m[1])
  return found
}

describe('_base.css page background', () => {
  let selector: string

  beforeAll(() => {
    selector = pageBackgroundBodySelector()
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('applies when no story background is marked', () => {
    document.body.innerHTML = '<div class="qt-tab-pane" aria-hidden="false"><div class="qt-homepage-container"></div></div>'
    expect(document.body.matches(selector)).toBe(true)
  })

  it('stands aside for a story or dynamic background on the visible tab', () => {
    document.body.innerHTML =
      '<div class="qt-tab-pane" aria-hidden="false"><div class="qt-homepage-container" style="--story-background-url: url(\'/c.webp\')"></div></div>'
    expect(document.body.matches(selector)).toBe(false)
  })

  it('ignores a marker inside a hidden kept-alive workspace tab', () => {
    document.body.innerHTML =
      '<div class="qt-tab-pane" aria-hidden="true"><div><div style="--story-background-url: url(\'/story.webp\')"></div></div></div>' +
      '<div class="qt-tab-pane" aria-hidden="false"><div class="qt-homepage-container"></div></div>'
    expect(document.body.matches(selector)).toBe(true)
  })

  it('stands aside when the visible tab is marked even if a hidden one is too', () => {
    document.body.innerHTML =
      '<div class="qt-tab-pane" aria-hidden="true"><div style="--story-background-url: url(\'/a.webp\')"></div></div>' +
      '<div class="qt-tab-pane" aria-hidden="false"><div style="--story-background-url: url(\'/b.webp\')"></div></div>'
    expect(document.body.matches(selector)).toBe(false)
  })

  it('uses the same hidden-tab exclusion on the image, surface and texture rules', () => {
    const selectors = allPageBackgroundBodySelectors()
    expect(selectors.length).toBeGreaterThanOrEqual(3)
    for (const s of selectors) {
      expect(s).toBe(selector)
    }
  })
})

describe("Madman's Box home photograph", () => {
  const css = read('themes/bundled/madmans-box/styles.css')

  it('is guarded by qt-homepage-backdrop', () => {
    const rules = [...css.matchAll(/([^{}]*\.qt-homepage-container[^{}]*)::before\s*\{/g)].map((m) => m[1].trim())
    expect(rules.length).toBeGreaterThan(0)
    for (const prefix of rules) {
      document.body.innerHTML =
        '<div class="qt-homepage-container" id="plain"></div><div class="qt-homepage-container qt-homepage-backdrop" id="collage"></div>'
      expect(document.getElementById('plain')!.matches(prefix)).toBe(true)
      expect(document.getElementById('collage')!.matches(prefix)).toBe(false)
    }
    document.body.innerHTML = ''
  })
})
