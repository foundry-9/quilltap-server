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

Or design one in **Calliope's Atelier** (**Settings → Appearance → Design a theme**, `/calliope`): see [Drafts and the Atelier](#drafts-and-the-atelier).

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
- **Keyword tokens** accept only the words in their `options` (text transform, link decoration, colour scheme, scrollbar width, background attachment and repeat), listed per token in [THEME_TOKENS.md](./THEME_TOKENS.md); validation refuses any other value, `var()` references aside.
- **`choices`** are named switches. `density` is `compact` (the default) or `comfortable`; the list of choices and their options is in [THEME_TOKENS.md](./THEME_TOKENS.md).

Values are plain CSS and may use `var()`, `color-mix()` and `calc()`. Literal values are checked against the token's type. A `var()` must name a primitive of the same document, a registry token or a Tailwind token (`--color-*`, `--radius-*`, `--font-*`), or carry a fallback (`var(--maybe, #fff)`). No value may contain `;`, `{`, `}`, `!` or `</`.

### Features the app owns

Some styling is the app's, switched on by the theme rather than written by it (`app/styles/qt-components/_base.css`):

- **Focus ring** — always on for a version 2 theme, coloured by `--theme-ring`. Don't restyle `:focus-visible` in custom CSS; set the token.
- **Page background** — setting `--qt-page-background-image` (for example `"url(images/paper.webp)"`) switches on the page background rules.
- **Scrollbar** — setting `--qt-scrollbar-thumb` switches on the WebKit scrollbar rules.

## Custom CSS (`styles.css`)

For what no token covers. Write it **without the theme id**: the app scopes every rule to the element that wears your theme (`[data-theme="<id>"]`, normally `<html>`) when it loads the theme.

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

