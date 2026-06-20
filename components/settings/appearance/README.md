# Appearance Settings Module

This module provides the UI for managing theme and color mode preferences in Quilltap.

## Structure

```
appearance/
├── types.ts                       # TypeScript interfaces and types
├── hooks/
│   ├── useAppearanceSettings.ts   # Settings state management hook
│   └── useThemePreview.ts         # Theme preview state hook
├── components/
│   ├── ThemeCard.tsx              # Individual theme card component (Preview button opens the modal)
│   ├── ThemePreviewModal.tsx      # Full-page theme preview modal (banner, live preview, gallery, icon sheet)
│   ├── ThemeBrowser.tsx           # Registry browser for discovering/installing themes
│   ├── ColorModeSelector.tsx      # Color mode selection component
│   ├── DebugThemeInfo.tsx         # Development debug info component
│   ├── ThemePreviewPanel.tsx      # Theme preview panel component
│   └── ThemePreviewElements.tsx   # Theme preview elements component
├── utils/
│   └── contrast.ts                # Shared contrast/badge helpers (banner foreground computation)
├── DisplayOptions.tsx             # Display options container
├── ThemeSelector.tsx              # Theme selection container
├── index.tsx                      # Main appearance tab component
└── README.md                      # This file
```

## Features

### Color Mode Selection
- Light mode (always light)
- Dark mode (always dark)
- System mode (follows OS preferences)

### Theme Selection
- Default theme with preview
- Bundled themes (Art Deco, Earl Grey, Great Estate, Madman's Box, Old School, Rains)
- User-installed bundle themes (.qtap-theme format)
- Legacy plugin-provided themes (deprecated, shown with badge)
- Live preview of color swatches
- Dark mode support badges
- Source badges ("Built-in" / "Bundle" / "Plugin (deprecated)")
- Install Theme button for uploading .qtap-theme files
- Uninstall button for user-installed bundle themes
- Export button for any theme

### Theme Preview Modal
- Opened by the **Preview** button on any theme card. One shared `ThemePreviewModal` instance is owned by `ThemeSelector`, driven by `previewThemeId` and keyed by theme so its local state resets per open
- Themed banner header painted in the theme's own background color, with an accessible foreground computed from it (`utils/contrast.ts`) — fixes low-contrast headers on vivid themes
- Light/Dark toggle that drives both the banner and the live `ThemePreviewPanel` (hidden when the theme has no dark mode)
- Live element preview (reuses `ThemePreviewPanel` / `ThemePreviewElements`)
- Image gallery built from manifest-referenced images only (`themeRegistry.getImages` → tokens endpoint `images`), alphabetical, over a checkerboard backing; empty state when the theme bundles none
- Icon sheet rendering each overridden icon in four states (default / muted / hover / on-primary) inside a theme-scoped container so the bundled icon-override CSS and color tokens are in effect (uses `generateIconOverridesCSS(icons, scopePrefix)`); empty state when the theme overrides none
- Apply / Export / Uninstall actions live in the banner

### Icon Overrides
- Active bundle themes can replace any of the 80 built-in icons via an `icons` map in `theme.json`
- `.svg` overrides use mask mode (tinted by `currentColor`); `.webp` and other non-SVG formats use image mode (full color as authored)
- `brand` is always image mode regardless of extension
- Overrides are injected into the same `<style>` block as tokens — no reload, live theme-switch applies them instantly
- Canonical icon names and the override recipe are documented in `docs/developer/ICON_INVENTORY.md` and the `@quilltap/theme-storybook` Icons story

### Theme Browser (Registry)
- Browse themes from configured remote registries
- Search by name, tag, or description
- Install directly from registries
- Verified/unverified badges (Ed25519 signature verification)
- Registry source management (add/remove/toggle)

### Display Options
- Quick theme access toggle (nav selector)
- Theme selector visibility control

### Development Features
- Debug theme state display
- CSS variable test visualization

## Usage

Import the main component:

```tsx
import AppearanceTab from '@/components/settings/appearance'

export function SettingsPage() {
  return <AppearanceTab />
}
```

Or use individual components:

```tsx
import { useAppearanceSettings } from '@/components/settings/appearance/hooks'
import { ThemeSelector } from '@/components/settings/appearance/ThemeSelector'
import { DisplayOptions } from '@/components/settings/appearance/DisplayOptions'

// Use them in your own component
```

## Styling

All components use the `qt-*` utility classes for theming support. These classes are defined in the Tailwind configuration and allow themes to override styling globally.

## Logging

All components include debug logging via `clientLogger`. Log levels:
- `debug`: Component renders and state changes
- `info`: User actions (theme selection, mode changes)

Check `logs/combined.log` for detailed logs.
