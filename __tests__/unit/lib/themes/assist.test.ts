/**
 * @jest-environment node
 *
 * Calliope's references and proposals (Calliope Live, Spec J, Stage 0): the
 * styled-by table's builder, applying and describing a change set, judging
 * one against a draft, and the bounded renderings she is told.
 */

import fs from 'fs'
import path from 'path'
import { HOOK_CATALOGUE } from '@/lib/themes/hooks'
import { buildStyledByTable, compoundsOf, conditionFor } from '@/lib/themes/assist/styled-by-build'
import { STYLED_BY_TABLE, styledBy } from '@/lib/themes/assist/styled-by'
import { applyChangeSet, ChangeSetSchema, changeLineText, describeChangeSet, type ChangeTarget } from '@/lib/themes/assist/change-set'
import { issueKey, judgeChangeSet, type JudgeInput } from '@/lib/themes/assist/judge'
import {
  assistDraftFrom,
  lookupHooks,
  lookupTokens,
  renderDraft,
  renderHookLookup,
  renderTokenLookup,
  RENDER_LIMITS,
  type AssistDraft,
} from '@/lib/themes/assist/render'
import type { ThemeTokensDocument } from '@/lib/themes/engine/client'

const blankTokens = (): ThemeTokensDocument => ({ primitives: {}, tokens: {}, choices: {} })
const hook = (cls: string) => HOOK_CATALOGUE.hooks.find((h) => h.className === cls)!

// ============================================================================
// 0.1 styled-by

describe('styled-by table builder', () => {
  const hookClasses = new Set(HOOK_CATALOGUE.hooks.map((h) => h.className as string))

  it('splits a selector into compounds at top-level combinators only', () => {
    expect(compoundsOf('.a:is(.b .c) > .d[data-x="1 2"] + .e ~ .f')).toEqual(['.a:is(.b .c)', '.d[data-x="1 2"]', '.e', '.f'])
  })

  it('names variant values, class and aria states, interactions, pseudo-elements, dark mode and ancestor hooks', () => {
    expect(conditionFor(hook('qt-homepage-section'), '.qt-homepage-section[data-section="chats"]:hover', hookClasses)).toBe('[data-section="chats"], :hover')
    expect(conditionFor(hook('qt-dialog'), '.qt-dialog.qt-dialog-wide', hookClasses)).toBe('state: Page-width dialog')
    expect(conditionFor(hook('qt-dialog'), '.dark .qt-dialog[aria-busy="true"]::before', hookClasses)).toBe(
      'state: Working; Escape and the close button wait (aria-busy="true"), ::before, dark mode'
    )
    expect(conditionFor(hook('qt-dialog'), '.qt-dialog-overlay .qt-dialog', hookClasses)).toBe('inside .qt-dialog-overlay')
  })

  it('credits a rule to the hook in its subject only, resolves nesting, follows Tailwind variables and ignores :not()', () => {
    const css = `
      .qt-dialog { background: var(--qt-dialog-bg); padding: 1rem; --tw-shadow: 0 1px var(--qt-dialog-shadow-color); box-shadow: var(--tw-shadow); }
      .qt-dialog .qt-homepage-section { color: red; }
      .qt-homepage-section { & .x { color: blue; } &:focus-visible { outline: 2px solid var(--color-ring); } }
      .x:not(.qt-dialog) { color: green; }
      @keyframes qt-dialog { from { opacity: 0; } }
    `
    const table = buildStyledByTable([{ path: 'x.css', css }], HOOK_CATALOGUE)
    expect(table.hooks['qt-dialog']).toEqual([
      {
        when: '',
        properties: [
          { property: 'background', vars: ['--qt-dialog-bg'] },
          { property: 'box-shadow', vars: ['--qt-dialog-shadow-color'] },
          { property: 'padding', vars: [], literal: true },
        ],
      },
    ])
    expect(table.hooks['qt-homepage-section']).toEqual([
      { when: ':focus', properties: [{ property: 'outline', vars: ['--color-ring'] }] },
      { when: 'inside .qt-dialog', properties: [{ property: 'color', vars: [], literal: true }] },
    ])
  })

  it('the committed table is for this catalogue and covers most hooks', () => {
    expect(STYLED_BY_TABLE.catalogueVersion).toBe(HOOK_CATALOGUE.version)
    const covered = HOOK_CATALOGUE.hooks.filter((h) => styledBy(h.className).length > 0).length
    expect(covered / HOOK_CATALOGUE.hooks.length).toBeGreaterThan(0.8)
    expect(styledBy('qt-chat-message-assistant')[0].properties).toEqual(
      expect.arrayContaining([{ property: 'background', vars: ['--qt-chat-assistant-bg'] }])
    )
    expect(styledBy('qt-no-such-hook')).toEqual([])
  })
})

