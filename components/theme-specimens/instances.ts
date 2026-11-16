/**
 * Calliope's specimen gallery — the instances each hook is shown in.
 *
 * Pure (Calliope Live, Spec H, Stage 1). A hook is shown once as it stands,
 * once per closed variant value (an open set gets one sample value), once
 * per class state and once per value of an ARIA state (decision 8: hover and
 * focus are not forced; they show on interaction). Each instance carries the
 * props its hooked element wears, so a specimen spreads them and need not
 * know which instance it is drawing.
 *
 * @module components/theme-specimens/instances
 */

import type { HookDef, HookState } from '@/lib/themes/hooks'

export interface SpecimenInstance {
  /** Stable within the hook. */
  key: string
  /** What the instance shows, in words. */
  label: string
  /** The selector this instance answers to, beyond the class alone. */
  selector: string
  kind: 'base' | 'variant' | 'state'
  /** Extra classes on the hooked element (a class state). */
  classes: readonly string[]
  /** Attributes on the hooked element (a variant value or ARIA state). */
  attributes: Readonly<Record<string, string>>
  /** The state shown, when this is a state instance. */
  state?: HookState
}

/** The value an open variant is shown with: obviously invented. */
export const OPEN_VARIANT_SAMPLE = 'specimen-example'

export function specimenInstances(hook: HookDef): SpecimenInstance[] {
  const base = `.${hook.className}`
  const out: SpecimenInstance[] = [
    { key: 'base', label: 'As it stands', selector: base, kind: 'base', classes: [], attributes: {} },
  ]
  for (const variant of hook.variants ?? []) {
    const values = variant.values === 'open' ? [OPEN_VARIANT_SAMPLE] : variant.values
    for (const value of values) {
      out.push({
        key: `variant:${variant.attribute}=${value}`,
        label: variant.values === 'open' ? `${variant.attribute} (any value; “${value}” shown)` : `${variant.attribute}="${value}"`,
        selector: variant.values === 'open' ? `${base}[${variant.attribute}]` : `${base}[${variant.attribute}="${value}"]`,
        kind: 'variant',
        classes: [],
        attributes: { [variant.attribute]: value },
      })
    }
  }
  for (const state of hook.states ?? []) {
    if (state.kind === 'class') {
      out.push({
        key: `state:${state.className}`,
        label: state.label,
        selector: `${base}.${state.className}`,
        kind: 'state',
        classes: [state.className],
        attributes: {},
        state,
      })
      continue
    }
    for (const value of state.values) {
      out.push({
        key: `state:${state.attribute}=${value}`,
        label: `${state.label} (${state.attribute}="${value}")`,
        selector: `${base}[${state.attribute}="${value}"]`,
        kind: 'state',
        classes: [],
        attributes: { [state.attribute]: value },
        state,
      })
    }
  }
  return out
}

/** The props a specimen spreads on its hooked element: the class, the instance's classes and attributes, and any extra classes. */
export type HookElementProps = { className: string } & Record<string, string>

export function hookElementProps(hook: HookDef, instance: SpecimenInstance, extraClasses = ''): HookElementProps {
  const className = [hook.className, ...instance.classes, extraClasses].filter(Boolean).join(' ')
  return { ...instance.attributes, className }
}

/** True when a hook has so many instances that the gallery lays them out as a dense grid. */
export const isDense = (instances: readonly SpecimenInstance[]) => instances.length > 6
