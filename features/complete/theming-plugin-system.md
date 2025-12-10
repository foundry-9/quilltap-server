# Theming Plugin System Implementation Plan

This document outlines the implementation plan for a themeable plugin system in Quilltap, allowing users to customize colors, typography, spacing, and radically alter the application's appearance through plugins.

## Overview

The theming system uses a **three-tier architecture**:

1. **Tier 1 - Design Tokens**: CSS custom properties for colors, fonts, spacing (easy customization)
2. **Tier 2 - Component Tokens**: Semantic tokens for component-level styling (moderate customization)
3. **Tier 3 - Component Overrides**: Full CSS overrides for radical changes (advanced customization)

Current styling in `globals.css` becomes the **"Default" theme** - no changes needed to existing code.

---

## Phase 1: Foundation - Theme Token Schema

### 1.1 Create Theme Token Type Definitions

**File**: `lib/themes/types.ts`

```typescript
/**
 * Theme Token System
 *
 * Defines the structure for theme customization at multiple levels.
 */

import { z } from 'zod';

// ============================================================================
// COLOR TOKENS
// ============================================================================

/** HSL color value (e.g., "222.2 84% 4.9%") */
const HSLColorSchema = z.string().regex(/^\d+(\.\d+)?\s+\d+(\.\d+)?%\s+\d+(\.\d+)?%$/);

/** Hex color value (e.g., "#1a1a2e") */
const HexColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/** Any valid CSS color */
const CSSColorSchema = z.union([HSLColorSchema, HexColorSchema, z.string()]);

export const ColorPaletteSchema = z.object({
  // Semantic colors
  background: CSSColorSchema,
  foreground: CSSColorSchema,

  // Primary action colors
  primary: CSSColorSchema,
  primaryForeground: CSSColorSchema,

  // Secondary/muted colors
  secondary: CSSColorSchema,
  secondaryForeground: CSSColorSchema,

  // Muted text and backgrounds
  muted: CSSColorSchema,
  mutedForeground: CSSColorSchema,

  // Accent colors
  accent: CSSColorSchema,
  accentForeground: CSSColorSchema,

  // Destructive/error colors
  destructive: CSSColorSchema,
  destructiveForeground: CSSColorSchema,

  // Card and popover surfaces
  card: CSSColorSchema,
  cardForeground: CSSColorSchema,
  popover: CSSColorSchema,
  popoverForeground: CSSColorSchema,

  // Borders and inputs
  border: CSSColorSchema,
  input: CSSColorSchema,
  ring: CSSColorSchema,

  // Optional: Extended palette for advanced themes
  success: CSSColorSchema.optional(),
  successForeground: CSSColorSchema.optional(),
  warning: CSSColorSchema.optional(),
  warningForeground: CSSColorSchema.optional(),
  info: CSSColorSchema.optional(),
  infoForeground: CSSColorSchema.optional(),
});

export type ColorPalette = z.infer<typeof ColorPaletteSchema>;

// ============================================================================
// TYPOGRAPHY TOKENS
// ============================================================================

export const TypographySchema = z.object({
  // Font families
  fontSans: z.string().default('Inter, system-ui, sans-serif'),
  fontSerif: z.string().default('Georgia, serif'),
  fontMono: z.string().default('ui-monospace, monospace'),

  // Font size scale (rem values)
  fontSizeXs: z.string().default('0.75rem'),
  fontSizeSm: z.string().default('0.875rem'),
  fontSizeBase: z.string().default('1rem'),
  fontSizeLg: z.string().default('1.125rem'),
  fontSizeXl: z.string().default('1.25rem'),
  fontSize2xl: z.string().default('1.5rem'),
  fontSize3xl: z.string().default('1.875rem'),
  fontSize4xl: z.string().default('2.25rem'),

  // Line heights
  lineHeightTight: z.string().default('1.25'),
  lineHeightNormal: z.string().default('1.5'),
  lineHeightRelaxed: z.string().default('1.75'),

  // Font weights
  fontWeightNormal: z.string().default('400'),
  fontWeightMedium: z.string().default('500'),
  fontWeightSemibold: z.string().default('600'),
  fontWeightBold: z.string().default('700'),

  // Letter spacing
  letterSpacingTight: z.string().default('-0.025em'),
  letterSpacingNormal: z.string().default('0'),
  letterSpacingWide: z.string().default('0.025em'),
});

export type Typography = z.infer<typeof TypographySchema>;

// ============================================================================
// SPACING & LAYOUT TOKENS
// ============================================================================

export const SpacingSchema = z.object({
  // Border radius
  radiusSm: z.string().default('calc(0.5rem - 4px)'),
  radiusMd: z.string().default('calc(0.5rem - 2px)'),
  radiusLg: z.string().default('0.5rem'),
  radiusXl: z.string().default('0.75rem'),
  radiusFull: z.string().default('9999px'),

  // Spacing scale (for padding, margin, gap)
  spacing1: z.string().default('0.25rem'),
  spacing2: z.string().default('0.5rem'),
  spacing3: z.string().default('0.75rem'),
  spacing4: z.string().default('1rem'),
  spacing5: z.string().default('1.25rem'),
  spacing6: z.string().default('1.5rem'),
  spacing8: z.string().default('2rem'),
  spacing10: z.string().default('2.5rem'),
  spacing12: z.string().default('3rem'),
  spacing16: z.string().default('4rem'),
});

export type Spacing = z.infer<typeof SpacingSchema>;

// ============================================================================
// EFFECTS TOKENS
// ============================================================================

export const EffectsSchema = z.object({
  // Shadows
  shadowSm: z.string().default('0 1px 2px 0 rgb(0 0 0 / 0.05)'),
  shadowMd: z.string().default('0 4px 6px -1px rgb(0 0 0 / 0.1)'),
  shadowLg: z.string().default('0 10px 15px -3px rgb(0 0 0 / 0.1)'),
  shadowXl: z.string().default('0 20px 25px -5px rgb(0 0 0 / 0.1)'),

  // Transitions
  transitionFast: z.string().default('150ms'),
  transitionNormal: z.string().default('200ms'),
  transitionSlow: z.string().default('300ms'),
  transitionEasing: z.string().default('cubic-bezier(0.4, 0, 0.2, 1)'),

  // Focus ring
  focusRingWidth: z.string().default('2px'),
  focusRingOffset: z.string().default('2px'),
});

export type Effects = z.infer<typeof EffectsSchema>;

// ============================================================================
// COMPLETE THEME TOKENS
// ============================================================================

export const ThemeTokensSchema = z.object({
  colors: z.object({
    light: ColorPaletteSchema,
    dark: ColorPaletteSchema,
  }),
  typography: TypographySchema.optional(),
  spacing: SpacingSchema.optional(),
  effects: EffectsSchema.optional(),
});

export type ThemeTokens = z.infer<typeof ThemeTokensSchema>;

// ============================================================================
// THEME MANIFEST (extends plugin manifest)
// ============================================================================

export const ThemeManifestSchema = z.object({
  // Theme identity
  id: z.string().regex(/^[a-z][a-z0-9-]*$/),
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  version: z.string(),
  author: z.union([z.string(), z.object({
    name: z.string(),
    email: z.string().email().optional(),
    url: z.string().url().optional(),
  })]),

  // Theme configuration
  tokens: ThemeTokensSchema,

  // Optional: Custom fonts to load
  fonts: z.array(z.object({
    family: z.string(),
    src: z.string(), // URL or relative path
    weight: z.string().optional(),
    style: z.string().optional(),
    display: z.enum(['auto', 'block', 'swap', 'fallback', 'optional']).default('swap'),
  })).optional(),

  // Optional: Component-specific CSS overrides (Tier 3)
  componentStyles: z.string().optional(), // Path to CSS file

  // Optional: Preview image
  preview: z.string().optional(),

  // Theme category/tags
  tags: z.array(z.string()).optional(),

  // Whether this theme supports dark mode (default: true)
  supportsDarkMode: z.boolean().default(true),
});

export type ThemeManifest = z.infer<typeof ThemeManifestSchema>;

// ============================================================================
// USER THEME PREFERENCE
// ============================================================================

export const ThemePreferenceSchema = z.object({
  /** Active theme plugin ID (null = default) */
  activeThemeId: z.string().nullable().default(null),

  /** Color mode preference */
  colorMode: z.enum(['light', 'dark', 'system']).default('system'),

  /** Custom token overrides (user tweaks on top of theme) */
  customOverrides: z.record(z.string()).optional(),
});

export type ThemePreference = z.infer<typeof ThemePreferenceSchema>;
```

