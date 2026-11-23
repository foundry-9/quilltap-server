# Calliope Live — Phase 0a audit

**Status:** findings, 2026-11-14. Input to the Phase 0b / 0b′ / 0c specs in
[calliope-live.md](calliope-live.md). Nothing was changed in the app.

**Method.** The six bundled `styles.css` files and every stylesheet under
`app/` were parsed with PostCSS (not grep), so counts here are exact for what
is written literally. Class and attribute use in TSX was found by pattern
search and by reading the components named below; a class assembled from a
string at run time can be missed, and those places are marked "not found as a
literal". The full variable × theme table is
[calliope-live-audit-matrix.csv](calliope-live-audit-matrix.csv) (739 rows).

Loader findings that bear on security are kept out of this file; see
"CSS safety" at the end.

## Summary

1. The component tier is **505 variables**, not ~618 (the earlier figure counted
   light and dark declarations separately). 209 are set by five or six themes,
   158 by none.
2. **Themes do not use the semantic tier.** About 85% of the values a theme
   sets are literals. A theme carries 120–225 distinct literal colours against
   27 semantic colour tokens. The hierarchy the proposal wants does not exist
   yet in the themes; it exists only in the app's defaults.
3. **The primitive tier already exists informally.** Five of six themes define
   a private palette and build component values from it.
4. **About 30 "tokens" are constants**: all six themes set the same value, and
   only the default theme differs.
5. **Most hand-written rules are the same dozen rules repeated.** Once those
   become tokens or app-owned behaviour, each theme is left with zero to about
   eight rules of real custom CSS.
6. **A noticeable share of theme CSS is dead**: selectors for markup that no
   longer exists, and ~175 variables in two themes that nothing reads.
7. **Structural hooks are good in the Salon, the workspace, Settings and
   dialogs; weak on the home cards, the sidebar items and the character page.**
8. **A theme cannot be cloned or extended today** without hand-rewriting it:
   the theme id is written into every selector and every asset URL, and
   `extendsTheme` inherits tokens only.
9. Validation exists in **three unshared copies** (app Zod schema, CLI
   hand-written checks, published JSON Schema), and the scaffolder has a fourth
   copy of the default token values.

## 1. Variables

### 1.1 Where they are declared

| Set | Count |
|---|---|
| Custom properties declared anywhere in app CSS | 653 |
| Declared in `_variables.css` (the component registry in practice) | 505 (500 `--qt-*`, 5 `--theme-font-*`) |
| …with a default derived from another variable | 256 |
| …with a literal default | 249 |
| …with a separate light or dark default | 107 |
| Distinct names set by at least one theme | 581 |

By guessed value type, the 505 are: colour 333, length 59, radius 25, shadow
11, font weight 7, motion 6, font family 5, other 59 (blur, z-index, font
style, the 16 terminal ANSI colours, a few borders and images).

### 1.2 Per theme

| Theme | Variable declarations | Distinct variables | Mode-specific | Literal values | Reference a semantic token | Reference a private palette | Distinct literal colours |
|---|---|---|---|---|---|---|---|
| art-deco | 326 | 242 | 84 | 279 | 16 | 25 | 148 |
| earl-grey | 701 | 492 | 202 | 446 | 18 | 235 | 212 |
| great-estate | 324 | 240 | 83 | 281 | 13 | 24 | 162 |
| madmans-box | 259 | 259 | 0 | 207 | 14 | 34 | 119 |
| old-school | 257 | 198 | 59 | 233 | 16 | 0 | 145 |
| rains | 701 | 506 | 192 | 439 | 28 | 231 | 226 |

Notes:

- Only 13–28 values per theme refer to `--color-*` / `--theme-*`. A change to
  a semantic colour in `tokens.json` therefore repaints very little of a
  bundled theme. The cascade "change primary, everything follows" holds for the
  default theme and not for the six.
- madmans-box sets no mode-specific variable at all; it is one look in both
  modes.
- The six are two lineages. earl-grey and rains share 479 variable names and a
  rule set; the other four share 194 names (union 282).

### 1.3 Override frequency (registry variables)

