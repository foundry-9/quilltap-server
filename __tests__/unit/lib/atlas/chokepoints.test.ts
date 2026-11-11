/**
 * @jest-environment node
 *
 * The Atlas's grep fences (atlas spec §7): one writer of `Atlas/` files, one
 * builder of Atlas matchers, one door for the chat path and one for image
 * code, and no Atlas in avatars.
 */

import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import path from 'path'

const ROOT = path.resolve(__dirname, '../../../..')

function grep(pattern: string, dirs: string[]): string[] {
  try {
    const out = execSync(
      `git grep --untracked -lE ${JSON.stringify(pattern)} -- ${dirs.map((d) => `'${d}'`).join(' ')}`,
      { cwd: ROOT, encoding: 'utf8' },
    )
    return out.split('\n').filter(Boolean)
  } catch {
    return []
  }
}

const SOURCE = ['lib/*.ts', 'app/*.ts', 'app/*.tsx', 'components/*.tsx', 'components/*.ts', 'hooks/*.ts']

it('nothing outside lib/atlas/vault-writes.ts projects or writes an Atlas file', () => {
  const callers = grep("projectArrayIntoVaultFolder\\([^)]*ATLAS_FOLDER|writeDatabaseDocument\\([^)]*['\"`]Atlas/", SOURCE)
  expect(callers.filter((f) => f !== 'lib/atlas/vault-writes.ts')).toEqual([])
  const writers = grep('(create|update|delete)AtlasInMount|projectMountAtlas', SOURCE)
  expect(writers.filter((f) => !['lib/atlas/vault-writes.ts', 'lib/atlas/location.ts'].includes(f))).toEqual([])
})

it('the Atlas and the Inventory write only through the item-store kernel, bound once each', () => {
  // The projection itself lives in the kernel (lib/mount-index/item-store.ts);
  // a family that called it directly would bypass the bound serialiser.
  const projectors = grep('projectArrayIntoVaultFolder\\(', ['lib/atlas/*.ts', 'lib/inventory/*.ts'])
  expect(projectors).toEqual([])
  const binders = grep('createItemFolderStore[<(]', SOURCE)
  expect(binders.sort()).toEqual(['lib/atlas/vault-writes.ts', 'lib/inventory/vault-writes.ts', 'lib/mount-index/item-store.ts'])
})

it('nothing outside lib/atlas/match.ts builds an Atlas matcher', () => {
  const builders = grep('caseInsensitive:\\s*true', SOURCE)
  expect(builders.filter((f) => f !== 'lib/atlas/match.ts')).toEqual([])
  const users = grep('buildAtlasMatcher\\(', SOURCE)
  for (const file of users) expect(file.startsWith('lib/atlas/')).toBe(true)
})

it('lib/chat reads the Atlas only through buildAtlasSection and findAtlasMentions', () => {
  for (const file of grep("from '@/lib/atlas/", ['lib/chat/*.ts'])) {
    const imports = readFileSync(path.join(ROOT, file), 'utf8').match(/from '@\/lib\/atlas\/[^']+'/g) ?? []
    for (const spec of imports) expect(['prompt-section', 'mentions']).toContain(spec.replace(/^from '@\/lib\/atlas\//, '').replace(/'$/, ''))
  }
})

it('image code reads the Atlas only through lib/atlas/image-reference.ts', () => {
  const imageDirs = ['lib/image-gen/*.ts', 'lib/tools/handlers/image-generation-handler.ts', 'lib/background-jobs/handlers/*.ts', 'lib/memory/cheap-llm-tasks/*.ts', 'app/api/v1/images/*.ts', 'app/api/v1/image-profiles/*.ts']
  for (const file of grep("from '@/lib/atlas/", imageDirs)) {
    const imports = readFileSync(path.join(ROOT, file), 'utf8').match(/from '@\/lib\/atlas\/[^']+'/g) ?? []
    for (const spec of imports) expect(spec).toBe("from '@/lib/atlas/image-reference'")
  }
})

it('no avatar path touches the Atlas', () => {
  const avatarFiles = grep("lib/atlas", ['lib/image-gen/avatar-prompt.ts', 'lib/background-jobs/handlers/*avatar*', 'lib/wardrobe/*.ts', 'lib/inventory/*.ts'])
  expect(avatarFiles).toEqual([])
})