### 1.2 Add Theme Capability to Plugin System

**Update**: `lib/schemas/plugin-manifest.ts`

Add `ThemeConfigSchema` for theme plugins:

```typescript
/**
 * Theme plugin configuration schema
 *
 * Defines the configuration for theme plugins.
 */
export const ThemeConfigSchema = z.object({
  /** Theme tokens file path (relative to plugin root) */
  tokensPath: z.string().default('tokens.json'),

  /** Optional component overrides CSS file */
  stylesPath: z.string().optional(),

  /** Whether this theme supports dark mode */
  supportsDarkMode: z.boolean().default(true),

  /** Preview image path */
  previewImage: z.string().optional(),

  /** Base theme to extend (null = extend default) */
  extendsTheme: z.string().nullable().optional(),
});

export type ThemeConfig = z.infer<typeof ThemeConfigSchema>;
```

Add to `PluginManifestSchema`:

```typescript
/** Theme configuration (for THEME capability plugins) */
themeConfig: ThemeConfigSchema.optional(),
```

---

## Phase 2: Theme Loading Infrastructure

### 2.1 Theme Registry

**File**: `lib/themes/theme-registry.ts`

```typescript
/**
 * Theme Registry
 *
 * Manages loading, validation, and access to theme plugins.
 */

import { logger } from '@/lib/logger';
import { pluginRegistry, getEnabledPluginsByCapability } from '@/lib/plugins';
import type { ThemeTokens, ThemeManifest } from './types';

interface LoadedTheme {
  id: string;
  manifest: ThemeManifest;
  tokens: ThemeTokens;
  cssOverrides?: string;
  pluginName: string;
}

class ThemeRegistry {
  private themes: Map<string, LoadedTheme> = new Map();
  private defaultTheme: ThemeTokens | null = null;

  /**
   * Initialize themes from enabled THEME plugins
   */
  async initialize(): Promise<void> {
    const themePlugins = getEnabledPluginsByCapability('THEME');

    for (const plugin of themePlugins) {
      try {
        await this.loadThemeFromPlugin(plugin);
      } catch (error) {
        logger.error('Failed to load theme from plugin', {
          plugin: plugin.manifest.name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    logger.info('Theme registry initialized', {
      themeCount: this.themes.size,
    });
  }

  /**
   * Load theme from a plugin
   */
  private async loadThemeFromPlugin(plugin: LoadedPlugin): Promise<void> {
    const themeConfig = plugin.manifest.themeConfig;
    if (!themeConfig) {
      throw new Error('Plugin does not have themeConfig');
    }

    // Load tokens
    const tokensPath = path.join(plugin.pluginPath, themeConfig.tokensPath);
    const tokensData = await fs.readFile(tokensPath, 'utf-8');
    const tokens = ThemeTokensSchema.parse(JSON.parse(tokensData));

    // Load optional CSS overrides
    let cssOverrides: string | undefined;
    if (themeConfig.stylesPath) {
      const stylesPath = path.join(plugin.pluginPath, themeConfig.stylesPath);
      cssOverrides = await fs.readFile(stylesPath, 'utf-8');
    }

    const themeId = plugin.manifest.name.replace('qtap-plugin-theme-', '');

    this.themes.set(themeId, {
      id: themeId,
      manifest: {
        id: themeId,
        name: plugin.manifest.title,
        description: plugin.manifest.description,
        version: plugin.manifest.version,
        author: plugin.manifest.author,
        tokens,
        supportsDarkMode: themeConfig.supportsDarkMode ?? true,
      },
      tokens,
      cssOverrides,
      pluginName: plugin.manifest.name,
    });
  }

  /**
   * Get all available themes
   */
  getAll(): LoadedTheme[] {
    return Array.from(this.themes.values());
  }

  /**
   * Get a specific theme by ID
   */
  get(id: string): LoadedTheme | null {
    return this.themes.get(id) || null;
  }

  /**
   * Get the default theme tokens
   */
  getDefaultTokens(): ThemeTokens {
    // Return current globals.css values as default
    return DEFAULT_THEME_TOKENS;
  }

  /**
   * Generate CSS variables from theme tokens
   */
  generateCSSVariables(tokens: ThemeTokens, mode: 'light' | 'dark'): string {
    const colors = tokens.colors[mode];
    const typography = tokens.typography || {};
    const spacing = tokens.spacing || {};
    const effects = tokens.effects || {};

    const vars: string[] = [];

    // Color variables
    vars.push(`--color-background: ${colors.background};`);
    vars.push(`--color-foreground: ${colors.foreground};`);
    // ... all other color tokens

    // Typography variables
    if (typography.fontSans) vars.push(`--font-sans: ${typography.fontSans};`);
    // ... all other typography tokens

    // Spacing variables
    if (spacing.radiusLg) vars.push(`--radius-lg: ${spacing.radiusLg};`);
    // ... all other spacing tokens

    return vars.join('\n  ');
  }
}

export const themeRegistry = new ThemeRegistry();
```

