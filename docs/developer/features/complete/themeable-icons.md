# Implementation plan: centralized, theme-replaceable icons

**For:** Claude Code, in the `quilltap-server` repo.
**Goal (from Charlie):** Move all the app's icons into one place (`public/images/icons/`), give each a stable name, and let a `.qtap-theme` bundle override any of them. If a theme declares no replacement for an icon, the default is used. Defaults stay SVG; theme replacements may be SVG **or** bitmap — **WebP recommended** (matching the repo convention), **SVG allowed** when the author wants `currentColor` behavior.

This is a design + refactor task. The design questions have been settled with Charlie (see "Decisions" immediately below); implement the phases as written. Everything here was checked against the current code; file paths and line numbers are real as of this writing but **re-verify before editing** — the repo moves.

---

## 0. Decisions (settled with Charlie — do NOT re-litigate)

1. **`<Icon>` internals = Option A** (CSS `mask-image`/`background-image` driven by per-icon CSS variables, injected by the theme-style-injector). Default monochrome SVGs keep `currentColor`; bitmap overrides render as full-color `background-image`. See §2 Option A and §4.
2. **`quill.svg` stays in place** at `/public/quill.svg` for now — do NOT relocate it. Still **register it as an overridable named icon** (`brand`) so themes can replace it; its default keeps rendering as the existing full-color `<Image>`, default mode `image` (not `mask`).
3. **Override format policy = SVG or WebP, WebP recommended.** Validator allows both extensions; docs steer authors to WebP for baked color/texture, SVG when they want theme-color inheritance.
4. **Migrate ALL ~127 icon-bearing files now** — not a scoped subset. Expect to **rename** some icons to fit the canonical kebab-case list, and **consolidate** duplicates (multiple local `close`/`check`/`chevron` defs collapse to one canonical icon). Treat dedupe as an explicit goal, not a side effect.

---

## 1. What exists today (grounding)

- **Icons are scattered.** There is a tiny shared module `components/ui/icons/index.tsx` (59 lines) exporting only 5 icons: `CloseIcon`, `PencilIcon`, `RefreshIcon`, `CheckIcon`, `ChatIcon`. Plus `components/ui/ChevronIcon.tsx`. Everything else is **local inline-`<svg>` function components** defined in the file that uses them. ~127 component files under `components/` contain a `<svg>`. The left sidebar alone defines `ProsperoIcon`, `FileIcon`, `CharacterIcon`, `ScriptoriumIcon`, `PhotosIcon`, `ScenariosNavIcon` (in `components/layout/left-sidebar/collapsed-nav.tsx`), `FoundryIcon`, `PaletteIcon`, `WardrobeIcon`, `HelpIcon` (in `sidebar-footer.tsx`), `ProfileIcon`, `InfoIcon`, `ChevronUpIcon` (in `profile-menu.tsx`), plus imported `QuickHideIcon` and `ChatIcon`.
- **All inline icons use `stroke="currentColor"`** — they inherit the theme's foreground color automatically today. **This is the central design tension** (see §3): a bitmap can't inherit `currentColor`. The plan must preserve color-inheritance for the default SVGs while accepting that bitmap overrides are pre-colored.
- **`public/quill.svg`** is the one real image (the colorful feather), referenced via Next `<Image src="/quill.svg">` in `sidebar-header.tsx` and `collapsed-nav.tsx`. Its colors are baked in (not `currentColor`).
- **Theme bundle manifest** = `QtapThemeManifestSchema` in `lib/themes/types.ts:320`. Fonts are declared as `fonts: z.array(FontDefinitionSchema).optional()` (`types.ts:359`); `FontDefinitionSchema` (`types.ts:239`) = `{ family, src, weight?, style?, display? }` where `src` is a bundle-relative path like `fonts/Lora-Regular.woff2`.
- **Theme asset serving already supports what we need.** `app/api/themes/assets/[...path]/route.ts` serves arbitrary bundle files by URL `/api/themes/assets/bundle:<themeId>/<relativePath>`, already allows `.svg` AND `.webp` (`ALLOWED_EXTENSIONS`, route.ts:38), validates extension, and blocks path traversal. **No new serving route is needed for icons** — this is the big simplifier.
- **Bundle install copies the whole zip** (`extractZipToDir`, `bundle-loader.ts:464`); `ALLOWED_EXTENSIONS` there (`bundle-loader.ts:38`) already permits `.svg`/`.webp`. So icons placed in a bundle's `icons/` dir are copied and served with **zero loader changes** beyond manifest parsing.
- **Runtime CSS injection point** = `components/providers/theme-style-injector.tsx`. It builds `@font-face` CSS from `fonts` and injects one `<style id="quilltap-theme-variables">`. This is where we also inject icon-override CSS variables (see §4, Option A).
- **Validator** (bundle CLI): `packages/quilltap/lib/theme-validation.js:111` validates the `fonts` array shape. An `icons` field needs a parallel block here.

