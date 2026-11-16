/**
 * @jest-environment node
 */
/**
 * The inspector's model (Calliope Live, Spec H, Stage 0): element to hook,
 * rules to properties in cascade order (hover and focus apart, the theme's
 * custom CSS marked), and property to token through the resolved theme.
 */

import {
  describeHook,
  hookForChain,
  inspectProperties,
  parseDeclarations,
  propertyCategory,
  specificity,
  splitSelectorList,
  stripInteraction,
  traceProperty,
  varsIn,
  type ElementFacts,
  type MatchedRule,
} from '@/components/theme-inspect/model'
import { CLIENT_REGISTRY_VIEW, resolveTheme, type ThemeTokensDocument } from '@/lib/themes/engine/client'
import { HOOKS } from '@/lib/themes/hooks'

const facts = (classes: string[], attributes: Record<string, string> = {}): ElementFacts => ({ classes, attributes })
const hook = (className: string) => HOOKS.find((h) => h.className === className)!

describe('element to hook', () => {
  it('finds the hook on the element itself', () => {
    const match = hookForChain([facts(['flex', 'qt-dialog']), facts(['qt-dialog-overlay'])])
    expect(match?.hook.className).toBe('qt-dialog')
    expect(match?.depth).toBe(0)
    expect(match?.selector.selector).toBe('.qt-dialog')
  })

  it('climbs to the nearest hooked ancestor and says how far', () => {
    const match = hookForChain([facts(['px-2']), facts(['flex']), facts(['qt-dialog-body'])])
    expect(match?.hook.className).toBe('qt-dialog-body')
    expect(match?.depth).toBe(2)
  })

  it('returns null when nothing in the chain carries a hook', () => {
    expect(hookForChain([facts(['px-2']), facts([])])).toBeNull()
  })

  it('reads class and ARIA states and picks the most specific selector', () => {
    const match = hookForChain([facts(['qt-dialog', 'qt-dialog-wide'], { 'aria-busy': 'true', role: 'dialog' })])!
    expect(match.states.map((s) => s.label)).toEqual(['Page-width dialog', 'Working; Escape and the close button wait'])
    expect(match.selectors.map((s) => s.selector)).toEqual(['.qt-dialog', '.qt-dialog.qt-dialog-wide', '.qt-dialog[aria-busy="true"]'])
    expect(match.selector.selector).toBe('.qt-dialog[aria-busy="true"]')
  })

  it('reads a closed variant, and flags a value the catalogue does not know', () => {
    const item = hook('qt-left-sidebar-item')
    const known = describeHook(item, facts(['qt-left-sidebar-item'], { 'data-nav': 'help', 'aria-expanded': 'false' }))
    expect(known.variants).toEqual([{ attribute: 'data-nav', value: 'help', known: true }])
    expect(known.selectors.map((s) => s.selector)).toContain('.qt-left-sidebar-item[data-nav="help"]')
    expect(known.selector.selector).toBe('.qt-left-sidebar-item[aria-expanded="false"]')

    const unknown = describeHook(item, facts(['qt-left-sidebar-item'], { 'data-nav': 'not-a-thing' }))
    expect(unknown.variants[0].known).toBe(false)
    expect(unknown.selector.selector).toBe('.qt-left-sidebar-item')
  })

  it('writes an open variant as the attribute alone', () => {
    const open = HOOKS.find((h) => h.variants?.some((v) => v.values === 'open'))!
    const variant = open.variants!.find((v) => v.values === 'open')!
    const match = describeHook(open, facts([open.className], { [variant.attribute]: 'anything' }))
    expect(match.selector.selector).toBe(`.${open.className}[${variant.attribute}]`)
  })

  it('lists other hooks on the same element', () => {
    const match = hookForChain([facts(['qt-dialog-header', 'qt-dialog'])])!
    expect(match.hook.className).toBe('qt-dialog')
    expect(match.alsoOn.map((h) => h.className)).toEqual(['qt-dialog-header'])
  })
})

