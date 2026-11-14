/**
 * @jest-environment node
 */

/**
 * Theme hook catalogue lint (lib/themes/hooks/lint.ts): the catalogue
 * well-formedness check, the markup check, and the report-only check of a
 * theme's selectors. Fixtures are small hand-made catalogues so each rule is
 * exercised alone; one test holds the real catalogue to its own rules.
 */

import { HOOK_CATALOGUE, hooksRemovedSince } from '@/lib/themes/hooks'
import {
  lintCatalogue,
  lintMarkup,
  lintThemeSelectors,
  tokenizeSelector,
  type SelectorReasonCode,
} from '@/lib/themes/hooks/lint'
import type { HookCatalogue } from '@/lib/themes/hooks/types'

const FIXTURE: HookCatalogue = {
  version: 2,
  hooks: [
    {
      className: 'qt-home',
      surface: 'home',
      label: 'Home',
      since: 1,
    },
    {
      className: 'qt-home-card',
      surface: 'home',
      label: 'Home card',
      within: ['qt-home'],
      variants: [{ attribute: 'data-section', values: ['chats', 'projects'] }],
      states: [
        { kind: 'class', className: 'qt-home-card-open', label: 'Open' },
        { kind: 'aria', attribute: 'aria-expanded', values: ['true', 'false'], label: 'Open' },
      ],
      since: 1,
    },
    {
      className: 'qt-tool-card',
      surface: 'salon',
      label: 'Tool card',
      variants: [{ attribute: 'data-tool', values: 'open' }],
      since: 2,
    },
  ],
  removed: [{ className: 'qt-old-card', removedIn: 2, replacedBy: 'qt-home-card' }],
}

const GOOD_MARKUP = [
  {
    path: 'components/home.tsx',
    content: `
      export function Home() {
        return (
          <div className="qt-home">
            <div className={open ? 'qt-home-card qt-home-card-open' : 'qt-home-card'} data-section="chats" aria-expanded={open} />
            <div className="qt-home-card" data-section={'projects'} />
            <div className="qt-tool-card" data-tool="anything_at_all" />
          </div>
        )
      }`,
  },
]

describe('lintCatalogue', () => {
  it('accepts a well-formed catalogue', () => {
    expect(lintCatalogue(FIXTURE)).toEqual([])
  })

  it('holds the real catalogue to its own rules', () => {
    expect(lintCatalogue(HOOK_CATALOGUE)).toEqual([])
  })

  it('refuses a class catalogued twice', () => {
    const issues = lintCatalogue({ ...FIXTURE, hooks: [...FIXTURE.hooks, { ...FIXTURE.hooks[0] }] })
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining('`qt-home` is catalogued twice')])
  })

  it('refuses a `within` that names no hook', () => {
    const issues = lintCatalogue({
      ...FIXTURE,
      hooks: [{ ...FIXTURE.hooks[1], within: ['qt-nowhere'] }, FIXTURE.hooks[0]],
    })
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('`qt-nowhere`')
  })

  it('refuses a hook both catalogued and removed', () => {
    const issues = lintCatalogue({ ...FIXTURE, removed: [{ className: 'qt-home', removedIn: 2 }] })
    expect(issues.map((i) => i.message)).toEqual([expect.stringContaining('both catalogued and in REMOVED_HOOKS')])
  })

  it('refuses a state class listed twice, and an empty value list', () => {
    const card = FIXTURE.hooks[1]
    const issues = lintCatalogue({
      ...FIXTURE,
      hooks: [
        FIXTURE.hooks[0],
        {
          ...card,
          states: [...card.states!, { kind: 'class', className: 'qt-home-card-open', label: 'Again' }],
          variants: [{ attribute: 'data-section', values: [] }],
        },
      ],
    })
    expect(issues).toHaveLength(2)
  })

  it('refuses a `since` newer than the catalogue', () => {
    const issues = lintCatalogue({ ...FIXTURE, hooks: [{ ...FIXTURE.hooks[0], since: 3 }, ...FIXTURE.hooks.slice(1)] })
    expect(issues).toHaveLength(1)
    expect(issues[0].message).toContain('since: 3')
  })
})

