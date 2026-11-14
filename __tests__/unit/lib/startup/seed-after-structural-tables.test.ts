/**
 * First-startup seeding writes the sample characters' vaults, which need the
 * mount-index tables. Those are created by the structural-table check (and file
 * storage must be initialised); seeding before them left Lorian and Riya as
 * bare rows on every new install. Hold the boot order.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

describe('instrumentation boot order', () => {
  const source = readFileSync(join(__dirname, '../../../../instrumentation.ts'), 'utf8')

  it('seeds initial data after file storage and the structural-table check', () => {
    const fileStorage = source.indexOf('fileStorageManager.initialize()')
    const verify = source.indexOf('await verifyStructuralTables()')
    const seed = source.indexOf('await seedInitialData()')
    expect(fileStorage).toBeGreaterThan(-1)
    expect(verify).toBeGreaterThan(-1)
    expect(seed).toBeGreaterThan(-1)
    expect(seed).toBeGreaterThan(fileStorage)
    expect(seed).toBeGreaterThan(verify)
  })
})
