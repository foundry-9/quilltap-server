/**
 * Renders `docs/developer/THEME_HOOKS.md` from the catalogue. Pure; the
 * writer is `scripts/generate-theme-hooks-doc.ts`, and
 * `scripts/check-theme-hooks.ts` fails `npm run lint` when the committed file
 * differs from this output.
 *
 * @module lib/themes/hooks/doc
 */

import { HOOK_SURFACES, HOOK_SURFACE_TITLES, ROOT_HOOKS } from './index'
import type { HookCatalogue, HookDef, HookState, HookVariant } from './types'

export const THEME_HOOKS_DOC_PATH = 'docs/developer/THEME_HOOKS.md'

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ')
}

function code(text: string): string {
  return `\`${text}\``
}

function renderVariant(variant: HookVariant): string {
  const values = variant.values === 'open' ? 'any (open set)' : variant.values.map(code).join(', ')
  return `${code(variant.attribute)}: ${values}`
}

function renderState(state: HookState): string {
  if (state.kind === 'class') return `${code(`.${state.className}`)} — ${state.label}`
  const values = state.values.map((value) => `${state.attribute}="${value}"`).map(code).join(' / ')
  return `${values} — ${state.label}`
}

function renderRow(hook: HookDef): string {
  const what = hook.description ? `${hook.label}. ${hook.description}` : hook.label
  const within = (hook.within ?? []).map((cls) => code(`.${cls}`)).join(', ')
  const variants = (hook.variants ?? []).map(renderVariant).join('<br>')
  const states = (hook.states ?? []).map(renderState).join('<br>')
  return `| ${code(`.${hook.className}`)} | ${cell(what)} | ${within} | ${cell(variants)} | ${cell(states)} |`
}

export function renderThemeHooksDoc(catalogue: HookCatalogue): string {
  const lines: string[] = []
  lines.push('# Theme hooks')
  lines.push('')
  lines.push('<!-- GENERATED FILE — DO NOT EDIT BY HAND. Source: lib/themes/hooks/. Regenerate with `npm run generate:theme-hooks-doc`. -->')
  lines.push('')
  lines.push(
    `The structural hooks a theme's custom CSS may rely on — catalogue version **${catalogue.version}**, ${catalogue.hooks.length} hooks. ` +
      'Anything not listed here is an implementation detail and may change without notice. ' +
      'The catalogue lives in `lib/themes/hooks/`; `npm run lint` fails when the markup and the catalogue drift apart.',
  )
  lines.push('')
  lines.push('## Conventions')
  lines.push('')
  lines.push('- **Element identity is a `qt-*` class.** One class names one kind of element.')
  lines.push(
    '- **Which one of a set is a data attribute named for the set** — `data-section`, `data-nav`, `data-role`, `data-staff`, `data-tab-kind`, `data-tool`, `data-group`, `data-card`, `data-pane`. ' +
      'Values are stable ids, never display text and never instance ids: no character, chat or message id is exposed for styling.',
  )
  lines.push(
    '- **State is the ARIA attribute when one says it** (`aria-current`, `aria-selected`, `aria-expanded`, `aria-pressed`, `aria-busy`); otherwise a modifier class (`qt-tab-active`, `qt-chat-message-silent`).',
  )
  lines.push(
    `- **The root element** (\`<html>\`) carries ${ROOT_HOOKS.attributes.map((a) => code(a)).join(' and ')} and ${ROOT_HOOKS.classes.map((c) => code(`.${c}`)).join(' / ')}. Custom CSS is written without the theme id: Quilltap scopes every rule to \`[data-theme="<id>"]\` when it loads the theme, stopping at any nested element that wears another theme.`,
  )
  lines.push(
    '- **Not hooks:** bare elements (`h1`, `button`), non-`qt` classes (Tailwind utilities), class-substring selectors (`[class*="card"]`), and inline-style matches. They work today and break silently.',
  )
  lines.push('')
  lines.push('## Versioning')
  lines.push('')
  lines.push(
    'The catalogue version rises by one in any change that removes a hook, removes a variant value or state, or changes what element a hook names. Adding does not raise it. ' +
      'A removed hook is listed under "Removed hooks" below, with what replaced it.',
  )
  for (const surface of HOOK_SURFACES) {
    const hooks = catalogue.hooks.filter((hook) => hook.surface === surface)
    if (hooks.length === 0) continue
    lines.push('')
    lines.push(`## ${HOOK_SURFACE_TITLES[surface]}`)
    lines.push('')
    lines.push('| Class | What it is | Inside | Variants | States |')
    lines.push('|---|---|---|---|---|')
    for (const hook of hooks) lines.push(renderRow(hook))
  }
  lines.push('')
  lines.push('## Removed hooks')
  lines.push('')
  if (catalogue.removed.length === 0) {
    lines.push('None yet.')
  } else {
    lines.push('| Class | Removed in | Replaced by | Note |')
    lines.push('|---|---|---|---|')
    for (const gone of catalogue.removed) {
      lines.push(
        `| ${code(`.${gone.className}`)} | ${gone.removedIn} | ${gone.replacedBy ? code(`.${gone.replacedBy}`) : ''} | ${cell(gone.note ?? '')} |`,
      )
    }
  }
  lines.push('')
  return lines.join('\n')
}
