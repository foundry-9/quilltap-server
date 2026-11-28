import React from 'react'
import { screen, fireEvent, waitFor, act } from '@testing-library/react'
import { renderWithQuery } from '../../../helpers/renderWithQuery'
import { ThemeSelector } from '@/components/settings/appearance/ThemeSelector'

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/components/providers/workspace-provider', () => ({ useWorkspaceOptional: () => null }))
jest.mock('@/components/providers/theme-provider', () => ({
  useTheme: () => ({ refusedThemes: [] }),
}))
jest.mock('@/components/settings/appearance/components/ThemeCard', () => ({
  ThemeCard: ({ theme, onToggleExpand }: { theme: { name: string } | null; onToggleExpand?: () => void }) => (
    <button onClick={onToggleExpand}>card-{theme ? theme.name : 'Default'}</button>
  ),
}))
jest.mock('@/components/settings/appearance/components/RefusedThemes', () => ({ RefusedThemes: () => null }))
jest.mock('@/components/settings/appearance/components/ThemePreviewModal', () => ({
  ThemePreviewModal: ({ isOpen, theme, onUninstall }: { isOpen: boolean; theme: { id: string } | null; onUninstall?: () => void }) =>
    isOpen ? (
      <div data-testid="modal">
        <span>{theme ? theme.id : 'Default'}</span>
        <button onClick={onUninstall}>Uninstall</button>
      </div>
    ) : null,
}))
jest.mock('@/components/ui/icon', () => ({ Icon: () => null }))
jest.mock('@/components/ui/brand-name', () => ({ BrandName: () => null }))
jest.mock('@/lib/query/fetcher', () => ({
  ApiFetchError: class extends Error {},
  apiErrorMessage: (_e: unknown, f: string) => f,
  apiFetch: jest.fn(async () => ({ message: 'gone' })),
}))

describe('ThemeSelector uninstall from preview (#285)', () => {
  it('closes the preview once the theme is uninstalled', async () => {
    const theme = { id: 'ornate', name: 'Ornate', source: 'bundle', supportsDarkMode: true } as never
    const props = { activeThemeId: null, onThemeSelect: jest.fn() }
    const { rerender, container } = renderWithQuery(
      <ThemeSelector {...props} availableThemes={[theme]} onRefreshThemes={async () => undefined} />
    )
    fireEvent.click(screen.getByText('card-Ornate'))
    expect(screen.getByTestId('modal')).toBeInTheDocument()
    await act(async () => { fireEvent.click(screen.getByText('Uninstall')) })
    await waitFor(() => expect(screen.queryByTestId('modal')).toBeNull())
    expect(container).toBeTruthy()
    void rerender
  })
})