---

## 2. Decide the rendering strategy FIRST (ask Charlie if unsure)

Two viable designs. **Recommendation: Option A (CSS `mask` + background-image), because it keeps `currentColor` behavior for default SVGs AND supports bitmap overrides, with the theme override happening purely in CSS the existing injector already controls.**

### Option A — `<Icon name="...">` renders a `<span>` styled by a per-icon CSS variable (RECOMMENDED)
- A single `components/ui/icon.tsx` exports `<Icon name="prospero" className="w-5 h-5" />`.
- Internally it renders a `<span role="img" aria-label data-icon="prospero">` whose CSS resolves an icon via a variable, e.g. `--qt-icon-prospero`.
- **Default (no theme override):** the variable points at the bundled default — render the SVG as a CSS `mask-image` so `background: currentColor` shows through. This preserves today's "icon takes theme foreground color" behavior for the default set.
- **Theme override present:** the theme sets `--qt-icon-prospero: url(/api/themes/assets/bundle:madmans-box/icons/prospero.webp)` and a companion flag so the icon renders as a normal `background-image` (full-color bitmap, NOT masked). A second variable like `--qt-icon-prospero-mode: image|mask` selects behavior, or use two variables (`--qt-icon-prospero-mask` vs `--qt-icon-prospero-img`) and let `:where()` pick.
- The theme-style-injector emits, per declared icon override, the variable assignments into the same `<style>` it already manages.
- **Pro:** one render path; default SVGs keep `currentColor`; bitmaps "just work"; override is data-driven CSS. **Con:** masking loses multi-color in the *default* SVGs (they're already monochrome, so fine), and per-icon CSS vars need generating.

### Option B — `<Icon>` swaps the React component vs an `<img>` at render time
- `<Icon name>` reads the active theme's icon manifest from the theme provider; if an override exists, render `<img src={assetUrl}>`, else render the default inline SVG component from a registry map.
- **Pro:** conceptually simple; full-color SVG defaults possible. **Con:** couples icon rendering to the theme React context (SSR/hydration care needed — see §3); default icons lose nothing but the override path is JS-driven, not CSS, so it won't update as cleanly on live theme switch; more re-render surface.

**Either way**, step 1 of implementation is the same: build the central registry + `<Icon>` API and migrate call sites. The override mechanism (A vs B) only changes the internals of `<Icon>` and the injector.

---

## 3. Constraints / gotchas to honor

- **`currentColor` vs bitmaps.** Default SVGs are monochrome and theme-colored via `currentColor`. A WebP override is pre-baked color and will NOT respond to theme foreground or hover/active recoloring. Document this clearly: *theme bitmap icons own their own color.* For Madman's Box specifically, that's fine/desirable (brass icons). Provide guidance that theme authors can also ship **SVG** overrides (the asset route serves svg) if they want `currentColor` behavior — so the override format is "SVG or WebP," with WebP recommended only when the author wants baked color/texture.
- **Sizing.** Icons render at `w-5 h-5` (20px), `w-7 h-7` (the quill, 28px), etc. Bitmap overrides must be authored at 2x (40px/56px) for retina. Specify a standard box (e.g. 24px logical, ship 48px WebP) in the docs and the storybook.
- **SSR / hydration (Option B).** The active theme's overrides must be known at first paint or icons will flip after hydration. Option A avoids this because the CSS variable is injected in the same `<style>` block that already loads with the theme. Prefer A for this reason.
- **The `quill.svg` brand mark** is special (full-color, via `<Image>`, used as Home + header). Treat it as a named icon too (`brand`/`quill`) so themes can override the feather, but keep its default rendering as the existing colorful image, not a masked monochrome. This is the one default that should default to `mode: image`, not `mask`.
- **Don't break `currentColor` semantics** anywhere a migrated icon previously relied on it (hover states, active nav `color`, disabled opacity). Audit each migrated call site.
- **Performance / bundle size.** Theme bundles cap at 50MB. WebP icons are tiny; no concern. But don't force-load all icon SVGs as separate network requests — inline the default SVG set in the JS bundle (they already are), and only the *overrides* come over `/api/themes/assets`.
- **API structure.** No new route needed (assets route handles it). Do NOT add routes outside `/api/v1/` except this existing `/api/themes/*` asset route which is already exempt per CLAUDE.md.

---

## 4. Proposed implementation phases

### Phase 0 — Naming + inventory (no behavior change)
1. Grep every inline `<svg>` icon component across `components/` and catalog them: name, file, current size, whether it uses `currentColor`, and a proposed stable kebab-case icon name. Produce `docs/developer/ICON_INVENTORY.md` (working doc). Expect duplicates (multiple "close"/"chevron"/"check" definitions) — dedupe to a canonical set.
2. Decide the canonical icon-name list (e.g. `prospero`, `files`, `scriptorium`, `characters`, `photos`, `scenarios`, `chats`, `settings`, `themes`, `wardrobe`, `help`, `profile`, `quick-hide`, `brand`, plus the shared `close`/`pencil`/`refresh`/`check`/`chat`/`chevron-up`/`chevron-down`/`info` …). This list IS the public contract themes target — name it carefully; renaming later breaks theme overrides.

### Phase 1 — Central default icon set + `<Icon>` component
3. Create `public/images/icons/` and move/author each **default** icon as an optimized SVG named `<icon-name>.svg` (monochrome, `stroke="currentColor"`/`fill="currentColor"`, consistent 24×24 viewBox). **`quill.svg` stays where it is** (`/public/quill.svg`, full-color) per §0 — do NOT move or copy it. Register it in the icon registry under the name `brand` with default `mode: image` (renders the existing colorful `<Image>`, not a mask). The two existing `<Image src="/quill.svg">` call sites (`sidebar-header.tsx`, `collapsed-nav.tsx`) can either keep using `<Image>` directly or route through `<Icon name="brand">` — prefer routing through `<Icon>` so a theme can override the feather, but keep the default visual identical.
4. Build `components/ui/icon.tsx`: `<Icon name className size>` plus a typed `IconName` union generated from the canonical list. Internally implement the chosen Option (A recommended). Provide an `iconRegistry` mapping name → default inline SVG (for the mask/default path) so defaults stay in-bundle (no network request).
5. Keep `components/ui/icons/index.tsx` exports as thin re-exports/aliases during migration so nothing breaks mid-refactor; mark deprecated.

### Phase 2 — Migrate ALL call sites (full scope, ~127 files)
6. Replace **every** local inline-SVG icon component with `<Icon name="…">`, app-wide — not a subset. Work in reviewable batches by area (sidebar → dashboard → settings → chat → aurora/prospero → misc) so each PR/commit is digestible, but the end state is that no feature component defines its own inline icon SVG anymore (the only inline SVGs left should be genuinely non-icon graphics — charts, decorative illustrations, the brand mark). After each batch run `npx tsc` and a visual check. Preserve every call site's size classes and `aria-label`/`title`.
7. **Consolidate as you go.** When a batch reveals a duplicate of an already-canonical icon, point it at the existing canonical name rather than minting a new one; record the old→new mapping in `ICON_INVENTORY.md`. Apply the rename/consolidate guidance in §7.
8. Delete each now-orphaned local icon function component as it's migrated. Leave no dead code (CLAUDE.md: no stubs/TODO left behind). At the end, grep `components/` for `<svg` again and confirm the only remaining hits are intentional non-icon graphics — list them in the inventory so the "all icons centralized" claim is verifiable.

### Phase 3 — Manifest schema: the `icons` field
9. In `lib/themes/types.ts`, add an optional `icons` field to `QtapThemeManifestSchema` (after `fonts`, ~line 359). Proposed shape — a map of icon-name → bundle-relative path:
   ```ts
   icons: z.record(
     z.string().regex(/^[a-z][a-z0-9-]*$/),   // must be a known icon name
     z.string().min(1),                        // bundle-relative path, e.g. "icons/prospero.webp"
   ).optional().describe('Per-icon overrides: icon name -> bundle-relative asset path (svg or webp)'),
   ```
   (A record keeps it terse for theme authors: `"icons": { "prospero": "icons/prospero.webp", "chats": "icons/chats.webp" }`.) Add a matching `IconOverridesSchema` if you prefer a named schema. Also add to the non-bundle `ThemeManifestSchema` (~line 265) only if plugin themes should support it too — probably yes for parity.
9. Update `public/schemas/qtap-theme.schema.json` to document the new `icons` property (mirror how `fonts` appears there).
10. Update the bundle validator `packages/quilltap/lib/theme-validation.js` (~line 111, after the fonts block): validate `icons` is an object, keys match the icon-name regex AND are in the known-icon list (import/duplicate the canonical list — or at least validate the regex + that values are non-empty strings ending in an allowed ext). Emit a **warning** (not error) for unknown icon names so future-named icons don't hard-fail older validators.

### Phase 4 — Wire overrides to the runtime
11. In `lib/themes/theme-registry.ts`, where it reads `manifest.fonts` and resolves font URLs to `/api/themes/fonts/<pluginName>/<src>` (see registry ~line 673 and the URL build ~line 932), add a parallel pass that reads `manifest.icons` and resolves each to an asset URL `/api/themes/assets/<pluginName>/<src>` (pluginName is `bundle:<themeId>` for bundles). Carry an `icons: Record<IconName, {url, format}>` onto the loaded theme object (extend the theme type in `theme-registry.ts:80`-ish and `components/providers/theme/types.ts`).
12. In `components/providers/theme-style-injector.tsx`, alongside `fontFacesCss`, generate per-override CSS variable assignments (Option A): for each overridden icon emit `--qt-icon-<name>: url("<assetUrl>"); --qt-icon-<name>-mode: image;` (webp) or `mask` (svg-with-currentColor). Append into the same injected `<style>`. The default `<Icon>` CSS (shipped in global CSS or the component) reads `var(--qt-icon-<name>, <default>)`.
13. Confirm live theme-switching updates icons without reload (the injector re-runs on theme change; Option A means just swapping the `<style>` content).

### Phase 5 — Author tooling + the bundled themes
14. `packages/create-quilltap-theme`: add an `icons/` folder to `templates/bundle/`, document the optional `icons` manifest field in the template README, and (optional) scaffold a commented-out example. **Bump the package version and pause for Charlie to `npm publish`** (CLAUDE.md: packages changes require publish-then-install; do NOT copy down manually).
15. `packages/theme-storybook`: add a story/preview that renders the full icon set so theme authors can eyeball overrides. Bump + publish per the same rule.
16. (Optional, separate follow-up) Give **Madman's Box** a set of brass/walnut WebP icon overrides in `themes/bundled/madmans-box/icons/` + `"icons": {…}` in its `theme.json`. This is the proof-of-concept and can be its own commit. WebP authored at 2x per §3, converted with `cwebp -q 82 -m 6 -mt in.png -o out.webp` (CLAUDE.md avatar convention) — delete intermediate PNGs.

### Phase 6 — Docs, tests, changelog
17. Help docs (CLAUDE.md requires user-visible changes documented in `help/*.md`): document theme icon overrides in the appropriate themes/appearance help doc, in the steampunk voice, with correct `url:` frontmatter and matching `help_navigate(...)`.
18. Developer docs: `components/settings/appearance/README.md`, `docs/developer/` theme docs, and the `.claude/commands/update-documentation.md` registry. Document the icon-name contract + override format.
19. Tests: add the new `icons` manifest to the tool/theme snapshot tests if applicable; a unit test that the registry resolves icon override URLs; a validator test for good/bad `icons` blocks. Add the canonical icon-name list as the source of truth for both the validator and the `IconName` type (single source — don't duplicate).
20. `docs/CHANGELOG.md`: terse plain-English entry (changelog is the exception to the steampunk voice). Note schema addition.

---

## 5. Schema / migration / export checklist (per CLAUDE.md)

- **qtap-export / SillyTavern export:** icons are theme-manifest-only; not part of character/chat export. No change expected — but confirm `public/schemas/qtap-export.schema.json` doesn't enumerate theme manifests (it shouldn't).
- **`public/schemas/qtap-theme.schema.json`:** YES — update (Phase 3 step 9).
- **DDL.md / migrations:** none — no DB schema touches. Themes are filesystem bundles.
- **`next.config.js`:** no native-module change.
- **Backups:** unaffected.

---

## 6. Suggested commit slicing

1. `feat(icons): central <Icon> component + default SVG set in public/images/icons` (Phases 0–1, no call-site changes yet beyond the new component).
2. `refactor(icons): migrate call sites to <Icon>` — possibly split into sidebar / rest (Phase 2).
3. `feat(themes): optional per-icon overrides in .qtap-theme manifest` (Phases 3–4 + validator + schema + docs + tests).
4. `chore(create-quilltap-theme,theme-storybook): icon-override scaffolding` (Phase 5, **needs npm publish pause**).
5. `feat(theme): Madman's Box brass icon overrides` (Phase 5 step 16, optional/separate).

Each commit goes through the normal `/commit` flow (lint, `npx tsc`, tests, changelog enforcement).

---

## 7. Settled decisions (see §0) + the one thing still to confirm

All the prior open questions are resolved in **§0**: Option A, `quill.svg` stays put but is registered as `brand`, SVG-or-WebP overrides (WebP recommended), and a full 127-file migration with deliberate rename/consolidate.

The **one** thing still worth a human checkpoint — but NOT a blocker for starting:

- **The canonical icon-name list is the permanent public contract** theme authors target. Don't finalize it from a code grep alone. Produce the Phase-0 `ICON_INVENTORY.md` first, propose the deduped canonical name list in that doc, and get Charlie's eyes on it **before** Phase 2 mass-migration locks the names in. Renaming an icon after themes ship overrides for it is a breaking change. Until confirmed, proceed through Phase 1 (the inventory + the `<Icon>` component + default set can all be built; only the *final names* need sign-off before the big migrate).

### Rename / consolidate guidance (Charlie explicitly wants this)
- **Consolidate duplicates ruthlessly.** Expect several near-identical `close`/`x`, `check`, `chevron-up`/`chevron-down`, `chevron-left`/`right`, `info`, `plus`, `trash`, `pencil`/`edit` definitions across the ~127 files. Each collapses to ONE canonical icon. Record every old→new mapping in `ICON_INVENTORY.md` so the migration is auditable and reversible.
- **Rename for clarity + the theme contract.** Prefer plain, function-or-noun kebab-case names that a theme author would recognize (`settings`, `chats`, `characters`, `files`, `help`, `profile`, `wardrobe`, `themes`, `quick-hide`, `brand`, `close`, `check`, `chevron-down`, …). Where a local name encodes a Quilltap feature (`FoundryIcon` → `/settings`, `ProsperoIcon` → projects), pick the name that will still make sense to an outside theme author — lean toward the **function** (`settings`, `projects`) over the internal codename, but note the codename in the inventory.
- **Visual-equivalence check when consolidating:** before merging two near-duplicate SVGs into one canonical glyph, eyeball them — if they're meaningfully different drawings used in different contexts, keep both under distinct names rather than forcing a merge.