describe('parsing', () => {
  it('splits a selector list at top-level commas only', () => {
    expect(splitSelectorList('.a, :is(.b, .c) > .d,[data-x="1,2"]')).toEqual(['.a', ':is(.b, .c) > .d', '[data-x="1,2"]'])
  })

  it('parses declarations, keeping shorthands with var() and !important', () => {
    expect(parseDeclarations('background: var(--a, url("x;y")); color: red !important; --qt-x: var(--y);')).toEqual([
      { property: 'background', value: 'var(--a, url("x;y"))', important: false },
      { property: 'color', value: 'red', important: true },
      { property: '--qt-x', value: 'var(--y)', important: false },
    ])
  })

  it('finds every custom property a value reads, fallbacks included', () => {
    expect(varsIn('var(--a, var(--b, 1px)) var(--a)')).toEqual(['--a', '--b'])
  })

  it.each([
    ['.a', [0, 1, 0]],
    ['#x .a > p', [1, 1, 1]],
    ['.a:hover::before', [0, 2, 1]],
    [':where(.a #b) .c', [0, 1, 0]],
    [':is(.a, #b) .c', [1, 1, 0]],
    [':not(.a.b) p', [0, 2, 1]],
    ['[data-theme="x"] .qt-card[aria-current="page"]', [0, 3, 0]],
    [':nth-child(2n of .a, #b)', [1, 1, 0]],
    ['*', [0, 0, 0]],
  ] as const)('specificity of %s', (selector, expected) => {
    expect(specificity(selector)).toEqual(expected)
  })

  it.each([
    ['.a:hover', '.a', ['hover']],
    ['.a:focus-visible', '.a', ['focus']],
    ['.a :hover', '.a *', ['hover']],
    [':hover > .b', '* > .b', ['hover']],
    ['.a:hover:active .b', '.a .b', ['hover', 'active']],
    ['.a:not(:focus)', '.a:not(*)', ['focus']],
  ] as const)('stripping interaction from %s', (selector, out, states) => {
    expect(stripInteraction(selector)).toEqual({ selector: out, states })
  })

  it('leaves a selector without interaction alone', () => {
    expect(stripInteraction('.a:focused-thing')).toBeNull()
    expect(stripInteraction('.a')).toBeNull()
  })

  it.each([
    ['background-color', 'background'],
    ['color', 'text'],
    ['border-top-color', 'border'],
    ['border-radius', 'radius'],
    ['box-shadow', 'shadow'],
    ['padding-inline', 'spacing'],
    ['font-family', 'type'],
    ['--qt-x', 'variable'],
    ['display', 'other'],
  ])('%s is %s', (property, category) => {
    expect(propertyCategory(property)).toBe(category)
  })
})

