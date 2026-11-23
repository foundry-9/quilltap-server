/**
 * Calliope's inspector — the report for one selected element (Calliope
 * Live, Spec H, Stage 2).
 *
 * Built once, when an element is selected (never on pointer move): the
 * nearest hook (decision 4), the stylesheet rules that match the hooked
 * element now and on hover, focus or press (decisions 3 and 8), the tokens
 * they read traced through the resolved theme, and the value each has where
 * the element actually is.
 *
 * @module components/theme-inspect/report
 */

import { CLIENT_REGISTRY_VIEW, resolveTheme, type ResolvedTheme } from '@/lib/themes/engine/client'
import { HOOK_SURFACE_TITLES } from '@/lib/themes/hooks'
import type { EditorMode } from '@/components/theme-editor/model'
import { elementChain, matchingRules } from './dom'
import {
  customCssRules,
  groupTokenUses,
  hookForChain,
  inspectProperties,
  traceProperty,
  type CategoryGroup,
  type HookMatch,
  type InteractionState,
  type MatchedRule,
  type TokenTrace,
} from './model'

export interface InspectReport {
  match: HookMatch | null
  surfaceTitle: string | null
  /** The element the tokens are read from: the hooked element, or the one pointed at when nothing above it is hooked. */
  target: Element
  mode: EditorMode
  /** True when the trace reads the draft being edited; false when it reads the registry defaults (no draft open). */
  readsDraft: boolean
  base: CategoryGroup[]
  states: Array<{ state: InteractionState; label: string; groups: CategoryGroup[] }>
  customRules: MatchedRule[]
  /** The value each traced custom property has on the target, as the browser computed it. */
  computed: Readonly<Record<string, string>>
  elapsedMs: number
}

const EMPTY_RESOLVED: ResolvedTheme = resolveTheme({ primitives: {}, tokens: {}, choices: {} }, CLIENT_REGISTRY_VIEW)

const STATE_LABELS: Record<InteractionState, string> = { hover: 'On hover', focus: 'On focus', active: 'While pressed' }

/** The mode an element is drawn in: the nearest `.light` / `.dark` above it. */
export function modeOf(el: Element): EditorMode {
  const owner = el.closest('.dark, .light')
  return owner?.classList.contains('dark') ? 'dark' : 'light'
}

export function buildInspectReport(pointed: Element, resolved: ResolvedTheme | null): InspectReport {
  const match = hookForChain(elementChain(pointed))
  let target: Element = pointed
  if (match) for (let i = 0; i < match.depth && target.parentElement; i++) target = target.parentElement
  const mode = modeOf(target)
  const walk = matchingRules(target)
  const properties = inspectProperties(walk.rules, walk.layerOrder)
  const readsDraft = resolved !== null
  const traces = new Map<string, TokenTrace>()
  const trace = (name: string) => {
    let t = traces.get(name)
    if (!t) {
      t = traceProperty(name, resolved ?? EMPTY_RESOLVED, mode)
      traces.set(name, t)
    }
    return t
  }
  const base = groupTokenUses(properties.base, trace)
  const states = (['hover', 'focus', 'active'] as const)
    .map((state) => ({ state, label: STATE_LABELS[state], groups: groupTokenUses(properties.states[state] ?? [], trace) }))
    .filter((s) => s.groups.length > 0)
  const style = target.ownerDocument.defaultView?.getComputedStyle(target)
  const computed: Record<string, string> = {}
  for (const name of traces.keys()) computed[name] = style?.getPropertyValue(name).trim() ?? ''
  return {
    match,
    surfaceTitle: match ? HOOK_SURFACE_TITLES[match.hook.surface] : null,
    target,
    mode,
    readsDraft,
    base,
    states,
    customRules: customCssRules(walk.rules),
    computed,
    elapsedMs: walk.elapsedMs,
  }
}
