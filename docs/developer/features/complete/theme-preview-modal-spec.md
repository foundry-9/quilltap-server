# Spec: Full-Page Theme Preview Modal (gallery + icon sheet)

**Audience:** Claude Code, working in `quilltap-server`.
**Goal:** Replace the inline "expanded card" theme preview in **Settings → Appearance → Theme** with a **full-page modal dialog**. The modal shows the existing live element preview, **plus** (a) a scrollable gallery of the theme's bundled images and (b) a sheet of the theme's bundled icons rendered in several states. Also fix the banner-header contrast problem.

## Locked decisions (do not deviate)

1. **Banner contrast — Option B (theme-tinted with computed contrast).** The banner header sits inside/over the theme's own colors, and we compute an accessible foreground (white/dark) from the theme's background using the luminance helpers already in `ThemeCard.tsx`. Lift those helpers into a shared util rather than duplicating.
2. **Image gallery source — manifest-referenced only.** Do **not** enumerate the bundle directory. The gallery is built strictly from `previewImage` + `subsystems[*].thumbnail` + `subsystems[*].backgroundImage`. No new filesystem walking.
3. **Icon states — four synthetic contexts:** default (`qt-text-primary`), muted/disabled (`qt-text-secondary` + reduced opacity), hover/active (`qt-text-primary` on a `qt-bg-muted` chip), and on-primary (`qt-button-primary` background). Name label beneath each, monospace, copyable.
4. **Ordering:** both gallery and icon sheet are **alphabetical by display name**, case-insensitive.

---

## Background: how the current system works (verified)

- The "preview" today is **not** a modal. It is the `isExpanded` branch of `components/settings/appearance/components/ThemeCard.tsx` (the `if (isExpanded) { ... }` block, ~lines 179–301). When expanded, the card grows to full width and renders a header (name/description/Apply/Active/close) followed by one or two `ThemePreviewPanel` columns (Light / Dark). That header, rendered over the theme's preview colors, is the orange banner in the screenshot; its text uses `qt-heading-4`/`qt-text-small`, which assume app surface colors → poor contrast on a vivid theme banner.
- Expand state lives in the parent `components/settings/appearance/ThemeSelector.tsx`: `const [expandedThemeId, setExpandedThemeId] = useState<string | null>(null)` (~line 39), toggled by `handleToggleExpand` (~line 45) and passed down as `isExpanded` / `onToggleExpand` to each `<ThemeCard>` (~lines 232–251).
- The live preview content (heading, buttons, input, badges, card) is `components/settings/appearance/components/ThemePreviewElements.tsx` rendered inside the theme-scoped CSS container by `components/settings/appearance/components/ThemePreviewPanel.tsx`. **Reuse both unchanged.**
- **Tokens API:** `GET /api/v1/themes/:themeId?action=tokens` → `handleGetTokens` in `app/api/v1/themes/[themeId]/route.ts` already returns `{ tokens, fonts, icons, cssOverrides, subsystems }` via `successResponse(...)`. Note `successResponse(data)` returns `data` at the top level (no `data:` envelope) — see `lib/api/responses.ts` line 63–68. The hook reads `data.tokens` etc. directly.
  - `icons` shape: `{ name: string; src: string }[]` where `src` is a versioned asset URL `/api/themes/assets/<pluginName>/<relpath>?v=<version>` (route.ts ~lines 64–68).
  - `subsystems` shape: `Record<string, { name?; description?; thumbnail?; backgroundImage? }>` (passed straight from `theme.subsystems`).
  - **Caution:** `subsystems[*].thumbnail` / `.backgroundImage` are **raw, unresolved relative paths** (e.g. `"textures/aurora-bg.webp"`). They are NOT asset URLs yet. They must be resolved to URLs (see below).
