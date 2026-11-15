# Quilltap Theme Development Guide

A Quilltap theme is a **version 2 `.qtap-theme` bundle**: a directory, or a zip of one, holding a manifest, a tokens document, optional custom CSS, and optional fonts, icons and images. There is no build step, no npm package and no JavaScript. The app validates, scopes and compiles the bundle itself when it loads it.

Only version 2 bundles load. A version 1 bundle, or a theme shipped as an npm plugin, is refused: it is listed on the Appearance card with an uninstall button, refused at install before anything is written, and never registered.

Companion references, both generated from the source of truth:

- [THEME_TOKENS.md](./THEME_TOKENS.md) — every token, its type, its group and its light/dark defaults (from `lib/themes/registry/`).
- [THEME_HOOKS.md](./THEME_HOOKS.md) — every class and attribute a custom stylesheet may target (from `lib/themes/hooks/`).

## Quick start

```bash
npx create-quilltap-theme my-theme      # scaffold a bundle directory
quilltap themes validate ./my-theme     # the app's own validator
cd my-theme && zip -r ../my-theme.qtap-theme . && cd ..
quilltap themes install my-theme.qtap-theme
```

Or upload the `.qtap-theme` file in **Settings → Appearance → Install Theme**. `quilltap themes export <id>` packs an installed theme back into a bundle.

## Bundle layout

```
my-theme/
├── theme.json      # manifest (required)
├── tokens.json     # primitives, token overrides, choices (required; path set by tokensPath)
├── styles.css      # custom CSS (optional; path set by stylesPath)
├── fonts/          # font files and licence texts (optional)
├── icons/          # icon overrides (optional)
└── images/         # backgrounds, subsystem art, preview (optional)
```

Every path in a bundle uses letters, digits, `.`, `_`, `-` and `/` only, and stays inside the bundle: no absolute paths, no `..`, no symbolic links. Extraction refuses an archive that breaks any of these.

Both JSON files name their schema in `$schema`, which gives an editor completion and checking for every field, token name and choice:

| File | `$schema` |
|------|-----------|
| `theme.json` | `https://quilltap.ai/schemas/qtap-theme.schema.json` |
| `tokens.json` | `https://quilltap.ai/schemas/qtap-theme-tokens.schema.json` |

The schemas are generated from the engine's Zod documents (`npm run generate:theme-schemas`) and published from `public/schemas/`; the token schema lists every registry name.

## The manifest (`theme.json`)

```json
{
  "$schema": "https://quilltap.ai/schemas/qtap-theme.schema.json",
  "format": "qtap-theme",
  "formatVersion": 2,
  "id": "my-theme",
  "name": "My Theme",
  "description": "A short description",
  "version": "1.0.0",
  "author": { "name": "Your Name", "email": "you@example.com" },
  "license": "MIT",
  "supportsDarkMode": true,
  "tokensPath": "tokens.json",
  "stylesPath": "styles.css",
  "hooksVersion": 1
}
```