| Themes that set it | Variables |
|---|---|
| 0 | 158 |
| 1 | 7 |
| 2 | 106 (almost all earl-grey + rains) |
| 3 | 15 |
| 4 | 10 |
| 5 | 45 |
| 6 | 164 |

Classification used in the CSV: `most` (5–6) 209, `some` (3–4) 25, `few` (1–2)
113, `never` 158.

Groups where nearly everything is overridden everywhere (real tokens, show by
default): alert 12/12, roleplay 8/8, overlay 8/8, terminal 26/30, card 7/10,
left-sidebar 10/17, rp 14/23, response 6/9, badge 32/76, chat 20/57.

Groups never overridden (derive, or hide behind "advanced"): diagram 17/20,
brahma 9/9, checkbox 5/5, autonomous 5/5, punctuation 4/4, composer 4/4, radio
4/4, progress 4/4, range 2/2, and 37 of the 76 badge variables. Of the 158
never-overridden variables, 94 already have a derived default.

### 1.4 Constants posing as tokens

39 variables have one identical value in every theme that sets them. 30 of
those are set by all six themes to a value that differs from the default — for
example `--qt-card-padding: 1.5rem` (default `1.25rem`),
`--qt-navbar-height: 4rem` (default `3.5rem`), the four avatar sizes, the
sidebar widths, the tab and badge paddings, and
`--qt-button-transition: all 200ms …` (default `150ms`).

These are sizing and density. No theme has ever chosen a different value; the
default theme is simply tighter. They are one **density** choice (compact /
comfortable), not thirty tokens.

### 1.5 Missing inheritance

Looked for variables that four or more themes set to an expression of the same
other variable. Only 11 turned up, and in 9 the default already has that
reference. The two real ones: `--qt-button-radius` and `--qt-tab-radius`,
which four themes point at `--radius-lg` while the default uses `--radius-md`.

So step 3 of the audit plan finds little, and the reason is 1.2: themes write
literals, so there is no shared expression to detect. The inheritance has to be
**designed**, family by family. The 176 variables that are literal in four or
more themes say which families need it:

| Family | Literal variables | What it implies for the semantic tier |
|---|---|---|
| badge | 32 | a category palette (character, chat, project, memory, tag, …) with bg/fg/border derived per category |
| terminal | 26 | a terminal block: bg, fg, cursor, selection, 16 ANSI colours |
| chat | 14 | assistant / user / system bubble surfaces, beyond the one `chatUser` pair |
| rp + roleplay | 21 | a roleplay text palette (dialogue, narration, inner monologue, OOC) |
| alert | 12 | bg / fg / border per status, derivable from the four status colours by one formula |
| left-sidebar | 11 | mostly the density constants of 1.4 |
| overlay | 7 | scrim and overlay surfaces |
| response, queue, avatar, card, button, tab, navbar | 4–6 each | hover / active / shadow variants |

### 1.6 Private palettes

| Theme | Private names | Example |
|---|---|---|
| art-deco | 10 | `--deco-gold`, `--deco-navy`, `--deco-line-thin` |
| great-estate | 7 | `--estate-gold`, `--estate-brown` |
| madmans-box | 21 | `--box-walnut`, `--tube-amber-glow`, `--rotor-cyan` |
| earl-grey, rains | ~80 shared | `--bg-000…500`, `--text-000…500`, `--accent-main-*`, `--border-100…400` |

earl-grey and rains build 230-odd component values from theirs, which is the
tiered model working. The primitive tier must therefore be an **open set of
author-named values** (colours, lengths, glows), not a fixed list; and
component values must be able to reference them.

### 1.7 Dead and stray variables

- **~175 names in earl-grey and rains are declared nowhere in the app.** About
  80 are the private palette above (live inside the theme). The rest are read
  by nothing: ~100 `--qt-debug-*`, `--qt-log-*`, `--qt-devconsole-*`,
  `--qt-mobile-*`, `--qt-empty-state-*`; ~17 `--tw-*` Tailwind internals; and
  font names from another product (`--font-anthropic-sans`,
  `--font-claude-response`, `--font-user-message`).
- **12 registry variables are read by no app CSS and named in no TS**, yet 8 of
  them are set by themes — `--qt-left-sidebar-min-width`, `-max-width`,
  `-item-gap`, `-overlay-bg`, `--qt-auth-page-bg`, `--qt-tab-gap` by all six.
  `--qt-left-sidebar-header-height` is set by all six and declared nowhere.
