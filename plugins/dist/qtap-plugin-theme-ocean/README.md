# Ocean Theme Plugin

A calming ocean-inspired theme for Quilltap with deep blues and teals, designed for a relaxing yet focused chat experience.

## Features

- **Light & Dark Mode**: Full support for both light and dark color schemes
- **Ocean Color Palette**: Carefully crafted blues, teals, and complementary colors
- **Component Overrides**: Enhanced styling for chat messages, buttons, and more
- **Smooth Animations**: Subtle wave-inspired animations for loading states
- **Accessible**: Maintains proper contrast ratios for readability

## Installation

This theme is included with Quilltap. To enable it:

1. Go to **Settings** > **Appearance**
2. Select "Ocean" from the theme picker
3. Choose your preferred color mode (Light, Dark, or System)

## Color Palette

### Light Mode
- **Background**: Cool off-white (`hsl(200 20% 98%)`)
- **Primary**: Ocean blue (`hsl(200 80% 40%)`)
- **Accent**: Teal (`hsl(180 60% 45%)`)
- **Text**: Deep navy (`hsl(200 50% 10%)`)

### Dark Mode
- **Background**: Deep ocean (`hsl(200 50% 8%)`)
- **Primary**: Bright ocean blue (`hsl(200 80% 60%)`)
- **Accent**: Vibrant teal (`hsl(180 60% 50%)`)
- **Text**: Soft white (`hsl(200 20% 95%)`)

## Customization

The theme provides three tiers of customization:

### Tier 1: Design Tokens
Core color, typography, and spacing values defined in `tokens.json`. These CSS custom properties are applied globally.

### Tier 2: Component Tokens
Semantic tokens for component-level styling that reference the design tokens.

### Tier 3: Component Overrides
Advanced CSS in `styles.css` for specific component enhancements:
- Gradient backgrounds for user/assistant messages
- Frosted glass navigation effect
- Custom scrollbar styling
- Wave-inspired animations
- Enhanced focus states

## File Structure

```
qtap-plugin-theme-ocean/
├── manifest.json      # Plugin manifest with theme configuration
├── package.json       # NPM package metadata
├── tokens.json        # Design tokens (colors, typography, spacing)
├── styles.css         # Component override CSS (Tier 3)
├── index.ts           # Plugin entry point
├── preview.png        # Theme preview image
└── README.md          # This file
```

## Development

### Testing the Theme

1. Enable the plugin in the Quilltap plugin settings
2. Select the Ocean theme in Appearance settings
3. Verify both light and dark modes work correctly

### Modifying Colors

Edit `tokens.json` to adjust the color palette. The theme uses HSL color format for easy adjustment:

```json
{
  "colors": {
    "light": {
      "primary": "hsl(200 80% 40%)"
    }
  }
}
```

### Adding Component Overrides

Add CSS rules to `styles.css` using the `[data-theme="ocean"]` selector:

```css
[data-theme="ocean"] .my-component {
  /* Custom styles */
}
```

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
