/**
 * The theme editor's pure model (Calliope Live, Spec E, Stage 1): levels and
 * sections, search and "changed only", where a row's value comes from, what
 * it follows, the dark value apart, choices, and the undo history.
 */

import {
  EDITOR_GROUPS,
  EMPTY_RESOURCES,
  FONT_STYLE_OPTIONS,
  appendFamilies,
  declaredWeights,
  draftFontWeights,
  draftResources,
  firstFamilyInForce,
  isEasing,
  keywordOptions,
  moveItem,
  primitiveNames,
  primitiveRowView,
  primitiveStarter,
  valueProblem,
  weightFamilyToken,
  weightNumber,
  HISTORY_COALESCE_MS,
  HISTORY_LIMIT,
  EMPTY_HISTORY,
  analyse,
  darkFollowsLight,
  detachToLiteral,
  filterPrimitiveRows,
  followPrimitive,
  joinDarkToLight,
  matchesQuery,
  placeOf,
  primitiveRows,
  primitivesOfType,
  recordEdit,
  redoStep,
  rowModeView,
  rowProblem,
  sectionViews,
  separateDarkValue,
  setChoice,
  setTokenValue,
  tokenRowView,
  undoStep,
} from '@/components/theme-editor/model'
import { PRIMITIVE_TYPES, THEME_TOKENS, type ThemeTokensDocument, type TokenDef } from '@/lib/themes/engine/client'

const EMPTY: ThemeTokensDocument = { primitives: {}, tokens: {}, choices: {} }
const NO_FILTER = { query: '', changedOnly: false }
const token = (name: string): TokenDef => THEME_TOKENS.find((t) => t.name === name)!

describe('levels', () => {
  it('places every token an author may set, and no internal one', () => {
    const counts = { essential: 0, component: 0, advanced: 0 }
    for (const g of EDITOR_GROUPS) {
      counts.essential += g.essential.length
      counts.component += g.component.length
      counts.advanced += g.advanced.length
    }
    expect(counts).toEqual({ essential: 139, component: 239, advanced: 296 })
    expect(THEME_TOKENS.filter((t) => placeOf(t) === null).every((t) => t.visibility === 'internal')).toBe(true)
  })

  it('keeps registry order within a group', () => {
    const colours = EDITOR_GROUPS.find((g) => g.id === 'colors')!
    const order = THEME_TOKENS.filter((t) => t.group === 'colors' && placeOf(t) === 'essential').map((t) => t.name)
    expect(colours.essential.map((t) => t.name)).toEqual(order)
  })

  it('shows essentials without advanced, and components with them', () => {
    const essentials = sectionViews('essentials', NO_FILTER, EMPTY)
    expect(essentials.every((s) => s.advanced.length === 0 && s.rows.every((t) => placeOf(t) === 'essential'))).toBe(true)
    const components = sectionViews('components', NO_FILTER, EMPTY)
    expect(components.every((s) => s.rows.every((t) => placeOf(t) === 'component'))).toBe(true)
    expect(components.some((s) => s.advanced.length > 0)).toBe(true)
    expect([...essentials, ...components].every((s) => !s.forced)).toBe(true)
  })
})

describe('search and changed only', () => {
  it('matches label, name and description, ignoring case', () => {
    const card = token('--theme-card')
    expect(matchesQuery(card, 'CARD')).toBe(true)
    expect(matchesQuery(card, '--theme-card')).toBe(true)
    expect(matchesQuery(card, 'zzz-nothing')).toBe(false)
  })

  it('finds a match at any level, behind the advanced disclosure too, and opens it', () => {
    const views = sectionViews('essentials', { query: 'card background', changedOnly: false }, EMPTY)
    const advanced = views.flatMap((s) => s.advanced).map((t) => t.name)
    expect(advanced).toContain('--qt-card-bg')
    expect(views.every((s) => s.forced)).toBe(true)
  })

  it('shows only what the theme sets, and counts it per section at every level', () => {
    let doc = setTokenValue(EMPTY, '--theme-card', 'light', '#abcdef')
    doc = setTokenValue(doc, '--qt-card-bg', 'light', '#123456')
    const views = sectionViews('components', { query: '', changedOnly: true }, doc)
    const names = views.flatMap((s) => [...s.rows, ...s.advanced]).map((t) => t.name)
    expect(names.sort()).toEqual(['--qt-card-bg', '--theme-card'])
    const colours = sectionViews('essentials', NO_FILTER, doc).find((s) => s.id === 'colors')!
    expect(colours.changed).toBe(1)
  })

  it('narrows primitives by name', () => {
    const doc: ThemeTokensDocument = { ...EMPTY, primitives: { ink: { type: 'color', value: '#000' }, paper: { type: 'color', value: '#fff' } } }
    expect(filterPrimitiveRows(primitiveRows(doc), { query: 'ink', changedOnly: false }).map((p) => p.name)).toEqual(['ink'])
    expect(filterPrimitiveRows(primitiveRows(doc), { query: '', changedOnly: true })).toHaveLength(2)
  })
})

