/**
 * Calliope's inspector — what it reads from the page (Calliope Live, Spec H,
 * Stage 0).
 *
 * The only part of the inspector that touches the DOM. It reads class
 * lists, attributes and stylesheets — never an element's text — and hands
 * plain data to `./model.ts`.
 *
 * `matchingRules` walks every stylesheet in the document, so it is run when
 * an element is selected, never on pointer move. It tolerates a stylesheet
 * it may not read (a cross-origin sheet throws on `cssRules`) and descends
 * into `@media` and `@supports` (only when their condition holds now),
 * `@layer` (recording the order layers are declared in), `@container`
 * (always: whether a container query holds depends on a container the walk
 * does not measure), `@scope` (honouring its root and limit) and nested
 * style rules.
 *
 * @module components/theme-inspect/dom
 */

import {
  parseDeclarations,
  splitSelectorList,
  stripInteraction,
  type ElementFacts,
  type InteractionState,
  type MatchedRule,
  type RuleOrigin,
} from './model'

/** The id of the style element the theme provider injects the shown theme's CSS into. */
export const THEME_STYLE_ELEMENT_ID = 'quilltap-theme-variables'

/** An element's classes and attributes (not its text). */
export function elementFacts(el: Element): ElementFacts {
  const attributes: Record<string, string> = {}
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === 'class' || attr.name === 'style') continue
    attributes[attr.name] = attr.value
  }
  return { classes: Array.from(el.classList), attributes }
}

/** The element and its ancestors, outward, as facts; stops after `<html>`. */
export function elementChain(el: Element): ElementFacts[] {
  const out: ElementFacts[] = []
  for (let node: Element | null = el; node; node = node.parentElement) out.push(elementFacts(node))
  return out
}

/** `el.matches(selector)`, false for a selector this browser cannot parse. */
function safeMatches(el: Element, selector: string): boolean {
  try {
    return el.matches(selector)
  } catch {
    return false
  }
}

interface ScopeFrame {
  start: string | null
  end: string | null
}

/** Whether `el` lies inside every enclosing `@scope`: below a root and not at or below a limit inside it. */
function inScopes(el: Element, scopes: readonly ScopeFrame[]): boolean {
  for (const scope of scopes) {
    if (!scope.start) continue
    let root: Element | null = null
    try {
      root = el.closest(scope.start)
    } catch {
      return false
    }
    if (!root) return false
    if (scope.end) {
      for (let node: Element | null = el; node && node !== root; node = node.parentElement) {
        if (safeMatches(node, scope.end)) return false
      }
    }
  }
  return true
}

/** A scoped selector made testable outside `@scope`: `:scope` stands for the nearest scope's root selector. */
function unscoped(selector: string, scopes: readonly ScopeFrame[]): string {
  const root = scopes.length > 0 ? scopes[scopes.length - 1].start : null
  return root ? selector.replace(/:scope(?![\w-])/g, `:is(${root})`) : selector
}

/** A nested rule's selector written out in full against its parent's. */
function resolveNested(selector: string, parent: string | null): string {
  if (!parent) return selector
  return selector.includes('&') ? selector.replace(/&/g, `:is(${parent})`) : `:is(${parent}) ${selector}`
}

function sheetSource(sheet: CSSStyleSheet): string {
  const node = sheet.ownerNode as Element | null
  if (sheet.href) return sheet.href
  if (node?.id) return `#${node.id}`
  return node?.getAttribute?.('data-n-href') ?? node?.nodeName.toLowerCase() ?? 'stylesheet'
}

