/**
 * Tests for the Plugins card (Settings → Plugins).
 *
 * #283: toggling a plugin re-read the whole `queryKeys.plugins` namespace,
 * which included the npm upgrade check — so every enable / disable went to npm
 * again and blanked the Upgrades list behind a spinner. A toggle changes no
 * version, so it must re-read the registry only.
 */

import React from 'react'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import PluginsTab from '@/components/settings/plugins-tab'

jest.mock('@/lib/toast', () => ({
  showSuccessToast: jest.fn(),
  showErrorToast: jest.fn(),
}))

const PLUGIN = {
  name: 'qtap-plugin-demo',
  title: 'Demo Plugin',
  version: '1.0.0',
  enabled: true,
  capabilities: [],
  path: '/plugins/demo',
  source: 'npm',
  packageName: 'qtap-plugin-demo',
}

function json(payload: unknown): Promise<Response> {
  return Promise.resolve({ ok: true, status: 200, json: async () => payload } as Response)
}

function urlOf(input: RequestInfo | URL): string {
  return typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url
}

function stubPluginRoutes() {
  let enabled = true
  return jest
    .spyOn(global as unknown as { fetch: typeof fetch }, 'fetch')
    .mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = urlOf(input)
      if (url === '/api/v1/system/deployment') return json({ isHosted: false })
      if (url === '/api/v1/plugins?action=check-upgrades') return json({ upgrades: [], lastChecked: '2026-11-27T00:00:00Z' })
      if (url === '/api/v1/plugins') {
        return json({ plugins: [{ ...PLUGIN, enabled }], stats: { total: 1, enabled: enabled ? 1 : 0, disabled: enabled ? 0 : 1, errors: 0, initialized: true } })
      }
      if (url.startsWith('/api/v1/plugins/') && init?.method === 'PUT') {
        enabled = JSON.parse(String(init.body)).enabled
        return json({ ok: true })
      }
      return Promise.reject(new Error(`unexpected fetch: ${url}`))
    })
}

function callsTo(spy: jest.SpyInstance, url: string): number {
  return spy.mock.calls.filter((call) => urlOf(call[0]) === url).length
}

describe('PluginsTab', () => {
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('does not re-run the npm upgrade check when a plugin is toggled (#283)', async () => {
    const spy = stubPluginRoutes()
    renderWithQuery(<PluginsTab />)

    const toggle = await screen.findByRole('switch', { name: `Enable ${PLUGIN.name}` })
    await waitFor(() => expect(callsTo(spy, '/api/v1/plugins?action=check-upgrades')).toBe(1))
    const listReads = callsTo(spy, '/api/v1/plugins')

    fireEvent.click(toggle)

    await waitFor(() => expect(screen.getByRole('switch', { name: `Enable ${PLUGIN.name}` })).toHaveAttribute('aria-checked', 'false'))
    expect(callsTo(spy, '/api/v1/plugins')).toBeGreaterThan(listReads)
    expect(callsTo(spy, '/api/v1/plugins?action=check-upgrades')).toBe(1)
  })
})