### 2.2 Default Theme Tokens

**File**: `lib/themes/default-tokens.ts`

Extract current `globals.css` values into a TypeScript constant:

```typescript
/**
 * Default Theme Tokens
 *
 * These values match the current globals.css and serve as the
 * fallback when no theme plugin is active.
 */

import type { ThemeTokens } from './types';

export const DEFAULT_THEME_TOKENS: ThemeTokens = {
  colors: {
    light: {
      background: 'hsl(0 0% 100%)',
      foreground: 'hsl(222.2 84% 4.9%)',
      primary: 'hsl(222.2 47.4% 11.2%)',
      primaryForeground: 'hsl(210 40% 98%)',
      secondary: 'hsl(210 40% 96.1%)',
      secondaryForeground: 'hsl(222.2 47.4% 11.2%)',
      muted: 'hsl(210 40% 96.1%)',
      mutedForeground: 'hsl(215.4 16.3% 46.9%)',
      accent: 'hsl(210 40% 96.1%)',
      accentForeground: 'hsl(222.2 47.4% 11.2%)',
      destructive: 'hsl(0 84.2% 60.2%)',
      destructiveForeground: 'hsl(210 40% 98%)',
      card: 'hsl(0 0% 100%)',
      cardForeground: 'hsl(222.2 84% 4.9%)',
      popover: 'hsl(0 0% 100%)',
      popoverForeground: 'hsl(222.2 84% 4.9%)',
      border: 'hsl(214.3 31.8% 91.4%)',
      input: 'hsl(214.3 31.8% 91.4%)',
      ring: 'hsl(222.2 84% 4.9%)',
    },
    dark: {
      background: 'hsl(222.2 84% 4.9%)',
      foreground: 'hsl(210 40% 98%)',
      primary: 'hsl(210 40% 98%)',
      primaryForeground: 'hsl(222.2 47.4% 11.2%)',
      secondary: 'hsl(217.2 32.6% 17.5%)',
      secondaryForeground: 'hsl(210 40% 98%)',
      muted: 'hsl(217.2 32.6% 17.5%)',
      mutedForeground: 'hsl(215 20.2% 65.1%)',
      accent: 'hsl(217.2 32.6% 17.5%)',
      accentForeground: 'hsl(210 40% 98%)',
      destructive: 'hsl(0 62.8% 30.6%)',
      destructiveForeground: 'hsl(210 40% 98%)',
      card: 'hsl(222.2 84% 4.9%)',
      cardForeground: 'hsl(210 40% 98%)',
      popover: 'hsl(222.2 84% 4.9%)',
      popoverForeground: 'hsl(210 40% 98%)',
      border: 'hsl(217.2 32.6% 17.5%)',
      input: 'hsl(217.2 32.6% 17.5%)',
      ring: 'hsl(212.7 26.8% 83.9%)',
    },
  },
  typography: {
    fontSans: 'Inter, system-ui, sans-serif',
    fontSerif: 'Georgia, serif',
    fontMono: 'ui-monospace, SFMono-Regular, monospace',
    fontSizeBase: '1rem',
    // ... other defaults
  },
  spacing: {
    radiusLg: '0.5rem',
    radiusMd: 'calc(0.5rem - 2px)',
    radiusSm: 'calc(0.5rem - 4px)',
    // ... other defaults
  },
};
```