describe('sources', () => {
  it('says default, theme, or the choice and option that set it', () => {
    const name = '--qt-card-padding'
    expect(rowModeView(analyse(EMPTY).resolved, name, 'light').source).toEqual({ kind: 'default' })
    const comfortable = setChoice(EMPTY, 'density', 'comfortable')
    expect(rowModeView(analyse(comfortable).resolved, name, 'light').source).toEqual({
      kind: 'choice',
      choice: 'density',
      choiceLabel: 'Density',
      option: 'comfortable',
    })
    const own = setTokenValue(comfortable, name, 'light', '2rem')
    expect(rowModeView(analyse(own).resolved, name, 'light').source).toEqual({ kind: 'theme' })
  })

  it('says an optional token is unset', () => {
    const view = rowModeView(analyse(EMPTY).resolved, '--qt-heading-color', 'light')
    expect(view).toMatchObject({ value: '', literal: null, source: { kind: 'unset' } })
  })

  it('names the primitive a value follows', () => {
    const doc = followPrimitive({ ...EMPTY, primitives: { ink: { type: 'color', value: '#112233' } } }, '--theme-card', 'light', 'ink')
    const view = rowModeView(analyse(doc).resolved, '--theme-card', 'light')
    expect(view.follows).toEqual({ name: '--p-ink', label: 'primitive “ink”', primitive: 'ink' })
    expect(view.literal).toBe('#112233')
  })
})

describe('following', () => {
  const withInk: ThemeTokensDocument = {
    ...EMPTY,
    primitives: { ink: { type: 'color', value: '#112233' }, gap: { type: 'length', value: '1rem' } },
  }

  it('offers the primitives of the token type', () => {
    expect(primitivesOfType(withInk, 'color')).toEqual(['ink'])
    expect(primitivesOfType(withInk, 'length')).toEqual(['gap'])
  })

  it('points a mode at a primitive, and back to a value of its own', () => {
    const following = followPrimitive(withInk, '--theme-card', 'light', 'ink')
    expect(following.tokens['--theme-card']).toBe('var(--p-ink)')
    const detached = detachToLiteral(following, analyse(following).resolved, '--theme-card', 'light')
    expect(detached.tokens['--theme-card']).toBe('#112233')
  })

  it('leaves a value that follows nothing alone', () => {
    const doc = setTokenValue(EMPTY, '--theme-card', 'light', '#abcdef')
    expect(detachToLiteral(doc, analyse(doc).resolved, '--theme-card', 'light')).toBe(doc)
  })
})

describe('the dark value apart', () => {
  it('separates dark at the value it shows, and joins it again', () => {
    const name = '--theme-focus-ring-width'
    expect(darkFollowsLight(EMPTY, name)).toBe(true)
    const apart = separateDarkValue(EMPTY, analyse(EMPTY).resolved, name)
    expect(apart.tokens[name]).toEqual({ value: '2px', dark: '2px' })
    expect(darkFollowsLight(apart, name)).toBe(false)
    const joined = joinDarkToLight(apart, analyse(apart).resolved, name)
    expect(joined.tokens[name]).toBe('2px')
    expect(darkFollowsLight(joined, name)).toBe(true)
  })

  it('joins a registry dark default by writing light for both modes', () => {
    expect(darkFollowsLight(EMPTY, '--theme-card')).toBe(false)
    const joined = joinDarkToLight(EMPTY, analyse(EMPTY).resolved, '--theme-card')
    expect(joined.tokens['--theme-card']).toBe(token('--theme-card').default)
  })
})

