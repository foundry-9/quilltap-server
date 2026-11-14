/**
 * Plugin config secrets: password-typed and `secret: true` fields are
 * redacted; an unresolvable manifest withholds everything; the MCP plugin's
 * `servers` blob is declared secret.
 */

import fs from 'fs'
import path from 'path'

jest.mock('@/lib/logger', () => {
  const l: any = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }
  l.child = jest.fn(() => l)
  return { logger: l }
})

jest.mock('@/lib/plugins/registry', () => ({
  getPlugin: jest.fn(),
}))

import { getPlugin } from '@/lib/plugins/registry'
import {
  isSecretConfigField,
  secretKeysOfConfigSchema,
  redactPluginConfigSecrets,
} from '@/lib/plugins/config-secrets'
import { ConfigSchemaSchema } from '@/lib/schemas/plugin-manifest'

describe('config secrets', () => {
  it('treats password fields and secret-flagged fields as secret', () => {
    expect(isSecretConfigField({ key: 'a', type: 'password' })).toBe(true)
    expect(isSecretConfigField({ key: 'b', type: 'textarea', secret: true })).toBe(true)
    expect(isSecretConfigField({ key: 'c', type: 'textarea', secret: false })).toBe(false)
    expect(isSecretConfigField({ key: 'd', type: 'text' })).toBe(false)
    expect(isSecretConfigField(null)).toBe(false)
  })

  it('keeps the secret flag through the manifest schema', () => {
    const parsed = ConfigSchemaSchema.parse({ key: 'servers', label: 'Servers', type: 'textarea', secret: true })
    expect(parsed.secret).toBe(true)
  })

  it('collects secret keys from a schema', () => {
    expect(
      [...secretKeysOfConfigSchema([
        { key: 'a', type: 'password' },
        { key: 'b', type: 'textarea', secret: true },
        { key: 'c', type: 'number' },
      ])].sort()
    ).toEqual(['a', 'b'])
    expect(secretKeysOfConfigSchema(undefined).size).toBe(0)
  })

  it('redacts secret keys and names them', () => {
    ;(getPlugin as jest.Mock).mockReturnValue({
      manifest: { configSchema: [{ key: 'servers', type: 'textarea', secret: true }] },
    })
    expect(redactPluginConfigSecrets('qtap-plugin-mcp', { servers: '[...]', autoReconnect: true })).toEqual({
      config: { autoReconnect: true },
      redactedKeys: ['servers'],
    })
  })

  it('withholds everything when the manifest is unavailable', () => {
    ;(getPlugin as jest.Mock).mockReturnValue(null)
    expect(redactPluginConfigSecrets('gone', { x: 1 })).toEqual({ config: {}, redactedKeys: ['*'] })
  })

  it('the MCP plugin declares its servers field secret, with matching versions', () => {
    const dir = path.join(process.cwd(), 'plugins/dist/qtap-plugin-mcp')
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'))
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf-8'))
    expect(secretKeysOfConfigSchema(manifest.configSchema).has('servers')).toBe(true)
    expect(manifest.version).toBe(pkg.version)
  })
})