// ============================================================================
// 0.2 change sets

const target = (over: Partial<ChangeTarget> = {}): ChangeTarget => ({
  tokens: {
    primitives: { ink: { type: 'color', value: '#111111', dark: '#eeeeee' } },
    tokens: { '--theme-foreground': 'var(--p-ink)', '--theme-card': { value: '#ffffff', dark: '#222222' } },
    choices: {},
  },
  css: '.qt-dialog { border-width: 2px; }\n',
  ...over,
})

describe('applyChangeSet', () => {
  it('applies every kind of operation in order with the editor\'s own edits', () => {
    const result = applyChangeSet(target(), {
      operations: [
        { op: 'set-token', token: '--theme-primary', value: '#335577' },
        { op: 'set-token', token: '--theme-card', value: '#fafafa' },
        { op: 'set-token', token: '--theme-border', dark: '#444444' },
        { op: 'reset-token', token: '--theme-foreground' },
        { op: 'add-primitive', name: 'accent', type: 'color', value: '#aa3300' },
        { op: 'set-primitive', name: 'ink', dark: null },
        { op: 'rename-primitive', from: 'accent', to: 'ember' },
        { op: 'set-choice', choice: 'density', option: 'comfortable' },
        { op: 'replace-css', find: 'border-width: 2px;', replace: 'border-width: 3px;' },
      ],
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.tokens.tokens['--theme-primary']).toBe('#335577')
    expect(result.tokens.tokens['--theme-card']).toEqual({ value: '#fafafa', dark: '#222222' })
    expect(result.tokens.tokens['--theme-border']).toEqual({ value: expect.any(String), dark: '#444444' })
    expect(result.tokens.tokens['--theme-foreground']).toBeUndefined()
    expect(result.tokens.primitives).toEqual({ ink: { type: 'color', value: '#111111' }, ember: { type: 'color', value: '#aa3300' } })
    expect(result.tokens.choices).toEqual({ density: 'comfortable' })
    expect(result.css).toBe('.qt-dialog { border-width: 3px; }\n')
    expect(result.tokensChanged && result.cssChanged).toBe(true)
  })

  it('names the first operation that cannot be applied, and why', () => {
    const cases: Array<[unknown, RegExp]> = [
      [{ op: 'set-token', token: '--theme-primry', value: 'red' }, /not a registry token \(did you mean --theme-primary\?\)/],
      [{ op: 'reset-token', token: '--theme-primary' }, /not set by the draft/],
      [{ op: 'set-primitive', name: 'nope', value: '#000' }, /no primitive named "nope"/],
      [{ op: 'add-primitive', name: 'ink', type: 'color', value: '#000' }, /already exists/],
      [{ op: 'rename-primitive', from: 'nope', to: 'other' }, /no primitive named "nope"/],
      [{ op: 'set-choice', choice: 'density', option: 'roomy' }, /not an option of density/],
      [{ op: 'replace-css', find: 'color: red;', replace: '' }, /not in the stylesheet/],
    ]
    for (const [op, reason] of cases) {
      const set = ChangeSetSchema.parse({ title: 't', reason: 'r', operations: [{ op: 'set-token', token: '--theme-ring', value: '#000' }, op] })
      const result = applyChangeSet(target(), set)
      expect(result).toMatchObject({ ok: false, index: 1 })
      if (!result.ok) expect(result.reason).toMatch(reason)
    }
  })

  it('refuses a stretch of CSS found more than once, and replace-css on a draft without a stylesheet', () => {
    const twice = applyChangeSet(target({ css: 'a{x:1}\na{x:1}\n' }), { operations: [{ op: 'replace-css', find: 'a{x:1}', replace: '' }] })
    expect(twice).toMatchObject({ ok: false, reason: expect.stringMatching(/2 times/) })
    const none = applyChangeSet(target({ css: null }), { operations: [{ op: 'replace-css', find: 'a', replace: 'b' }] })
    expect(none).toMatchObject({ ok: false, reason: expect.stringMatching(/no stylesheet yet; use set-css/) })
    const written = applyChangeSet(target({ css: null }), { operations: [{ op: 'set-css', css: '.qt-dialog { color: red; }' }] })
    expect(written).toMatchObject({ ok: true, css: '.qt-dialog { color: red; }', cssChanged: true, tokensChanged: false })
  })

  it('the schema refuses an unknown operation and an empty proposal', () => {
    expect(ChangeSetSchema.safeParse({ title: 't', reason: 'r', operations: [] }).success).toBe(false)
    expect(ChangeSetSchema.safeParse({ title: 't', reason: 'r', operations: [{ op: 'set-font', family: 'X' }] }).success).toBe(false)
  })
})

describe('describeChangeSet', () => {
  it('gives each operation with the value before and after', () => {
    const lines = describeChangeSet(target(), {
      operations: [
        { op: 'set-token', token: '--theme-card', value: '#fafafa' },
        { op: 'set-token', token: '--theme-card', value: '#f0f0f0' },
        { op: 'reset-token', token: '--theme-foreground' },
        { op: 'set-choice', choice: 'density', option: 'comfortable' },
        { op: 'set-css', css: 'a{}\nb{}' },
      ],
    }).map(changeLineText)
    expect(lines[0]).toMatch(/^Card .*\(--theme-card\): set — #ffffff; dark #222222 → #fafafa; dark #222222$/)
    expect(lines[1]).toMatch(/#fafafa; dark #222222 → #f0f0f0; dark #222222$/)
    expect(lines[2]).toMatch(/\(--theme-foreground\): reset to the default — var\(--p-ink\) → default: /)
    expect(lines[3]).toBe('Density: chosen — compact → comfortable')
    expect(lines[4]).toBe('Stylesheet: rewritten whole — 1 lines → 2 lines')
  })
})

// ============================================================================
// Judge

const manifest = { format: 'qtap-theme', formatVersion: 2, id: 'judge-test', name: 'Judge Test', version: '1.0.0', author: 'Tester' }
const judgeInput = (over: Partial<JudgeInput> = {}): JudgeInput => ({
  manifest,
  tokens: blankTokens(),
  css: null,
  files: ['theme.json', 'tokens.json'],
  ...over,
})

describe('judgeChangeSet', () => {
  it('a clean proposal applies with nothing introduced', () => {
    const j = judgeChangeSet(judgeInput(), { operations: [{ op: 'set-token', token: '--theme-primary', value: '#1d4ed8' }] })
    expect(j).toMatchObject({ ok: true, acceptable: true, introducedErrors: [], introducedWarnings: [] })
  })

  it('one with an unknown token does not apply', () => {
    expect(judgeChangeSet(judgeInput(), { operations: [{ op: 'set-token', token: '--theme-nothing-here', value: 'red' }] })).toMatchObject({
      ok: false,
      stage: 'apply',
      index: 0,
    })
  })

  it('a value of the wrong type is an introduced error', () => {
    const j = judgeChangeSet(judgeInput(), { operations: [{ op: 'set-token', token: '--theme-primary', value: '12px' }] })
    expect(j.ok && j.acceptable).toBe(false)
    if (j.ok) expect(j.introducedErrors[0].message).toMatch(/--theme-primary: "12px" is not a colour/)
  })

  it('CSS the scoper refuses is an introduced error, with its line', () => {
    const j = judgeChangeSet(judgeInput(), { operations: [{ op: 'set-css', css: '.qt-dialog { color: red; }\n@import "x.css";\n' }] })
    expect(j.ok && j.acceptable).toBe(false)
    if (j.ok) expect(j.introducedErrors).toEqual([expect.objectContaining({ source: 'validation', message: expect.stringMatching(/@import is not allowed/), line: 2 })])
  })

  it('a selector off the catalogue is a warning, and a moved line is not counted as new', () => {
    const first = judgeChangeSet(judgeInput(), { operations: [{ op: 'set-css', css: '.foo { color: red; }\n' }] })
    expect(first).toMatchObject({ ok: true, acceptable: true })
    if (first.ok) expect(first.introducedWarnings).toEqual([expect.objectContaining({ source: 'hooks', line: 1, message: expect.stringMatching(/not a `qt-\*` hook/) })])

    const moved = judgeChangeSet(judgeInput({ css: '.foo { color: red; }\n', files: ['theme.json', 'tokens.json', 'styles.css'], manifest: { ...manifest, stylesPath: 'styles.css' } }), {
      operations: [{ op: 'replace-css', find: '.foo', replace: '.qt-dialog { color: blue; }\n\n.foo' }],
    })
    expect(moved).toMatchObject({ ok: true, introducedWarnings: [], removed: [] })
  })

  it('a pair that newly fails contrast is reported, and one it mends is credited', () => {
    const worse = judgeChangeSet(judgeInput(), { operations: [{ op: 'set-token', token: '--theme-foreground', value: '#fefefe' }] })
    expect(worse.ok && worse.acceptable).toBe(true)
    if (worse.ok) {
      expect(worse.contrastWorse).toEqual(
        expect.arrayContaining([expect.objectContaining({ foreground: '--theme-foreground', mode: 'light', after: expect.objectContaining({ status: 'fail' }) })])
      )
    }
    const broken = blankTokens()
    broken.tokens['--theme-foreground'] = '#fefefe'
    const mended = judgeChangeSet(judgeInput({ tokens: broken }), { operations: [{ op: 'reset-token', token: '--theme-foreground' }] })
    if (mended.ok) expect(mended.contrastFixed.length).toBeGreaterThan(0)
    expect(mended.ok).toBe(true)
  })

  it('issue keys ignore line numbers', () => {
    expect(issueKey({ source: 'validation', message: 'styles.css: x (line 4)' })).toBe(issueKey({ source: 'validation', message: 'styles.css: x (line 9)' }))
  })
})

// ============================================================================
// 0.3 renderings

const BUNDLED = path.join(process.cwd(), 'themes/bundled')
function bundledDraft(id: string): AssistDraft {
  const dir = path.join(BUNDLED, id)
  const m = JSON.parse(fs.readFileSync(path.join(dir, 'theme.json'), 'utf8'))
  const css = fs.existsSync(path.join(dir, 'styles.css')) ? fs.readFileSync(path.join(dir, 'styles.css'), 'utf8') : null
  return assistDraftFrom({
    id,
    manifest: m,
    tokens: JSON.parse(fs.readFileSync(path.join(dir, 'tokens.json'), 'utf8')),
    styles: css === null ? null : { text: css },
    images: [],
    issues: [],
  })
}
const blankDraft: AssistDraft = assistDraftFrom({ id: 'blank', manifest: { name: 'Blank' }, tokens: null, styles: null, images: [], issues: [] })

describe('renderings', () => {
  it('the draft overview says what it sets, its choices, fonts, contrast and stylesheet', () => {
    const blank = renderDraft(blankDraft)
    expect(blank).toMatch(/None: the draft is the house default\./)
    expect(blank).toMatch(/density = compact \(default\)/)
    expect(blank).toMatch(/no stylesheet/)

    const rains = renderDraft(bundledDraft('rains'))
    expect(rains).toMatch(/# Draft "Rains"/)
    expect(rains).toMatch(/"Nunito Sans"/)
    expect(rains).toMatch(/## Stylesheet \(\d+ lines\)/)
    expect(renderDraft(bundledDraft('rains'), { part: 'css' })).toMatch(/^## Stylesheet/)
  })

  it('clips a long stylesheet in the overview and says so', () => {
    const long = { ...blankDraft, css: '.qt-dialog { color: red; }\n'.repeat(1000) }
    const text = renderDraft(long)
    expect(text).toMatch(/the first 6000 of \d+ characters/)
    expect(text.length).toBeLessThan(RENDER_LIMITS.cssInOverview + 5000)
  })

  it('token lookup finds by words, group, type and name, with the draft\'s values; internal tokens only by name', () => {
    const draft = bundledDraft('rains')
    const found = lookupTokens({ query: 'primary', type: 'color' }, draft.tokens)
    expect(found.map((t) => t.name)).toContain('--theme-primary')
    expect(renderTokenLookup(draft, found)).toMatch(/--theme-primary — .*\[set by this theme\]/)
    expect(lookupTokens({}, draft.tokens)).toEqual([])
    expect(lookupTokens({ names: ['--theme-primary'] }, draft.tokens)).toHaveLength(1)
    expect(lookupTokens({ group: 'colors', setOnly: true }, blankTokens())).toEqual([])
    expect(renderTokenLookup(draft, [])).toMatch(/No registry token matches/)
  })

  it('hook lookup joins styled-by rows to the draft\'s values', () => {
    const draft = bundledDraft('rains')
    const found = lookupHooks({ classes: ['qt-chat-message-assistant'] })
    const text = renderHookLookup(draft, found)
    expect(text).toMatch(/## \.qt-chat-message-assistant/)
    expect(text).toMatch(/background ← --qt-chat-assistant-bg: /)
    expect(lookupHooks({ query: 'dialog', surface: 'dialog' }).length).toBeGreaterThan(1)
    expect(lookupHooks({})).toEqual([])
  })

  it('stays bounded against a blank draft and the largest bundled theme', () => {
    const drafts = [blankDraft, bundledDraft('rains')]
    for (const draft of drafts) {
      expect(renderDraft(draft).length).toBeLessThan(40000)
      expect(renderTokenLookup(draft, lookupTokens({ group: 'colors' }, draft.tokens)).length).toBeLessThan(20000)
      expect(renderHookLookup(draft, lookupHooks({ surface: 'salon' })).length).toBeLessThan(30000)
    }
  })
})