describe('choices', () => {
  it('writes a non-default option and drops the default one', () => {
    const comfortable = setChoice(EMPTY, 'density', 'comfortable')
    expect(comfortable.choices).toEqual({ density: 'comfortable' })
    expect(setChoice(comfortable, 'density', 'compact').choices).toEqual({})
  })

  it('refuses an unknown choice or option', () => {
    expect(setChoice(EMPTY, 'density', 'cavernous')).toBe(EMPTY)
    expect(setChoice(EMPTY, 'layout', 'wide')).toBe(EMPTY)
    expect(setChoice(EMPTY, 'density', 'compact')).toBe(EMPTY)
  })
})

describe('the type check', () => {
  it('gives the engine message for a value that does not fit, and nothing for an empty one', () => {
    expect(rowProblem(token('--theme-focus-ring-width'), 'wide')).toMatch(/length/)
    expect(rowProblem(token('--theme-focus-ring-width'), '3px')).toBeNull()
    expect(rowProblem(token('--qt-button-text-transform'), 'shouting')).toMatch(/not one of/)
    expect(rowProblem(token('--theme-card'), '')).toBeNull()
  })

  it('reports it on a row only for a value the theme sets', () => {
    const doc = setTokenValue(EMPTY, '--theme-focus-ring-width', 'light', 'wide')
    const { resolved, findings } = analyse(doc)
    const view = tokenRowView(token('--theme-focus-ring-width'), { tokens: doc, resolved, findings, mode: 'light' })
    expect(view.problems.light).toMatch(/length/)
    const clean = analyse(EMPTY)
    expect(tokenRowView(token('--theme-focus-ring-width'), { tokens: EMPTY, ...clean, mode: 'light' }).problems.light).toBeNull()
  })
})

describe('undo history', () => {
  const a = EMPTY
  const b = setTokenValue(a, '--theme-card', 'light', '#000001')
  const c = setTokenValue(b, '--theme-card', 'light', '#000002')

  it('undoes and redoes, and an edit clears redo', () => {
    let h = recordEdit(EMPTY_HISTORY, a, 'card:light', 0)
    h = recordEdit(h, b, 'other', 5000)
    const back = undoStep(h, c)!
    expect(back.doc).toBe(b)
    const forward = redoStep(back.history, back.doc)!
    expect(forward.doc).toBe(c)
    expect(recordEdit(back.history, b, 'x', 9000).future).toEqual([])
    expect(undoStep(EMPTY_HISTORY, a)).toBeNull()
    expect(redoStep(EMPTY_HISTORY, a)).toBeNull()
  })

  it('holds quick edits of one key as one step', () => {
    let h = recordEdit(EMPTY_HISTORY, a, 'card:light', 0)
    h = recordEdit(h, b, 'card:light', HISTORY_COALESCE_MS - 1)
    expect(h.past).toHaveLength(1)
    expect(undoStep(h, c)!.doc).toBe(a)
    h = recordEdit(h, c, 'card:light', 3 * HISTORY_COALESCE_MS)
    expect(h.past).toHaveLength(2)
  })

  it('keeps at most the limit', () => {
    let h = EMPTY_HISTORY
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = recordEdit(h, a, null, i)
    expect(h.past).toHaveLength(HISTORY_LIMIT)
  })
})

describe('keyword options and value problems (Stage 2)', () => {
  it('offers the font styles to a font-style token that lists none', () => {
    expect(keywordOptions(token('--qt-rp-narration-style'))).toEqual(FONT_STYLE_OPTIONS)
    expect(keywordOptions(token('--qt-button-text-transform'))).toEqual(token('--qt-button-text-transform').options)
    expect(keywordOptions(token('--theme-card'))).toBeNull()
  })

  it('checks a value of a type with no token behind it, as a primitive is', () => {
    expect(valueProblem('length', '1rem')).toBeNull()
    expect(valueProblem('length', 'wide')).toMatch(/length/)
    expect(valueProblem('color', '')).toBeNull()
  })
})