- **14 variables are read by app CSS as `var(--hook, fallback)` but are not in
  `_variables.css`**: nine `--qt-copy-button-*`, `--qt-workspace-accent`,
  `--qt-workspace-tab-active-fg`, `--qt-badge-secondary-border`,
  `--qt-thinking-duration`, `--qt-thinking-origin`. A registry must list these.
- Only 22 of 2,568 theme declarations restate the default. Redundancy is not
  the problem; literalness is.

## 2. Hand-written rules

| Theme | Rules with non-variable declarations | Declarations | `@keyframes` |
|---|---|---|---|
| art-deco | 31 | 55 | 0 |
| earl-grey | 52 | 131 | 1 |
| great-estate | 40 | 73 | 0 |
| madmans-box | 37 | 67 | 2 |
| old-school | 12 | 33 | 0 |
| rains | 53 | 129 | 2 |

### 2.1 Kinds that repeat — missing tokens or app-owned behaviour

| Kind | Themes | What themes write | Should become |
|---|---|---|---|
| Reduced-motion reset on `*` | 6, identical | `animation-duration` etc. under `prefers-reduced-motion` | app-owned; delete from themes |
| Root baseline | 6 | font smoothing, `scroll-behavior`, `scrollbar-width`, `color-scheme` | app-owned, plus a `colorScheme` token |
| `::selection` | 6 | background, colour | two tokens |
| Scrollbar | 5 (4–7 rules each) | size, track, thumb, thumb hover, radius | five tokens; the app writes the rules once |
| `:focus-visible` | 5 | outline, offset, sometimes a glow | the `effects.focusRing*` tokens exist and are not wired to a rule; wire them, add an optional glow |
| Page background image | 3, near-identical, 15 rules each | image on `body`; eight rules making `.bg-background`, `.qt-app-layout`, `.qt-app-main`, `.qt-page`, `.qt-content`, `.qt-content-scroll`, `.qt-auth-page`, `.qt-page-container` transparent; six more undoing it under `body:has([style*="--story-background-url"])` | one `pageBackground` image token (per mode) with size / position / attachment; the app owns the transparency and the story-background precedence |
| Heading treatment on bare `h1`–`h3` | 4 | font family, letter spacing, transform or small caps, weight, colour | heading tokens (`--qt-heading-font` exists; add spacing, transform, weight, colour) applied by the app to a heading hook |
| Button text on bare `button` / `.qt-button` | 3 | letter spacing, transform, size | button typography tokens |
| Form control radius on bare `input, textarea, select` | 3 | `border-radius` | an input radius token applied to `.qt-input` and friends |
| Card border via `[class*="card"], [class*="Card"]` | 3 | `border-color` | a card border token |
| Dialog border via `[role="dialog"]` | 3 | `border` | a dialog border token on `.qt-dialog` |
| Badge and alert rules | 2 (about 30 rules each) | background / colour per `.qt-badge-*`, `.qt-alert-*` | nothing new: the variables exist; these rules duplicate them |
| Transition on `*` | 2 | duration, easing | the existing transition tokens |
| Sidebar active item | 3 | `[data-sidebar] [aria-current="page"]` | dead, see 2.3 |

### 2.2 What is left: real custom CSS

| Theme | Rules that are specific to the theme |
|---|---|
| art-deco | none after 2.1 |
| great-estate | `body::after` texture overlay (3 rules); light-mode sidebar colour fixes (4) |
| madmans-box | homepage `::before` backdrop (3); brand glow; primary-button glow; diagram shadow; spinner and thinking-indicator animations with two `@keyframes` |
| old-school | a ten-rule grid re-layout of `.qt-foundry-card` |
| earl-grey | chat toolbar button shape; composer focus glow; message fade-in |
| rains | much the same, plus skeleton shimmer and tab / participant accents |

This is the layer-2 surface in practice: decorative pseudo-elements, glows,
keyframe animation, and one layout rearrangement. Small, and exactly the kind
of thing that should stay CSS.