- Every rule is placed in `@scope ([data-theme="<id>"]) to ([data-theme]:not([data-theme="<id>"]))`, with `:scope` standing for the themed element. The rule reaches everything below that element **except** what sits inside a nested element wearing another theme: the Atelier's editing panel, which keeps the house default while the rest of Quilltap previews your draft, and the theme preview cards on the Appearance card. Icon overrides are scoped the same way. `:scope` counts as one pseudo-class, exactly as the `[data-theme]` attribute did, so specificity is what it would be with the id written out.
- A leading `:root` or `html` becomes `:scope` itself; `.dark` and `.light` attach to it, so `.dark .qt-card` means "this theme, in dark mode".
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
| `src` | A bundle path ending `.woff2`, `.woff`, `.ttf` or `.otf`. WOFF2 is recommended; a theme installed from the Atelier carries `.ttf` and `.otf` as WOFF2 (see [Drafts and the Atelier](#drafts-and-the-atelier)). |
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

## Drafts and the Atelier

Calliope's Atelier is the in-app theme editor. What it edits is a **draft**: the folder `Themes/<id>/` in the Quilltap General document store, holding an unpacked version 2 bundle (the same files as above) and nothing else — no side file, no database row.

- **Creating.** A draft starts blank (an empty `tokens.json`: the default theme), as a copy of every file of an installed or bundled theme, under a new id derived from the draft's name, at version `0.1.0`, or from a `.qtap-theme` file (**Open a theme file** on the draft list). A copy keeps no link to its source.
- **Importing.** An opened `.qtap-theme` is untrusted: it is validated and extracted by `bundle-archive.ts` under every check an install runs, into a temporary directory that is always removed, before anything is written. A version 1 bundle is refused with the earlier-theme message. The draft keeps the bundle's name and version and takes its id, or the next free one (`rains-2`) — an import never replaces a draft or an installed theme. Images and fonts arrive as the bundle carries them (an installed bundle's are already WebP and WOFF2).
- **Editing.** The Atelier edits every token of visibility `standard` or `advanced` (666; the 38 `internal` ones are never shown), each with a control for its type and an edit-as-text form, in both modes; the primitives (add, rename with references rewritten, retype, dark value, remove with the value written into its users); the `density` choice; name and description; and, as named server operations rather than a client-built manifest, the fonts (with licence and licence file), images, icon overrides, subsystems, preview image, author, licence, tags and `supportsDarkMode`. A value a control's parser does not read (a gradient, a data URI, `calc()`, `clamp()`, a `var()` with a fallback) is shown as text and never rewritten. Any other file — a README, say — is edited in the files, through the Scriptorium, Document Mode or a character's `doc_*` tools. A draft is judged by the same loader as an installed bundle, so the Atelier shows exactly the errors and warnings an install would. A file that does not parse is an issue on the draft; the draft still lists and opens. Saves carry the revision (content hash of `tokens.json`) they were read at, and a stale one is refused rather than overwritten; every manifest or file operation carries the manifest's revision (content hash of `theme.json`) the same way.
- **Custom CSS.** The Custom CSS section creates the stylesheet (`set-styles-file`: an empty `styles.css`, named in the manifest), edits it in the shared code editor (`components/code-editor/`, JSON and CSS highlighting, the file's bytes kept exactly), and removes it (`clear-styles-file`, which unnames it first and deletes the file unless told not to). The text is saved whole after a pause in typing, like `tokens.json`: its own content-hash revision (`stylesRevision`), a stale one refused and the draft reloaded. Scoping stays on the server (PostCSS never reaches the browser), so the preview takes the scoped CSS as each save returns; while the stylesheet has errors the preview keeps the last good compile, the errors are marked on their lines (issues carry `file` and `line`) and install waits. Beside the editor a reference panel lists the hook catalogue with every variant and state selector, the registry tokens and the draft's primitives with their values in force, and the draft's images; choosing one inserts the selector, `var(--name)` or `url('path')` at the caret. Undo in the editor is the text's own; the token undo does not cover CSS. Document Mode shows a draft's `styles.css` view-only, and a character's `doc_*` tools cannot write it: Quilltap General is a database store, and those hold only Markdown, text, JSON and JSONL as editable text.
- **Previewing.** While a draft is open, the whole app wears it in place of the chosen theme, compiled in the browser from the unsaved tokens; the Atelier's own panel wears the house default (see the `@scope` boundary under [Custom CSS](#custom-css-stylescss)). A draft's images and fonts are served by the asset and font routes at the draft's exact version, uncached.
- **Folders.** The Atelier stores what it is given under fixed folders — `fonts/` (fonts and their licence files, `.txt` or `.md`), `images/` and `icons/` (`.svg` or `.webp`, named after the icon) — under a name the server builds from the upload's, made safe for a bundle path, with `-2`, `-3`… on a collision. It never asks for a path. A font or raster image whose extension disagrees with its leading bytes is refused, and every upload is held to the bundle's limits (per file, file count, total) when it arrives. Files placed by hand elsewhere in the folder are read and packed like any others.
- **What uses what.** `bundleFileUsage` (`lib/themes/engine/usage.ts`) lists, for every bundle path, the things that refer to it: a font entry, a licence file, an icon override, a subsystem picture, the preview image, the tokens and styles files, a token or primitive value, a `url()` in the custom CSS. A font, image or licence file with no user is **unused**; removing a file that has users is refused with the list.
- **Fonts.** A draft keeps its font files as uploaded. On upload the server reads the family, weight (a range for a variable font), style, embedding permission and the font's own licence text (`lib/themes/font-info.ts`) and offers them as a starting point; a file it cannot parse is still accepted when its leading bytes are a font's, with fields guessed from its name. On install every `.ttf` and `.otf` a font entry names becomes `.woff2` (`lib/themes/convert-fonts.ts`) and the entry's `src` is rewritten; a `.woff` is packed as it is.
- **Images.** A draft keeps its originals byte for byte (blob normalisation skips `Themes/`). On install, PNG, JPEG and GIF become WebP (quality 85), lossless WebP is re-encoded, SVG and animated images are left alone, and every reference — manifest, tokens, custom CSS — is rewritten to the new name. Draft files are not chunked or embedded.
- **Installing.** Install refuses a draft with validation errors, and a draft whose id is a bundled theme's. Otherwise the draft is packed, unused font and image files are left out (other files, such as a README, are packed as they are), fonts and images are converted as above, and the result goes through the ordinary bundle install, every check included, replacing an earlier install of the same id; it is registered without a restart. Afterwards the draft's patch version is bumped, so the installed theme and the draft never share asset URLs. Deleting a draft leaves its installed theme in place.
- **Export and backup.** Drafts are left out of `.qtap` exports (`docStoreExportExclusion`, `lib/export/excluded-files.ts`: the `Themes` folder of General and everything under it); a finished theme travels as a `.qtap-theme`. Backups carry drafts like any other document.

## Validating

```bash
quilltap themes validate ./my-theme            # a bundle directory
quilltap themes validate my-theme.qtap-theme   # or a packed bundle
```

The CLI carries the app's own engine (`packages/quilltap/lib/theme-engine.generated.js`, built from `lib/themes/` by `npm run build:cli-theme-engine`), so it reports exactly what an install would refuse, and the same warnings: unknown tokens with suggestions, values of the wrong type, unresolved `var()`s in tokens, refused at-rules and URLs, selectors that miss the hook catalogue, removed hooks, missing font licences, unknown icon and subsystem names. A clean run has no errors and no warnings. All the bundled themes in `themes/bundled/` validate cleanly and are good worked examples.

### Contrast

Every theme is measured against the registry's contrast pairs (`lib/themes/registry/contrast.ts`): a foreground token, the background it is drawn on, and a kind — `text` must reach 4.5:1 and `non-text` (focus rings) 3:1, WCAG 2.2 AA, in light and in dark. A translucent foreground is composited over its background, a translucent background over the page. A value that is not one colour the engine can evaluate (a gradient, an image, an unsupported colour function) is reported as unchecked, never as a pass.

A failure is a **warning**: a theme that fails a pair still loads, saves and installs. `quilltap themes validate` prints the failures, the Atelier shows each token's pairs beside it, and `npm run lint` runs `scripts/check-theme-contrast.ts --check` against the default theme and the bundled themes, which must pass every pair except those on `themes/bundled/contrast-exceptions.json` (empty, and kept that way). `--all` prints every pair.

## How a theme is loaded (for app developers)

- `lib/themes/engine/` is pure (Zod and PostCSS): `document.ts` (the two documents), `validate.ts`, `scope.ts` (custom CSS scoping and refusals), `urls.ts`, `compile.ts` (the CSS the client injects, including the app-owned feature switches) and `resolve.ts`.
- `lib/themes/theme-bundle.ts` reads a bundle's files for the engine; `lib/themes/bundle-archive.ts` validates, extracts and packs archives for both the app and the CLI, under the app's path rules.
- `lib/themes/theme-registry.ts` holds loaded themes and the refused list (`lib/themes/refused.ts`).
- `lib/themes/engine/client.ts` is the engine's browser entry: resolve, compile tokens, contrast and colour parsing, with no Node built-ins, no PostCSS and no logger. Client code imports the engine only through it; a test walks its imports. Scoping custom CSS (PostCSS) stays on the server, which is why a draft arrives with its non-token parts already compiled.
- The theme provider's **preview slot** (`setPreview`, `components/providers/theme/`) is the one way a preview reaches the DOM: a theme shown in place of the worn one, leaving the worn theme and the stored preference untouched. The Atelier is its caller; nothing injects theme CSS beside it.
- `lib/themes/drafts/` is the only code that knows a draft is `Themes/<id>/` in Quilltap General. Text files are written through the document core (`writeDocument`), others through `storeMountFile`; a whole draft is deleted with the folder. `lib/themes/hot-load.ts` registers an installed bundle without a restart; `lib/themes/convert-images.ts` and `lib/themes/convert-fonts.ts` are the install-time WebP and WOFF2 passes; manifest and file edits are the named operations in `lib/themes/drafts/operations.ts`, uploads go through `lib/themes/drafts/uploads.ts`, and `bundleFileUsage` is the one source for what is used. Routes: [API.md, Theme Drafts](./API.md#theme-drafts).
- The token registry (`lib/themes/registry/`) generates `app/styles/_theme-defaults.css`, `app/styles/qt-components/_variables.css` (`npm run generate:theme-variables`) and [THEME_TOKENS.md](./THEME_TOKENS.md) (`npm run generate:theme-tokens-doc`); the hook catalogue generates [THEME_HOOKS.md](./THEME_HOOKS.md) (`npm run generate:theme-hooks-doc`). `npm run lint` fails while any generated file is stale.
