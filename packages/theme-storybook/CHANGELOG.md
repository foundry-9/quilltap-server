# Changelog

All notable changes to `@quilltap/theme-storybook` will be documented in this file.

## [1.0.2] - 2025-12-31

### Changed
- Sidebar navigation icons and labels now use standard foreground color

## [1.0.1] - 2025-12-31

### Added
- Left sidebar CSS variables (`--qt-left-sidebar-*`) for theme customization
- App header CSS variables (`--qt-app-header-*`) for theme customization
- Left sidebar component classes (`.qt-left-sidebar-*`)
- App layout component classes (`.qt-app-layout`, `.qt-app-main`, `.qt-app-header-*`)
- Mobile-responsive hamburger menu class (`.qt-hamburger`)

## [1.0.0] - 2025-12-31

### Added
- Initial release of `@quilltap/theme-storybook`
- Storybook preset for theme development
- Default Quilltap theme tokens CSS (`quilltap-defaults.css`)
- Complete qt-* component classes CSS (`qt-components.css`)
- ThemeDecorator for applying themes in Storybook
- Default preview configuration with theme/color mode toggles
- Comprehensive story components:
  - `ColorPalette` - Theme color token visualization
  - `Typography` - Font families, headings, text styles
  - `Spacing` - Border radius, spacing scale, shadows
  - `Buttons` - All button variants and states
  - `Cards` - Card variants, entity cards, panels
  - `Inputs` - Text inputs, textareas, selects, forms
  - `Badges` - Badge variants including provider badges
  - `Avatars` - Avatar sizes, shapes, status indicators
  - `Dialogs` - Modal/dialog variants with interactions
  - `Tabs` - Tab navigation patterns
  - `Chat` - Chat messages, input, typing indicator
  - `ThemeComparison` - Side-by-side theme comparison