**Animation:** four `@keyframes` across three themes, all decorative (fade-in,
shimmer, pulse, a turning indicator). Supports the lean in the proposal:
durations and easings as tokens, keyframes in custom CSS.

### 2.3 Brittle and dead selectors

Brittle stand-ins for a missing hook:

- bare elements: `h1`–`h6` (4 themes), `button`, `input`, `textarea`, `select`
  (3), `svg`, `span:first-child`, `div:last-child`;
- class substrings: `[class*="card"]`, `[class*="Card"]`, `[class*="brand"]`,
  `[class*="spinner"]`, `button[class*="primary"]`;
- a Tailwind utility as a hook: `.bg-background` (3 themes);
- `body:has([style*="--story-background-url"])` — matching on an inline style
  string (3 themes).

Selectors that match nothing in the current markup:

- `[data-sidebar]` (3 themes), `[data-role="assistant"]` / `[data-role="user"]`
  (great-estate): neither attribute is set anywhere in TSX. Messages are told
  apart by class only.
- `.app-shell`, `.message-enter` (earl-grey, rains): no such class in TSX.
- `.qt-sidebar-section-title`, `.qt-brand`: defined in no app CSS and (the
  first) used in no TSX.
- 31 of the 75 `qt-*` classes that theme rules target were not found as a
  literal in TSX. Some are certainly dead — the left sidebar is now a permanent
  icon rail with no labels, no active state and no toggle, so
  `.qt-left-sidebar-item-label`, `-item-active`, `-toggle`, `-profile-name`,
  `-profile-email`, `-view-all` (great-estate) and `.qt-sidebar-item*`,
  `.qt-navbar-link*` (earl-grey, rains) style nothing. Others
  (`.qt-badge-characters`, `.qt-badge-source-*`, `.qt-foundry-card*`,
  `.qt-skeleton`, `.qt-page`, `.qt-content`) may be composed at run time and
  need a check before deletion.

Across the app: about 169 `.qt-*` selectors defined in app CSS are referenced
by no TS/TSX, and roughly 100 `qt-*` class names used in TSX have no rule
(deliberate theme hooks, plus some strays). Nothing ties the two lists
together, which is what the hook catalogue lint is for.

## 3. Assets and manifest

| Theme | Fonts | Textures | Icons | Other |
|---|---|---|---|---|
| art-deco | 10 woff2 (0.4 MB) | 2 webp (0.6 MB) | — | |
| earl-grey | 2 woff2 | — | — | `OFL.txt` |
| great-estate | 6 woff2 (0.4 MB) | 1 webp, 1 png | — | |
| madmans-box | 23 woff2 (1.1 MB) | 13 webp (8.0 MB) | 88 svg | `OFL.txt`, README, a prompts file |
| old-school | 6 woff2 (0.5 MB) | — | — | |
| rains | 4 woff2 | — | — | `OFL.txt` |

- **Fonts** are declared in the manifest (`family`, `src`, `weight`, `style`,
  `display`). Only three of six bundles ship a licence file, and the manifest
  has no licence field per font.
- **Textures** are not declared anywhere. `styles.css` names them by absolute
  URL with the theme id inside:
  `url('/api/themes/assets/bundle:art-deco/textures/…')`.
- **Icons** are a manifest map, name → path (madmans-box only). Names are not
  checked against the app's icon list.
- **Subsystem backgrounds** (madmans-box, 12 images) and names (old-school)
  live in the manifest's `subsystems` record, whose keys are not checked
  against the known subsystem ids.
- No bundle has a preview image.
- `tokens.json` has 101 keys and is the same shape in all six, bar one extra
  radius in earl-grey.

## 4. Structural hooks

Verdicts: **hooked** (a `qt-*` class or data attribute specific to the
element), **generic** (a shared class only), **unhooked** (Tailwind only).

