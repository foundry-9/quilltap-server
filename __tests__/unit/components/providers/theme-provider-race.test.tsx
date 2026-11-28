import React, { useEffect } from 'react'
import { render, act, waitFor } from '@testing-library/react'
import { ThemeProvider } from '@/components/providers/theme/ThemeProvider'
import { useTheme } from '@/components/providers/theme/useTheme'
import * as utils from '@/components/providers/theme/theme-utils'
import { showErrorToast } from '@/lib/toast'

jest.mock('@/components/providers/session-provider', () => ({
  useSession: () => ({ status: 'authenticated' }),
}))
jest.mock('@/components/providers/theme-style-injector', () => ({
  ThemeStyleInjector: ({ compiledCss, themeId }: { compiledCss: string | null; themeId: string | null }) => (
    <div data-testid="inj" data-theme-id={themeId ?? ''} data-css={compiledCss ?? ''} />
  ),
}))
jest.mock('@/lib/toast', () => ({
  showErrorToast: jest.fn(),
  showWarningToast: jest.fn(),
}))
jest.mock('@/components/providers/theme/theme-utils', () => ({
  resolveColorMode: () => 'light',
  applyThemeToDom: jest.fn(),
  setupSystemPreferenceListener: () => () => undefined,
  getSystemDarkModePreference: () => false,
  fetchThemeTokens: jest.fn(),
  fetchAvailableThemes: jest.fn(async () => ({ themes: [], defaultTheme: null, refused: [] })),
  fetchThemePreference: jest.fn(async () => null),
  saveThemePreference: jest.fn(),
}))

const tokens = (css: string) => ({ css, features: {}, choices: {}, subsystems: null })

let api: ReturnType<typeof useTheme>
function Probe() {
  const value = useTheme()
  useEffect(() => {
    api = value
  }, [value])
  return null
}

describe('ThemeProvider races and failed saves', () => {
  beforeEach(() => jest.clearAllMocks())

  it('keeps the latest chosen theme styles when an earlier load lands last', async () => {
    let resolveA: (v: unknown) => void = () => undefined
    let resolveB: (v: unknown) => void = () => undefined
    ;(utils.fetchThemeTokens as jest.Mock).mockImplementation((id: string) =>
      new Promise((res) => { if (id === 'a') resolveA = res; else resolveB = res })
    )
    ;(utils.saveThemePreference as jest.Mock).mockResolvedValue(undefined)
    const { getByTestId } = render(<ThemeProvider><Probe /></ThemeProvider>)
    await waitFor(() => expect(api.isLoading).toBe(false))

    let pa: Promise<void>, pb: Promise<void>
    act(() => { pa = api.setTheme('a'); pb = api.setTheme('b') })
    await act(async () => { resolveB(tokens('B-css')); await pb })
    await act(async () => { resolveA(tokens('A-css')); await pa })

    expect(getByTestId('inj').getAttribute('data-css')).toContain('B-css')
    expect(getByTestId('inj').getAttribute('data-css')).not.toContain('A-css')
  })

  it('shows an error toast when saving the preference fails', async () => {
    ;(utils.saveThemePreference as jest.Mock).mockRejectedValue(new Error('nope'))
    render(<ThemeProvider><Probe /></ThemeProvider>)
    await waitFor(() => expect(api.isLoading).toBe(false))
    await act(async () => { await api.setColorMode('dark') })
    expect(showErrorToast).toHaveBeenCalledTimes(1)
  })
})
