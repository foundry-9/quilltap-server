# Calliope Live — Spec C: rendering differences

Every way a bundled theme renders differently after its migration to version
2 ([calliope-live-spec-c-migration.md](calliope-live-spec-c-migration.md)),
with the reason. A snapshot or probe difference is either fixed or entered
here; nothing else changes.

**Reasons:** decision 1 (earl-grey and rains get their intended fonts);
decision 3 near-match (ΔE in OKLab ≤ 0.02, value given); dead rule removed;
app-owned feature replaces a hand-written rule; selector moved to a hook;
other (explained in the row).

**Stage 2 rows** are measured against the Stage 1 probe (`.theme-probe/stage1/`), which matched version 1; an ΔE near-match row names the token whose override was dropped.

**Baseline:** the version 1 probe and screenshots taken 2026-11-14 on V4test
(`.theme-probe/v1-baseline/`, not tracked), 7 themes × 2 modes × 7 pages.

## All six themes

| What differs | Where it shows | Old value | New value | Reason |
|---|---|---|---|---|
| The theme preview dialog's sample panel | Appearance settings, a theme card's Preview | drawn from the theme's `tokens.json` (`ThemePreviewPanel`), which did not match the live app: e.g. earl-grey's sample in Rethink Sans while the app renders the system font; rains' and great-estate's card borders, shadows and badge colours | drawn from the compiled theme (`ThemePreviewPanelV2`); every sampled hook that is also visible on a live page matches it, except rains' radii (below) | other: version 2 previews with the theme's own compiled CSS |
| Bundle asset URLs carry the theme version | art-deco and great-estate page backgrounds, great-estate's `body::after` texture, madmans-box's home background | `/api/themes/assets/bundle:<id>/textures/<file>` | the same with `?v=2.0.0` | other: the engine adds the version so a theme update is not served from cache; same file |
| Text selection colours reach `html` | selecting text anywhere | each theme's own `::selection` rule, which matched elements but not `html::selection` | the app's `::selection` rule from `--qt-selection-bg` / `-fg`, which also covers `html` | app-owned feature replaces a hand-written rule; the colours are the theme's own |
| Smoothed text, smooth scrolling | every page | hand-written in each theme (art-deco, earl-grey, great-estate, madmans-box, rains) | from `_base.css` for every theme | app-owned feature replaces a hand-written rule |
| `color-scheme` | form controls and scrollbars in dark mode | `light` on dark-mode elements where a theme set none (art-deco, great-estate, old-school); hand-written elsewhere | `--qt-color-scheme` per mode: `dark` in dark mode | app-owned feature replaces a hand-written rule |
| Reduced-motion resets, `*` transitions | every page | hand-written (earl-grey's `*` colour transition; reduced-motion blocks) | gone; the app's own reduced-motion handling applies | app-owned feature replaces a hand-written rule |
| `html` background and text colour | nowhere visible: `body` and `.qt-app-layout` paint over it | the theme's background / foreground | transparent / inherited | other: invisible |
| Body text colour, light and dark | body text that sets no colour of its own: dialogs, `h4` | rains and earl-grey: their `--p-text` primitive (e.g. dark 244,243,241; light 29,26,22) | `--color-foreground` (dark 250,249,245; light 26,26,26) | decision 3 near-match: version 1's body rule named the primitive, version 2 the semantic colour |
| The story-background page surfaces | art-deco, great-estate and madmans-box, Settings, Appearance and the dialog page while a story background is set | `body` background size / attachment and `.qt-app-main` colour from the theme's `body:has([style*="--story-background-url"])` rules | the app's page-background rules | other: the computed values differ; the screenshots are identical, because the story background covers both |
| Scrollbar colours in Chromium | every scrollbar in Chrome, Edge and the Electron shell — art-deco, great-estate, madmans-box | the browser's grey scrollbar: version 1 coloured them only through `::-webkit-scrollbar`, which Chromium ignores once `scrollbar-width` is set, so only Safari showed the theme's colours | the theme's thumb and track (e.g. art-deco dark: gold on navy) in every browser, from `--qt-scrollbar-thumb` / `-track` | app-owned feature replaces a hand-written rule — **flagged for the human:** visible in the shell. earl-grey and rains already set `scrollbar-color` and are unchanged |
| Character page header rule | the 1px line under a character's header — art-deco, great-estate, madmans-box | the card border colour at the card border opacity (from the removed `[class*="card"]` rule) | the same, now set on `.qt-character-header` | selector moved to a hook |
| Workspace tab and sidebar profile capitals | art-deco, great-estate | tracked capitals from the bare `button` rule | the same, set on `.qt-tab-select` and `.qt-left-sidebar-profile` (the base styles reset `text-transform` on buttons, so the rule must name the button) | selector moved to a hook. Link-style controls with those hooks — the Settings sidebar item, link buttons on the home page — now take the capitals too, which version 1 gave only to `<button>` elements |
| Bare `button` text treatment | art-deco, great-estate (and madmans-box letter-spacing) | a bare `button` rule set tracked capitals and 0.8125rem on every button | set on named hooks: `.qt-button`, `.qt-tab`, `.qt-left-sidebar-item`, `.qt-settings-rail-item`, `.qt-settings-persona-chip`, `.qt-collapsible-card-header`, `.qt-chat-announcement-chip`. Buttons with no hook — icon-only buttons (no text), the avatar button, and other unnamed buttons — no longer take it | selector moved to a hook; the unnamed buttons are a loss |
| The "Browse themes" header | Appearance settings, `<button class="qt-heading-3">` in the theme browser | 13px tracked capitals (the bare `button` rule beat the heading class) | the full `qt-heading-3` treatment, 20px | selector moved to a hook |
| Card and dialog titles | art-deco, great-estate, madmans-box | the body face (version 1's `h1, h2, h3` rule did not reach `.qt-card-title` / `.qt-dialog-title`, which are not always headings) | the heading face, letter-spacing and capitals | other: added so the heading treatment reads the same on titles that lost it with the bare `h1`–`h3` rule (below) |
| `[class*="card"]` border colour | art-deco, great-estate, madmans-box | the card border colour on anything with "card" in a class name | gone; cards take `--qt-card-border`, and the character header (above) has its own rule | dead rule removed: every other element it matched has no border |


## art-deco

| What differs | Where it shows | Old value | New value | Reason |
|---|---|---|---|---|
| Heading font on the theme card | Appearance settings, theme picker card title | "Cormorant Garamond", Georgia, … | Raleway | other: the card now uses the font the theme's headings render in (resolved `--qt-heading-font`); version 1 named `fontSerif`, which the theme never applied to headings |
| Bare `h1`–`h3` heading rule | headings without a `qt-*` class (Markdown in messages and documents) | Raleway, tracked capitals | the body face; `qt-heading-*`, `.qt-page-title`, `.qt-section-title` and card / dialog titles keep the treatment | selector moved to a hook; Markdown headings are a loss — **for the human to decide** |
| Scrollbar thumb border | every scrollbar (Safari / `::-webkit-scrollbar` only) | a 2px border in the track colour around the thumb | none | other: the app's scrollbar tokens have no thumb border |
| Dead selectors removed | — | `.qt-page`, `.qt-page-with-navbar`, `.qt-content`, `.qt-content-scroll` and their story-background variants | — | dead rule removed |
| `--qt-alert-warning-bg` (light) | warning alerts | `hsl(43 85% 55% / 0.12)` | `color-mix(in srgb, hsl(38 90% 46%) 10%, transparent)` | decision 3 near-match, ΔE 0.0092 |
| `--qt-chat-wardrobe-bg` (light) | Salon, wardrobe-change announcements | `color-mix(in srgb, hsl(222 16% 72%) 55%, hsl(43 80% 50%) 45%)` | `color-mix(in srgb, hsl(222 16% 72%) 60%, hsl(43 80% 50%) 40%)` | decision 3 near-match, ΔE 0.0104 |
| `--qt-entity-card-bg` (light) | character and project cards over a page background | `color-mix(in srgb, hsl(45 28% 75%) 90%, transparent)` | `color-mix(in srgb, hsl(45 28% 75%) 92%, transparent)` | decision 3 near-match, ΔE 0.0004 |
| `--qt-overlay-light-bg` (light) | light scrims over images | `hsl(222 40% 10% / 0.2)` | `color-mix(in srgb, rgb(9.4605 14.4942 26.2395) 20%, transparent)` | decision 3 near-match, ΔE 0.0045 |
| `--qt-terminal-chrome-fg` (light) | Salon Terminal Mode, the pane header text | `hsl(43 30% 84%)` | `hsl(43 35% 86%)` | decision 3 near-match, ΔE 0.0159 |
| `--qt-alert-warning-bg` (dark) | warning alerts | `hsl(43 85% 55% / 0.2)` | `color-mix(in srgb, hsl(38 85% 50%) 20%, transparent)` | decision 3 near-match, ΔE 0.0166 |
| `--qt-chat-wardrobe-bg` (dark) | Salon, wardrobe-change announcements | `color-mix(in srgb, hsl(222 25% 15%) 55%, hsl(43 75% 32%) 45%)` | `color-mix(in srgb, hsl(222 25% 15%) 60%, hsl(43 75% 32%) 40%)` | decision 3 near-match, ΔE 0.0166 |
| `--qt-entity-card-bg` (dark) | character and project cards over a page background | `color-mix(in srgb, hsl(222 40% 12%) 90%, transparent)` | `color-mix(in srgb, hsl(222 40% 12%) 92%, transparent)` | decision 3 near-match, ΔE 0.0010 |
| `--qt-overlay-light-bg` (dark) | light scrims over images | `hsl(222 40% 10% / 0.2)` | `color-mix(in srgb, rgb(9.4605 14.4942 26.2395) 20%, transparent)` | decision 3 near-match, ΔE 0.0065 |
| `--qt-response-status-bg` (dark) | Salon, the response status strip while a reply streams | `color-mix(in srgb, hsl(222 25% 15%) 60%, transparent)` | `color-mix(in srgb, hsl(222 25% 15%) 40%, transparent)` | decision 3 near-match, ΔE 0.0174 |
| `--qt-terminal-chrome-fg` (dark) | Salon Terminal Mode, the pane header text | `hsl(43 30% 84%)` | `hsl(43 35% 86%)` | decision 3 near-match, ΔE 0.0159 |


## earl-grey

| What differs | Where it shows | Old value | New value | Reason |
|---|---|---|---|---|
| Heading font on the theme card | Appearance settings, theme picker card title | "Rethink Sans", ui-sans-serif, … | Rethink Sans (Stage 2, decision 1) | other: the card now uses the font the theme's headings render in (resolved `--qt-heading-font`); version 1 named `fontSerif`, which the theme never applied to headings |
| Fonts | everywhere | the system stack (version 1 named Rethink Sans and never applied it) | Rethink Sans; e.g. the Salon action bar Georgia → Rethink Sans | decision 1 |
| Card font row (Stage 1) | — | — | superseded: the card title now resolves to Rethink Sans | decision 1 |
| Scrollbar | every scrollbar | the theme's thumb on a transparent track | the same; between Stage 1 and Stage 2 the track was dropped, and the root fell back to the browser's scrollbar until `_base.css` gave the track a transparent fallback | other: no change against version 1 |
| Button border style | every button | `border-style: none` | `solid` at width 0 | other: invisible |
| Dead selectors removed | — | `.qt-sidebar-item:hover`, `.qt-sidebar-item-active`, `.qt-navbar-link*`, `.qt-badge-characters` / `-chats` / `-user-characters` (and their dark forms), `.qt-badge-enabled`, `.qt-sidebar-section-title`, `.message-enter` | — | dead rule removed |
| `--qt-entity-card-bg` (light) | character and project cards over a page background | `color-mix(in srgb, hsl(0 0% 100%) 90%, transparent)` | `color-mix(in srgb, hsl(0 0% 100%) 92%, transparent)` | decision 3 near-match, ΔE 0.0000 |
| `--qt-entity-card-bg` (dark) | character and project cards over a page background | `color-mix(in srgb, hsl(0 0% 18.4%) 90%, transparent)` | `color-mix(in srgb, hsl(0 0% 18.4%) 92%, transparent)` | decision 3 near-match, ΔE 0.0011 |
| `--qt-response-status-bg` (dark) | Salon, the response status strip while a reply streams | `color-mix(in srgb, hsl(0 0% 18.4%) 60%, transparent)` | `color-mix(in srgb, hsl(0 0% 18.4%) 40%, transparent)` | decision 3 near-match, ΔE 0.0113 |


## great-estate

| What differs | Where it shows | Old value | New value | Reason |
|---|---|---|---|---|
| Bare `h1`–`h3` heading rule | headings without a `qt-*` class (Markdown) | the heading face and cream colour | the body face; hooked headings and card / dialog titles keep it | selector moved to a hook; Markdown headings are a loss — **for the human to decide** |
| `.qt-heading-4` colour | wherever the class appears without a text utility | gold | cream | other: version 1's `h1, h2, h3` rule left `h4` gold; the hook now takes the heading colour |
| Message accent borders | Salon messages | none: the rule was removed in Spec B because its selector never matched | not restored | other: nothing rendered before or after. They can be restored on `data-role` **if the human asks** |
| Dead selectors removed | — | `.qt-page`, `.qt-page-with-navbar`, `.qt-content`, `.qt-content-scroll` and their story-background variants | — | dead rule removed |
| `--qt-alert-warning-bg` (light) | warning alerts | `hsl(43 75% 55% / 0.12)` | `color-mix(in srgb, hsl(38 90% 46%) 10%, transparent)` | decision 3 near-match, ΔE 0.0045 |
| `--qt-badge-source-npm-bg` (light) | Plugins settings, npm source badge | `hsl(0 60% 48% / 0.15)` | `color-mix(in srgb, hsl(0 60% 50%) 12%, transparent)` | decision 3 near-match, ΔE 0.0163 |
| `--qt-chat-wardrobe-bg` (light) | Salon, wardrobe-change announcements | `color-mix(in srgb, hsl(38 12% 91%) 58%, hsl(42 70% 48%) 42%)` | `color-mix(in srgb, hsl(38 12% 91%) 60%, hsl(42 70% 48%) 40%)` | decision 3 near-match, ΔE 0.0053 |
| `--qt-entity-card-bg` (light) | character and project cards over a page background | `color-mix(in srgb, hsl(38 25% 95%) 90%, transparent)` | `color-mix(in srgb, hsl(38 25% 95%) 92%, transparent)` | decision 3 near-match, ΔE 0.0003 |
| `--qt-overlay-light-bg` (light) | light scrims over images | `hsl(20 25% 8% / 0.2)` | `color-mix(in srgb, rgb(16.32 11.56 9.18) 20%, transparent)` | decision 3 near-match, ΔE 0.0047 |
| `--qt-warning-box-bg` (light) | warning boxes in forms and settings | `hsl(43 75% 55% / 0.1)` | `color-mix(in srgb, hsl(38 85% 32%) 8%, transparent)` | decision 3 near-match, ΔE 0.0153 |
| `--qt-alert-warning-bg` (dark) | warning alerts | `hsl(43 75% 55% / 0.2)` | `color-mix(in srgb, hsl(38 85% 50%) 20%, transparent)` | decision 3 near-match, ΔE 0.0129 |
| `--qt-badge-source-npm-bg` (dark) | Plugins settings, npm source badge | `hsl(0 60% 48% / 0.3)` | `color-mix(in srgb, hsl(0 60% 55%) 25%, transparent)` | decision 3 near-match, ΔE 0.0137 |
| `--qt-chat-wardrobe-bg` (dark) | Salon, wardrobe-change announcements | `color-mix(in srgb, hsl(20 18% 15%) 55%, hsl(42 65% 28%) 45%)` | `color-mix(in srgb, hsl(20 18% 15%) 60%, hsl(42 65% 28%) 40%)` | decision 3 near-match, ΔE 0.0115 |
| `--qt-entity-card-bg` (dark) | character and project cards over a page background | `color-mix(in srgb, hsl(20 22% 12%) 90%, transparent)` | `color-mix(in srgb, hsl(20 22% 12%) 92%, transparent)` | decision 3 near-match, ΔE 0.0009 |
| `--qt-overlay-light-bg` (dark) | light scrims over images | `hsl(20 25% 8% / 0.2)` | `color-mix(in srgb, rgb(16.32 11.56 9.18) 20%, transparent)` | decision 3 near-match, ΔE 0.0069 |
| `--qt-warning-box-bg` (dark) | warning boxes in forms and settings | `hsl(43 75% 55% / 0.1)` | `color-mix(in srgb, hsl(38 85% 50%) 8%, transparent)` | decision 3 near-match, ΔE 0.0180 |


## madmans-box

| What differs | Where it shows | Old value | New value | Reason |
|---|---|---|---|---|
| Heading font on the theme card | Appearance settings, theme picker card title | Lora, Georgia, … | Raleway | other: the card now uses the font the theme's headings render in (resolved `--qt-heading-font`); version 1 named `fontSerif`, which the theme never applied to headings |
| Bare `h1`–`h3` heading rule | headings without a `qt-*` class (Markdown) | brand face, small capitals, 0.1em | the body face; hooked headings and card / dialog titles keep it | selector moved to a hook; Markdown headings are a loss — **for the human to decide** |
| `.qt-button` letter-spacing | standalone `.qt-button-primary` / `-secondary` / `-ghost` with no `qt-button` beside them | none | the theme's button letter-spacing | other: now a token, which every button variant reads |
| Scrollbar thumb border | every scrollbar (Safari only) | a border in the track colour | none | other: the app's scrollbar tokens have no thumb border |
| Dead selectors removed | — | `.qt-page`, `.qt-page-with-navbar`, `.qt-content`, `.qt-content-scroll` (and story-background variants), `.qt-brand, [class*="brand"]` | — | dead rule removed |
| `--qt-chat-wardrobe-bg` (light) | Salon, wardrobe-change announcements | `color-mix(in srgb, hsl(28 24% 13%) 55%, hsl(40 62% 34%) 45%)` | `color-mix(in srgb, hsl(28 24% 13%) 60%, hsl(40 64% 36%) 40%)` | decision 3 near-match, ΔE 0.0033 |
| `--qt-overlay-caption-bg` (light) | captions over images | `hsl(28 36% 5% / 0.6)` | `color-mix(in srgb, rgb(17.34 12.444 8.16) 50%, transparent)` | decision 3 near-match, ΔE 0.0025 |
| `--qt-overlay-light-bg` (light) | light scrims over images | `hsl(28 30% 11% / 0.25)` | `color-mix(in srgb, rgb(17.34 12.444 8.16) 20%, transparent)` | decision 3 near-match, ΔE 0.0169 |
| `--qt-terminal-chrome-bg` (light) | Salon Terminal Mode, the pane header | `hsl(28 32% 9%)` | `color-mix(in srgb, hsl(28 34% 5%) 78%, hsl(40 28% 84%) 6%)` | decision 3 near-match, ΔE 0.0121 |
| `--qt-terminal-chrome-fg` (light) | Salon Terminal Mode, the pane header text | `hsl(40 30% 84%)` | `hsl(40 28% 84%)` | decision 3 near-match, ΔE 0.0018 |
| `--qt-warning-box-bg` (light) | warning boxes in forms and settings | `hsl(38 92% 54% / 0.1)` | `color-mix(in srgb, hsl(38 92% 54%) 8%, transparent)` | decision 3 near-match, ΔE 0.0144 |
| `--qt-chat-wardrobe-bg` (dark) | Salon, wardrobe-change announcements | `color-mix(in srgb, hsl(28 24% 13%) 55%, hsl(40 62% 34%) 45%)` | `color-mix(in srgb, hsl(28 24% 13%) 60%, hsl(40 64% 36%) 40%)` | decision 3 near-match, ΔE 0.0033 |
| `--qt-overlay-caption-bg` (dark) | captions over images | `hsl(28 36% 5% / 0.6)` | `color-mix(in srgb, rgb(17.34 12.444 8.16) 50%, transparent)` | decision 3 near-match, ΔE 0.0025 |
| `--qt-overlay-light-bg` (dark) | light scrims over images | `hsl(28 30% 11% / 0.25)` | `color-mix(in srgb, rgb(17.34 12.444 8.16) 20%, transparent)` | decision 3 near-match, ΔE 0.0169 |
| `--qt-response-status-bg` (dark) | Salon, the response status strip while a reply streams | `color-mix(in srgb, hsl(28 24% 13%) 60%, transparent)` | `color-mix(in srgb, hsl(28 24% 13%) 40%, transparent)` | decision 3 near-match, ΔE 0.0136 |
| `--qt-terminal-chrome-bg` (dark) | Salon Terminal Mode, the pane header | `hsl(28 32% 9%)` | `color-mix(in srgb, hsl(28 34% 5%) 78%, hsl(40 28% 84%) 6%)` | decision 3 near-match, ΔE 0.0121 |
| `--qt-terminal-chrome-fg` (dark) | Salon Terminal Mode, the pane header text | `hsl(40 30% 84%)` | `hsl(40 28% 84%)` | decision 3 near-match, ΔE 0.0018 |
| `--qt-warning-box-bg` (dark) | warning boxes in forms and settings | `hsl(38 92% 54% / 0.1)` | `color-mix(in srgb, hsl(38 92% 54%) 8%, transparent)` | decision 3 near-match, ΔE 0.0144 |


## old-school

| What differs | Where it shows | Old value | New value | Reason |
|---|---|---|---|---|
| Heading font on the theme card | Appearance settings, theme picker card title | "EB Garamond", Georgia, … | Inter | other: the card now uses the font the theme's headings render in (resolved `--qt-heading-font`); version 1 named `fontSerif`, which the theme never applied to headings |
| Keyboard focus ring | every focusable control | the browser's own ring: `outline: auto 1px`, offset 0 | the app's ring: `2px solid` in `--qt-focus-ring-color` (the theme's `ring`, or the control's own outline colour where it sets one), offset 2px | app-owned feature replaces a hand-written rule: version 2 turns on `features.focusRing`, and old-school has no focus rule of its own (the other five do, and theirs still win; measured identical) |
| Dead selectors removed | — | `.qt-foundry-card` and its six descendant rules | — | dead rule removed. The app's own `.qt-foundry-card` in `_surfaces.css` is dead too; left for the dead-code sweep |
| `--qt-entity-card-bg` (light) | character and project cards over a page background | `color-mix(in srgb, hsl(220 20% 100%) 90%, transparent)` | `color-mix(in srgb, hsl(0 0% 100%) 92%, transparent)` | decision 3 near-match, ΔE 0.0005 |
| `--qt-overlay-light-bg` (light) | light scrims over images | `hsl(220 15% 10% / 0.2)` | `color-mix(in srgb, rgb(16.32 19.04 24.48) 20%, transparent)` | decision 3 near-match, ΔE 0.0032 |
| `--qt-rp-button-narration-bg` (light) | Salon roleplay toolbar, Narration button | `hsl(220 14% 40%)` | `hsl(225 10% 38%)` | decision 3 near-match, ΔE 0.0188 |
| `--qt-sidebar-item-active-bg` (light) | left sidebar, the current item | `color-mix(in srgb, hsl(220 60% 20%) 10%, transparent)` | `color-mix(in srgb, hsl(220 60% 20%) 8%, transparent)` | decision 3 near-match, ΔE 0.0126 |
| `--qt-warning-box-bg` (light) | warning boxes in forms and settings | `hsl(38 92% 45% / 0.1)` | `color-mix(in srgb, hsl(38 92% 31.5%) 8%, transparent)` | decision 3 near-match, ΔE 0.0101 |
| `--qt-chat-wardrobe-bg` (dark) | Salon, wardrobe-change announcements | `color-mix(in srgb, hsl(220 15% 15%) 58%, hsl(38 75% 28%) 42%)` | `color-mix(in srgb, hsl(220 15% 15%) 60%, hsl(38 75% 28%) 40%)` | decision 3 near-match, ΔE 0.0051 |
| `--qt-entity-card-bg` (dark) | character and project cards over a page background | `color-mix(in srgb, hsl(220 20% 12%) 90%, transparent)` | `color-mix(in srgb, hsl(220 20% 12%) 92%, transparent)` | decision 3 near-match, ΔE 0.0009 |
| `--qt-overlay-light-bg` (dark) | light scrims over images | `hsl(220 15% 10% / 0.2)` | `color-mix(in srgb, rgb(16.32 19.04 24.48) 20%, transparent)` | decision 3 near-match, ΔE 0.0047 |
| `--qt-response-status-bg` (dark) | Salon, the response status strip while a reply streams | `color-mix(in srgb, hsl(220 15% 15%) 60%, transparent)` | `color-mix(in srgb, hsl(220 15% 15%) 40%, transparent)` | decision 3 near-match, ΔE 0.0152 |
| `--qt-rp-button-narration-bg` (dark) | Salon roleplay toolbar, Narration button | `hsl(220 14% 40%)` | `hsl(225 10% 38%)` | decision 3 near-match, ΔE 0.0188 |
| `--qt-sidebar-item-active-bg` (dark) | left sidebar, the current item | `color-mix(in srgb, hsl(220 50% 75%) 10%, transparent)` | `color-mix(in srgb, hsl(220 50% 75%) 8%, transparent)` | decision 3 near-match, ΔE 0.0137 |
| `--qt-warning-box-bg` (dark) | warning boxes in forms and settings | `hsl(38 92% 45% / 0.1)` | `color-mix(in srgb, hsl(38 90% 50%) 8%, transparent)` | decision 3 near-match, ΔE 0.0071 |


## rains

| What differs | Where it shows | Old value | New value | Reason |
|---|---|---|---|---|
| Corner radii inside the theme preview's sample | Appearance settings, rains' Preview | cards 12px, badges 24px (as in the app) | cards 8px, badges 12px | other, preview only: rains overrides Tailwind's `--radius-sm/md/lg/xl` on the root (kept in custom CSS, 6 / 12 / 24 / 32px), and the preview re-applies `--radius-*: var(--theme-radius-*)` on its nested `[data-theme]` container. The live app is unchanged. Folding the overrides into `--theme-radius-*` would change the sidebar and settings rail, which read that scale (8px), so the gap stays — **for the human to decide** |
| Fonts | code | the system monospace (version 1 named Fira Code and never applied it) | Fira Code | decision 1 |
| Bare `h1`–`h6` heading rule | headings without a `qt-*` class (Markdown); `h1`/`h2` Georgia → Inter where a page uses bare tags | Georgia | the body face; `.qt-dialog-title` and `.qt-empty-state-title` keep Georgia | selector moved to a hook; `h4`–`h6` and Markdown headings are a loss — **for the human to decide** |
| Body text weight | all text that sets no weight | 300 | 300, now from the new `--qt-body-font-weight` token | other: no change against version 1 |
| Scrollbar | every scrollbar | the theme's thumb on a transparent track | the same (see earl-grey) | other: no change against version 1 |
| Body background, dark | nowhere visible: `.qt-app-layout` paints over it | 34,34,32 | 41,37,33 (the same as `.qt-app-layout` in both) | other: invisible |
| Button border style | every button | `none` | `solid` at width 0 | other: invisible |
| Dead selectors removed | — | `.qt-chat-message:hover`, `.qt-sidebar-item-active`, `.qt-badge-characters` / `-chats` / `-user-characters`, `.qt-badge-enabled`, `.qt-badge-source-*`, `.qt-navbar-link*`, `.qt-auth-title`, `.qt-auth-card`, `.qt-skeleton`, `.message-enter` | — | dead rule removed |
| `--qt-entity-card-bg` (light) | character and project cards over a page background | `color-mix(in srgb, hsl(0 0% 100%) 90%, transparent)` | `color-mix(in srgb, hsl(0 0% 100%) 92%, transparent)` | decision 3 near-match, ΔE 0.0004 |
| `--qt-overlay-light-bg` (light) | light scrims over images | `hsl(35 12% 12% / 0.2)` | `color-mix(in srgb, rgb(29.325 26.1375 21.675) 20%, transparent)` | decision 3 near-match, ΔE 0.0031 |
| `--qt-entity-card-bg` (dark) | character and project cards over a page background | `color-mix(in srgb, hsl(30 8% 18.4%) 90%, transparent)` | `color-mix(in srgb, hsl(30 8% 18.4%) 92%, transparent)` | decision 3 near-match, ΔE 0.0008 |
| `--qt-overlay-light-bg` (dark) | light scrims over images | `hsl(30 8% 8% / 0.2)` | `color-mix(in srgb, rgb(14.025 12.75 11.475) 20%, transparent)` | decision 3 near-match, ΔE 0.0065 |
