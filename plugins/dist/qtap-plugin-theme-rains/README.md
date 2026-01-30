# Rains Theme Plugin

A warm, minimalist theme for Quilltap with full light and dark mode support. The dark mode features ChatGPT-inspired warm greys with clay/orange accents, while the light mode offers an Opus-inspired warm paper aesthetic with terracotta accents.

## Features

- **Light & Dark Mode**: Full support for both color schemes with distinct aesthetics
- **Warm Color Palette**: Carefully crafted earthy tones for comfortable viewing
- **Component Overrides**: Enhanced styling for chat messages, buttons, and more
- **Smooth Animations**: Gentle fade-in animations for messages
- **Accessible**: Maintains proper contrast ratios for readability
- **Cozy Aesthetic**: Perfect for extended reading and writing sessions

## Installation

This theme is included with Quilltap. To enable it:

1. Go to **Settings** > **Appearance**
2. Select "Rains" from the theme picker
3. Choose your preferred color mode (Light, Dark, or System)

## Color Palette

### Light Mode (Opus-inspired)
- **Background**: Warm off-white paper (`#FAF8F6`)
- **Sidebar**: Soft warm grey (`#F2F0EE`)
- **Cards/Inputs**: Pure white (`#FFFFFF`)
- **Primary Text**: Sharp charcoal (`#1A1A1A`)
- **Secondary Text**: Muted grey (`#585858`)
- **Accent**: Terracotta (`hsl(10 53% 53%)`)
- **Border**: Subtle warm (`#E6E4E2`)

### Dark Mode (ChatGPT-inspired)
- **Background**: Dark charcoal (`#212121`)
- **Sidebar**: Deep grey (`#1a1a1a`)
- **Cards/Inputs**: Elevated grey (`#303030`)
- **Primary Text**: Soft white (`#ececec`)
- **Secondary Text**: Muted grey (`#9e9e9e`)
- **Accent**: Clay/orange (`hsl(15 55% 59%)`)
- **Border**: White at low opacity

## Customization

The theme provides three tiers of customization:

### Tier 1: Design Tokens
Core color, typography, and spacing values defined in `tokens.json`. These CSS custom properties are applied globally.

### Tier 2: Component Tokens
Semantic tokens for component-level styling that reference the design tokens.

### Tier 3: Component Overrides
Advanced CSS in `styles.css` for specific component enhancements:
- Mode-specific color palettes
- Warm gradient backgrounds for user/assistant messages
- Custom scrollbar styling
- Enhanced focus states with accent glow
- Serif headings for a refined look

## Bundled Fonts

This theme includes **Fira Code** for monospace text (code blocks, terminal output, etc.).

### Fira Code

- **Source**: [github.com/tonsky/FiraCode](https://github.com/tonsky/FiraCode)
- **Version**: 6.2
- **License**: SIL Open Font License 1.1 (see `fonts/OFL.txt`)
- **Files**: `FiraCode-Regular.woff2`, `FiraCode-Bold.woff2`

Fira Code is a monospaced font with programming ligatures, making code more readable.

## File Structure

```
qtap-plugin-theme-rains/
├── manifest.json      # Plugin manifest with theme configuration
├── package.json       # NPM package metadata
├── tokens.json        # Design tokens (colors, typography, spacing)
├── styles.css         # Component override CSS (Tier 3)
├── index.ts           # Plugin entry point (TypeScript)
├── index.js           # Plugin entry point (compiled)
├── preview.png        # Theme preview image
├── fonts/             # Bundled font files
│   ├── FiraCode-Regular.woff2
│   ├── FiraCode-Bold.woff2
│   └── OFL.txt        # Font license
└── README.md          # This file
```

## Development

### Testing the Theme

1. Enable the plugin in the Quilltap plugin settings
2. Select the Rains theme in Appearance settings
3. Toggle between light and dark modes to verify both work correctly

### Modifying Colors

Edit `tokens.json` to adjust the color palette. The theme uses HSL color format for easy adjustment:

```json
{
  "colors": {
    "light": {
      "primary": "hsl(10 53% 53%)"
    },
    "dark": {
      "primary": "hsl(15 63.1% 59.6%)"
    }
  }
}
```

### Adding Component Overrides

Add CSS rules to `styles.css` using the appropriate selectors:

```css
/* Both modes */
[data-theme="rains"] .my-component {
  /* Shared styles */
}

/* Light mode only */
[data-theme="rains"].light .my-component {
  /* Light mode styles */
}

/* Dark mode only */
[data-theme="rains"].dark .my-component {
  /* Dark mode styles */
}
```

## Design Philosophy

The Rains theme draws inspiration from:

**Light Mode:**
- Warm, minimalist paper aesthetic
- Clean typography with high readability
- Subtle borders and shadows
- Terracotta accent for warmth

**Dark Mode:**
- ChatGPT-style warm neutral greys
- Clay/orange brand accent
- Comfortable contrast for extended use
- Subtle transparency-based borders

The goal is to create a visually comfortable environment that reduces eye strain during extended use, whether in bright daylight or low-light conditions.

## Credits

- **Author**: Foundry-9
- **License**: MIT
- **Version**: 1.2.0

## Changelog

### 1.2.0
- Added full light mode support with Opus-inspired warm paper aesthetic
- Restructured CSS for proper light/dark mode switching
- Updated tokens.json with distinct light and dark palettes
- Light mode uses terracotta accent, dark mode uses clay/orange
- Improved badge, alert, and status color definitions for both modes
- Updated dev console colors for proper contrast in both modes

### 1.1.0
- Refactored to ChatGPT-inspired aesthetic
- Updated color palette to warm neutral greys
- Added clay/orange brand accent

### 1.0.0
- Initial release
- Dark mode support only
- Full design token system
- Component override CSS for enhanced styling
- Warm amber accent colors