---

## Phase 3: Theme Provider & Runtime

### 3.1 React Theme Provider

**File**: `components/providers/theme-provider.tsx`

```typescript
'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import type { ThemeTokens, ThemePreference } from '@/lib/themes/types';

interface ThemeContextValue {
  // Current state
  activeThemeId: string | null;
  colorMode: 'light' | 'dark' | 'system';
  resolvedColorMode: 'light' | 'dark';
  tokens: ThemeTokens;

  // Actions
  setTheme: (themeId: string | null) => Promise<void>;
  setColorMode: (mode: 'light' | 'dark' | 'system') => void;

  // Available themes
  availableThemes: Array<{ id: string; name: string; preview?: string }>;

  // Loading state
  isLoading: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [activeThemeId, setActiveThemeId] = useState<string | null>(null);
  const [colorMode, setColorModeState] = useState<'light' | 'dark' | 'system'>('system');
  const [resolvedColorMode, setResolvedColorMode] = useState<'light' | 'dark'>('light');
  const [tokens, setTokens] = useState<ThemeTokens | null>(null);
  const [availableThemes, setAvailableThemes] = useState<Array<{ id: string; name: string }>>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Detect system preference
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

    const updateResolvedMode = () => {
      if (colorMode === 'system') {
        setResolvedColorMode(mediaQuery.matches ? 'dark' : 'light');
      } else {
        setResolvedColorMode(colorMode);
      }
    };

    updateResolvedMode();
    mediaQuery.addEventListener('change', updateResolvedMode);
    return () => mediaQuery.removeEventListener('change', updateResolvedMode);
  }, [colorMode]);

  // Apply theme to DOM
  useEffect(() => {
    if (!tokens) return;

    const root = document.documentElement;

    // Toggle dark class
    if (resolvedColorMode === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }

    // Apply CSS variables (handled by injected <style> tag)
  }, [resolvedColorMode, tokens]);

  // Load user preference on mount
  useEffect(() => {
    async function loadPreference() {
      try {
        const response = await fetch('/api/theme-preference');
        if (response.ok) {
          const preference = await response.json();
          setActiveThemeId(preference.activeThemeId);
          setColorModeState(preference.colorMode);
        }

        // Load available themes
        const themesResponse = await fetch('/api/themes');
        if (themesResponse.ok) {
          const themes = await themesResponse.json();
          setAvailableThemes(themes);
        }
      } catch (error) {
        console.error('Failed to load theme preference:', error);
      } finally {
        setIsLoading(false);
      }
    }

    loadPreference();
  }, []);

  const setTheme = useCallback(async (themeId: string | null) => {
    setActiveThemeId(themeId);

    // Persist to server
    await fetch('/api/theme-preference', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ activeThemeId: themeId }),
    });

    // Load new theme tokens
    if (themeId) {
      const response = await fetch(`/api/themes/${themeId}/tokens`);
      if (response.ok) {
        setTokens(await response.json());
      }
    } else {
      setTokens(null); // Use default
    }
  }, []);

  const setColorMode = useCallback((mode: 'light' | 'dark' | 'system') => {
    setColorModeState(mode);

    // Persist to server
    fetch('/api/theme-preference', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colorMode: mode }),
    });
  }, []);

  return (
    <ThemeContext.Provider value={{
      activeThemeId,
      colorMode,
      resolvedColorMode,
      tokens: tokens || DEFAULT_THEME_TOKENS,
      setTheme,
      setColorMode,
      availableThemes,
      isLoading,
    }}>
      <ThemeStyleInjector tokens={tokens} mode={resolvedColorMode} />
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
}
```