- **Asset URL resolution:** `lib/themes/theme-registry.ts` has a private helper `resolveThemeAssetUrl(value, pluginName)` (~lines 180–195) that already does exactly the right thing: passes through `data:`/`http(s)`/`/`-rooted/`none`, and maps relative → `/api/themes/assets/<pluginName>/<relpath>`. **Reuse this logic** (export it or add a registry method that uses it — see Task 1).
- `LoadedTheme` (registry) carries: `previewImage?` (relative path), `previewImagePath?` (absolute, for serving), `pluginName` (e.g. `"bundle:madmans-box"`), `subsystems?`, `bundlePath?`, `icons?`, `source` (`'default' | 'plugin' | 'bundle'`).
- **Reuse `components/ui/BaseModal.tsx`** for the modal shell. Props: `isOpen`, `onClose`, `title`, `children`, `footer?`, `maxWidth` (`'sm'..'4xl' | 'full'`), `showCloseButton`, `closeOnClickOutside`, `closeOnEscape`. It portals to `document.body`, body is `overflow-y-auto`, container is `max-h-[90vh]`.
- **Icon rendering:** `<Icon name="x" />` → `<span class="qt-icon" data-icon="x">`. `mask`-mode icons are tinted by `currentColor`; `image`-mode are pre-colored. Theme overrides inject `[data-icon="name"]` rules into a `<style>` block that beats the `@layer components` defaults. For the icon sheet we render the bundled override **inside the theme-scoped container** so the override CSS is in effect, then vary `currentColor`/background per state via wrapper classes.

### Example data (for manual verification)

- **Madman's Box** (`themes/bundled/madmans-box`): `previewImage` is null; **82** icon overrides under `icons/`; **8** subsystem `backgroundImage`s under `textures/` (aurora, prospero, salon, commonplace-book, scriptorium, lantern, forge, calliope). Gallery should show those 8 background images; icon sheet should show 82 icons.
- **Art Deco** (`themes/bundled/art-deco`): 2 texture images but referenced how? Verify — if they aren't in `subsystems`/`previewImage`, the manifest-referenced gallery will (correctly, per locked decision) show fewer/none. Report what shows.
- **Earl Grey / Rains / Old School:** no bundled images → gallery shows an **empty state**; likely no icon overrides → icon sheet shows an empty state.

---

## Task 1 — Registry: expose manifest-referenced images

**File:** `lib/themes/theme-registry.ts`

Add a public method on the registry class (mirror the existing `getIcons(themeId)` at ~line 850):

```ts
export interface ThemePreviewImage {
  /** Display name, derived from the source key/filename. */
  name: string;
  /** Browser-usable URL (resolved via resolveThemeAssetUrl). */
  src: string;
  /** Where the reference came from. */
  kind: 'preview' | 'background' | 'thumbnail';
  /** Subsystem key when kind is background/thumbnail (e.g. "aurora"); undefined for preview. */
  subsystem?: string;
}

getImages(themeId: string): ThemePreviewImage[]
```

Behavior:

- Look up `theme = this.state.themes.get(themeId)`; if absent return `[]`.
- Build a list from **manifest references only**:
  - If `theme.previewImage` → one entry `{ kind: 'preview', name: 'Preview', subsystem: undefined, src: resolveThemeAssetUrl(theme.previewImage, theme.pluginName) }`.
  - For each `[key, sub]` in `theme.subsystems ?? {}`:
    - If `sub.backgroundImage` and it's not `'none'` → `{ kind: 'background', subsystem: key, name: <pretty>, src: resolve(...) }`.
    - If `sub.thumbnail` and it's not `'none'` → `{ kind: 'thumbnail', subsystem: key, name: <pretty>, src: resolve(...) }`.
- **Skip** entries whose resolved `src` is `undefined` or `'none'`.
- **Pretty name:** for subsystem images, prefer `sub.name` if present, else humanize the subsystem key (`'commonplace-book'` → `'Commonplace Book'`); append a kind suffix only when needed to disambiguate (e.g. `"Aurora Background"`, `"Aurora Thumbnail"`). For `previewImage`, name is `"Preview"`.
- **De-dupe** by resolved `src` (a subsystem could repeat the same file); keep the first.
- **Sort** alphabetically by `name`, case-insensitive (`localeCompare` with `{ sensitivity: 'base' }`).
- **Asset URL resolution:** reuse `resolveThemeAssetUrl`. It's currently a module-private function; either (a) export it and call it, or (b) keep it private and call it from inside the method (preferred — it's already in scope). Do **not** reimplement the path logic.

**Logging (project convention — debug logs on touched backend):** add `logger.debug('theme-registry.getImages', { themeId, count, kinds })` and a `logger.debug` when a referenced image resolves to undefined/none (so missing assets are visible). Use the existing `logger` import already in the file.

---

## Task 2 — Tokens endpoint: return `images`

