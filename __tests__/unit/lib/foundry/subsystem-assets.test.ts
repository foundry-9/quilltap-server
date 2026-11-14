/**
 * Every subsystem's thumbnail and backdrop must ship — a missing one is a
 * broken image on every badge and persona chip that names it.
 */

import fs from 'fs'
import path from 'path'
import { DEFAULT_SUBSYSTEM_DEFINITIONS } from '@/lib/foundry/subsystem-defaults'

describe('subsystem art', () => {
  it.each(Object.values(DEFAULT_SUBSYSTEM_DEFINITIONS).map((d) => [d.id, d] as const))(
    '%s has its thumbnail and backdrop under public/',
    (_id, def) => {
      for (const asset of [def.thumbnail, def.backgroundImage]) {
        expect(fs.existsSync(path.join(process.cwd(), 'public', asset))).toBe(true)
      }
    },
  )
})