| Surface | State | Gaps |
|---|---|---|
| Root | `<html>` carries `data-theme`, `data-color-mode`, `.light` / `.dark` | set client-side only; nothing at server render |
| App shell | hooked (`qt-app-layout`, `qt-app-main`, `qt-page-toolbar*`) | `<main>` and the scroll wrapper are unhooked |
| Workspace | hooked (`qt-workspace*`, `qt-tab-strip[data-pane]`, tab parts) | a tab pane does not say which pane it is or what kind of tab it holds; `qt-tab` is shared with the in-page entity tabs |
| Home | container and grid hooked (`qt-homepage-container`, `qt-homepage-grid`) | the three cards are all `qt-homepage-section` with nothing to tell them apart; list rows and empty states unhooked |
| Left sidebar | container, nav, footer, profile hooked | the nine nav items are identical (`qt-collapsed-nav-button`); **no active-item state at all**; open / disabled button state and the popout menus unhooked |
| Salon | thoroughly hooked: rows, bubbles, whisper / silent / fact modifiers, action bar, composer, participant cards with state classes, Staff chips | no `data-role`; no speaker or character identity on a row; which Staff member posted is not exposed; tool-call cards, the streaming bubble and the avatar image box are unhooked |
| Character page | weak | page container is a non-qt `character-page`; sticky header, avatar region, meta and actions unhooked; field sections are a generic `qt-card` distinguishable only by `id` |
| Dialogs | hooked (`qt-dialog-overlay`, `qt-dialog[data-qt-modal]`, header, title, body, footer) | 41 of 67 callers that pass a body or footer class name replace the hook instead of adding to it; close button unhooked |
| Settings | hooked (`qt-settings-*`, cards by `id`, `data-persona`) | rail items carry no group id |

The only data attribute used systematically is `data-icon` (the shared `Icon`
component, ~220 files). About fifteen others exist in one file each
(`data-pane`, `data-stage`, `data-save-state`, `data-persona`, …). State is
otherwise carried in class names (`-active`, `-silent`, `-dangerous`).

### The three test cases

**Triptych home cards.** Nearly possible today. The grid and the card class
exist, so perspective on `.qt-homepage-grid` and a transform per card work —
but the cards can only be told apart with `:nth-child`. Needs one identifying
attribute per card (`data-section="chats | projects | characters"`).

**Tabletop RPG.** The Salon half is achievable: participant cards, bubbles and
the composer are well hooked. Two things are missing there — a role attribute
on the message row and the Staff sender on announcement chips. The
character-sheet half is not achievable: the page has almost no hooks. It needs
a page hook, header and avatar hooks, and a section hook carrying the
section's name.

**Sidebar as a menu bar.** The sidebar is already a fixed icon rail, and
`qt-app-layout` plus `qt-left-sidebar` are enough for CSS to lay it along the
top. That gives a horizontal icon strip, not a menu bar: there are no text
labels in the markup (only `title` / `aria-label`), no active state, and the
popouts are positioned for a vertical rail. Confirms the proposal: this is a
declared layout variant, not custom CSS.

## 5. How a theme reaches the page today

- `tokens.json` → `themeTokensToCSS` → `--theme-*` on `:root` (light and all
  non-colour tokens) and `.dark`. Tailwind maps `--color-*` to `--theme-*`.
- One `<style>` element receives, in order: `@font-face` rules, token CSS, icon
  override rules, then the bundle's `styles.css` verbatim.
- **No scoping is applied.** Authors write `[data-theme="<id>"]` on every rule
  by hand.
- **Defect, confirmed by the Spec A snapshot (2026-11-14):** the font
  families in `tokens.json` (`typography.fontSans` / `fontSerif` /
  `fontMono`) never take effect. `_variables.css` declares the five
  `--theme-font-*` variables on `[data-theme].light` / `.dark` (specificity
  0,2,0), which outranks the injected `:root` (0,1,0). Method: resolve each
  bundle with the `--theme-font-sans/serif/mono` declarations removed from
  its `styles.css` (`scripts/theme-snapshot.ts` machinery) and compare with
  `tokens.json`. Result, all six bundles in both modes: every one resolves to
  the app's system stacks. The only "match" is rains' serif, whose token
  happens to equal the default stack.
  - art-deco, great-estate, madmans-box and old-school re-declare all three in
    `styles.css` (higher-specificity `[data-theme="<id>"]` blocks), so they
    render their intended fonts — the workaround is load-bearing.
  - **earl-grey and rains do not.** They set `--default-font-family` (and
    rains `--default-mono-font-family`) instead, which only Tailwind's
    preflight on `html` reads; `body` carries `font-sans` →
    `var(--theme-font-sans)`, the system stack. So the UI of those two themes
    renders in system fonts rather than Rethink Sans / Inter / Fira Code, and
    the bundled font files are loaded for little. Not fixed here: a fix
    changes rendering, and Spec C decides.
