# Implementation Plan: Make per-page subsystem backgrounds theme-overridable

**Audience:** Claude Code, working in `quilltap-server`.
**Goal:** Let bundled and installed themes replace the full-page background images on the content pages (`/aurora`, `/prospero`, `/salon`, `/files`, `/scriptorium`, `/photos`) the same way they already can on the Settings page — without inventing a new mechanism.

---

## Background: why this is small

There are two background systems in Quilltap. **This plan touches only one of them.**

1. **Theme texture backgrounds** (whole-`body`, e.g. art-deco's `textures/background-light.webp`). Already theme-owned; **out of scope.**
2. **Per-page subsystem backgrounds** — the eleven `/images/<subsystem>.webp` files painted on `.qt-page-container::before` via the `--story-background-url` CSS variable. **This is the target.**

The critical fact that makes this a small change: **the theme-override pipeline for subsystem backgrounds already exists and already works.** The Settings page is already fully theme-overridable. The content pages are not — *only* because they hardcode the image URL inline instead of reading it from the existing hook.

### The pipeline that already works (do not rebuild it)

- `lib/themes/types.ts` — `QtapThemeManifestSchema` already defines `subsystems: Record<string, { name?, description?, thumbnail?, backgroundImage? }>`.
- `lib/foundry/subsystem-defaults.ts` — `DEFAULT_SUBSYSTEM_DEFINITIONS` is the single source of truth: each `SubsystemId` maps to a `backgroundImage` (e.g. `aurora: '/images/aurora.webp'`).
- `components/providers/theme/theme-utils.ts` — fetches the active theme's `subsystems` overrides from `/api/v1/themes/[themeId]?action=tokens` into `useTheme().subsystems`.
- `components/providers/theme/useSubsystemInfo.ts` — `useSubsystemInfo(id)` merges `subsystems[id].backgroundImage` over the default (with a `'none'` sentinel meaning "no background"). **This is the function to consume.**
- `app/settings/page.tsx` — already consumes it: `useSubsystemInfo(subsystemId).backgroundImage` → `--story-background-url`. **This is the pattern to copy.**

### The six pages that bypass it

Each hardcodes the URL inline. Confirmed call sites (`grep -rn "story-background-url" app/`):

| Page file | Route | Hardcoded value | Subsystem id (`SubsystemId`) |
|---|---|---|---|
| `app/aurora/page.tsx` (~line 288) | `/aurora` | `url(/images/aurora.webp)` | `aurora` |
| `app/salon/page.tsx` (~line 184) | `/salon` | `url(/images/salon.webp)` | `salon` |
| `app/files/page.tsx` (~lines 19, 53) | `/files` | `url(/images/commonplace_book.webp)` | `commonplace-book` |
| `app/scriptorium/page.tsx` (~line 110) | `/scriptorium` | `url(/images/scriptorium.webp)` | `scriptorium` |
| `app/scriptorium/[id]/page.tsx` (~line 88) | `/scriptorium/[id]` | `url(/images/scriptorium.webp)` | `scriptorium` |
| `app/photos/page.tsx` (~line 200) | `/photos` | `url(/images/lantern.webp)` | `lantern` |
| `app/prospero/page.tsx` (~line 55) | `/prospero` | `url(/images/prospero.webp)` | `prospero` |

**Do NOT touch the two dynamic-background pages** — they read a *user-set* per-chat/per-project story background and must keep doing so:

- `app/salon/[id]/page.tsx` (~line 1226) — uses `useStoryBackground(...)`, paints via `.qt-chat-layout::before`.
- `app/prospero/[id]/page.tsx` (~lines 82, 125) — uses `useStoryBackground(...)`.

> Note the two CSS paint paths are distinct: `.qt-page-container::before` (`app/styles/qt-components/_content.css`, opacity 0.35) for the static page backgrounds in scope here, and `.qt-chat-layout::before` (`app/styles/qt-components/_chat.css`, opacity 0.45) for the in-chat user background. This plan changes neither CSS rule; it only changes where the `--story-background-url` *value* comes from on the seven static call sites above.

---

## The change

For each of the seven static call sites: replace the hardcoded inline `url(...)` with a value derived from `useSubsystemInfo(<id>).backgroundImage`. After this, a theme that ships `subsystems.aurora.backgroundImage` (pointing at a `bundle:` asset or any URL) overrides `/aurora`'s background automatically — exactly as it already does for Settings.

### Recommended approach: a tiny shared hook

To keep the seven edits DRY and identical, add one hook that returns the ready-to-spread style object (or `undefined` when the resolved image is empty, i.e. the `'none'` sentinel). This also centralizes the `url()` wrapping and the empty-string handling so individual pages can't get it subtly wrong.

**New file:** `components/providers/theme/useSubsystemBackgroundStyle.ts`

```ts
'use client';

import { useMemo } from 'react';
import type React from 'react';
import { useSubsystemInfo } from './useSubsystemInfo';
import type { SubsystemId } from '@/lib/foundry/subsystem-defaults';

/**
 * Returns an inline style object setting --story-background-url for a page
 * container, resolved through the active theme's subsystem overrides.
 *
 * Returns undefined when the resolved background image is empty (the theme
 * set backgroundImage: 'none'), so the page renders with no story background.
 */
export function useSubsystemBackgroundStyle(
  id: SubsystemId,
): React.CSSProperties | undefined {
  const { backgroundImage } = useSubsystemInfo(id);
  return useMemo(() => {
    if (!backgroundImage) return undefined;
    return { '--story-background-url': `url(${backgroundImage})` } as React.CSSProperties;
  }, [backgroundImage]);
}
```

Re-export it from the theme provider barrel if one exists (check `components/providers/theme/index.ts`); otherwise import directly.

### Per-page edits

Each page currently looks like:

```tsx
<div className="character-page qt-page-container text-foreground"
     style={{ '--story-background-url': 'url(/images/aurora.webp)' } as React.CSSProperties}>
```

Change to:

```tsx
const bgStyle = useSubsystemBackgroundStyle('aurora');
// ...
<div className="character-page qt-page-container text-foreground" style={bgStyle}>
```

Apply with the correct `SubsystemId` per the table above. Keep all existing class names (`character-page`, `chat-page`, etc.) — they are unrelated to the background and may carry other styling.

**Hook-rules caution:** these are client components (`'use client'`). Add the `useSubsystemBackgroundStyle(...)` call at the **top level** of the component, before any early `return` (several of these pages early-return on loading/error states — see `app/aurora/page.tsx` ~line 280). Put the hook call near the other hooks at the top, store it in a `const`, and reference it in the JSX. Verify each page is already a client component; if any is a server component it cannot call the hook — in that case keep the static default for that one page and note it, rather than converting it to a client component just for this.

- `app/files/page.tsx` has **two** call sites (list + detail render branches) — both get the same `commonplace-book` style; compute once at the top, use in both.
- `app/scriptorium/page.tsx` and `app/scriptorium/[id]/page.tsx` are separate files; edit both, both use `scriptorium`.

---

## Wire up the bundled themes (so the feature is real, not theoretical)

The override path is dormant until a theme actually ships overrides. Pick **one** bundled theme to prove the mechanism end-to-end — **Madman's Box** is the natural choice (dark-only, strong art direction, owned by us). For that theme:

1. Add the background art assets under `themes/bundled/madmans-box/textures/` (or a new `backgrounds/` subfolder — match whatever the bundle loader expects; check how `art-deco` references `textures/...` and mirror it). Use WebP, per the repo's avatar/asset convention (`cwebp -q 82 -m 6 -mt in.png -o out.webp`, delete the PNG).
2. Add a `subsystems` block to `themes/bundled/madmans-box/manifest.json`, e.g.:

   ```json
   "subsystems": {
     "aurora":      { "backgroundImage": "/api/themes/assets/bundle:madmans-box/textures/aurora-bg.webp" },
     "prospero":    { "backgroundImage": "/api/themes/assets/bundle:madmans-box/textures/prospero-bg.webp" }
   }
   ```

   Confirm the asset URL shape against `app/api/themes/assets/[...path]/route.ts` (the `bundle:<themeId>/...` prefix). The keys are `SubsystemId` values; note `commonplace-book` is hyphenated.
3. Validate the bundle: `npx quilltap themes validate themes/bundled/madmans-box` (confirm exact verb via `npx quilltap themes --help`).

> Charlie is supplying his own replacement art. If assets aren't ready at implementation time, wire the manifest + page-hook plumbing and leave the `subsystems` block with one real entry as a working example; he'll fill the rest.

---

## Files to create / modify (checklist)

**Create**
- `components/providers/theme/useSubsystemBackgroundStyle.ts`

**Modify (consume the hook)**
- `app/aurora/page.tsx` → `useSubsystemBackgroundStyle('aurora')`
- `app/salon/page.tsx` → `'salon'`
- `app/files/page.tsx` → `'commonplace-book'` (two render branches)
- `app/scriptorium/page.tsx` → `'scriptorium'`
- `app/scriptorium/[id]/page.tsx` → `'scriptorium'`
- `app/photos/page.tsx` → `'lantern'`
- `app/prospero/page.tsx` → `'prospero'`

**Do NOT modify**
- `app/salon/[id]/page.tsx`, `app/prospero/[id]/page.tsx` (user/per-chat story background — leave `useStoryBackground`).
- `app/settings/page.tsx` (already correct — but optionally refactor it to use the new hook too, for consistency; it currently inlines the same logic via `useSettingsBackground`). Optional, low-risk, do last.
- The `::before` CSS rules in `_content.css` / `_chat.css`.

**Wire a theme (proof of mechanism)**
- `themes/bundled/madmans-box/manifest.json` (+ asset files under its bundle dir).

---

## Conventions to honor (from CLAUDE.md)

- **Debug logging:** this is a UI-only data-flow change with no backend handler, so backend debug-log requirement doesn't strictly apply; do not add `console.log` to React render paths. If anything warrants a log, it's already covered by the themes API route. (Confirm: no new backend code is introduced.)
- **Type-check** with `npx tsc` (not `npm run build`).
- **Themes touched ⇒ stylebook/storybook check:** this change adds no new `qt-*` classes and changes no CSS, so the theme-storybook/`create-quilltap-theme`/bundled-theme propagation rule is **not** triggered. (`subsystems.backgroundImage` is already a documented manifest field; if `create-quilltap-theme`'s scaffolded manifest or docs *don't* yet mention `subsystems`, add a one-line example there — but no version bump unless you actually edit a file under `packages/`.)
- **Packages rule:** if (and only if) you edit anything under `packages/` (e.g. `create-quilltap-theme`), STOP and ask Charlie to `npm publish` before consuming — do not copy built artifacts down. Most likely you won't need to touch `packages/` at all.
- **Help docs:** user-visible behavior changes (themes can now restyle these page backgrounds) ⇒ update the relevant `help/*.md` (Calliope/appearance or theme-authoring help). Keep its `url` frontmatter and the `help_navigate(...)` In-Chat Navigation block consistent. Use the steampunk / Roaring-20s / Wodehouse / Lemony Snicket voice for help text.
- **Changelog:** add a terse, plain-English entry to `docs/CHANGELOG.md` (reverse chronological). The changelog is the *exception* to the steampunk voice — keep it direct, e.g. *"Themes can now override the per-page subsystem background images (Aurora, Prospero, Salon, Files, Scriptorium, Photos) via the manifest `subsystems.backgroundImage` field, matching the Settings page."*
- **No stubs/TODOs** left behind.
- **DDL / schema / exports:** none affected — no data model, DB, `.qtap`/SillyTavern export, or migration changes. (The theme manifest schema already supports `subsystems`; nothing to migrate.)

---

## Verification (include as a final step)

1. `npx tsc` clean.
2. With the **default** theme active, all seven pages render their original backgrounds unchanged (`aurora.webp`, `salon.webp`, `commonplace_book.webp`, `scriptorium.webp` ×2, `lantern.webp`, `prospero.webp`). This proves the refactor is behavior-preserving by default.
3. Activate **Madman's Box** (with its `subsystems` overrides): the wired pages now show the theme's replacement art; un-wired subsystems fall back to defaults.
4. Set one subsystem's `backgroundImage` to `'none'` in a test theme and confirm that page renders with **no** story background (hook returns `undefined`, the `:not([style*="--story-background-url"])::before { display: none }` rule hides the layer).
5. Confirm `/salon/[id]` and `/prospero/[id]` still honor a **user-set** per-chat/project story background (regression guard on the path we deliberately didn't touch).
6. Watch `logs/combined.log` during `npm run dev` for theme-fetch errors when switching themes.

---

## Risk notes

- **Hook ordering / early returns** are the only real footgun — several pages early-return before the JSX. Resolve the style at the top with the other hooks.
- **`commonplace-book` id is hyphenated** while its image file is `commonplace_book.webp` (underscore). Use the *id* (`'commonplace-book'`) when calling the hook; the image filename lives in `subsystem-defaults.ts` and isn't typed by hand here.
- **Server vs client components:** all seven are expected to be client components (they use hooks/state already), but verify before adding the hook; don't convert a server component solely for this.