### 3.2 Theme Style Injector Component

**File**: `components/providers/theme-style-injector.tsx`

```typescript
'use client';

import { useMemo } from 'react';
import { themeTokensToCSS } from '@/lib/themes/utils';
import type { ThemeTokens } from '@/lib/themes/types';

interface Props {
  tokens: ThemeTokens | null;
  mode: 'light' | 'dark';
}

export function ThemeStyleInjector({ tokens, mode }: Props) {
  const cssContent = useMemo(() => {
    if (!tokens) return null;
    return themeTokensToCSS(tokens, mode);
  }, [tokens, mode]);

  if (!cssContent) return null;

  return (
    <style
      id="quilltap-theme-variables"
      dangerouslySetInnerHTML={{ __html: cssContent }}
    />
  );
}
```

---

## Phase 4: Database & API

### 4.1 Theme Preference in Chat Settings

**Update**: `lib/schemas/types.ts`

Add to `ChatSettingsSchema`:

```typescript
/** Theme preference */
themePreference: z.object({
  activeThemeId: z.string().nullable().default(null),
  colorMode: z.enum(['light', 'dark', 'system']).default('system'),
  customOverrides: z.record(z.string()).optional(),
}).default({
  activeThemeId: null,
  colorMode: 'system',
}),
```

### 4.2 API Endpoints

