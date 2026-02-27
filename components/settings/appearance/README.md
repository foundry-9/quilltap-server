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
│   ├── ThemeCard.tsx              # Individual theme card component
│   ├── ColorModeSelector.tsx      # Color mode selection component
│   ├── DebugThemeInfo.tsx         # Development debug info component
│   ├── ThemePreviewPanel.tsx      # Theme preview panel component
│   └── ThemePreviewElements.tsx   # Theme preview elements component
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
- Plugin-provided themes
- Live preview of color swatches
- Dark mode support badges

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
