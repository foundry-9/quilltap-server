import { themeRegistry, initializeThemeRegistry, getTheme, getThemeCSS, getThemeTokens, hasTheme, getThemeStats } from '@/lib/themes/theme-registry'
import { DEFAULT_THEME_TOKENS } from '@/lib/themes/default-tokens'
import type { LoadedPlugin } from '@/lib/plugins/manifest-loader'

jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}))

const mockReadFile = jest.fn()
const mockAccess = jest.fn()

jest.mock('node:fs/promises', () => ({
  readFile: (...args: any[]) => mockReadFile(...args),
  access: (...args: any[]) => mockAccess(...args),
}))

const mockGetEnabledPluginsByCapability = jest.fn()

jest.mock('@/lib/plugins', () => ({
  pluginRegistry: {},
  getEnabledPluginsByCapability: (...args: any[]) => mockGetEnabledPluginsByCapability(...args),
}))

const basePlugin: LoadedPlugin = {
  manifest: {
    name: 'qtap-plugin-theme-ocean',
    title: 'Ocean Breeze',
    description: 'desc',
    version: '1.0.0',
    author: 'QA',
    functionality: ['THEME'],
    themeConfig: {
      tokensPath: 'tokens.json',
      stylesPath: 'styles.css',
      previewImage: 'preview.png',
      supportsDarkMode: true,
      tags: ['calm'],
      fonts: [
        { family: 'Coral', src: 'fonts/coral.woff2', weight: '400', style: 'normal' },
      ],
    },
  } as any,
  pluginPath: '/plugins/qtap-plugin-theme-ocean',
  manifestPath: '',
  enabled: true,
  capabilities: ['THEME'],
  source: 'included',
}

describe('theme registry', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    themeRegistry.reset()
  })

  it('registers only the default theme when no plugins are available', async () => {
    mockGetEnabledPluginsByCapability.mockReturnValue([])

    await initializeThemeRegistry()

    const defaultTheme = getTheme('default')
    expect(defaultTheme?.isDefault).toBe(true)
    expect(getThemeStats().total).toBe(1)
  })

  it('loads plugin themes, merges tokens, and exposes CSS/fonts/metadata', async () => {
    const pluginTokens = JSON.parse(JSON.stringify(DEFAULT_THEME_TOKENS))
    pluginTokens.colors.light.primary = '#0055ff'
    pluginTokens.colors.dark.primary = '#88ddff'

    mockReadFile.mockImplementation(async (filePath: string) => {
      if (filePath.endsWith('tokens.json')) return JSON.stringify(pluginTokens)
      if (filePath.endsWith('styles.css')) return '.btn { color: #0055ff; }'
      throw new Error(`Unexpected read: ${filePath}`)
    })
    mockAccess.mockResolvedValue(undefined)
    mockGetEnabledPluginsByCapability.mockReturnValue([basePlugin])

    await initializeThemeRegistry()

    const theme = getTheme('ocean')
    expect(theme).not.toBeNull()
    expect(theme?.tokens.colors.light.primary).toBe('#0055ff')
    expect(theme?.cssOverrides).toContain('.btn')
    expect(theme?.fonts?.[0].family).toBe('Coral')
    expect(theme?.previewImagePath).toContain('preview.png')
    expect(hasTheme('ocean')).toBe(true)

    const css = getThemeCSS('ocean')
    expect(css).toContain('--theme-primary: #0055ff')

    const fallbackTokens = getThemeTokens('unknown-theme')
    expect(fallbackTokens.colors.light.background).toBe(DEFAULT_THEME_TOKENS.colors.light.background)
  })
})