describe('the draft resources', () => {
  it('reads the weights a face declares', () => {
    expect(declaredWeights(undefined)).toEqual([400])
    expect(declaredWeights('bold')).toEqual([700])
    expect(declaredWeights('400 700')).toEqual([400, 500, 600, 700])
    expect(declaredWeights('heavy')).toEqual([])
  })

  it('gathers faces of one family and skips malformed entries', () => {
    const r = draftResources(
      {
        fonts: [
          { family: 'Brass Serif', weight: 'bold', style: 'italic', src: 'a.woff2' },
          { family: 'Brass Serif', weight: '400', src: 'b.woff2' },
          { family: '', src: 'c.woff2' },
          'junk',
        ],
      },
      [{ path: 'images/paper.webp', url: '/x/paper.webp' }],
    )
    expect(r.fonts).toEqual([{ family: 'Brass Serif', weights: [400, 700], styles: ['italic', 'normal'] }])
    expect(r.images).toEqual([{ path: 'images/paper.webp', url: '/x/paper.webp' }])
    expect(draftResources(null, [])).toEqual(EMPTY_RESOURCES)
  })

  it('finds the declared weights of the family in force, ignoring case', () => {
    const r = draftResources({ fonts: [{ family: 'Brass Serif', weight: '300 500' }] }, [])
    expect(draftFontWeights(r, 'brass serif')).toEqual([300, 400, 500])
    expect(draftFontWeights(r, 'Georgia')).toBeNull()
    expect(draftFontWeights(r, null)).toBeNull()
  })
})

describe('list helpers', () => {
  it('appends families once, ignoring case', () => {
    expect(appendFamilies(['Georgia', 'serif'], ['georgia', 'Times', ' ', 'Times'])).toEqual(['Georgia', 'serif', 'Times'])
  })

  it('moves an item inside the list', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c'])
    expect(moveItem(['a', 'b', 'c'], 2, 5)).toEqual(['a', 'b', 'c'])
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c'])
  })
})

describe('font weights', () => {
  it('pairs a weight token with the family it weighs', () => {
    expect(weightFamilyToken('--qt-heading-font-weight')).toBe('--qt-heading-font')
    expect(weightFamilyToken('--qt-button-font-weight')).toBe('--theme-font-sans')
  })

  it('reads the first family in force, and none for a var()', () => {
    const doc = setTokenValue(EMPTY, '--theme-font-sans', 'light', '"Brass Serif", serif')
    expect(firstFamilyInForce(analyse(doc).resolved, 'light', '--theme-font-sans')).toBe('Brass Serif')
  })

  it('names the number a weight is', () => {
    expect(weightNumber('normal')).toBe(400)
    expect(weightNumber('bold')).toBe(700)
    expect(weightNumber('650')).toBe(650)
    expect(weightNumber('bolder')).toBeNull()
  })

  it('tells a timing function from anything else', () => {
    expect(isEasing('ease-in-out')).toBe(true)
    expect(isEasing('cubic-bezier(0.2, 0, 0, 1)')).toBe(true)
    expect(isEasing('wobbly')).toBe(false)
    expect(isEasing('')).toBe(false)
  })
})

describe('the primitives panel', () => {
  const doc: ThemeTokensDocument = {
    ...EMPTY,
    primitives: { paper: { type: 'color', value: '#fff', dark: '#111' }, ink: { type: 'color', value: '#000' } },
    tokens: { '--theme-card': 'var(--p-paper)' },
  }
  const snapshot = { tokens: doc, ...analyse(doc), mode: 'light' as const }

  it('lists names in order', () => {
    expect(primitiveNames(doc)).toEqual(['ink', 'paper'])
  })

  it('shows each mode, its literal and who follows it', () => {
    const view = primitiveRowView('paper', snapshot)!
    expect(view).toMatchObject({ variable: '--p-paper', type: 'color', sameAsLight: false })
    expect(view.light).toEqual({ value: '#fff', literal: '#fff' })
    expect(view.dark.value).toBe('#111')
    expect(view.users.tokens).toEqual([{ name: '--theme-card', label: token('--theme-card').label }])
    expect(primitiveRowView('ink', snapshot)!.sameAsLight).toBe(true)
    expect(primitiveRowView('nothing', snapshot)).toBeNull()
  })

  it('starts every primitive type on a value its type check accepts', () => {
    for (const type of PRIMITIVE_TYPES) {
      if (type === 'raw' || type === 'easing' || type === 'number') continue
      expect(valueProblem(type, primitiveStarter(type))).toBeNull()
    }
    expect(isEasing(primitiveStarter('easing'))).toBe(true)
  })
})