**File**: `app/api/themes/route.ts`

```typescript
/**
 * GET /api/themes
 * Returns list of available theme plugins
 */
export async function GET() {
  const themes = themeRegistry.getAll();

  return Response.json(themes.map(theme => ({
    id: theme.id,
    name: theme.manifest.name,
    description: theme.manifest.description,
    preview: theme.manifest.preview,
    supportsDarkMode: theme.manifest.supportsDarkMode,
  })));
}
```

**File**: `app/api/themes/[themeId]/tokens/route.ts`

```typescript
/**
 * GET /api/themes/:themeId/tokens
 * Returns the tokens for a specific theme
 */
export async function GET(
  request: Request,
  { params }: { params: { themeId: string } }
) {
  const theme = themeRegistry.get(params.themeId);

  if (!theme) {
    return Response.json({ error: 'Theme not found' }, { status: 404 });
  }

  return Response.json(theme.tokens);
}
```

**File**: `app/api/theme-preference/route.ts`

```typescript
/**
 * GET /api/theme-preference
 * Returns user's theme preference
 *
 * PUT /api/theme-preference
 * Updates user's theme preference
 */
```

---

## Phase 5: Settings UI

### 5.1 Appearance Settings Tab

**File**: `components/settings/appearance-tab.tsx`

```typescript
'use client';

import { useTheme } from '@/components/providers/theme-provider';

export function AppearanceTab() {
  const {
    activeThemeId,
    colorMode,
    setTheme,
    setColorMode,
    availableThemes,
    isLoading
  } = useTheme();

  if (isLoading) {
    return <div>Loading theme settings...</div>;
  }

  return (
    <div className="space-y-8">
      {/* Color Mode Selection */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Color Mode</h3>
        <div className="flex gap-4">
          {['light', 'dark', 'system'].map((mode) => (
            <button
              key={mode}
              onClick={() => setColorMode(mode as 'light' | 'dark' | 'system')}
              className={`px-4 py-2 rounded-lg border ${
                colorMode === mode
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border'
              }`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
      </section>

      {/* Theme Selection */}
      <section>
        <h3 className="text-lg font-semibold mb-4">Theme</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {/* Default theme */}
          <ThemeCard
            id={null}
            name="Default"
            isActive={activeThemeId === null}
            onSelect={() => setTheme(null)}
          />

          {/* Plugin themes */}
          {availableThemes.map((theme) => (
            <ThemeCard
              key={theme.id}
              id={theme.id}
              name={theme.name}
              preview={theme.preview}
              isActive={activeThemeId === theme.id}
              onSelect={() => setTheme(theme.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}
```

---

## Phase 6: Example Theme Plugin

### 6.1 Plugin Structure

```text
plugins/src/qtap-plugin-theme-ocean/
├── manifest.json
├── package.json
├── tokens.json          # Theme token values
├── styles.css           # Optional component overrides (Tier 3)
├── preview.png          # Theme preview image
└── fonts/               # Optional custom fonts
    └── custom-font.woff2
```

### 6.2 Example manifest.json

