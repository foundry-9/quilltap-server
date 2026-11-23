/**
 * The inspector's page reader (Calliope Live, Spec H, Stage 0): an element's
 * facts without its text, and the rules that match it now or on hover,
 * read from every stylesheet, the theme's own style element told apart.
 *
 * jsdom's CSSOM knows style and `@media` rules; `@layer`, `@scope` and
 * `@container` are covered by the model's tests and the in-browser
 * measurement recorded in the spec.
 */

import { elementChain, elementFacts, matchingRules, THEME_STYLE_ELEMENT_ID } from '@/components/theme-inspect/dom'
import { inspectProperties } from '@/components/theme-inspect/model'

function addStyle(css: string, id?: string) {
  const el = document.createElement('style')
  if (id) el.id = id
  el.textContent = css
  document.head.appendChild(el)
  return el
}

afterEach(() => {
  document.head.innerHTML = ''
  document.body.innerHTML = ''
})

describe('elementFacts', () => {
  it('reads classes and attributes, not text or the style attribute', () => {
    document.body.innerHTML = '<div class="qt-card x" data-role="a" aria-current="page" style="color: red">Secret words</div>'
    const el = document.body.firstElementChild!
    const facts = elementFacts(el)
    expect(facts).toEqual({ classes: ['qt-card', 'x'], attributes: { 'data-role': 'a', 'aria-current': 'page' } })
    expect(JSON.stringify(facts)).not.toContain('Secret')
  })

  it('walks outward to the root', () => {
    document.body.innerHTML = '<section class="qt-dialog"><p class="inner"></p></section>'
    const chain = elementChain(document.querySelector('.inner')!)
    expect(chain[0].classes).toEqual(['inner'])
    expect(chain[1].classes).toEqual(['qt-dialog'])
    expect(chain.length).toBe(4) // p, section, body, html
  })
})

describe('matchingRules', () => {
  it('finds matching rules, hover rules apart, and skips the rest', () => {
    addStyle(`
      .qt-card { background: var(--qt-card-bg); }
      .qt-card:hover { background: var(--qt-card-hover); }
      .other { color: red; }
      @media (min-width: 1px) { .qt-card { color: var(--qt-card-fg); } }
      @media not all { .qt-card { color: var(--never); } }
    `)
    document.body.innerHTML = '<div class="qt-card" style="--x: 1px"></div>'
    // jsdom has no matchMedia; a browser answers this itself.
    window.matchMedia = ((query: string) => ({ matches: !query.startsWith('not all') })) as unknown as typeof window.matchMedia
    const walk = matchingRules(document.querySelector('.qt-card')!)
    const summary = walk.rules.map((r) => [r.selector, r.state, r.origin])
    expect(summary).toEqual([
      ['.qt-card', null, 'app'],
      ['.qt-card:hover', 'hover', 'app'],
      ['.qt-card', null, 'app'],
      ['', null, 'inline'],
    ])
    const { base, states } = inspectProperties(walk.rules, walk.layerOrder)
    expect(base.map((r) => r.property)).toEqual(['--x', 'background', 'color'])
    expect(states.hover?.[0].vars).toEqual(['--qt-card-hover'])
    expect(walk.elapsedMs).toBeGreaterThanOrEqual(0)
  })

  it("marks the theme's token block apart from the app", () => {
    addStyle('.qt-card { color: var(--a); }')
    addStyle('[data-theme="t"] { --theme-card: red; }', THEME_STYLE_ELEMENT_ID)
    document.documentElement.setAttribute('data-theme', 't')
    const walk = matchingRules(document.documentElement)
    expect(walk.rules.map((r) => r.origin)).toEqual(['theme-tokens'])
    document.documentElement.removeAttribute('data-theme')
  })

  it('tolerates a stylesheet it may not read', () => {
    addStyle('.a { color: var(--a); }')
    const sheets = Array.from(document.styleSheets)
    const locked = { get cssRules(): CSSRuleList { throw new DOMException('cross-origin', 'SecurityError') } } as unknown as CSSStyleSheet
    const spy = jest.spyOn(document, 'styleSheets', 'get').mockReturnValue([locked, ...sheets] as unknown as StyleSheetList)
    document.body.innerHTML = '<p class="a"></p>'
    const walk = matchingRules(document.querySelector('.a')!)
    expect(walk.unreadable).toBe(1)
    expect(walk.rules).toHaveLength(1)
    spy.mockRestore()
  })
})
