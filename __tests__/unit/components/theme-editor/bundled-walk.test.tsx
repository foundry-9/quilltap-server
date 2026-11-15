/**
 * Calliope's Atelier — opening every section of every bundled theme, at every
 * level and behind every advanced disclosure, writes nothing (Calliope Live,
 * Spec E, Stage 2): the typed controls commit only on a change, and a value
 * beyond them is shown as text and left alone.
 */

// Uses global jest (not @jest/globals) so the jest-dom matcher augmentation
// resolves on the global `expect` under tsc.
import fs from 'node:fs'
import path from 'node:path'
import { act, fireEvent, screen } from '@testing-library/react'
import React from 'react'
import { ThemeEditorView } from '@/app/calliope/ThemeEditorView'
import type { DraftDetail } from '@/lib/themes/drafts/service'
import type { ThemeTokensDocument } from '@/lib/themes/engine/client'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

jest.mock('@/components/providers/theme-provider', () => ({
  useTheme: () => ({
    availableThemes: [{ id: 'default', name: 'Professional Neutral', source: 'default' }],
    resolvedColorMode: 'light',
    setPreview: jest.fn(),
    refreshThemes: jest.fn(async () => {}),
    setTheme: jest.fn(async () => {}),
  }),
}))

jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showSuccessToast: jest.fn(),
  showWarningToast: jest.fn(),
  showInfoToast: jest.fn(),
}))

const BUNDLED = path.join(process.cwd(), 'themes/bundled')
const THEMES = fs.readdirSync(BUNDLED).filter((d) => fs.existsSync(path.join(BUNDLED, d, 'tokens.json')))
const realFetch = global.fetch

afterAll(() => {
  global.fetch = realFetch
})

describe.each(THEMES)('the bundled theme %s', (id) => {
  it('opens every section at every level and writes nothing', async () => {
    const tokens = JSON.parse(fs.readFileSync(path.join(BUNDLED, id, 'tokens.json'), 'utf8')) as ThemeTokensDocument
    const manifest = JSON.parse(fs.readFileSync(path.join(BUNDLED, id, 'theme.json'), 'utf8')) as Record<string, unknown>
    const draft: DraftDetail = {
      id: `${id}-copy`,
      manifest,
      tokens,
      revision: 'rev-1',
      uri: `qtap://Quilltap General/Themes/${id}-copy`,
      compiled: { fontFaces: '', icons: '', custom: '' },
      subsystems: {},
      issues: [],
      images: [],
      manifestRevision: 'mrev-1',
      files: [],
      totals: { files: 2, bytes: 1000, limits: { files: 200, bytes: 26214400, fileBytes: 5242880 } },
      mountPointId: 'mp-general',
      updatedAt: '2026-11-14T12:00:00.000Z',
      version: '1.0.0',
    }
    const writes: string[] = []
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method !== 'GET') writes.push(`${method} ${String(input)}`)
      return { ok: true, status: 200, statusText: '200', json: async () => ({ draft }) }
    }) as unknown as typeof fetch

    jest.useFakeTimers()
    renderWithQuery(<ThemeEditorView payload={{ draftId: draft.id }} />)
    await act(async () => {
      await jest.advanceTimersByTimeAsync(10)
    })
    await screen.findByRole('button', { name: 'Open all' })
    for (const level of ['Essentials', 'Components']) {
      fireEvent.click(screen.getByRole('button', { name: level }))
      fireEvent.click(screen.getByRole('button', { name: 'Open all' }))
      for (const d of document.querySelectorAll('details')) {
        if (!d.open) fireEvent.click(d.querySelector('summary')!)
      }
      await act(async () => {
        await jest.advanceTimersByTimeAsync(2000)
      })
    }
    expect(document.querySelectorAll('[role=group]').length).toBeGreaterThan(300)
    expect(writes).toEqual([])
    jest.useRealTimers()
  }, 60_000)
})
