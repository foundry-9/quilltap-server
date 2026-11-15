# Changelog

All notable changes to this package will be documented in this file.

## [3.0.0] - 2026-11-14

### Changed
- Writes a version 2 `.qtap-theme` bundle: `theme.json` and `tokens.json` name their published JSON Schemas in `$schema`; `tokens.json` holds four primitives, a handful of `--theme-*` overrides with dark values, and the `density` choice; `styles.css` is a short stylesheet written against the app's hooks without the theme id, and the manifest records `hooksVersion`.
- The bundle README links the authoring guide, the token reference and the hook reference.
- The primary colour may be any CSS colour; the author email is optional and is written as an author object when given.

### Removed
- The `--plugin` option and every npm-plugin template (package.json, manifest.json, index.ts, tsconfig, esbuild config, Storybook setup, the plugin development guide). `--plugin` now exits with an error.
- The templates' copy of the default token values and the commented copy of the `--qt-*` defaults.
- The empty `fonts/` and `icons/` placeholder folders.

## [2.0.24] - 2026-11-10

### Changed
- Bundle `styles.css` template: the commented defaults for `--qt-status-*-bg` now show the status colour at full strength, and the tinted badge inks show the app's deeper (light) / lighter (dark) values that meet WCAG 4.5:1.

## [2.0.19] - 2026-08-30

### Added
- Bundle `styles.css` template: commented `--qt-range-accent` / `--qt-range-focus-ring` scaffold for the new `.qt-range` slider class, with a note on what overriding `.qt-range` with `appearance: none` costs.
- Theme-development doc template: the two range tokens in the overridable-variable reference.

## [2.0.13] - 2026-06-14

### Added
- Bundle `styles.css` template: commented `--qt-roleplay-1..4-bg/fg` scaffold so theme authors can dress the four high-contrast roleplay-template chips in their own hues. The semantic chips (`qt-roleplay-danger/warning/success/info/muted/code`) follow the theme's `--color-*` tokens and need no overrides.

## [2.0.12] - 2026-06-10

### Changed
- Bundle README template: the `brand` note reflects the app-side rule change — an `.svg` brand override is tinted like any other icon; ship `.webp` to keep its own colors.

## [2.0.11] - 2026-06-09

### Added
- Scaffolded bundles now include an `icons/` folder (with a commented example) for icon overrides, mirroring `fonts/`. The bundle README documents the optional `icons` manifest map and the `.svg` (theme-tinted) vs `.webp` (full-color) override modes.
- The scaffolded Storybook stories now include the `Icons` reference story from `@quilltap/theme-storybook`.

## [2.0.10] - 2026-06-04

### Added
- Component variable reference and bundle `styles.css` template now document the newly tokenized controls: `--qt-select-arrow` (full `url()` chevron), `--qt-checkbox-*`, and `--qt-radio-*`, plus the previously-omitted `--qt-input-bg/fg/placeholder/focus-ring`. Scaffolded themes now learn that checkboxes, radios, and the select chevron are overridable.

## [2.0.0] - 2026-03-06

### Changed

- Default output format is now `.qtap-theme` bundle (declarative directory with `theme.json`, `tokens.json`, `styles.css`, and `fonts/`)
- Legacy npm plugin format available via `--plugin` flag
- Bundle format requires no build tools, npm packages, or TypeScript

### Added

- Bundle directory templates (`theme.json.template`, `styles.css.template`, `README.md.template`)
- `--plugin` flag for legacy npm plugin scaffolding

## [1.0.4] - 2026-01-01

### Added

- Document avatar CSS variables (`--qt-avatar-name-fg`, `--qt-avatar-title-fg`) in styles.css template

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
