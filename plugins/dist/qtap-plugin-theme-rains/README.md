# Rains Theme Plugin

A warm, earthy dark theme for Quilltap with rich browns and amber accents, inspired by rain-soaked autumn evenings.

## Features

- **Light & Dark Mode**: Full support for both light and dark color schemes
- **Warm Color Palette**: Carefully crafted browns, ambers, and earthy tones
- **Component Overrides**: Enhanced styling for chat messages, buttons, and more
- **Smooth Animations**: Gentle rain-inspired animations for loading states
- **Accessible**: Maintains proper contrast ratios for readability
- **Cozy Aesthetic**: Perfect for late-night coding or reading sessions

## Installation

This theme is included with Quilltap. To enable it:

1. Go to **Settings** > **Appearance**
2. Select "Rains" from the theme picker
3. Choose your preferred color mode (Light, Dark, or System)

## Color Palette

### Light Mode
- **Background**: Warm off-white (`hsl(30 15% 96%)`)
- **Primary**: Rich amber (`hsl(30 80% 45%)`)
- **Accent**: Bright amber (`hsl(25 85% 50%)`)
- **Text**: Deep brown (`hsl(30 20% 15%)`)

### Dark Mode
- **Background**: Deep brown (`hsl(25 12% 10%)`)
- **Primary**: Warm amber (`hsl(30 75% 55%)`)
- **Accent**: Vibrant amber (`hsl(28 85% 55%)`)
- **Text**: Soft cream (`hsl(35 20% 90%)`)

## Customization

The theme provides three tiers of customization:

### Tier 1: Design Tokens
Core color, typography, and spacing values defined in `tokens.json`. These CSS custom properties are applied globally.

### Tier 2: Component Tokens
Semantic tokens for component-level styling that reference the design tokens.

### Tier 3: Component Overrides
Advanced CSS in `styles.css` for specific component enhancements:
- Warm gradient backgrounds for user/assistant messages
- Frosted glass navigation effect
- Custom scrollbar styling
- Rain-inspired loading animations
- Enhanced focus states with amber glow
- Amber-accented avatars

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
└── README.md          # This file
```

## Development

### Testing the Theme

1. Enable the plugin in the Quilltap plugin settings
2. Select the Rains theme in Appearance settings
3. Verify both light and dark modes work correctly

### Modifying Colors

Edit `tokens.json` to adjust the color palette. The theme uses HSL color format for easy adjustment:

```json
{
  "colors": {
    "dark": {
      "primary": "hsl(30 75% 55%)"
    }
  }
}
```

### Adding Component Overrides

Add CSS rules to `styles.css` using the `[data-theme="rains"]` selector:

```css
[data-theme="rains"] .my-component {
  /* Custom styles */
}
```

## Design Philosophy

The Rains theme draws inspiration from:
- **Autumn evenings**: Warm browns and rich ambers
- **Rain on windows**: Soft, diffused lighting effects
- **Cozy interiors**: Comfortable contrast that's easy on the eyes
- **Natural earth tones**: Grounding, calming color palette

The goal is to create a visually warm environment that reduces eye strain during extended use, particularly in low-light conditions.

## Credits

- **Author**: Foundry-9
- **License**: MIT
- **Version**: 1.0.0

## Changelog

### 1.0.0
- Initial release
- Light and dark mode support
- Full design token system
- Component override CSS for enhanced styling
- Warm amber accent colors
- Rain-inspired animations
