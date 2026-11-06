/**
 * @jest-environment node
 *
 * #145: the build-plugins guard that catches a plugin typechecking against the
 * repository root's copy of a dependency it declares itself.
 */
import { join } from 'path'
import {
  findForeignResolutions,
  formatResolutionViolations,
  packageNameFromPath,
} from '../../../scripts/lib/plugin-resolution-guard'

const PLUGIN_DIR = '/repo/plugins/dist/qtap-plugin-openrouter'

const EXPLAIN = [
  '../../../node_modules/typescript/lib/lib.es2023.d.ts',
  '  Library \'lib.es2023.d.ts\' specified in compilerOptions',
  'node_modules/@openrouter/sdk/esm/sdk/sdk.d.ts',
  "  Imported via '@openrouter/sdk' from file 'provider.ts'",
  '../../../node_modules/@openrouter/sdk/esm/lib/chat-compat.d.ts',
  "  Imported via '@openrouter/sdk/lib/chat-compat' from file 'provider.ts'",
  '../../../node_modules/zod/v4/core/core.d.cts',
  "  Imported via 'zod' from file '../../../node_modules/openai/index.d.ts'",
  'provider.ts',
  '  Matched by include pattern \'*.ts\' in \'tsconfig.json\'',
].join('\n')

describe('plugin resolution guard', () => {
  it('names the package from the last node_modules segment', () => {
    expect(packageNameFromPath('node_modules/@openrouter/sdk/esm/index.d.ts')).toBe('@openrouter/sdk')
    expect(packageNameFromPath('../../../node_modules/zod/v4/core.d.cts')).toBe('zod')
    expect(packageNameFromPath('node_modules/a/node_modules/b/index.d.ts')).toBe('b')
    expect(packageNameFromPath('provider.ts')).toBeNull()
  })

  it('flags a declared dependency resolved from the repository root', () => {
    const violations = findForeignResolutions(EXPLAIN, PLUGIN_DIR, ['@openrouter/sdk'])
    expect(violations).toEqual([
      {
        packageName: '@openrouter/sdk',
        resolvedPath: '../../../node_modules/@openrouter/sdk/esm/lib/chat-compat.d.ts',
        expectedRoot: join(PLUGIN_DIR, 'node_modules', '@openrouter/sdk'),
      },
    ])
  })

  it('ignores a root-resolved package the plugin does not declare', () => {
    expect(findForeignResolutions(EXPLAIN, PLUGIN_DIR, ['zod-not-listed'])).toEqual([])
    const zodOnly = EXPLAIN.split('\n').filter((l) => !l.includes('@openrouter')).join('\n')
    expect(findForeignResolutions(zodOnly, PLUGIN_DIR, ['@openrouter/sdk'])).toEqual([])
  })

  it('accepts files from the plugin\'s own node_modules', () => {
    const own = 'node_modules/@openrouter/sdk/esm/sdk/sdk.d.ts\n'
    expect(findForeignResolutions(own, PLUGIN_DIR, ['@openrouter/sdk'])).toEqual([])
  })

  it('formats a message naming the plugin, package and both paths', () => {
    const msg = formatResolutionViolations(
      'qtap-plugin-openrouter',
      findForeignResolutions(EXPLAIN, PLUGIN_DIR, ['@openrouter/sdk']),
    )
    expect(msg).toContain('qtap-plugin-openrouter')
    expect(msg).toContain('@openrouter/sdk')
    expect(msg).toContain('../../../node_modules/@openrouter/sdk/esm/lib/chat-compat.d.ts')
    expect(msg).toContain(join(PLUGIN_DIR, 'node_modules', '@openrouter/sdk'))
  })
})
