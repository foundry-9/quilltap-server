/**
 * Calliope's specimen gallery — the coverage test (Calliope Live, Spec H,
 * decision 2).
 *
 * The gallery is rendered whole and every catalogued hook must be drawn in
 * its own specimen: its class, every closed variant value (an open set by a
 * sample), every class state and every value of every ARIA state. A hook
 * added to the catalogue without a specimen fails here, and so does a
 * specimen left behind for a hook the catalogue no longer has.
 */

import { render } from '@testing-library/react'
import React from 'react'
import { SpecimenGallery } from '@/components/theme-specimens/SpecimenGallery'
import { specimenInstances } from '@/components/theme-specimens/instances'
import { SPECIMENS } from '@/components/theme-specimens/registry'
import { HOOKS } from '@/lib/themes/hooks'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

/**
 * Hooks that cannot sensibly be shown, each with its reason. Expected to stay
 * (nearly) empty: adding one here needs a reason a reviewer will accept.
 */
const NOT_SHOWN: Readonly<Record<string, string>> = {}

describe('the specimen gallery covers the hook catalogue', () => {
  let container: HTMLElement
  beforeAll(() => {
    // Rendered once; testing-library unmounts after each test, so keep a copy of the DOM.
    const rendered = render(
      <SpecimenGallery query="" modes={['light']} stage={{ themeId: 'default', choiceAttributes: {} }} idPrefix="t" />,
    )
    container = rendered.container.cloneNode(true) as HTMLElement
  })

  it('has a specimen for every hook, and none for a hook that is gone', () => {
    const catalogued = new Set(HOOKS.map((h) => h.className))
    const missing = HOOKS.filter((h) => !SPECIMENS[h.className] && !NOT_SHOWN[h.className]).map((h) => h.className)
    const stale = Object.keys(SPECIMENS).filter((c) => !catalogued.has(c))
    expect({ missing, stale }).toEqual({ missing: [], stale: [] })
  })

  it.each(HOOKS.filter((h) => !NOT_SHOWN[h.className]).map((h) => [h.className, h] as const))(
    '%s is drawn in every variant and state',
    (className, hook) => {
      const article = container.querySelector(`[data-specimen-for="${className}"]`)
      expect(article).not.toBeNull()
      // Each instance in its own item and on its own stage: the theme probe
      // (scripts/theme-probe) addresses it as
      // [data-specimen-for] [data-specimen-instance] [data-specimen-stage].
      const absent = specimenInstances(hook)
        .filter((i) => !article!.querySelector(`[data-specimen-instance="${i.key.replace(/"/g, '\\"')}"] [data-specimen-stage] ${i.selector}`))
        .map((i) => i.key)
      expect(absent).toEqual([])
    },
  )

  it('draws every instance on a stage wearing the shown theme', () => {
    const stages = container.querySelectorAll('[data-specimen-stage]')
    const expected = HOOKS.reduce((n, h) => n + specimenInstances(h).length, 0)
    expect(stages.length).toBe(expected)
    for (const stage of Array.from(stages)) {
      expect(stage.getAttribute('data-theme')).toBe('default')
      expect(stage.classList.contains('light')).toBe(true)
    }
  })

  it('carries no DOM id inside a stage', () => {
    expect(container.querySelectorAll('[data-specimen-stage] [id]')).toHaveLength(0)
  })
})
