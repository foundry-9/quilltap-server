# @quilltap/theme-storybook

A comprehensive Storybook package for developing and testing Quilltap theme plugins. This package provides everything needed to preview themes against Quilltap's default styling without requiring the full Quilltap application.

## Installation

```bash
npm install --save-dev @quilltap/theme-storybook @storybook/react
```

## Quick Start

### 1. Add the Preset to Your Storybook Configuration

In your `.storybook/main.ts`:

```typescript
import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  stories: ['../src/**/*.stories.@(ts|tsx)'],
  addons: [
    '@storybook/addon-essentials',
    '@quilltap/theme-storybook/preset', // Add this line
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
};

export default config;
```

### 2. Configure the Preview

In your `.storybook/preview.tsx`:

```typescript
import type { Preview } from '@storybook/react';
import { defaultPreviewConfig, ThemeDecorator } from '@quilltap/theme-storybook';

// Import your theme's CSS
import '../src/styles.css';

const preview: Preview = {
  ...defaultPreviewConfig,
  decorators: [ThemeDecorator],
};

export default preview;
```

### 3. Import the Default Styles

The package provides two CSS files:
- `quilltap-defaults.css` - Default theme tokens (colors, fonts, spacing)
- `qt-components.css` - Component class definitions

Import them in your preview or let the preset handle it:

```typescript
import '@quilltap/theme-storybook/css/quilltap-defaults.css';
import '@quilltap/theme-storybook/css/qt-components.css';
```

## Using Story Components

The package exports reusable story components to showcase your theme:

```typescript
import {
  ColorPalette,
  Typography,
  Spacing,
  Buttons,
  Cards,
  Inputs,
  Badges,
  Avatars,
  Dialogs,
  Tabs,
  Chat,
  ThemeComparison,
} from '@quilltap/theme-storybook/stories';

// Use in your stories
export const ColorsStory = () => <ColorPalette />;
export const ButtonsStory = () => <Buttons />;
export const ChatStory = () => <Chat />;
```

## Available Components

| Component | Description |
|-----------|-------------|
| `ColorPalette` | Displays all theme color tokens with swatches |
| `Typography` | Font families, headings, body text, and text colors |
| `Spacing` | Border radius, spacing scale, and shadow tokens |
| `Buttons` | All button variants, sizes, and states |
| `Cards` | Card variants, entity cards, and panels |
| `Inputs` | Text inputs, textareas, selects, and form examples |
| `Badges` | Badge variants including provider badges |
| `Avatars` | Avatar sizes, shapes, status indicators, and groups |
| `Dialogs` | Modal/dialog variants with interactive examples |
| `Tabs` | Tab navigation patterns including pill and vertical tabs |
| `Chat` | Chat messages, input, typing indicator, and chat list |
| `ThemeComparison` | Side-by-side comparison view for theme development |

## Creating a Theme Plugin

### Basic Theme Structure

```
my-quilltap-theme/
├── package.json
├── manifest.json
├── tokens.json
├── styles.css (optional)
├── src/
│   └── index.ts
└── .storybook/
    ├── main.ts
    └── preview.tsx
```

### manifest.json

```json
{
  "id": "my-custom-theme",
  "name": "My Custom Theme",
  "version": "1.0.0",
  "capabilities": ["theme"],
  "theme": {
    "type": "complete",
    "displayName": "My Custom Theme",
    "description": "A beautiful custom theme for Quilltap",
    "tokensFile": "tokens.json"
  }
}
```

### tokens.json

Override any of the default tokens:

```json
{
  "colors": {
    "light": {
      "--theme-background": "#ffffff",
      "--theme-foreground": "#1a1a1a",
      "--theme-primary": "#3b82f6",
      "--theme-primary-foreground": "#ffffff"
    },
    "dark": {
      "--theme-background": "#0a0a0a",
      "--theme-foreground": "#fafafa",
      "--theme-primary": "#60a5fa",
      "--theme-primary-foreground": "#0a0a0a"
    }
  },
  "fonts": {
    "--font-sans": "Inter, system-ui, sans-serif"
  },
  "radius": {
    "--radius-sm": "0.25rem",
    "--radius-md": "0.5rem",
    "--radius-lg": "0.75rem"
  }
}
```

### Theme Entry Point (src/index.ts)

