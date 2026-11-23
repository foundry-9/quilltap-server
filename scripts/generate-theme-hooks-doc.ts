/**
 * generate-theme-hooks-doc.ts
 *
 * Regenerates `docs/developer/THEME_HOOKS.md` from the theme hook catalogue
 * (`lib/themes/hooks/`). Run after any catalogue change:
 *
 *   npm run generate:theme-hooks-doc
 *
 * `npm run lint` (scripts/check-theme-hooks.ts) fails when the committed file
 * is stale.
 */

import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { HOOK_CATALOGUE } from '../lib/themes/hooks'
import { renderThemeHooksDoc, THEME_HOOKS_DOC_PATH } from '../lib/themes/hooks/doc'

const outPath = join(process.cwd(), THEME_HOOKS_DOC_PATH)
writeFileSync(outPath, renderThemeHooksDoc(HOOK_CATALOGUE))
console.log(`Wrote ${THEME_HOOKS_DOC_PATH} (${HOOK_CATALOGUE.hooks.length} hooks, catalogue version ${HOOK_CATALOGUE.version})`)