/** An icon override is the only kind of rule a theme's compiled icon block holds. */
const isIconOverride = (selectors: readonly string[]) => selectors.every((s) => /^:scope \[data-icon="[^"]*"\]$/.test(s))

export interface RuleWalk {
  rules: MatchedRule[]
  /** Every cascade layer's full name, in the order the page declares them. */
  layerOrder: string[]
  /** Stylesheets that could not be read (cross-origin). */
  unreadable: number
  /** Milliseconds the walk took. */
  elapsedMs: number
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

/**
 * Every style rule that matches `el` now, or would on hover, focus or
 * press (decision 8), in document order. Run on selection only.
 */
export function matchingRules(el: Element, doc: Document = el.ownerDocument): RuleWalk {
  const started = now()
  const view = doc.defaultView
  const rules: MatchedRule[] = []
  const layerOrder: string[] = []
  let unreadable = 0
  let order = 0

  const noteLayer = (name: string) => {
    if (!layerOrder.includes(name)) layerOrder.push(name)
  }
  const joinLayer = (outer: string | null, inner: string) => (outer ? `${outer}.${inner}` : inner)
  let anonymous = 0

  const conditionHolds = (rule: CSSRule): boolean => {
    if (typeof CSSMediaRule !== 'undefined' && rule instanceof CSSMediaRule) {
      const text = rule.media.mediaText
      return !text || !view?.matchMedia || view.matchMedia(text).matches
    }
    if (typeof CSSSupportsRule !== 'undefined' && rule instanceof CSSSupportsRule) {
      try {
        return typeof CSS === 'undefined' || !CSS.supports || CSS.supports(rule.conditionText)
      } catch {
        return true
      }
    }
    return true
  }

  const testSelector = (selector: string, scopes: readonly ScopeFrame[]): { state: InteractionState | null } | null => {
    if (safeMatches(el, unscoped(selector, scopes))) return { state: null }
    const stripped = stripInteraction(selector)
    if (stripped && safeMatches(el, unscoped(stripped.selector, scopes))) return { state: stripped.states[0] }
    return null
  }

  const walk = (list: CSSRuleList, ctx: { origin: 'app' | 'theme'; source: string; layer: string | null; scopes: ScopeFrame[]; parent: string | null }) => {
    for (const rule of Array.from(list)) {
      if (typeof CSSStyleRule !== 'undefined' && rule instanceof CSSStyleRule) {
        const selectors = splitSelectorList(rule.selectorText).map((s) => resolveNested(s, ctx.parent))
        const declarations = parseDeclarations(rule.style.cssText)
        if (declarations.length > 0 && inScopes(el, ctx.scopes)) {
          const origin: RuleOrigin =
            ctx.origin === 'app'
              ? 'app'
              : ctx.scopes.length === 0
                ? 'theme-tokens'
                : isIconOverride(splitSelectorList(rule.selectorText))
                  ? 'theme-icons'
                  : 'theme-custom'
          for (const selector of selectors) {
            const hit = testSelector(selector, ctx.scopes)
            if (!hit) continue
            rules.push({ selector, declarations, origin, layer: ctx.layer, order: order++, state: hit.state, source: ctx.source })
          }
        }
        const nested = (rule as CSSStyleRule & { cssRules?: CSSRuleList }).cssRules
        if (nested && nested.length > 0) {
          walk(nested, { ...ctx, parent: selectors.length === 1 ? selectors[0] : selectors.join(', ') })
        }
        continue
      }
      if (typeof CSSImportRule !== 'undefined' && rule instanceof CSSImportRule) {
        try {
          if (rule.styleSheet) walk(rule.styleSheet.cssRules, ctx)
        } catch {
          unreadable++
        }
        continue
      }
      if (typeof CSSLayerStatementRule !== 'undefined' && rule instanceof CSSLayerStatementRule) {
        for (const name of rule.nameList) noteLayer(joinLayer(ctx.layer, name))
        continue
      }
      if (typeof CSSLayerBlockRule !== 'undefined' && rule instanceof CSSLayerBlockRule) {
        const layer = joinLayer(ctx.layer, rule.name || `<anonymous ${++anonymous}>`)
        noteLayer(layer)
        walk(rule.cssRules, { ...ctx, layer })
        continue
      }
      const scopeRule = rule as CSSRule & { start?: string | null; end?: string | null; cssRules?: CSSRuleList }
      if (typeof CSSScopeRule !== 'undefined' && rule instanceof CSSScopeRule) {
        walk(rule.cssRules, { ...ctx, scopes: [...ctx.scopes, { start: scopeRule.start ?? null, end: scopeRule.end ?? null }] })
        continue
      }
      if ('cssRules' in rule && scopeRule.cssRules && conditionHolds(rule)) {
        // @media, @supports, @container and any other grouping rule.
        walk(scopeRule.cssRules, ctx)
      }
    }
  }

  const themeSheet = (doc.getElementById(THEME_STYLE_ELEMENT_ID) as HTMLStyleElement | null)?.sheet ?? null
  for (const sheet of Array.from(doc.styleSheets)) {
    let list: CSSRuleList
    try {
      list = sheet.cssRules
    } catch {
      unreadable++
      continue
    }
    if (sheet.disabled) continue
    const origin = themeSheet !== null && sheet === themeSheet ? 'theme' : 'app'
    walk(list, { origin, source: sheetSource(sheet as CSSStyleSheet), layer: null, scopes: [], parent: null })
  }

  const inline = el.getAttribute('style')
  if (inline) {
    const declarations = parseDeclarations(inline)
    if (declarations.length > 0) {
      rules.push({ selector: '', declarations, origin: 'inline', layer: null, order: order++, state: null, source: 'style attribute' })
    }
  }

  return { rules, layerOrder, unreadable, elapsedMs: now() - started }
}

/**
 * True when `el` lies in a part of the page the inspector leaves alone (its
 * own panel, the editor's panel, the gallery's chrome). A
 * `data-inspect-target` inside such a part (a specimen's stage) is open to it
 * again: whichever marker is nearer wins.
 */
export const isInspectIgnored = (el: Element | null): boolean =>
  el?.closest('[data-inspect-ignore], [data-inspect-target]')?.hasAttribute('data-inspect-ignore') ?? false

/**
 * The nearest element at or above `el` that carries a catalogued hook, for
 * the pointer's outline — cheap enough for pointer move (classes only, no
 * stylesheet). Null when none does.
 */
export function nearestHookedElement(el: Element | null, isHookClass: (c: string) => boolean): Element | null {
  for (let node = el; node && node !== node.ownerDocument.documentElement; node = node.parentElement) {
    for (const c of Array.from(node.classList)) if (isHookClass(c)) return node
  }
  return null
}
