# Earl Grey Theme Plugin

A sophisticated theme for Quilltap with high-contrast neutral grays and bright blue accents, inspired by modern AI chat interfaces. Supports both light and dark modes with carefully calibrated palettes for each.

## Features

- **Dual Mode Support**: Fully optimized for both light and dark modes
- **High Contrast**: Pure black sidebar in dark mode, crisp white in light mode
- **Blue Accents**: Bright, vibrant blue (#007aff) accent colors throughout
- **Neutral Palette**: Pure grays without warmth for a clean, modern look
- **Component Overrides**: Enhanced styling for chat messages, buttons, and more
- **Pill-Shaped Elements**: Rounded 26px radius inputs and 8px sidebar items
- **Smooth Animations**: Subtle fade and pulse animations for loading states
- **Accessible**: Maintains proper contrast ratios for readability in both modes

## Installation

This theme is included with Quilltap. To enable it:

1. Go to **Settings** > **Appearance**
2. Select "Earl Grey" from the theme picker
3. Choose your preferred color mode (Light, Dark, or System)

## Color Palette

### Dark Mode
- **Sidebar**: Pure black (`#000000`)
- **Background**: Charcoal (`#212121` / `hsl(0 0% 13%)`)
- **Surface**: Elevated gray (`#2f2f2f` / `hsl(0 0% 18.4%)`)
- **Primary Button**: White pill with black text
- **Text**: Pure white (`#ffffff`)
- **Accent**: Bright blue (`#007aff` / `hsl(211 100% 50%)`)

### Light Mode
- **Background**: Pure white (`#ffffff` / `hsl(0 0% 100%)`)
- **Sidebar**: Very light gray (`#f9f9f9` / `hsl(0 0% 98%)`)
- **Input Fields**: Light gray (`#f4f4f4` / `hsl(0 0% 96%)`)
- **Primary Button**: Black pill with white text (inverted from dark mode)
- **Text**: Near black (`#0d0d0d` / `hsl(0 0% 5%)`)
- **Secondary Text**: Medium gray (`#676767` / `hsl(0 0% 40%)`)
- **Borders**: Soft gray (`#e5e5e5` / `hsl(0 0% 90%)`)
- **Accent**: Bright blue (`#007aff` / `hsl(211 100% 50%)`)

### Key Colors (Both Modes)
- **Success**: Emerald green (`hsl(142 71% 45%)`)
- **Warning**: Amber yellow (`hsl(45 93% 47%)`)
- **Danger**: Coral red (`hsl(0 67% 50%)`)
- **Info/Accent**: Bright blue (`hsl(211 100% 50%)`)

## Customization

The theme provides three tiers of customization:

### Tier 1: Design Tokens
Core color, typography, and spacing values defined in `tokens.json`. These CSS custom properties are applied globally and include separate values for light and dark modes.

### Tier 2: Component Tokens
Semantic tokens for component-level styling that reference the design tokens.

### Tier 3: Component Overrides
Advanced CSS in `styles.css` for specific component enhancements:
- Gradient backgrounds for user/assistant messages
- Frosted glass navigation effect
- Custom scrollbar styling
- Subtle loading animations
- Enhanced focus states with blue glow
- Blue-accented avatars and interactive elements
- Mode-specific button inversions (white/black pills)

## Bundled Fonts

This theme includes **Rethink Sans** as the primary sans-serif font for all UI text.

### Rethink Sans

- **Source**: [Google Fonts](https://fonts.google.com/specimen/Rethink+Sans)
- **Designer**: Hans Thiessen, Nico Inosanto
- **License**: SIL Open Font License 1.1 (see `fonts/OFL.txt`)
- **Files**: `RethinkSans-latin.woff2`, `RethinkSans-latin-ext.woff2`
- **Weights**: 400-700 (variable font)

Rethink Sans is a geometric sans-serif with a friendly, modern character. Its clean lines and balanced proportions complement the sophisticated aesthetic of the Earl Grey theme.

## File Structure

```
qtap-plugin-theme-earl-grey/
├── manifest.json      # Plugin manifest with theme configuration
├── package.json       # NPM package metadata
├── tokens.json        # Design tokens (colors, typography, spacing)
├── styles.css         # Component override CSS (Tier 3)
├── index.ts           # Plugin entry point (TypeScript)
├── index.js           # Plugin entry point (compiled)
├── preview.png        # Theme preview image (optional)
├── fonts/             # Bundled font files
│   ├── RethinkSans-latin.woff2
│   ├── RethinkSans-latin-ext.woff2
│   └── OFL.txt        # Font license
└── README.md          # This file
```

## Development

### Testing the Theme

1. Enable the plugin in the Quilltap plugin settings
2. Select the Earl Grey theme in Appearance settings
3. Verify both light and dark modes work correctly
4. Test the System preference to ensure it follows OS settings

### Modifying Colors

Edit `tokens.json` to adjust the color palette. The theme uses HSL color format for easy adjustment:

```json
{
  "colors": {
    "light": {
      "primary": "hsl(0 0% 5%)",
      "primaryForeground": "hsl(0 0% 100%)"
    },
    "dark": {
      "primary": "hsl(0 0% 100%)",
      "primaryForeground": "hsl(0 0% 0%)"
    }
  }
}
```

### Adding Component Overrides

Add CSS rules to `styles.css` using mode-specific selectors:

```css
/* Base styles for both modes */
[data-theme="earl-grey"] .my-component {
  /* Shared styles */
}

/* Light mode specific */
[data-theme="earl-grey"].light .my-component {
  /* Light mode styles */
}

/* Dark mode specific */
[data-theme="earl-grey"].dark .my-component {
  /* Dark mode styles */
}
```

## Design Philosophy

The Earl Grey theme draws inspiration from:
- **Modern AI interfaces**: Clean, high-contrast design language
- **Neutral minimalism**: Pure grays without warmth or coolness
- **Blue accents**: Bright, vibrant blue for interactive elements
- **Inverted primaries**: Black pills on light, white pills on dark
- **Depth through contrast**: Strong visual hierarchy via background layering

The goal is to create a visually clean, professional environment that works beautifully in both light and dark conditions. Light mode features a crisp, paper-like white background, while dark mode offers deep blacks and charcoals for comfortable low-light use.

## Credits

- **Author**: Foundry-9 LLC
- **License**: MIT
- **Version**: 1.3.0

## Changelog

### 1.3.0

- Added comprehensive light mode support
- Pure white background with light gray sidebar in light mode
- Inverted primary button colors (black pill in light, white pill in dark)
- Updated badge and filter chip styling for light mode
- Enhanced focus states for both modes
- Restructured CSS with `.light` and `.dark` class selectors

### 1.2.0

- Various styling improvements and bug fixes

### 1.0.6

- Added Rethink Sans as the primary sans-serif font
- Bundled woff2 font files for latin and latin-ext character sets

### 1.0.0

- Initial release
- Dark mode support
- Full design token system
- Component override CSS for enhanced styling
- Blue accent colors
- Subtle animations
