/**
 * Calliope's specimen gallery — every specimen, by hook class.
 *
 * One table per group of surfaces. There is deliberately no fallback: a hook
 * added to the catalogue without a specimen is drawn as "no specimen" and
 * fails the coverage test (decision 2).
 *
 * @module components/theme-specimens/registry
 */

import { COMMON_SPECIMENS } from './specimens/common'
import { PAGE_SPECIMENS } from './specimens/pages'
import { SALON_SPECIMENS } from './specimens/salon'
import { SHELL_SPECIMENS } from './specimens/shell'
import type { SpecimenDef } from './types'

export const SPECIMENS: Readonly<Record<string, SpecimenDef>> = {
  ...SHELL_SPECIMENS,
  ...SALON_SPECIMENS,
  ...PAGE_SPECIMENS,
  ...COMMON_SPECIMENS,
}