describe('rules to properties', () => {
  let order = 0
  const rule = (selector: string, cssText: string, extra: Partial<MatchedRule> = {}): MatchedRule => ({
    selector,
    declarations: parseDeclarations(cssText),
    origin: 'app',
    layer: null,
    order: order++,
    state: null,
    source: 'test.css',
    ...extra,
  })

  it('orders by specificity, then document order', () => {
    const { base } = inspectProperties([
      rule('.qt-card.x', 'background: var(--a)'),
      rule('.qt-card', 'background: var(--b)'),
      rule('.qt-card.y', 'background: var(--c)'),
    ])
    const bg = base.find((r) => r.property === 'background')!
    expect(bg.uses.map((u) => u.vars[0])).toEqual(['--c', '--a', '--b'])
    expect(bg.vars).toEqual(['--c'])
  })

  it('puts unlayered over layered, later layers over earlier, and reverses for !important', () => {
    const layers = ['base', 'components', 'utilities']
    const { base } = inspectProperties(
      [
        rule('#high', 'color: var(--utilities)', { layer: 'utilities' }),
        rule('.low', 'color: var(--unlayered)'),
        rule('.x', 'color: var(--components)', { layer: 'components' }),
        rule('.x', 'border-color: var(--imp-components) !important', { layer: 'components' }),
        rule('.x', 'border-color: var(--imp-base) !important', { layer: 'base' }),
        rule('.x', 'border-color: var(--imp-unlayered) !important'),
      ],
      layers,
    )
    expect(base.find((r) => r.property === 'color')!.uses.map((u) => u.vars[0])).toEqual(['--unlayered', '--utilities', '--components'])
    expect(base.find((r) => r.property === 'border-color')!.uses.map((u) => u.vars[0])).toEqual(['--imp-base', '--imp-components', '--imp-unlayered'])
  })

  it('lets the style attribute beat any rule but an important one', () => {
    const { base } = inspectProperties([
      rule('#a.b.c', 'color: var(--rule)'),
      rule('', 'color: var(--inline)', { origin: 'inline' }),
    ])
    expect(base[0].uses[0].vars[0]).toBe('--inline')
  })

  it('follows a custom property the same rules declare on the element', () => {
    const { base } = inspectProperties([
      rule('.qt-button', '--_bg: var(--qt-button-primary-bg, var(--color-primary)); background-color: var(--_bg)'),
    ])
    expect(base.find((r) => r.property === 'background-color')!.vars).toEqual(['--_bg', '--qt-button-primary-bg', '--color-primary'])
  })

  it('keeps hover and focus apart and reports only what they would change', () => {
    const { base, states } = inspectProperties([
      rule('.qt-button', 'background: var(--rest); color: var(--fg)'),
      rule('.qt-button:hover', 'background: var(--hover)', { state: 'hover' }),
      rule('.qt-button:focus-visible', 'outline-color: var(--ring)', { state: 'focus' }),
      rule('.qt-button.qt-button.qt-button:hover', 'color: var(--fg)', { state: 'hover', order: -1 }),
    ])
    expect(base.map((r) => r.property)).toEqual(['background', 'color'])
    expect(states.hover?.map((r) => [r.property, r.vars[0]])).toEqual([
      ['background', '--hover'],
      ['color', '--fg'],
    ])
    expect(states.focus?.map((r) => r.property)).toEqual(['outline-color'])
    expect(states.active).toBeUndefined()
  })

  it("marks a property whose declaration in force is the theme's own custom CSS", () => {
    const { base } = inspectProperties([
      rule('.qt-card', 'background: var(--qt-card-bg); color: var(--qt-card-fg)'),
      rule(':scope .qt-card', 'background: var(--p-paper)', { origin: 'theme-custom' }),
    ])
    expect(base.find((r) => r.property === 'background')!.fromCustomCss).toBe(true)
    expect(base.find((r) => r.property === 'color')!.fromCustomCss).toBe(false)
  })
})

describe('property to token', () => {
  const EMPTY: ThemeTokensDocument = { primitives: {}, tokens: {}, choices: {} }

  it('follows a component token through to the semantic token, reading Tailwind names as theirs', () => {
    const resolved = resolveTheme(EMPTY, CLIENT_REGISTRY_VIEW)
    const trace = traceProperty('--qt-card-bg', resolved, 'light')
    expect(trace.kind).toBe('token')
    expect(trace.token?.label).toBe('Card background')
    expect(trace.setByTheme).toBe(false)
    expect(trace.follows.map((s) => s.name)).toEqual(['--theme-card'])
    expect(trace.literal).toBe('hsl(0 0% 100%)')
    expect(traceProperty('--qt-card-bg', resolved, 'dark').literal).toBe('hsl(225 16% 12%)')
  })

  it('reads a Tailwind name as the semantic token it stands for', () => {
    const resolved = resolveTheme(EMPTY, CLIENT_REGISTRY_VIEW)
    const trace = traceProperty('--color-card', resolved, 'light')
    expect(trace.name).toBe('--theme-card')
    expect(trace.property).toBe('--color-card')
    expect(trace.kind).toBe('token')
  })

  it('says when the theme sets a value, and follows a primitive', () => {
    const doc: ThemeTokensDocument = {
      primitives: { paper: { type: 'color', value: '#f5ecd7' } },
      tokens: { '--theme-card': 'var(--p-paper)' },
      choices: {},
    } as ThemeTokensDocument
    const resolved = resolveTheme(doc, CLIENT_REGISTRY_VIEW)
    const trace = traceProperty('--theme-card', resolved, 'light')
    expect(trace.setByTheme).toBe(true)
    expect(trace.follows.map((s) => s.name)).toEqual(['--p-paper'])
    expect(trace.literal?.toLowerCase()).toBe('#f5ecd7')
    expect(traceProperty('--p-paper', resolved, 'light').kind).toBe('primitive')
  })

  it('shows anything else by name only', () => {
    const resolved = resolveTheme(EMPTY, CLIENT_REGISTRY_VIEW)
    expect(traceProperty('--_qt-icon-mask', resolved, 'light')).toMatchObject({ kind: 'unknown', name: '--_qt-icon-mask', token: null, follows: [] })
  })
})
