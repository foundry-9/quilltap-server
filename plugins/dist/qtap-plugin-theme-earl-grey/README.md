# Earl Grey Theme Plugin

A sophisticated dark theme for Quilltap with deep slate grays and soft blue accents, inspired by the elegance of classic earl grey tea.

## Features

- **Dark Mode Focus**: Optimized for dark mode with carefully balanced contrast
- **Blue Accents**: Soft, refined blue (#007aff) accent colors throughout
- **Neutral Palette**: Deep grays (#212121, #2f2f2f, #424242) for a clean, modern look
- **Component Overrides**: Enhanced styling for chat messages, buttons, and more
- **Smooth Animations**: Subtle fade and pulse animations for loading states
- **Accessible**: Maintains proper contrast ratios for readability

## Installation

This theme is included with Quilltap. To enable it:

1. Go to **Settings** > **Appearance**
2. Select "Earl Grey" from the theme picker
3. Choose your preferred color mode (Light, Dark, or System)

## Color Palette

### Dark Mode
- **Background**: Deep gray (`#212121` / `hsl(0 0% 13%)`)
- **Surface**: Elevated gray (`#2f2f2f` / `hsl(0 0% 18.4%)`)
- **Primary**: Classic blue (`#007aff` / `hsl(211 100% 50%)`)
- **Text**: Pure white (`#ffffff`)
- **Accent**: Soft blue (`#66b5ff` / `hsl(211 100% 70%)`)

### Key Colors
- **Success**: Emerald green (`hsl(142 71% 45%)`)
- **Warning**: Amber yellow (`hsl(45 93% 47%)`)
- **Danger**: Coral red (`hsl(0 84.2% 60.2%)`)

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
- Subtle loading animations
- Enhanced focus states with blue glow
- Blue-accented avatars and interactive elements

## File Structure

```
qtap-plugin-theme-earl-grey/
├── manifest.json      # Plugin manifest with theme configuration
├── package.json       # NPM package metadata
├── tokens.json        # Design tokens (colors, typography, spacing)
├── styles.css         # Component override CSS (Tier 3)
├── index.ts           # Plugin entry point (TypeScript)
├── preview.png        # Theme preview image (optional)
└── README.md          # This file
```

## Development

### Testing the Theme

1. Enable the plugin in the Quilltap plugin settings
2. Select the Earl Grey theme in Appearance settings
3. Verify both light and dark modes work correctly

### Modifying Colors

Edit `tokens.json` to adjust the color palette. The theme uses HSL color format for easy adjustment:

```json
{
  "colors": {
    "dark": {
      "primary": "hsl(211 100% 50%)"
    }
  }
}
```

### Adding Component Overrides

Add CSS rules to `styles.css` using the `[data-theme="earl-grey"]` selector:

```css
[data-theme="earl-grey"] .my-component {
  /* Custom styles */
}
```

## Design Philosophy

The Earl Grey theme draws inspiration from:
- **Classic elegance**: Refined, sophisticated color choices
- **Modern minimalism**: Clean grays without warmth or coolness
- **Blue accents**: A nod to the bergamot notes in Earl Grey tea
- **Depth through shadow**: Layered surfaces with subtle shadows

The goal is to create a visually clean, professional environment that's easy on the eyes during extended use, particularly in low-light conditions.

## Credits

- **Author**: Foundry-9
- **License**: MIT
- **Version**: 1.0.0

## Changelog

### 1.0.0
- Initial release
- Dark mode support
- Full design token system
- Component override CSS for enhanced styling
- Blue accent colors
- Subtle animations
