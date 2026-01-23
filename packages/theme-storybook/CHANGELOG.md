# Changelog

All notable changes to `@quilltap/theme-storybook` will be documented in this file.

## [1.0.12] - 2026-01-23

### Added
- Filter chip classes (`qt-filter-chip`, `qt-filter-chip-active`) for themeable search filter toggles
- CSS variables: `--qt-filter-chip-radius`, `--qt-filter-chip-padding-x`, `--qt-filter-chip-padding-y`, `--qt-filter-chip-font-size`, `--qt-filter-chip-font-weight`, `--qt-filter-chip-transition`
- Active state variables: `--qt-filter-chip-active-bg`, `--qt-filter-chip-active-fg`, `--qt-filter-chip-active-border`
- Inactive state variables: `--qt-filter-chip-inactive-bg`, `--qt-filter-chip-inactive-fg`, `--qt-filter-chip-inactive-border`, `--qt-filter-chip-inactive-hover-bg`

## [1.0.11] - 2026-01-23

### Added
- Search highlight class (`qt-highlight`) for consistent search result text highlighting
- CSS variables: `--qt-highlight-bg`, `--qt-highlight-fg`, `--qt-highlight-radius`, `--qt-highlight-padding-x`, `--qt-highlight-font-weight`

## [1.0.10] - 2026-01-16

### Added
- Collapsed navigation classes (`qt-collapsed-nav`, `qt-collapsed-nav-button`) for sidebar quick-access buttons when collapsed

## [1.0.9] - 2026-01-10

### Changed
- Status badges (`qt-badge-success`, `qt-badge-warning`, `qt-badge-destructive`) now use `--qt-status-*` tokens for consistent theming
- Badges use solid backgrounds with contrasting foreground colors for better readability in dark mode

### Added
- Status token CSS variables: `--qt-status-success-*`, `--qt-status-warning-*`, `--qt-status-info-*`, `--qt-status-danger-*`
- `qt-badge-info` class using info status tokens

## [1.0.5] - 2026-01-06

### Added
- File preview component classes (`qt-file-preview-scroll`, `qt-file-preview-panel`, `qt-file-preview-code`)
- File preview state classes (`qt-file-preview-loading`, `qt-file-preview-loading-text`, `qt-file-preview-empty`, `qt-file-preview-empty-icon`)
- Wikilink classes (`qt-wikilink`, `qt-wikilink-broken`) for internal document links
- CSS variables: `--qt-file-preview-max-height`, `--qt-file-preview-min-height`, `--qt-file-preview-panel-bg`
- CSS variables: `--qt-code-bg`, `--qt-code-fg`, `--qt-code-font`
- FilePreview story component showcasing all file preview styles

## [1.0.4] - 2026-01-01

### Added
- Avatar label classes (`qt-avatar-labels`, `qt-avatar-name`, `qt-avatar-title`)
- CSS variables: `--qt-avatar-name-fg`, `--qt-avatar-title-fg` for theming avatar text
- Themes can now customize avatar name/title colors (useful for backgrounds with images)

## [1.0.3] - 2026-01-01

### Added
- Success button variant (`qt-button-success`) as standalone class with full styling
- CSS variables: `--qt-button-success-bg`, `--qt-button-success-fg`, `--qt-button-success-hover-bg`
- Dark foreground text for proper contrast on bright green background

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