describe('lintMarkup', () => {
  it('passes markup that carries every hook, state and variant', () => {
    expect(lintMarkup(FIXTURE, GOOD_MARKUP)).toEqual([])
  })

  it('fails a hook that has left the markup, with the removal instruction', () => {
    const issues = lintMarkup(FIXTURE, [
      { path: 'components/home.tsx', content: GOOD_MARKUP[0].content.replace(/qt-tool-card/g, 'qt-other') },
    ])
    expect(issues).toEqual([
      {
        rule: 'markup',
        className: 'qt-tool-card',
        message:
          'catalogued hook `qt-tool-card` is no longer in the markup: restore it, or move it to REMOVED_HOOKS and raise HOOK_CATALOGUE_VERSION',
      },
    ])
  })

  it('does not count a longer class as the hook (`qt-home-card-open` alone is not `qt-home-card`)', () => {
    const issues = lintMarkup(FIXTURE, [
      {
        path: 'components/home.tsx',
        content: '<div className="qt-home qt-home-card-open qt-tool-card" data-section="chats" data-tool="x" />',
      },
    ])
    expect(issues.map((i) => i.className)).toEqual(['qt-home-card'])
  })

  it('fails a missing state class and a missing variant attribute', () => {
    const issues = lintMarkup(FIXTURE, [
      { path: 'components/home.tsx', content: '<div className="qt-home qt-home-card qt-tool-card" data-tool="x" />' },
    ])
    expect(issues.map((i) => i.className).sort()).toEqual(['data-section', 'qt-home-card-open'])
  })

  it('looks for a composed class in its composedIn file, by prefix', () => {
    const composed: HookCatalogue = {
      version: 1,
      hooks: [{ className: 'qt-badge-provider-openai', surface: 'common', label: 'Badge', composedIn: 'components/badge.tsx', since: 1 }],
      removed: [],
    }
    const file = { path: 'components/badge.tsx', content: 'className={`qt-badge-provider-${id}`}' }
    expect(lintMarkup(composed, [file])).toEqual([])
    expect(lintMarkup(composed, [{ ...file, path: 'components/elsewhere.tsx' }])).toHaveLength(1)
  })

  it('fails a literal variant value the catalogue does not list, in every literal form', () => {
    const issues = lintMarkup(FIXTURE, [
      ...GOOD_MARKUP,
      {
        path: 'components/bad.tsx',
        content: [
          '<div data-section="settings" />',
          "<div data-section={'photos'} />",
          'const attrs = { \'data-section\': "files" }',
        ].join('\n'),
      },
    ])
    expect(issues.map((i) => [i.rule, i.line])).toEqual([
      ['variant-value', 1],
      ['variant-value', 2],
      ['variant-value', 3],
    ])
    expect(issues[0].message).toContain('expected one of: chats, projects')
  })

  it('does not check values supplied from a variable, or an open set', () => {
    const issues = lintMarkup(FIXTURE, [
      ...GOOD_MARKUP,
      { path: 'components/var.tsx', content: '<div data-section={section} data-tool="whatever_tool" />' },
    ])
    expect(issues).toEqual([])
  })
})

describe('tokenizeSelector', () => {
  it('extracts classes, attributes, elements and ids, descending into :is/:not/:has', () => {
    const tokens = tokenizeSelector(
      '[data-theme="x"].dark main > .qt-a:is(.qt-b, [data-nav="home"]) :not(.qt-c)::after #id body:has([style*="--u"])',
    )
    expect(tokens.classes).toEqual(['dark', 'qt-a', 'qt-b', 'qt-c'])
    expect(tokens.elements).toEqual(['main', 'body'])
    expect(tokens.ids).toEqual(['id'])
    expect(tokens.attributes).toEqual([
      { name: 'data-theme', operator: '=', value: 'x' },
      { name: 'data-nav', operator: '=', value: 'home' },
      { name: 'style', operator: '*=', value: '--u' },
    ])
  })

  it('reads escaped class names and unquoted attribute values', () => {
    const tokens = tokenizeSelector('.hover\\:qt-bg-muted[aria-current=page]')
    expect(tokens.classes).toEqual(['hover:qt-bg-muted'])
    expect(tokens.attributes).toEqual([{ name: 'aria-current', operator: '=', value: 'page' }])
  })

  it('ignores the argument of a non-selector pseudo-class', () => {
    expect(tokenizeSelector('li:nth-child(2n + 1) span:lang(en)').elements).toEqual(['li', 'span'])
  })
})