```json
{
  "$schema": "schemas/plugin-manifest.schema.json",
  "name": "qtap-plugin-theme-ocean",
  "title": "Ocean Theme",
  "description": "A calming ocean-inspired theme with deep blues and teals",
  "version": "1.0.0",
  "author": {
    "name": "Quilltap Themes",
    "url": "https://foundry-9.com"
  },
  "license": "MIT",
  "main": "index.js",
  "compatibility": {
    "quilltapVersion": ">=2.2.0"
  },
  "capabilities": ["THEME"],
  "category": "THEME",
  "themeConfig": {
    "tokensPath": "tokens.json",
    "stylesPath": "styles.css",
    "supportsDarkMode": true,
    "previewImage": "preview.png"
  },
  "keywords": ["theme", "ocean", "blue", "calming"],
  "enabledByDefault": false,
  "status": "STABLE"
}
```

### 6.3 Example tokens.json

```json
{
  "colors": {
    "light": {
      "background": "hsl(200 20% 98%)",
      "foreground": "hsl(200 50% 10%)",
      "primary": "hsl(200 80% 40%)",
      "primaryForeground": "hsl(0 0% 100%)",
      "secondary": "hsl(180 30% 90%)",
      "secondaryForeground": "hsl(200 50% 20%)",
      "muted": "hsl(200 20% 94%)",
      "mutedForeground": "hsl(200 20% 40%)",
      "accent": "hsl(180 60% 45%)",
      "accentForeground": "hsl(0 0% 100%)",
      "destructive": "hsl(0 70% 55%)",
      "destructiveForeground": "hsl(0 0% 100%)",
      "card": "hsl(0 0% 100%)",
      "cardForeground": "hsl(200 50% 10%)",
      "popover": "hsl(0 0% 100%)",
      "popoverForeground": "hsl(200 50% 10%)",
      "border": "hsl(200 20% 85%)",
      "input": "hsl(200 20% 85%)",
      "ring": "hsl(200 80% 40%)"
    },
    "dark": {
      "background": "hsl(200 50% 8%)",
      "foreground": "hsl(200 20% 95%)",
      "primary": "hsl(200 80% 60%)",
      "primaryForeground": "hsl(200 50% 8%)",
      "secondary": "hsl(200 30% 15%)",
      "secondaryForeground": "hsl(200 20% 90%)",
      "muted": "hsl(200 30% 15%)",
      "mutedForeground": "hsl(200 20% 60%)",
      "accent": "hsl(180 60% 50%)",
      "accentForeground": "hsl(200 50% 8%)",
      "destructive": "hsl(0 60% 40%)",
      "destructiveForeground": "hsl(0 0% 95%)",
      "card": "hsl(200 40% 10%)",
      "cardForeground": "hsl(200 20% 95%)",
      "popover": "hsl(200 40% 10%)",
      "popoverForeground": "hsl(200 20% 95%)",
      "border": "hsl(200 30% 20%)",
      "input": "hsl(200 30% 20%)",
      "ring": "hsl(200 80% 60%)"
    }
  },
  "typography": {
    "fontSans": "Inter, system-ui, sans-serif"
  },
  "spacing": {
    "radiusLg": "0.75rem",
    "radiusMd": "0.5rem",
    "radiusSm": "0.25rem"
  }
}
```

---

## Implementation Order

### Step 1: Foundation (Estimated: Core infrastructure)

1. Create `lib/themes/types.ts` with all Zod schemas
2. Create `lib/themes/default-tokens.ts` extracting current globals.css values
3. Update `lib/schemas/plugin-manifest.ts` to add `ThemeConfigSchema`
4. Create `lib/themes/index.ts` exports

### Step 2: Theme Registry (Estimated: Loading infrastructure)

1. Create `lib/themes/theme-registry.ts`
2. Create `lib/themes/utils.ts` with CSS generation helpers
3. Add theme registry initialization to app startup

### Step 3: React Provider (Estimated: Client-side runtime)

1. Create `components/providers/theme-provider.tsx`
2. Create `components/providers/theme-style-injector.tsx`
3. Add ThemeProvider to app layout
4. Install and configure `next-themes` for SSR-safe hydration (optional enhancement)

### Step 4: Database & API (Estimated: Persistence layer)

