# Ocean Theme Plugin

A luminous, bioluminescent-inspired theme for Quilltap that mixes glass surfaces, layered gradients, and fluid motion to create a calm but expressive writing environment.

## Features

- **Ambient Depth**: Layered backdrop gradients, floating glows, and glass panels that make every surface feel aquatic.
- **Message Personalities**: Assistant/user/system turns each receive their own gradients, borders, and motion to keep the thread legible.
- **Custom Typography**: Bundles Space Grotesk for UI copy and Space Mono for code to reinforce the futuristic ocean aesthetic.
- **Command & Canvas Polish**: Command palette, toolbars, tables, callouts, and chip groups all receive bespoke styling.
- **Light + Dark Harmony**: Shared palette tuned to stay vibrant in both surface modes with accessible contrast.
- **Micro-Interactions**: Buttons, bubbles, and typing dots animate with gentle "tidal" motion to show off the theme engine.

## Layered Styling Highlights

- Frosted navigation rail with subtle accent line and blurred glass effect.
- Chat thread container with translucent shell, glowing hover states, and message metadata microtype.
- Composer toolbar, inline actions, and chips that share a pill-based language.
- Command palette + popovers built from luminous panels, keeping the experience cohesive.
- Markdown treatments (tables, blockquotes, code) using the bundled mono font and aqua outlines.
- Scrollbars, progress bars, avatars, and badges themed to match the palette for full-environment polish.

## Color Palette

### Light Mode
- **Background**: Mist white (`hsl(198 58% 96%)`)
- **Primary**: Tidal teal (`hsl(196 78% 42%)`)
- **Accent**: Reef aqua (`hsl(174 66% 38%)`)
- **Text**: Midnight navy (`hsl(220 57% 12%)`)

### Dark Mode
- **Background**: Abyss blue (`hsl(214 68% 6%)`)
- **Primary**: Electric cyan (`hsl(188 82% 62%)`)
- **Accent**: Bioluminescent green (`hsl(176 70% 55%)`)
- **Text**: Soft foam (`hsl(205 46% 92%)`)

## Bundled Fonts

| Font | Use | License |
| ---- | --- | ------- |
| Space Grotesk (400/600) | UI + headings | SIL Open Font License 1.1 |
| Space Mono (400) | Code + inline monospace | SIL Open Font License 1.1 |

All font files live in `fonts/` alongside the license text.

## Installation

This theme ships with Quilltap. To enable it:

1. Go to **Settings → Appearance**
2. Choose **Ocean** in the theme picker
3. Pick *Light*, *Dark*, or *System* mode

## Customization

### Tier 1: Design Tokens
`tokens.json` defines the refreshed palette, typography, spacing, and effect scales. Adjust HSL values or font stacks to quickly reskin the vibe.

### Tier 2: Component Tokens
Semantic tokens inside Quilltap automatically pick up the palette—primary buttons, informative callouts, and more change without touching CSS.

### Tier 3: Component Overrides
`styles.css` uses `[data-theme="ocean"]` selectors to author advanced layouts:

- Ambient background layers with pseudo elements
- Chat-specific gradients, system callouts, and ripple animations
- Composer + toolbar pills, command palette panels, and markdown polish
- Scrollbars, badges, tabs, and inline actions tuned to the palette

## File Structure

```
qtap-plugin-theme-ocean/
├── manifest.json      # Plugin manifest and theme config
├── package.json       # NPM metadata
├── tokens.json        # Design tokens (colors, typography, spacing, effects)
├── styles.css         # Component overrides plus font-face declarations
├── fonts/             # Bundled fonts + SIL license
│   ├── SpaceGrotesk-Regular.ttf
│   ├── SpaceGrotesk-SemiBold.ttf
│   ├── SpaceMono-Regular.ttf
│   └── OFL.txt
├── index.ts           # Plugin entry (TypeScript)
├── index.js           # Compiled entry
└── README.md          # This document
```

## Development

1. Enable the plugin in Quilltap settings.
2. Switch to the Ocean theme in **Appearance**.
3. Verify the gradients, typography, and animations in both light and dark modes.
4. Inspect the chat thread, composer, command palette, markdown render, and sidebar to ensure every surface inherits the new styling.

## Design Philosophy

Ocean 1.1 leans into three pillars:

- **Depth** through stacked glass, blurred backgrounds, and glowing borders.
- **Flow** by animating key elements with a slow "tidal" sway rather than flashy motion.
- **Focus** via high-contrast typography and disciplined spacing so the experience remains usable despite the visual flourish.

## Credits

- **Author**: Foundry-9
- **License**: MIT
- **Version**: 1.1.0

## Changelog

### 1.1.0
- New color palette with brighter cyan/reef accents.
- Added bundled Space Grotesk + Space Mono fonts.
- Reauthored `styles.css` with ambient gradients, glass panels, and expanded component coverage.
- Enhanced chat thread, toolbar, command palette, markdown, and scrollbar styling.
- Updated tokens (spacing, effects) to support the new look.

### 1.0.0
- Initial release with basic light/dark palette, tokens, and component overrides.