**File:** `app/api/v1/themes/[themeId]/route.ts`, function `handleGetTokens` (~lines 38–73).

- After `const subsystems = theme?.subsystems || undefined;`, add:
  ```ts
  const images = themeRegistry.getImages(themeId);
  ```
- Change the return to:
  ```ts
  return successResponse({ tokens, fonts, icons, cssOverrides, subsystems, images });
  ```
- No new action, no signature change. The `icons` array is already returned; the modal will consume it (the hook currently discards it).

---

## Task 3 — Hook: surface `icons` and `images`

**File:** `components/settings/appearance/hooks/useThemePreview.ts`

- Extend `ThemeTokensResponse` (internal) with:
  ```ts
  icons?: { name: string; src: string }[]
  images?: ThemePreviewImage[]   // import the type from lib/themes/theme-registry (or a shared types module)
  ```
- Extend `UseThemePreviewResult` with `icons: { name: string; src: string }[]` and `images: ThemePreviewImage[]`.
- Add `useState` for both (`[]` initial). Set them in the cache-hit branch (~lines 70–74), the fresh-fetch branch (~lines 97–101), and reset them in `clearCache` (~lines 116–121). Return them in the final object (~lines 124–132).
- Keep the module-level `tokensCache` — it already caches the whole response object, so `icons`/`images` ride along once the response includes them.
- **Type import note:** `ThemePreviewImage` is declared in `lib/themes/theme-registry.ts` (Task 1). Importing a type from a registry module into a client hook is fine (type-only import: `import type { ThemePreviewImage } from '@/lib/themes/theme-registry'`). If lint/boundaries object, move the interface to `lib/themes/types.ts` and import from there; update Task 1's export accordingly.

---

## Task 4 — New component: `ThemePreviewModal`

**File:** `components/settings/appearance/components/ThemePreviewModal.tsx` (new).

**Props:**
```ts
interface ThemePreviewModalProps {
  theme: ThemeSummary | null        // null = default theme
  isActive: boolean
  isOpen: boolean
  onClose: () => void
  onApply: () => void               // = onSelect from the card
  onUninstall?: () => void
  onExport?: () => void
}
```