| Field | Notes |
|-------|-------|
| `format`, `formatVersion` | Always `"qtap-theme"` and `2`. |
| `id` | Lowercase letters, digits and hyphens, starting with a letter. It is the install directory name and the `data-theme` value. |
| `name`, `description`, `version` | Shown in the theme list. `version` is a string such as `"1.0.0"`. |
| `author` | A string, or `{ "name", "email"?, "url"? }`. Required. |
| `license` | An SPDX identifier (or expression) or `"proprietary"`. |
| `compatibility.quilltapVersion`, `tags` | Informational. |
| `supportsDarkMode` | Defaults to `true`. |
| `previewImage` | A bundle image shown on the Appearance card. |
| `tokensPath` | Defaults to `tokens.json`. |
| `stylesPath` | The custom stylesheet, if any. |
| `fonts`, `icons`, `subsystems` | See below. |
| `hooksVersion` | The hook catalogue version the custom CSS was written against. See [Hooks](#hooks-and-hooksversion). |

The manifest is strict: an unknown field is an error. There is no `extendsTheme`; every theme starts from the app's defaults. To start from an installed theme, copy its bundle.

## Tokens: three tiers

A theme speaks to three tiers of custom property:

1. **Primitives** (`--p-*`) — the theme's own named values: its palette, its radii, its shadows. Declared in `tokens.json`, private to the theme.
2. **Semantic tokens** (`--theme-*`) — what a colour or size *means* across the app: background, foreground, primary, border, ring, the font stacks, the radius scale.
3. **Component tokens** (`--qt-*`) — one component's knobs: a card's padding, a chat bubble's background, the scrollbar thumb.

Component tokens default to semantic tokens, and semantic tokens to the app's palette, so a theme that sets a handful of semantic tokens restyles everything; component tokens are for the cases where one surface should differ. [THEME_TOKENS.md](./THEME_TOKENS.md) lists every name with its type and defaults.

### The tokens document (`tokens.json`)

```json
{
  "$schema": "https://quilltap.ai/schemas/qtap-theme-tokens.schema.json",
  "choices": { "density": "comfortable" },
  "primitives": {
    "gold":  { "type": "color", "value": "#C19015", "dark": "#F4BE34" },
    "paper": { "type": "color", "value": "#FBF7EE", "dark": "#1B1814" },
    "ink":   { "type": "color", "value": "#2A241C", "dark": "#EDE6D8" }
  },
  "tokens": {
    "--theme-background": "var(--p-paper)",
    "--theme-foreground": "var(--p-ink)",
    "--theme-primary": "var(--p-gold)",
    "--theme-primary-foreground": { "value": "#ffffff", "dark": "#1B1814" },
    "--theme-font-serif": "\"Playfair Display\", Georgia, serif",
    "--theme-radius-md": "0.25rem",
    "--qt-card-padding": "1.25rem"
  }
}
```

- **A theme stores only what it changes.** Every token it leaves out keeps the app's default, so a theme picks up new tokens as the app adds them.
- **`primitives`** are kebab-case names, each with a `type` (`color`, `length`, `radius`, `shadow`, `font-family`, `font-weight`, `duration`, `easing`, `opacity`, `image`, `number` or `raw`), a `value` and an optional `dark`. Refer to one as `var(--p-<name>)`.
- **`tokens`** keys are registry names (`--theme-*`, `--qt-*`). A value is a string, or `{ "value", "dark"? }` to differ in dark mode. An unknown name is refused with the nearest registry name suggested.
- **`choices`** are named switches. `density` is `compact` (the default) or `comfortable`; the list of choices and their options is in [THEME_TOKENS.md](./THEME_TOKENS.md).

Values are plain CSS and may use `var()`, `color-mix()` and `calc()`. Literal values are checked against the token's type. A `var()` must name a primitive of the same document, a registry token or a Tailwind token (`--color-*`, `--radius-*`, `--font-*`), or carry a fallback (`var(--maybe, #fff)`). No value may contain `;`, `{`, `}`, `!` or `</`.

### Features the app owns

Some styling is the app's, switched on by the theme rather than written by it (`app/styles/qt-components/_base.css`):

- **Focus ring** — always on for a version 2 theme, coloured by `--theme-ring`. Don't restyle `:focus-visible` in custom CSS; set the token.
- **Page background** — setting `--qt-page-background-image` (for example `"url(images/paper.webp)"`) switches on the page background rules.
- **Scrollbar** — setting `--qt-scrollbar-thumb` switches on the WebKit scrollbar rules.

## Custom CSS (`styles.css`)

For what no token covers. Write it **without the theme id**: the app scopes every rule to `[data-theme="<id>"]` when it loads the theme.

```css
.qt-section-title {
  font-family: var(--theme-font-serif);
  letter-spacing: 0.02em;
}

.dark .qt-card-interactive:hover {
  border-color: var(--p-gold);
}

@keyframes shimmer { from { opacity: 0.6 } to { opacity: 1 } }
```

What the loader does and refuses:

- A leading `:root` or `html` becomes the scope prefix; `.dark` and `.light` attach to it, so `.dark .qt-card` means "this theme, in dark mode".
- `@keyframes` names are prefixed with the theme id, and `animation` references to them follow.
- `@media`, `@supports`, `@container` and `@layer` are kept. `@font-face`, `@import`, `@charset`, `@namespace` and every other at-rule are refused. Fonts go in the manifest.
- `url()` must be a path to an image in the bundle (rewritten to the theme's asset route) or a `data:image/…` URI. Remote, rooted and protocol-relative URLs are refused, in CSS and in tokens alike.

### Hooks and `hooksVersion`

Custom CSS should target **hooks**: the `qt-*` classes and data attributes the app sets on purpose and keeps stable. The catalogue, with what each hook marks and where it appears, is [THEME_HOOKS.md](./THEME_HOOKS.md).

The validator warns, with the file and line, about selectors that target something else: a bare element, a Tailwind or other non-`qt-*` class, a `qt-*` class that is not catalogued, a class-substring or inline-style attribute match, or an attribute the app does not set as a hook. These warnings don't block an install, but such rules break without notice when markup changes.

Set `hooksVersion` to the catalogue version you wrote against (currently `1`, `HOOK_CATALOGUE_VERSION` in `lib/themes/hooks/index.ts`; the scaffolder writes it). When a later catalogue removes a hook, a theme behind it is warned at load about each removed hook its CSS still uses, with the replacement where there is one.

## Fonts

Fonts are declared in the manifest; the app writes the `@font-face` rules.

```json
"fonts": [
  {
    "family": "Raleway",
    "src": "fonts/Raleway-Regular.woff2",
    "weight": "400",
    "style": "normal",
    "display": "swap",
    "license": "OFL-1.1",
    "licenseFile": "fonts/OFL.txt"
  }
]
```

| Property | Notes |
|----------|-------|
| `family` | The family name used in font stacks. |
| `src` | A bundle path ending `.woff2`, `.woff`, `.ttf` or `.otf`. WOFF2 is recommended. |
| `weight` | `"400"`, `"700"`, a range such as `"400 700"`, `"normal"` or `"bold"`. |
| `style` | `normal`, `italic` or `oblique`. |
| `display` | `auto`, `block`, `swap`, `fallback` or `optional`. |
| `license` | Required: an SPDX identifier (`"OFL-1.1"`) or `"proprietary"`. |
| `licenseFile` | The licence text in the bundle. Ship it when the licence asks for it, as OFL does. |

Then use the family in a font token, such as `"--theme-font-serif": "\"Raleway\", Georgia, serif"`.

## Icons

A theme may replace any of the app's built-in icons by mapping app icon names to bundle assets:

```json
"icons": {
  "brand":    "icons/brand.webp",
  "settings": "icons/settings.svg"
}
```

| Format | Mode | Behaviour |
|--------|------|-----------|
| `.svg` | Mask | Tinted with `currentColor`, so it follows hover, active and disabled colours. |
| `.webp` | Image | Drawn in its own colours; use it for artwork with a baked palette. |

Names must be app icon names (the list is [ICON_INVENTORY.md](./ICON_INVENTORY.md); the source of truth is `components/ui/icons/icon-registry.ts`); an unknown name or another file type is an error. Author `.svg` overrides at 24×24; for `.webp`, 48×48 or larger.

**The `thinking` icon is animated.** It is the quill that rocks while a reply is awaited, while tokens stream and while a tool call runs, and it is a separate name from `brand` so that replacing the brand mark doesn't set it rocking in the Salon. The motion is its own hook, `.qt-thinking-indicator`, which custom CSS can retune:

```css
.qt-thinking-indicator {
  --qt-thinking-duration: 2s;
  --qt-thinking-angle-rest: -20deg;
  --qt-thinking-angle-lean: 0deg;
}
```

Re-declaring `animation` on that class replaces the rock outright; honour `prefers-reduced-motion` in any replacement, as the default does.

If you replace the glyph, check `--qt-thinking-origin`. The default, `12.5% 87.5%`, is the nib of the default glyph ((3,21) of its 24×24 viewBox), so the quill pivots on the point touching the page. A glyph whose nib sits elsewhere needs its own origin, or the icon wheels around empty space. The default glyph is drawn on the diagonal, nib to the lower left, which is why the rest angle is the negative one; an upright glyph wants both angles adjusted. The quill's tip paints slightly outside its box at the upright extreme, so don't put the indicator in an `overflow: hidden` container.

## Subsystems

A theme may rename, re-describe or re-illustrate the app's personified subsystems (the Foundry hub cards and subsystem pages):

```json
"subsystems": {
  "lantern": { "name": "Image Generation", "thumbnail": "images/lantern.webp" },
  "foundry": { "name": "Settings", "backgroundImage": "none" }
}
```

Keys are subsystem ids: `foundry`, `aurora`, `forge`, `salon`, `commonplace-book`, `prospero`, `concierge`, `calliope`, `lantern`, `pascal`, `saquel`, `brahma`, `scriptorium` (`lib/foundry/subsystem-defaults.ts`). Each entry may set `name`, `description`, `thumbnail` and `backgroundImage`; an image is a bundle path or `"none"`. The hub cards are hooks (`.qt-foundry-card`, `.qt-foundry-card-image`, `.qt-foundry-card-content`) for custom CSS.

## Validating

```bash
quilltap themes validate ./my-theme            # a bundle directory
quilltap themes validate my-theme.qtap-theme   # or a packed bundle
```

The CLI carries the app's own engine (`packages/quilltap/lib/theme-engine.generated.js`, built from `lib/themes/` by `npm run build:cli-theme-engine`), so it reports exactly what an install would refuse, and the same warnings: unknown tokens with suggestions, values of the wrong type, unresolved `var()`s in tokens, refused at-rules and URLs, selectors that miss the hook catalogue, removed hooks, missing font licences, unknown icon and subsystem names. A clean run has no errors and no warnings. All the bundled themes in `themes/bundled/` validate cleanly and are good worked examples.

## How a theme is loaded (for app developers)

- `lib/themes/engine/` is pure (Zod and PostCSS): `document.ts` (the two documents), `validate.ts`, `scope.ts` (custom CSS scoping and refusals), `urls.ts`, `compile.ts` (the CSS the client injects, including the app-owned feature switches) and `resolve.ts`.
- `lib/themes/theme-bundle.ts` reads a bundle's files for the engine; `lib/themes/bundle-archive.ts` validates, extracts and packs archives for both the app and the CLI, under the app's path rules.
- `lib/themes/theme-registry.ts` holds loaded themes and the refused list (`lib/themes/refused.ts`).
- The token registry (`lib/themes/registry/`) generates `app/styles/_theme-defaults.css`, `app/styles/qt-components/_variables.css` (`npm run generate:theme-variables`) and [THEME_TOKENS.md](./THEME_TOKENS.md) (`npm run generate:theme-tokens-doc`); the hook catalogue generates [THEME_HOOKS.md](./THEME_HOOKS.md) (`npm run generate:theme-hooks-doc`). `npm run lint` fails while any generated file is stale.