- `extendsTheme` merges **tokens only** (shallow, per group). The parent's CSS,
  fonts and icons are not inherited; the merge silently falls back to default
  tokens if the parent registered later (no dependency ordering); and the child
  must still pass the full token schema, so it cannot be partial.
- `formatVersion` is `z.literal(1)`. There is no version branching anywhere.
- `subsystems` supplies per-subsystem name, description, thumbnail and
  background image to the Settings page and the story-background variable.
- Bundle limits: 50 MB compressed, 10 MB per entry, 200 files, an extension
  allowlist. Installed under `<dataDir>/themes/<id>/` with
  `themes-index.json`, which is read without schema validation.
- **Validation is three copies.** The app uses the Zod schema. `quilltap themes
  validate` is a separate hand-written implementation that shares no code with
  it, has a different id pattern, does not read `tokensPath` contents and does
  not check that referenced files exist. The published JSON Schema is used by
  neither.
- `create-quilltap-theme` carries its own default token values, which differ
  from `lib/themes/default-tokens.ts`, and a commented copy of the `--qt-*`
  defaults.
- **No contrast checking exists** for theme colours. A luminance helper in
  `components/settings/appearance/utils/contrast.ts` is used only to pick
  legible text on theme cards, and parses only HSL and hex.

## 6. What this means for the specs

**For 0b (token model and bundle format)**

- Registry-generates-CSS is supported by the data: all 505 entries reduce to
  name, type, group, default, optional dark default. Add the 14 hook variables;
  drop or fix the 12 unread ones.
- The work is not adding a tier on top; it is **widening the semantic tier**
  (category palette, terminal block, chat surfaces, roleplay text, status
  triples, scrollbar, selection, heading and button typography, page
  background) so that component defaults can derive from it, and making the
  primitive tier an open, author-named set.
- Replace the ~30 density constants with one density setting.
- Editable surface by default: the semantic tier (roughly 27 colours growing
  to perhaps 70 with the new families, plus type, radii, shadows, motion). The
  component tier (505) sits behind an "advanced" disclosure grouped by its 51
  component groups, with the 158 never-overridden ones collapsed.
- The bundle format needs: automatic scoping (the author never writes the
  theme id), bundle-relative asset references, declared textures, a licence per
  font, and real inheritance for `extendsTheme` if "start from an installed
  theme" is to mean anything other than a copy.
- Bump `formatVersion` to 2.

**For 0b′ (hook catalogue)**

- Smallest set that unlocks the three test cases: a section id on home cards;
  an id and an active state on sidebar nav items; role, speaker and Staff
  sender on Salon rows; a tab-kind attribute on workspace panes; page, header,
  avatar and named-section hooks on the character page; a heading hook; and
  dialog body / footer class names that add to the hook rather than replace it.
- Settle a convention: classes for element identity, data attributes for
  identity-within-a-set and for state. Today state is in class names.
- The lint must work both ways: every catalogued hook exists in markup, and
  theme CSS that targets an uncatalogued selector is flagged.

**For 0c (migration)**

- The migration deletes more than it moves: the dead selectors of 2.3, the
  ~120 unread variables of 1.7, and the repeated rules of 2.1.
- A pixel-for-pixel test will not pass and should not be the goal for the
  parts that are dead today or change by design (density). The screenshot
  harness needs an agreed list of intended differences.
- earl-grey and rains should be migrated as a pair; they are one theme
  structure with two palettes.

**For Phase 1 (engine)**

- One validator, used by the app, the CLI and the scaffolder, with the JSON
  Schema generated from it.
- Contrast checking is new work, and needs a colour parser that handles
  `color-mix()` and `var()` (it must run on resolved values).

## CSS safety

The loader was reviewed for what it permits in a bundle's CSS and assets. In
outline: bundle CSS is injected as written, with no scoping, filtering or
checks on what it may reference, and the three validators disagree. The
specifics are recorded privately rather than in this public file, and the
rules for the new format are a decision for the 0b spec.