```typescript
import type { ThemePlugin } from '@quilltap/plugin-types';
import { createPluginLogger } from '@quilltap/plugin-utils';
import manifest from '../manifest.json';
import tokens from '../tokens.json';

const logger = createPluginLogger(manifest.id);

const plugin: ThemePlugin = {
  manifest,

  async initialize() {
    logger.info('Theme initialized');
    return { success: true };
  },

  async getTokens() {
    return tokens;
  },

  async getStyles() {
    // Return additional CSS if needed
    return '';
  },
};

export default plugin;
```

## Theme Token Reference

### Color Tokens

Theme plugins should define these `--theme-*` tokens, which are automatically aliased to `--color-*`:

| Token | Description |
|-------|-------------|
| `--theme-background` | Page/app background |
| `--theme-foreground` | Primary text color |
| `--theme-card` | Card background |
| `--theme-card-foreground` | Card text color |
| `--theme-primary` | Primary action color |
| `--theme-primary-foreground` | Text on primary color |
| `--theme-secondary` | Secondary elements |
| `--theme-muted` | Muted backgrounds |
| `--theme-muted-foreground` | Secondary text |
| `--theme-accent` | Accent highlights |
| `--theme-border` | Border color |
| `--theme-destructive` | Error/delete actions |
| `--theme-success` | Success states |
| `--theme-warning` | Warning states |

### Font Tokens

| Token | Description |
|-------|-------------|
| `--font-sans` | Primary sans-serif font stack |
| `--font-serif` | Serif font stack |
| `--font-mono` | Monospace font stack |

### Radius Tokens

| Token | Description |
|-------|-------------|
| `--radius-sm` | Small border radius |
| `--radius-md` | Medium border radius |
| `--radius-lg` | Large border radius |

## Component Classes

All Quilltap components use `qt-*` prefixed classes. Your theme CSS can override these classes to customize component appearance beyond color tokens.

### Buttons
- `.qt-button` - Base button styles
- `.qt-button-primary` - Primary action button
- `.qt-button-secondary` - Secondary button
- `.qt-button-ghost` - Ghost/text button
- `.qt-button-destructive` - Destructive action
- `.qt-button-sm`, `.qt-button-lg` - Size variants
- `.qt-button-icon` - Icon-only button

### Cards
- `.qt-card` - Card container
- `.qt-card-header`, `.qt-card-body`, `.qt-card-footer` - Card sections
- `.qt-card-title`, `.qt-card-description` - Card text
- `.qt-card-interactive` - Hoverable card
- `.qt-entity-card` - Character/entity list card
- `.qt-character-card` - Compact character card (homepage grid)
- `.qt-panel` - Panel variant

### Inputs
- `.qt-input` - Text input styling
- `.qt-textarea` - Textarea variant
- `.qt-select` - Select dropdown

### Badges
- `.qt-badge` - Base badge
- `.qt-badge-primary`, `.qt-badge-secondary`, etc. - Variants
- `.qt-badge-outline-*` - Outline variants

### Chat
- `.qt-chat-message` - Message container
- `.qt-chat-message` - Chat message container
- `.qt-chat-message-user`, `.qt-chat-message-assistant` - Role variants
- `.qt-chat-input` - Chat input field
- `.qt-typing-indicator` - Typing animation

### Dialogs
- `.qt-dialog-overlay` - Modal backdrop
- `.qt-dialog` - Dialog container
- `.qt-dialog-header`, `.qt-dialog-body`, `.qt-dialog-footer` - Sections

### Navigation
- `.qt-tab-group`, `.qt-tab` - Tab components
- `.qt-navbar`, `.qt-navbar-link` - Navigation bar

## Development Workflow

1. **Start Storybook**: `npm run storybook`
2. **Edit tokens.json**: Modify colors, fonts, or radius values
3. **Preview changes**: Hot reload shows changes instantly
4. **Test both modes**: Use the toolbar to switch between light/dark
5. **Build plugin**: `npm run build`
6. **Test in Quilltap**: Install your theme plugin

## API Reference

### ThemeDecorator

A Storybook decorator that applies theme classes and handles dark mode:

```typescript
import { ThemeDecorator } from '@quilltap/theme-storybook';
```

### defaultPreviewConfig

Default Storybook preview configuration with theme/color mode toggles:

```typescript
import { defaultPreviewConfig } from '@quilltap/theme-storybook';
```

### CSS Imports

```typescript
// Default theme tokens
import '@quilltap/theme-storybook/css/quilltap-defaults.css';

// Component class definitions
import '@quilltap/theme-storybook/css/qt-components.css';
```

## License

MIT - Part of the Quilltap project by Foundry-9 LLC