describe('lintThemeSelectors', () => {
  const codesFor = (css: string): SelectorReasonCode[][] =>
    lintThemeSelectors(css, HOOK_CATALOGUE).map((finding) => finding.reasons.map((r) => r.code))

  it('accepts selectors built only from hooks, the root and ARIA state', () => {
    const css = `
      [data-theme="t"] .qt-homepage-section[data-section="chats"] { transform: rotateY(8deg); }
      [data-theme="t"].dark .qt-chat-message-row[data-role="staff"][data-staff="lantern"] { color: red; }
      [data-theme="t"] .qt-collapsed-nav-button[aria-current="page"] { outline: 1px solid; }
      [data-theme="t"] .qt-character-header, [data-theme="t"] .qt-section-card[data-section="physical-description"] { color: blue; }
      html, body { margin: 0; }
      @keyframes spin { from { opacity: 0 } 50% { opacity: .5 } to { opacity: 1 } }
      @media (min-width: 600px) { [data-theme="t"] .qt-dialog-body { padding: 0; } }
    `
    expect(lintThemeSelectors(css, HOOK_CATALOGUE)).toEqual([])
  })

  // The brittle and dead selectors listed in the Phase 0a audit, section 2.3.
  it.each<[string, SelectorReasonCode[]]>([
    ['h1', ['bare-element']],
    ['h6', ['bare-element']],
    ['button', ['bare-element']],
    ['input', ['bare-element']],
    ['textarea', ['bare-element']],
    ['select', ['bare-element']],
    ['svg', ['bare-element']],
    ['span:first-child', ['bare-element']],
    ['div:last-child', ['bare-element']],
    ['[class*="card"]', ['class-substring']],
    ['[class*="Card"]', ['class-substring']],
    ['[class*="brand"]', ['class-substring']],
    ['[class*="spinner"]', ['class-substring']],
    ['button[class*="primary"]', ['bare-element', 'class-substring']],
    ['.bg-background', ['non-qt-class']],
    ['body:has([style*="--story-background-url"])', ['uncatalogued-attribute']],
    ['[data-sidebar] [aria-current="page"]', ['uncatalogued-attribute']],
    ['.app-shell', ['non-qt-class']],
    ['.message-enter', ['non-qt-class']],
    ['.qt-sidebar-section-title', ['uncatalogued-qt-class']],
    ['.qt-brand', ['uncatalogued-qt-class']],
    ['.qt-left-sidebar-item-label', ['uncatalogued-qt-class']],
    ['.qt-navbar-link', ['uncatalogued-qt-class']],
  ])('flags %s', (selector, codes) => {
    expect(codesFor(`[data-theme="t"] ${selector} { color: red; }`)).toEqual([codes])
  })

  it('accepts [data-role="assistant"] now that rows carry it, but flags a value the set lacks', () => {
    expect(codesFor('[data-theme="t"] [data-role="assistant"] { color: red; }')).toEqual([])
    expect(codesFor('[data-theme="t"] [data-role="narrator"] { color: red; }')).toEqual([['unknown-variant-value']])
  })

  it('flags a removed hook, naming its replacement', () => {
    const findings = lintThemeSelectors('.qt-old-card { color: red; }', FIXTURE)
    expect(findings).toHaveLength(1)
    expect(findings[0].reasons[0]).toMatchObject({ code: 'removed-hook', token: 'qt-old-card' })
    expect(findings[0].reasons[0].message).toContain('use `.qt-home-card`')
  })

  it('reports each member of a comma list alone, with its line', () => {
    const css = '.qt-homepage-row {}\n\n.qt-homepage-row,\nh2,\n.qt-nope { color: red; }'
    const findings = lintThemeSelectors(css, HOOK_CATALOGUE)
    expect(findings.map((f) => [f.line, f.selector])).toEqual([
      [3, 'h2'],
      [3, '.qt-nope'],
    ])
  })
})

describe('hooksRemovedSince', () => {
  it('returns hooks removed after the given version', () => {
    expect(hooksRemovedSince(1, FIXTURE.removed).map((h) => h.className)).toEqual(['qt-old-card'])
    expect(hooksRemovedSince(2, FIXTURE.removed)).toEqual([])
  })
})
