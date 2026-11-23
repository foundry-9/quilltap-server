/**
 * Calliope's specimen gallery — what a specimen is.
 *
 * A specimen draws one catalogued hook (decision 2): the real component
 * where it renders from props alone, with no request and no app context;
 * hand-written markup carrying the same hooks otherwise. It is called once
 * per instance (`./instances.ts`) and spreads `el` on the hooked element;
 * compound things are drawn whole around it (a bubble inside its row, a
 * dialog's header with its body and footer).
 *
 * Fixture text is invented and obviously so. A specimen makes no request,
 * writes nothing and carries no DOM id.
 *
 * @module components/theme-specimens/types
 */

import type { ReactNode } from 'react'
import type { HookElementProps, SpecimenInstance } from './instances'

export interface SpecimenProps {
  /** The props for the hooked element. */
  el: HookElementProps
  instance: SpecimenInstance
}

export interface SpecimenDef {
  render: (props: SpecimenProps) => ReactNode
  /** The app component drawn, when the specimen is the real thing; absent for markup. */
  component?: string
  /** A word for the author: what is approximate, or what shows only on interaction. */
  note?: string
}

export type SpecimenTable = Readonly<Record<string, SpecimenDef>>