**Data:** call `useThemePreview(isDefault ? null : theme.id)` and `fetchTokens()` on open (mirror `ThemeCard`'s effect). For the default theme use `DEFAULT_THEME_TOKENS` and empty `icons`/`images` (default theme bundles none). Pull `tokens, fonts, cssOverrides, icons, images, isLoading, error`.

**Shell:** render inside `BaseModal` with `maxWidth="full"`, `showCloseButton`, `title` = theme name (BaseModal already renders the title in app chrome — but per Option B we also want a *themed* banner; see below — set the BaseModal `title` to the plain name for the accessible header, and render the themed banner as the first child).

**Layout (top → bottom, single scroll region = BaseModal body):**

### 4a. Themed banner header (Option B contrast)
- A full-width block painted with the theme's background color and an accessible foreground computed from it.
- **Move the contrast helpers** `getLuminance`, `getContrastingTextColor`, `getMutedTextColor` out of `ThemeCard.tsx` (lines ~42–90) into a shared util `components/settings/appearance/utils/contrast.ts` (or `lib/themes/contrast.ts`). Export all three. Update `ThemeCard.tsx` to import from there (no behavior change). The modal imports the same.
- Pick the banner background from the previewed mode's tokens: use `previewTokens.colors[mode].background` (same source `ThemeCard` uses via `previewColors`). Compute `fg = getContrastingTextColor(bg)` and `muted = getMutedTextColor(bg)`. Apply as inline `style` (these are dynamic, theme-derived values — inline style is correct here, not a `qt-*` class).
- Contents: theme **name** (large, `style={{ color: fg }}`), **description** (`style={{ color: muted }}`), a **source badge** (Built-in / Bundle / Plugin(deprecated) — reuse `getSourceBadge` logic from `ThemeCard`; consider lifting it to the shared util too), and the action cluster on the right: **Light/Dark toggle**, **Export** (download icon, if `onExport`), **Uninstall** (trash, bundle only, when not active), **Apply** (`qt-button-primary`, when not active) / **Active** badge, and the **close** affordance (BaseModal's `showCloseButton` already gives one; don't double up — either rely on BaseModal's close or render your own and set `showCloseButton={false}`). Action chips that sit on the themed banner should use computed `fg`/`muted` for borders/text so they stay legible (follow the pattern already in `ThemeCard`'s collapsed view, lines ~344–404, which tints chips with `${cardTextColor}15`).
- **Light/Dark toggle:** local `mode` state (`'light' | 'dark'`), default `'light'`. Disable/hide the Dark option when `!supportsDarkMode` (`isDefault ? true : theme.supportsDarkMode`). The toggle drives both the banner color and which `ThemePreviewPanel`(s) render.

### 4b. Live element preview
- Reuse `ThemePreviewPanel` exactly as `ThemeCard` does. With the new toggle you can either show the single selected mode, or keep the existing side-by-side Light+Dark. **Default: show the single mode selected by the toggle** (the toggle is the reason we have one). If `supportsDarkMode` is false, force light.
- Preserve the existing loading spinner and error states (copy from `ThemeCard` expanded branch, ~lines 260–272).

### 4c. Image gallery
- Section heading (use a `qt-*` heading class, e.g. `qt-heading-4`, in app chrome — this section is outside the themed banner, so app colors are correct and legible).
- If `images.length === 0`: empty state — a muted line like "This theme bundles no preview images." (steampunk voice optional here since it's app chrome, but keep it short).
- Else: a responsive grid (e.g. `grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4`). Each cell is a card (`qt-card` or a bordered `qt-border-default rounded-lg`) containing:
  - The image in a fixed-aspect box (`aspect-video` or `aspect-square`, `object-cover` or `object-contain` — prefer `contain` so nothing is cropped) on a **checkerboard backing** so transparent PNG/SVG read clearly. Implement the checkerboard with a small inline `background-image` conic/linear-gradient utility or an existing `qt-*` swatch background if one exists (grep `qt-checker`/`qt-swatch`; if none, inline a gradient — this is a presentational detail, acceptable inline).
  - Use a plain `<img>` (project convention forbids swapping `<img>`→ Next `<Image>`; see CLAUDE.md). Add `loading="lazy"`, `alt={name}`, and an `onError` that hides the cell or shows a broken-asset placeholder.
  - The image **name** below (`qt-text-small`), and optionally a tiny kind/subsystem tag (`qt-badge-secondary`).
- Images are already sorted alphabetically by the registry; don't re-sort (or re-sort defensively, same comparator).

### 4d. Icon sheet
- Section heading in app chrome.
- If `icons.length === 0`: empty state ("This theme overrides no icons.").
- Else: render the sheet **inside a theme-scoped container** so the bundled icon-override CSS is active. The simplest correct approach: reuse the same scoping mechanism `ThemePreviewPanel` uses (`generateScopedThemeCSS` + a scope class), OR mount the icon sheet inside a `ThemePreviewPanel`-style wrapper. **Recommended:** factor the scoping wrapper so the icon grid can live in the scoped subtree. If that's heavy, an acceptable alternative is to render each icon as an `<img src={icon.src} />` styled as a mask — but that loses the mask/image distinction; prefer the scoped-CSS route so `<Icon name=.../>` resolves the override naturally.
  - To make `<Icon name={icon.name} />` pick up the override, the override `[data-icon="name"]` rule must be present and scoped. The cleanest path: inside the scoped container, inject the theme's icon-override CSS (the same CSS the runtime uses). Investigate `generateIconOverridesCSS` in `lib/themes/utils.ts` (referenced by the icon-registry docs) and reuse it scoped to the container class, analogous to how `ThemePreviewPanel` scopes token CSS. Document in the PR which path you took.
- Grid (`grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-4`), alphabetical by `name` (registry returns icons unsorted — **sort here**, case-insensitive). Each cell:
  - A row of the **four state swatches**, each a small box rendering `<Icon name={icon.name} className="w-6 h-6" />`:
    1. **default** — wrapper `qt-text-primary`.
    2. **muted/disabled** — wrapper `qt-text-secondary opacity-50`.
    3. **hover/active** — wrapper `qt-text-primary` on a `qt-bg-muted` rounded chip (padding).
    4. **on-primary** — wrapper with `qt-button-primary` background (or `qt-bg-primary`), icon set to the primary foreground (`qt-text-on-primary` if it exists; grep — else use the button's own text color by nesting inside a `qt-button-primary` span).
    Label each swatch with a tiny caption (default/muted/hover/on-primary) for clarity, or provide a single legend above the grid instead of per-cell captions (less clutter — **prefer one legend row** above the grid).
  - The **icon name** beneath, in `font-mono qt-text-xs`, selectable (so users can copy the override name). Optionally a click-to-copy affordance.

**Accessibility:** the modal must trap focus (BaseModal handles Escape + click-outside; verify focus). Section headings should be real `<h3>`/`<h4>`. Images need `alt`. The Light/Dark toggle should be a labeled control.

---

## Task 5 — Rewire `ThemeCard` + `ThemeSelector` to open the modal

**`components/settings/appearance/components/ThemeCard.tsx`:**
- **Remove the entire `if (isExpanded) { ... }` branch** (~lines 179–301). The collapsed card (the `return (<>...</>)` at the end) stays.
- The collapsed card's **Preview** button (`handlePreviewClick`, ~line 162; button ~lines 390–403) should continue to call `onToggleExpand?.()` — but the parent now interprets that as "open modal for this theme," not "expand inline." No change needed inside the card beyond deleting the expanded branch; the prop contract (`onToggleExpand`) is reused.
- Keep `getSourceBadge` and the contrast helpers usable: after lifting helpers to the shared util (Task 4a), update `ThemeCard` imports. If `getSourceBadge` is also lifted, import it; otherwise leave it local and the modal can re-declare/import as decided in Task 4.
- The `ThemeCardProps.isExpanded` prop is now unused by the card. Either remove it from `types.ts` and `ThemeCardProps` (and stop passing it), or leave it as a harmless no-op. **Prefer removing** for cleanliness — update `types.ts` (`components/settings/appearance/types.ts`, lines 48–51) and `ThemeSelector` call sites.

**`components/settings/appearance/ThemeSelector.tsx`:**
- Rename the state to reflect new meaning: `const [previewThemeId, setPreviewThemeId] = useState<string | null>(null)` (replacing `expandedThemeId`, ~line 39). `'default'` sentinel for the default theme as before.
- `handleToggleExpand(themeId)` becomes `handleOpenPreview(themeId)` — set `previewThemeId` to the key (don't toggle-closed on re-click; the modal's own close handles closing). Keep passing it as `onToggleExpand` to `ThemeCard` (or rename the prop to `onPreview` across the three files if you want the names to match — optional but tidy).
- **Stop passing `isExpanded`** (card no longer uses it).
- After the theme list, render **one** `<ThemePreviewModal>` (not one per card) driven by `previewThemeId`:
  - Resolve the `theme` object from `previewThemeId` (`'default'` → `null`; else `availableThemes.find(t => t.id === previewThemeId)`).
  - `isOpen={previewThemeId !== null}`, `onClose={() => setPreviewThemeId(null)}`.
  - Wire `isActive`, `onApply` (= the same select handler used by the card), `onUninstall`, `onExport` from the existing handlers in `ThemeSelector`.
- Verify the existing per-card handlers (select/uninstall/export) are accessible at this level to pass into the single modal; if they're currently created per-card inline, hoist them or pass the resolved theme into a shared handler.

---

## Task 6 — Verify, document, changelog

- **Type check:** `npx tsc` (NOT `npm run build`, per CLAUDE.md). Resolve all errors.
- **Lint:** run the project lint; ensure no `<img>`→`<Image>` swaps (forbidden), and that new color/state styling prefers `qt-*` classes; only theme-derived dynamic values (banner bg/fg) use inline `style`. If you introduce any **new** `qt-*` utility class, you must also reflect it in the stylebook / `packages/theme-storybook` and possibly `create-quilltap-theme` per CLAUDE.md — but this feature should be achievable with **existing** `qt-*` classes; avoid adding new ones.
- **Dev-server log check:** with `npm run dev` running, open Settings → Appearance, open the modal for a few themes, and tail logs via `npx quilltap logs --stream combined --tail 100` (or `logs/combined.log`) to confirm the new `getImages` debug logs fire and no errors surface.
- **Manual verification matrix:**
  - **Madman's Box:** banner legible (dark theme → light fg); gallery shows the 8 subsystem backgrounds, alphabetical; icon sheet shows 82 overridden icons with the 4 states rendering distinctly; Light/Dark toggle flips banner + preview.
  - **Art Deco:** report what the manifest-referenced gallery shows (likely few/none if textures aren't in `subsystems`/`previewImage`); confirm that's expected under the locked "manifest-referenced only" decision.
  - **A no-image / no-icon-override theme (Earl Grey or Rains):** gallery + icon sheet show empty states; no crashes.
  - **Default theme:** modal opens, preview renders, gallery + icon sheet empty.
  - **Active theme:** shows "Active" badge instead of Apply; **non-active:** Apply works and applies the theme.
  - Light-only theme (`supportsDarkMode === false`): Dark toggle hidden/disabled; preview forced light.
  - Close via ×, Escape, and click-outside all work.
- **Help docs (user-facing, REQUIRED for user-visible changes):** update the appearance/theme help file under `help/*.md`. Match the existing **steampunk + Roaring 20s + Wodehouse + Lemony Snicket** voice. Ensure the frontmatter `url` points at the appearance theme page (`/settings?tab=appearance` with any `&section=` used) and that the "In-Chat Navigation" section's `help_navigate(url: "...")` call matches. (Grep `help/` for the current appearance/theme help file; likely `help/appearance.md` or similar.)
- **CHANGELOG (REQUIRED before commit):** add a terse, plain-American-English entry to `docs/CHANGELOG.md` (reverse chronological). NO steampunk voice in the changelog. E.g.: "Theme preview is now a full-page modal with a Light/Dark toggle, a gallery of the theme's bundled images, and an icon sheet showing each overridden icon in default/muted/hover/on-primary states. Fixed banner-header contrast on vivid themes."
- **Module README:** update `components/settings/appearance/README.md` to describe the modal (it currently documents the inline expanded preview and references `ThemePreviewPanel`/`ThemePreviewElements`).
- **Data/schema check (per CLAUDE.md):** this change adds no new persisted data and no schema changes (it only reads existing manifest fields). Confirm nothing in `.qtap` export, `public/schemas/qtap-export.schema.json`, backups, migrations, or `DDL.md` needs updating. (Expected: none.)
- **No package changes:** this touches app source only, not `packages/` — so no `npm publish` pause and no plugin version bump. Confirm you didn't modify anything under `packages/`.

---

## Files touched (summary)

| File | Change |
|---|---|
| `lib/themes/theme-registry.ts` | Add `ThemePreviewImage` interface + `getImages(themeId)` method; reuse `resolveThemeAssetUrl`; debug logging. |
| `app/api/v1/themes/[themeId]/route.ts` | `handleGetTokens` returns `images` (and existing `icons`). |
| `components/settings/appearance/hooks/useThemePreview.ts` | Surface `icons` + `images`. |
| `components/settings/appearance/components/ThemePreviewModal.tsx` | **New** full-page modal: themed banner (Option B contrast), live preview w/ Light/Dark toggle, image gallery, icon sheet. |
| `components/settings/appearance/utils/contrast.ts` (or `lib/themes/contrast.ts`) | **New** shared contrast helpers lifted from `ThemeCard`. |
| `components/settings/appearance/components/ThemeCard.tsx` | Delete inline `isExpanded` branch; import shared contrast helpers; Preview button now opens modal via parent. |
| `components/settings/appearance/ThemeSelector.tsx` | `expandedThemeId` → `previewThemeId`; render single `ThemePreviewModal`; stop passing `isExpanded`. |
| `components/settings/appearance/types.ts` | Remove unused `isExpanded` from `ThemeCardProps` (optional). |
| `help/*.md` (appearance/theme) | User-facing doc update (steampunk voice). |
| `docs/CHANGELOG.md` | Plain-English entry. |
| `components/settings/appearance/README.md` | Describe the modal. |

## Guardrails recap (from CLAUDE.md)

- Type-check with `npx tsc`, not `npm run build`.
- Debug logs for touched backend; use the built-in `logger`.
- Don't swap `<img>` for Next `<Image>`.
- Prefer existing `qt-*` semantic classes; inline `style` only for theme-derived dynamic colors. Avoid adding new `qt-*` classes (if unavoidable, propagate to stylebook/storybook/create-quilltap-theme).
- Document user-visible changes in `help/*.md`; record the change in `docs/CHANGELOG.md` (plain voice) before committing.
- No `packages/` edits expected → no npm publish step.
