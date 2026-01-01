# Changelog

All notable changes to this package will be documented in this file.

## [1.0.3] - 2025-12-31

### Added

- Document left sidebar CSS variables in styles.css template
- Document app header CSS variables in styles.css template

## [1.0.2] - 2025-12-31

### Fixed

- Add missing `@storybook/addon-essentials` to devDependencies in scaffolded projects

## [1.0.1] - 2025-12-31

### Added

- Include complete theme development guide (`docs/THEME_PLUGIN_DEVELOPMENT.md`) in every scaffolded theme
- Updated help output to show docs folder in project structure
- Added local documentation reference in post-scaffold instructions

## [1.0.0] - 2025-12-31

### Added

- Initial release
- Interactive CLI for scaffolding Quilltap theme plugins
- Template generation for:
  - package.json with correct dependencies
  - manifest.json with theme configuration
  - tokens.json with full color palette (light/dark)
  - index.ts entry point
  - styles.css for component overrides (optional)
  - Storybook setup (optional)
- Support for `--yes` flag to skip prompts
- Color-coded terminal output
- Customizable primary color
