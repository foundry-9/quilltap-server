/**
 * Theme hook catalogue — types.
 *
 * A *structural hook* is a stable name a theme's custom CSS may rely on: a
 * `qt-*` class that identifies one kind of element, optionally a data
 * attribute saying which one of a set it is, and the states an author may
 * select on. The catalogue (`./index.ts`) is the contract; the lint
 * (`./lint.ts`) holds the markup to it.
 *
 * Conventions (Calliope Live, Spec B, decisions 2–4):
 *
 *  - Element identity is a `qt-*` class. One class names one kind of element.
 *  - Which one of a set is a data attribute named for the set (`data-section`,
 *    `data-nav`, `data-role`, …). Values are stable ids — never display text,
 *    never instance ids.
 *  - State is the ARIA attribute when one says it (`aria-current`,
 *    `aria-selected`, `aria-expanded`, …); otherwise a modifier class.
 *
 * Framework-free: importable by server, client and scripts.
 *
 * @module lib/themes/hooks/types
 */

export type QtClass = `qt-${string}`
export type DataAttribute = `data-${string}`
export type AriaAttribute = `aria-${string}`

export type HookSurface =
  | 'app-shell'
  | 'workspace'
  | 'home'
  | 'sidebar'
  | 'salon'
  | 'character'
  | 'dialog'
  | 'settings'
  | 'common'

/** Which one of a set an element is. `'open'` only where the set is genuinely open. */
export interface HookVariant {
  attribute: DataAttribute
  values: readonly string[] | 'open'
  description?: string
}

export type HookState =
  | { kind: 'class'; className: QtClass; label: string }
  | { kind: 'aria'; attribute: AriaAttribute; values: readonly string[]; label: string }

export interface HookDef {
  /** The class that identifies the element, e.g. 'qt-homepage-section'. */
  className: QtClass
  surface: HookSurface
  /** Plain English: "Home page card". */
  label: string
  description?: string
  /** Classes of elements this one is always inside, for documentation. */
  within?: QtClass[]
  /** Data attributes that say which one of a set this is. */
  variants?: HookVariant[]
  /** State an author may select on. */
  states?: HookState[]
  /** Catalogue version in which the hook first appeared. */
  since: number
  /**
   * Where the class is written, when it is not a literal in the source
   * (repo-relative path). The lint then looks for the class's static prefix
   * (up to its last `-`) in that file.
   */
  composedIn?: string
}

export interface RemovedHook {
  className: QtClass
  removedIn: number
  replacedBy?: QtClass
  note?: string
}

/** The catalogue as the lint and the theme-selector check consume it. */
export interface HookCatalogue {
  version: number
  hooks: readonly HookDef[]
  removed: readonly RemovedHook[]
}
