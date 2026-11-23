/**
 * Calliope's Atelier — going to a token's row (Calliope Live, Spec H,
 * Stage 0): where each registry token's row lives, the row's stable id, and
 * `goToToken`, which the inspector calls to open the level and section,
 * scroll to the row and focus it.
 */

import { act, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { DraftEditor, type EditorNavigator } from '@/components/theme-editor/DraftEditor'
import { EDITOR_GROUPS, tokenLocation, tokenRowDomId } from '@/components/theme-editor/model'
import type { DraftDetail } from '@/lib/themes/drafts/service'
import { THEME_TOKENS } from '@/lib/themes/engine/client'
import { renderWithQuery } from '../../../helpers/renderWithQuery'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))

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

function detail(): DraftDetail {
  return {
    id: 'my-theme',
    manifest: { id: 'my-theme', name: 'My Theme', version: '0.1.0' },
    tokens: { primitives: {}, tokens: {}, choices: {} },
    revision: 'rev-1',
    uri: 'qtap://Quilltap General/Themes/my-theme',
    compiled: { fontFaces: '', icons: '', custom: '' },
    subsystems: {},
    issues: [],
    images: [],
    manifestRevision: 'mrev-1',
    files: [],
    totals: { files: 2, bytes: 1000, limits: { files: 200, bytes: 26214400, fileBytes: 5242880 } },
    mountPointId: 'mp-general',
    updatedAt: '2026-11-14T12:00:00.000Z',
    version: '0.1.0',
  }
}

describe('tokenLocation', () => {
  it('places every token the editor shows, and nothing else', () => {
    const shown = new Set(EDITOR_GROUPS.flatMap((g) => [...g.essential, ...g.component, ...g.advanced].map((t) => t.name)))
    for (const token of THEME_TOKENS) {
      const where = tokenLocation(token.name)
      if (!shown.has(token.name)) {
        expect(where).toBeNull()
        continue
      }
      const group = EDITOR_GROUPS.find((g) => g.id === where?.sectionId)!
      const list = where!.advanced ? group.advanced : where!.level === 'essentials' ? group.essential : group.component
      expect(list.some((t) => t.name === token.name)).toBe(true)
    }
    expect(tokenLocation('--not-a-token')).toBeNull()
  })

  it('gives each row a distinct id', () => {
    const ids = new Set(THEME_TOKENS.map((t) => tokenRowDomId(t.name)))
    expect(ids.size).toBe(THEME_TOKENS.length)
    expect(tokenRowDomId('--qt-card-bg')).toBe('qt-token-row-qt-card-bg')
  })
})

describe('goToToken', () => {
  beforeAll(() => {
    Element.prototype.scrollIntoView = jest.fn()
  })

  it('opens the components level, the section and its advanced rows, and focuses the row', async () => {
    const ref: React.MutableRefObject<EditorNavigator | null> = { current: null }
    renderWithQuery(<DraftEditor detail={detail()} mode="light" onModeChange={() => {}} onBack={() => {}} navigatorRef={ref} />)
    await waitFor(() => expect(ref.current).not.toBeNull())
    expect(document.getElementById(tokenRowDomId('--qt-card-bg'))).toBeNull()

    let went = false
    act(() => {
      went = ref.current!.goToToken('--qt-card-bg')
    })
    expect(went).toBe(true)
    await waitFor(() => expect(document.activeElement?.id).toBe(tokenRowDomId('--qt-card-bg')))
    expect(screen.getByRole('button', { name: 'Components' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('declines a name with no row', async () => {
    const ref: React.MutableRefObject<EditorNavigator | null> = { current: null }
    const { unmount } = renderWithQuery(<DraftEditor detail={detail()} mode="light" onModeChange={() => {}} onBack={() => {}} navigatorRef={ref} />)
    await waitFor(() => expect(ref.current).not.toBeNull())
    expect(ref.current!.goToToken('--_qt-icon-mask')).toBe(false)
    unmount()
    expect(ref.current).toBeNull()
  })
})