1. Add `themePreference` to ChatSettings schema
2. Create migration for existing users
3. Create `/api/themes` endpoint
4. Create `/api/themes/[themeId]/tokens` endpoint
5. Create `/api/theme-preference` endpoint
6. Update `UsersRepository` for theme preferences

### Step 5: Settings UI (Estimated: User interface)

1. Create `components/settings/appearance-tab.tsx`
2. Add "Appearance" tab to settings page
3. Create theme preview card component
4. Add color mode toggle component

### Step 6: Example Theme Plugin (Estimated: Reference implementation) ✅ COMPLETE

1. ✅ Create `qtap-plugin-theme-ocean` plugin structure
2. ✅ Write example tokens.json
3. ✅ Write example styles.css with component overrides
4. ⏭️ Create preview image (skipped - requires image generation)
5. ✅ Document theme creation process (README.md)

### Step 7: UI Component Audit (Estimated: Theme integration) ✅ COMPLETE

Audit and update UI components to use theme-aware Tailwind classes instead of hardcoded colors:

1. ✅ Replace hardcoded background colors (`bg-gray-50`, `bg-slate-800`, etc.) with `bg-background`, `bg-card`, `bg-muted`
2. ✅ Replace hardcoded text colors (`text-gray-900`, `text-white`, etc.) with `text-foreground`, `text-muted-foreground`
3. ✅ Replace hardcoded border colors (`border-gray-200`, `border-slate-700`, etc.) with `border-border`
4. ✅ Replace hardcoded accent/primary colors (`bg-blue-500`, `text-blue-400`, etc.) with `bg-primary`, `text-primary`
5. ✅ Update interactive states (hover, focus) to use theme variables
6. ⏳ Test all components with Default, Ocean, and Rains themes in both light and dark modes (manual testing required)

Components updated (~50+ files, ~1800+ color class replacements):

- ✅ Settings page tabs (connection-profiles, embedding-profiles, api-keys, plugins, chat-settings, appearance, image-profiles, tags, model-selector, restore-dialog, backup-dialog, delete-data-card)
- ✅ Chat interface (GenerateImageDialog, ToolMessage, ChatSettingsModal, MessageContent, ChatGalleryImageViewModal, ToolPalette, ImageModal)
- ✅ Navigation header (nav.tsx, search-results, search-dialog, search-bar, recent-chats)
- ✅ Modal dialogs and popovers (housekeeping-dialog, image-upload-dialog, ImageDetailModal, PhotoGalleryModal)
- ✅ Memory components (memory-editor, memory-card, memory-list)
- ✅ Import/character components (import-wizard, speaker-mapper, character-conversations-tab, favorite-characters)
- ✅ Gallery components (EmbeddedPhotoGallery, avatar-selector, image-gallery, DeletedImagePlaceholder)
- ✅ Tag components (tag-dropdown, tag-editor)
- ✅ Debug components (DebugPanel, ServerLogsTab, BrowserConsoleTab, DevConsolePanel, DevConsoleLayout)

### Step 8: Documentation & Polish

1. Update `features/` docs with theming information
2. Create theme development guide
3. Add theme validation CLI command
4. Write tests for theme loading

---

## Future Enhancements

### Potential Tier 3 Component Overrides

For radical theme changes, the optional `styles.css` can include:

```css
/* Component-specific overrides */
[data-theme="ocean"] .chat-message {
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-md);
}

[data-theme="ocean"] .nav-header {
  backdrop-filter: blur(8px);
  background: rgba(var(--color-background-rgb), 0.8);
}

/* Custom animations */
[data-theme="ocean"] .message-enter {
  animation: wave-in 0.3s ease-out;
}

@keyframes wave-in {
  from { transform: translateY(10px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}
```

### Theme Marketplace (Future)

- Browse community themes
- One-click install
- Theme ratings and reviews
- Theme version updates

### Theme Builder UI (Future)

- Visual color picker
- Real-time preview
- Export as plugin
- Share themes

---

## Migration Notes

- **No breaking changes**: Current styling continues to work unchanged
- **Default theme**: Current `globals.css` values are the default
- **Gradual adoption**: Components can progressively adopt semantic tokens
- **Backwards compatible**: Hardcoded Tailwind colors still work alongside theme variables
