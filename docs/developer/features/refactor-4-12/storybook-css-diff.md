# Storybook CSS — generated vs. hand copy

Phase 1 report for [Refactor 4.12 — The theme-storybook mirror is generated](../refactor-4-12-storybook-css-generated.md).
It compares the hand-maintained `packages/theme-storybook/src/css/qt-components.css`
as it stood at `25a20221` with the first output of `npm run generate:storybook-css`
(Tailwind 4.3.3). Phase 2 replaced the hand copy with that output; this file is the
record of what changed for theme authors.

Method: both files parsed with PostCSS, nested rules flattened to full selectors
(with any enclosing `@media` / `@supports` as a prefix, `@layer` ignored), and
compared selector by selector and declaration by declaration. Class counts are
distinct `.qt-*` tokens outside comments.

## Summary

| Measure | Hand copy | Generated |
|---|---|---|
| Distinct `.qt-*` classes | 566 | 893 |
| Classes only in this file | 7 (orphans, §B) | 334 (§A) |
| Flattened selectors carrying declarations | 934 | 1617 |
| Selectors only in the hand copy | 49 (§B) | — |
| Selectors in both with any declaration difference | 464 (§C) | |
| Bare `:hover` selectors (no `@media (hover: hover)`) | 128 | 0 |

(The spec's 567 / 894 count a trailing escaped character differently; the sets are the same.)

## Decisions taken

- **Storybook-only rules are dropped** (spec §8.2, default). Nothing in §B was a
  feature a theme author could rely on that the app lacks: each row is an orphan
  class, an un-scoped copy of a rule the app scopes, or the same rule in a
  different spelling.
- **`qt-tab-content`** (orphan) was used by the Tabs story. The app has no such
  class: `EntityTabs` (`components/tabs/entity-tabs.tsx`) renders the tab group,
  a `qt-tab-divider`, and an unstyled panel. The story now does the same.

## Findings that changed more than the CSS file

- **The `--qt-*` defaults need `data-theme` present.** The hand copy declared the
  component variables on `:root`; the app declares them on `[data-theme]` and
  `[data-theme].dark` (`_variables.css`). The storybook's `ThemeDecorator` left
  `data-theme` off for the default theme, so with the generated file the default
  view would have had no `--qt-button-*`, `--qt-card-*`, … at all. The decorator
  now sets `data-theme` always (`"default"` when no theme is chosen), the `light`
  / `dark` class, and `data-color-mode`, exactly as `applyThemeToDom`
  (`components/providers/theme/theme-utils.ts`) does on `<html>`.
- **Hover is media-gated.** Tailwind v4 compiles `hover:` to
  `&:hover { @media (hover: hover) { … } }`. The 128 bare `:hover` selectors in the
  hand copy behaved differently on touch devices; the generated file matches the app.
- **The file uses CSS nesting**, as Tailwind emits it (`&:hover`, nested `@media`
  and `@supports`). Every browser Storybook supports handles it.
- **Icon defaults are included.** `_icons.css` points `[data-icon]` masks at
  `/images/icons/*.svg`, which a theme author's Storybook does not serve. The
  Icons story documents names rather than rendering `qt-icon`, so nothing
  renders differently; a story that does render `<span class="qt-icon">` will
  need those SVGs served.

- **Dark mode never worked in Storybook.** `quilltap-defaults.css` declared the
  `--color-*` aliases only on `:root`, where `var(--theme-*)` resolved to the light
  values; the decorator's `.dark` sits on a child div, so it changed `--theme-*`
  and no alias. Both the hand copy and the generated file rendered light under
  "Dark". The aliases are now re-declared on `[data-theme]`, `.dark` and `.light`.
  (The hand copy additionally drew white cards in dark mode because its `--qt-*`
  defaults were also resolved on `:root`.)

## Visual check

Buttons, Cards, Chat, Tabs and Inputs stories rendered with Playwright, default
theme, light and dark, old CSS beside new. With the generated file the stories
match the app's look (bordered secondary/ghost buttons, the app's card header
row, inline message timestamps, the app's chat bubble spacing); dark mode renders
correctly for the first time. One story-side divergence: the Tabs story's
"Navigation Bar" demo uses markup that does not match the app's navbar, so under
the app's rules its links underline and the actions wrap below. That is the
story's markup, not the CSS.

## Pre-existing gaps noticed in passing (not changed)

The stories name a few classes that neither the hand copy nor the app defines:
`qt-badge-default`, `qt-badge-outline-{destructive,primary,success,warning}`,
`qt-badge-provider-{anthropic,google}`, `qt-chat-system-bar-chevron-down`,
`qt-confirmation-badge-label`, `qt-typing-indicator`. They rendered unstyled
before and still do.

## Detail

### A. Classes the generated file adds (334)

Grouped by the app family file that first defines them.

<details><summary><code>_chat.css</code> — 131</summary>

`qt-chat-attachment-button`, `qt-chat-attachment-chip`, `qt-chat-attachment-chip-icon`, `qt-chat-attachment-chip-icon-info`, `qt-chat-attachment-chip-icon-success`, `qt-chat-attachment-chip-remove`, `qt-chat-attachment-image`, `qt-chat-attachment-list`, `qt-chat-attachment-overlay`, `qt-chat-avatar-dangerous`, `qt-chat-composer-content`, `qt-chat-composer-inner`, `qt-chat-debug-panel`, `qt-chat-desktop-avatar`, `qt-chat-layout`, `qt-chat-main`, `qt-chat-main-split`, `qt-chat-message-actions`, `qt-chat-message-author`, `qt-chat-message-body`, `qt-chat-message-header`, `qt-chat-message-row`, `qt-chat-message-row-assistant`, `qt-chat-message-row-tool`, `qt-chat-message-row-user`, `qt-chat-message-system`, `qt-chat-message-time`, `qt-chat-message-tools`, `qt-chat-message-tools-before-prose`, `qt-chat-messages`, `qt-chat-messages-list`, `qt-chat-messages-viewport`, `qt-chat-pause-button`, `qt-chat-pause-button-paused`, `qt-chat-scroll-to-bottom`, `qt-chat-sidebar`, `qt-chat-sidebar-add`, `qt-chat-sidebar-collapsed`, `qt-chat-sidebar-collapsed-avatar`, `qt-chat-sidebar-collapsed-avatar-active`, `qt-chat-sidebar-collapsed-avatar-inactive`, `qt-chat-sidebar-collapsed-avatar-streaming`, `qt-chat-sidebar-collapsed-avatars`, `qt-chat-sidebar-collapsed-pause`, `qt-chat-sidebar-collapsed-pause-paused`, `qt-chat-sidebar-collapsed-position-badge`, `qt-chat-sidebar-collapsed-queue-badge`, `qt-chat-sidebar-debug`, `qt-chat-sidebar-header`, `qt-chat-sidebar-heading`, `qt-chat-sidebar-list`, `qt-chat-sidebar-meta`, `qt-chat-sidebar-overlay`, `qt-chat-sidebar-queue`, `qt-chat-sidebar-toggle`, `qt-chat-thinking`, `qt-chat-thinking-body`, `qt-chat-thinking-chevron`, `qt-chat-thinking-details`, `qt-chat-thinking-summary`, `qt-chat-tool-embedded`, `qt-chat-tool-result-chip`, `qt-chat-toolbar`, `qt-chat-toolbar-button`, `qt-chat-toolbar-button-active`, `qt-chat-toolbar-row`, `qt-collapsible-card-divider`, `qt-composer-gutter-button`, `qt-composer-gutter-column`, `qt-composer-gutter-rng`, `qt-composer-gutter-tools`, `qt-courier-bubble`, `qt-courier-bubble-actions`, `qt-courier-bubble-attachment-meta`, `qt-courier-bubble-attachments-label`, `qt-courier-bubble-attachments-list`, `qt-courier-bubble-error`, `qt-courier-bubble-header`, `qt-courier-bubble-hint`, `qt-courier-bubble-mode-badge`, `qt-courier-bubble-paste-label`, `qt-courier-bubble-prompt`, `qt-courier-bubble-prompt-body`, `qt-courier-bubble-prompt-toolbar`, `qt-courier-bubble-textarea`, `qt-courier-bubble-title`, `qt-participant-active-toggle`, `qt-participant-avatar-tool-button`, `qt-participant-avatar-tools`, `qt-participant-card`, `qt-participant-card-actions`, `qt-participant-card-active`, `qt-participant-card-avatar`, `qt-participant-card-dangerous`, `qt-participant-card-header`, `qt-participant-card-inactive`, `qt-participant-card-info`, `qt-participant-card-name`, `qt-participant-card-status`, `qt-participant-position-badge`, `qt-participant-position-eligible`, `qt-participant-position-generating`, `qt-participant-position-next`, `qt-participant-position-queued`, `qt-participant-position-spoken`, `qt-participant-position-user-turn`, `qt-participant-queue-badge`, `qt-participant-turn-dot`, `qt-participant-turn-indicator`, `qt-rp-annotation-button`, `qt-rp-annotation-button-internal`, `qt-rp-annotation-button-narration`, `qt-rp-annotation-button-ooc`, `qt-rp-annotation-toolbar`, `qt-source-mode-textarea`, `qt-thinking-indicator`, `qt-tool-palette-badge`, `qt-tool-palette-badge-off`, `qt-tool-palette-badge-on`, `qt-tool-palette-bar`, `qt-tool-palette-button`, `qt-tool-palette-button-danger`, `qt-tool-palette-inline-select`, `qt-tool-palette-popover`, `qt-tool-palette-section`, `qt-tool-palette-section-center`, `qt-tool-palette-section-content`, `qt-tool-palette-section-header`, `qt-tool-palette-section-left`, `qt-tool-palette-section-right`, `qt-tool-palette-select`

</details>

<details><summary><code>_content.css</code> — 69</summary>

`qt-about-intro`, `qt-autonomous-badge`, `qt-autonomous-badge-button`, `qt-autonomous-badge-group`, `qt-autonomous-badge-idle`, `qt-autonomous-badge-running`, `qt-avatar-group`, `qt-avatar-image`, `qt-badge-auto`, `qt-badge-autonomous-budget`, `qt-badge-autonomous-error`, `qt-badge-autonomous-idle`, `qt-badge-autonomous-paused`, `qt-badge-autonomous-running`, `qt-badge-autonomous-stopped`, `qt-badge-capability`, `qt-badge-character`, `qt-badge-characters`, `qt-badge-chat`, `qt-badge-chats`, `qt-badge-disabled`, `qt-badge-enabled`, `qt-badge-manual`, `qt-badge-memory`, `qt-badge-message`, `qt-badge-project`, `qt-badge-related`, `qt-badge-source-git`, `qt-badge-source-included`, `qt-badge-source-manual`, `qt-badge-source-npm`, `qt-badge-tag`, `qt-badge-user-character`, `qt-badge-user-characters`, `qt-badge-version`, `qt-code-block`, `qt-code-header`, `qt-code-inline`, `qt-empty-state`, `qt-empty-state-action`, `qt-empty-state-description`, `qt-empty-state-icon`, `qt-empty-state-title`, `qt-frontmatter`, `qt-frontmatter-chip-list`, `qt-frontmatter-table`, `qt-frontmatter-title`, `qt-heading-1`, `qt-heading-2`, `qt-heading-3`, `qt-heading-4`, `qt-heading-lg`, `qt-heading-sm`, `qt-markdown`, `qt-prose`, `qt-skeleton`, `qt-skeleton-circle`, `qt-skeleton-text`, `qt-spinner-sm`, `qt-tag-badge`, `qt-tag-badge-emoji`, `qt-tag-badge-md`, `qt-tag-badge-remove`, `qt-tag-badge-sm`, `qt-text-label`, `qt-text-label-xs`, `qt-text-large`, `qt-text-lead`, `qt-text-section`

</details>

<details><summary><code>_interactive.css</code> — 8</summary>

`qt-hint`, `qt-input-error`, `qt-label`, `qt-link-subtle`, `qt-qtap-doc--inert`, `qt-qtap-doc-icon`, `qt-select-sm`, `qt-tab-icon`

</details>

<details><summary><code>_layout.css</code> — 84</summary>

`qt-auth-card`, `qt-auth-divider`, `qt-auth-divider-line`, `qt-auth-divider-text`, `qt-auth-field`, `qt-auth-footer`, `qt-auth-form`, `qt-auth-header`, `qt-auth-hint`, `qt-auth-label`, `qt-auth-page`, `qt-auth-subtitle`, `qt-auth-title`, `qt-card-grid-2`, `qt-card-grid-3`, `qt-card-grid-auto`, `qt-characters-grid`, `qt-content`, `qt-content-scroll`, `qt-font-brand`, `qt-homepage-container`, `qt-homepage-grid`, `qt-homepage-section`, `qt-homepage-section-content`, `qt-homepage-section-header`, `qt-homepage-section-link`, `qt-homepage-section-title`, `qt-layout-main`, `qt-layout-sidebar`, `qt-layout-with-sidebar`, `qt-left-sidebar-footer-actions`, `qt-left-sidebar-items`, `qt-left-sidebar-profile`, `qt-left-sidebar-profile-avatar`, `qt-left-sidebar-profile-email`, `qt-left-sidebar-profile-info`, `qt-left-sidebar-profile-name`, `qt-left-sidebar-resize-handle`, `qt-left-sidebar-resize-handle-active`, `qt-left-sidebar-resizing`, `qt-left-sidebar-section-collapsed`, `qt-left-sidebar-section-content`, `qt-left-sidebar-section-grow`, `qt-left-sidebar-section-header`, `qt-left-sidebar-section-placeholder`, `qt-left-sidebar-toggle`, `qt-left-sidebar-view-all`, `qt-navbar-button`, `qt-navbar-chip-button`, `qt-navbar-chip-button-active`, `qt-navbar-container`, `qt-navbar-dropdown`, `qt-navbar-dropdown-divider`, `qt-navbar-dropdown-header`, `qt-navbar-dropdown-item`, `qt-navbar-dropdown-item-active`, `qt-navbar-dropdown-label`, `qt-navbar-dropdown-left`, `qt-navbar-dropdown-section`, `qt-navbar-dropdown-subtext`, `qt-navbar-menu-item-content`, `qt-navbar-menu-item-icon`, `qt-navbar-menu-item-label-full`, `qt-navbar-menu-item-label-short`, `qt-navbar-section`, `qt-navbar-submenu`, `qt-navbar-submenu-arrow`, `qt-navbar-submenu-item`, `qt-navbar-submenu-item-active`, `qt-navbar-toggle`, `qt-navbar-toggle-active`, `qt-page`, `qt-page-description`, `qt-page-header`, `qt-page-title`, `qt-page-with-navbar`, `qt-pretheme-bg`, `qt-quick-actions`, `qt-sidebar`, `qt-sidebar-item`, `qt-sidebar-item-active`, `qt-sidebar-section`, `qt-sidebar-title`, `qt-two-col`

</details>

<details><summary><code>_surfaces.css</code> — 11</summary>

`qt-collapsible-card`, `qt-collapsible-card-body`, `qt-collapsible-card-chevron`, `qt-collapsible-card-chevron-open`, `qt-collapsible-card-header`, `qt-collapsible-card-icon`, `qt-dropdown-separator`, `qt-entity-card-actions`, `qt-foundry-card`, `qt-foundry-card-content`, `qt-foundry-card-image`

</details>

<details><summary><code>_typography.css</code> — 10</summary>

`qt-action`, `qt-body`, `qt-body-sm`, `qt-caption`, `qt-card-subtitle`, `qt-helper`, `qt-meta`, `qt-page-subtitle`, `qt-section-subtitle`, `qt-section-title`

</details>

<details><summary><code>_utilities.css</code> — 6</summary>

`qt-dot-destructive`, `qt-dot-info`, `qt-dot-success`, `qt-dot-warning`, `qt-option-selected`, `qt-option-unselected`

</details>

<details><summary><code>_workspace.css</code> — 15</summary>

`qt-salon-portaled-pane`, `qt-tab-dragging`, `qt-tab-pane`, `qt-tab-portal-empty`, `qt-tab-portal-host`, `qt-tab-portal-mount`, `qt-workspace`, `qt-workspace-backdrop`, `qt-workspace-backdrop-layer`, `qt-workspace-backdrop-left`, `qt-workspace-backdrop-right`, `qt-workspace-divider-cell`, `qt-workspace-empty`, `qt-workspace-empty-hint`, `qt-workspace-pane-chrome`

</details>

### B. Storybook-only selectors dropped (49)

Flattened selectors (with any enclosing `@media`) present in the hand copy and absent, in that exact form, from the generated file.

| Selector | Why it goes |
|---|---|
| `.dark .qt-prose-auto` | The `dark:` variant compiles to `:is(.dark) .qt-prose-auto`. |
| `.qt-avatar img` | Not in the app; `qt-avatar` styles its own box only. |
| `.qt-button-icon:hover` | Hover now compiles inside `@media (hover: hover)`, as in the app. |
| `.qt-chat-dialogue` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-chat-inner-monologue` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-chat-message-user .qt-chat-dialogue` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-chat-narration` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-chat-ooc` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-dialog-backdrop` | Orphan: the class no longer exists in the app. |
| `.qt-floating-dialog-close:hover` | Hover now compiles inside `@media (hover: hover)`, as in the app. |
| `.qt-hamburger` | Orphan: the class no longer exists in the app. |
| `.qt-hamburger:hover` | Orphan: the class no longer exists in the app. |
| `.qt-left-sidebar-header` | Orphan: the class no longer exists in the app. |
| `.qt-left-sidebar-overlay` | Orphan: the class no longer exists in the app. |
| `.qt-left-sidebar-overlay-visible` | Orphan: the class no longer exists in the app. |
| `.qt-lexical-contenteditable` | App only styles it as `.qt-chat-composer-input.qt-lexical-contenteditable`. |
| `.qt-roleplay-1` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-roleplay-2` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-roleplay-3` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-roleplay-4` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-roleplay-code` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-roleplay-danger` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-roleplay-info` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-roleplay-muted` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-roleplay-success` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-roleplay-warning` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-rp-bold` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-rp-border` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-rp-border-dashed` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-rp-font-display` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-rp-font-mono` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-rp-font-sans` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-rp-font-script` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-rp-font-serif` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-rp-italic` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-rp-reverse` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-rp-underline` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-rp-underline-double` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `.qt-settings-field-group > :not(:last-child)` | Tailwind `space-y-*` compiles to `:where(… > :not(:last-child))`. |
| `.qt-tab-content` | Orphan: the class no longer exists in the app. |
| `.qt-tab:hover` | Hover now compiles inside `@media (hover: hover)`, as in the app. |
| `:is(p, blockquote, h1, h2, h3, h4, h5, h6):is(.qt-chat-narration, .qt-chat-ooc, .qt-chat-inner-monologue)` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |
| `@media (max-width: 767px) \|\| .qt-hamburger` | Orphan: the class no longer exists in the app. |
| `@media (max-width: 767px) \|\| .qt-left-sidebar` | Mobile left-sidebar rules the app no longer has. |
| `@media (max-width: 767px) \|\| .qt-left-sidebar-mobile-open` | Orphan: the class no longer exists in the app. |
| `@media (min-width: 40rem) \|\| .qt-footer-path` | Same breakpoint, now spelled `@media (width >= 40rem)` as Tailwind emits it. |
| `@media (min-width: 40rem) \|\| .qt-footer-separator` | Same breakpoint, now spelled `@media (width >= 40rem)` as Tailwind emits it. |
| `@media (min-width: 640px) \|\| .qt-copy-button-text` | Same breakpoint, now spelled `@media (width >= 40rem)` as Tailwind emits it. |
| `li:is(.qt-chat-narration, .qt-chat-ooc, .qt-chat-inner-monologue)` | Un-scoped copy; the app scopes it under `.qt-chat-message-content` (the stories already wrap it). |

### C. Selectors in both whose declarations differ (464 selectors, 2235 declarations)

For each, the properties whose value differs (`~`), that only the hand copy had (`−`), or that only the generated file has (`+`). Most are Tailwind expansions (`0.5rem` → `calc(var(--spacing, 0.25rem) * 2)`, `transition-colors` → its property list) or values the app changed after the hand copy was taken.

<details><summary>Show all 464</summary>

| Selector | Properties |
|---|---|
| `:root` | −`--qt-button-radius` −`--qt-button-padding-x` −`--qt-button-padding-y` −`--qt-button-font-size` −`--qt-button-font-weight` −`--qt-button-transition` −`--qt-button-primary-bg` −`--qt-button-primary-fg` −`--qt-button-primary-hover-bg` −`--qt-button-primary-shadow` −`--qt-button-secondary-bg` −`--qt-button-secondary-fg` … (+437 more) |
| `.qt-button` | ~`gap` ~`line-height` −`border` −`text-decoration` −`white-space` +`--tw-font-weight` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` |
| `.qt-button:disabled` | ~`opacity` |
| `.qt-button-primary` | −`background-color` +`display` +`align-items` +`justify-content` +`gap` +`font-size` +`line-height` +`--tw-font-weight` +`font-weight` +`transition-property` +`transition-timing-function` +`transition-duration` … (+7 more) |
| `.qt-button-primary:hover:not(:disabled)` | −`background-color` +`background` |
| `.qt-button-secondary` | −`background-color` −`border-color` +`display` +`align-items` +`justify-content` +`gap` +`font-size` +`line-height` +`--tw-font-weight` +`font-weight` +`transition-property` +`transition-timing-function` … (+8 more) |
| `.qt-button-secondary:hover:not(:disabled)` | −`background-color` +`background` |
| `.qt-button-ghost` | −`background-color` +`display` +`align-items` +`justify-content` +`gap` +`font-size` +`line-height` +`--tw-font-weight` +`font-weight` +`transition-property` +`transition-timing-function` +`transition-duration` … (+6 more) |
| `.qt-button-ghost:hover:not(:disabled)` | −`background-color` +`background` |
| `.qt-button-destructive` | −`background-color` +`display` +`align-items` +`justify-content` +`gap` +`font-size` +`line-height` +`--tw-font-weight` +`font-weight` +`transition-property` +`transition-timing-function` +`transition-duration` … (+6 more) |
| `.qt-button-destructive:hover:not(:disabled)` | −`background-color` +`background` |
| `.qt-button-warning` | −`background-color` +`display` +`align-items` +`justify-content` +`gap` +`font-size` +`line-height` +`--tw-font-weight` +`font-weight` +`transition-property` +`transition-timing-function` +`transition-duration` … (+6 more) |
| `.qt-button-warning:hover:not(:disabled)` | −`background-color` +`background` |
| `.qt-button-success` | ~`gap` ~`line-height` −`border` −`background-color` +`--tw-font-weight` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` +`background` |
| `.qt-button-success:disabled` | ~`opacity` |
| `.qt-button-success:hover:not(:disabled)` | −`background-color` +`background` |
| `.qt-button-sm` | −`padding` ~`font-size` +`padding-inline` +`padding-block` +`line-height` |
| `.qt-button-lg` | −`padding` ~`font-size` +`padding-inline` +`padding-block` +`line-height` |
| `.qt-button-icon` | −`width` −`height` ~`padding` −`background-color` −`color` −`border` +`gap` +`font-size` +`line-height` +`--tw-font-weight` +`font-weight` +`transition-property` … (+4 more) |
| `.qt-card` | −`background-color` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` +`padding` +`background` |
| `.qt-card-interactive:hover` | −`transform` +`--tw-translate-y` +`translate` +`border-color` |
| `.qt-card:has([aria-haspopup][aria-expanded="true"])` | −`transform` +`translate` |
| `.qt-card-interactive:has([aria-haspopup][aria-expanded="true"])` | −`transform` +`translate` |
| `.qt-card-header` | −`padding` −`padding-bottom` +`margin-bottom` +`display` +`align-items` +`justify-content` |
| `.qt-card-title` | ~`font-size` ~`font-weight` ~`line-height` −`margin` +`--tw-font-weight` +`color` +`font-family` |
| `.qt-card-description` | ~`font-size` ~`color` −`margin-top` +`line-height` |
| `.qt-card-body` | −`padding` +`flex` |
| `.qt-card-footer` | −`align-items` −`justify-content` ~`gap` −`padding` ~`padding-top` +`margin-top` +`flex-wrap` +`border-top` |
| `.qt-entity-card` | −`background-color` ~`border-radius` +`display` +`height` +`flex-direction` +`gap` +`padding` +`background` +`color` +`box-shadow` |
| `.qt-entity-card:hover` | +`--tw-translate-y` +`translate` |
| `.qt-character-card` | ~`gap` ~`border-radius` −`background-color` ~`border` +`background` |
| `.qt-panel` | −`background-color` ~`border` ~`border-radius` +`padding` +`background` |
| `.qt-panel-elevated` | ~`box-shadow` +`padding` +`border-radius` +`background` +`border` |
| `.qt-input` | −`background-color` ~`font-size` ~`line-height` ~`transition` +`background` |
| `.qt-input::placeholder` | ~`color` |
| `.qt-input:focus` | −`outline` ~`box-shadow` +`--tw-ring-shadow` +`--tw-outline-style` +`outline-style` +`--tw-ring-color` |
| `.qt-input:disabled` | −`opacity` +`background-color` |
| `.qt-textarea` | ~`min-height` +`width` +`font-size` +`line-height` +`padding` +`border-radius` +`background` +`color` +`border` +`transition` |
| `.qt-select` | ~`background-position` ~`background-size` +`width` +`font-size` +`line-height` +`padding` +`border-radius` +`background` +`color` +`border` +`transition` +`cursor` … (+2 more) |
| `.qt-checkbox` | −`cursor` |
| `.qt-checkbox:focus` | −`outline` ~`box-shadow` +`--tw-ring-shadow` +`--tw-ring-color` |
| `.qt-radio` | ~`border-radius` −`cursor` |
| `.qt-radio:focus` | −`outline` ~`box-shadow` +`--tw-ring-shadow` +`--tw-ring-color` |
| `.qt-range:focus-visible` | −`outline` ~`box-shadow` +`--tw-ring-shadow` +`--tw-outline-style` +`outline-style` +`--tw-ring-color` |
| `.qt-badge` | −`line-height` +`flex-shrink` +`justify-content` |
| `.qt-badge-primary` | −`background-color` ~`color` +`display` +`flex-shrink` +`align-items` +`justify-content` +`padding` +`border-radius` +`font-size` +`font-weight` +`background` |
| `.qt-badge-secondary` | −`background-color` ~`color` +`display` +`flex-shrink` +`align-items` +`justify-content` +`padding` +`border-radius` +`font-size` +`font-weight` +`background` |
| `.qt-badge-success` | +`display` +`flex-shrink` +`align-items` +`justify-content` +`padding` +`border-radius` +`font-size` +`font-weight` |
| `.qt-badge-warning` | +`display` +`flex-shrink` +`align-items` +`justify-content` +`padding` +`border-radius` +`font-size` +`font-weight` |
| `.qt-badge-destructive` | +`display` +`flex-shrink` +`align-items` +`justify-content` +`padding` +`border-radius` +`font-size` +`font-weight` |
| `.qt-badge-info` | +`display` +`flex-shrink` +`align-items` +`justify-content` +`padding` +`border-radius` +`font-size` +`font-weight` |
| `.qt-badge-outline` | −`background-color` ~`color` ~`border` +`display` +`flex-shrink` +`align-items` +`justify-content` +`padding` +`border-radius` +`font-size` +`font-weight` +`background` |
| `.qt-danger-badge` | ~`gap` −`padding` ~`font-size` ~`line-height` ~`font-weight` ~`background` ~`border` +`padding-inline` +`padding-block` +`--tw-font-weight` |
| `.qt-concierge-mark` | ~`font-weight` +`--tw-leading` +`--tw-font-weight` |
| `.qt-avatar` | −`background-color` −`font-weight` +`position` +`flex-shrink` +`background` +`border` |
| `.qt-avatar-sm` | ~`font-size` +`line-height` |
| `.qt-avatar-lg` | ~`font-size` +`line-height` |
| `.qt-avatar-xl` | ~`font-size` +`line-height` |
| `.qt-avatar-fallback` | +`font-size` +`line-height` +`--tw-font-weight` +`font-weight` |
| `.qt-avatar-labels` | ~`margin-top` |
| `.qt-avatar-name` | ~`font-size` ~`font-weight` ~`color` +`line-height` +`--tw-font-weight` |
| `.qt-avatar-title` | ~`font-size` ~`color` +`line-height` |
| `.qt-dialog` | −`background-color` ~`max-width` −`max-height` −`overflow` +`position` +`background` |
| `.qt-dialog-header` | −`padding` −`padding-bottom` +`padding-inline` +`padding-block` +`border-bottom` |
| `.qt-dialog-title` | ~`font-size` ~`font-weight` −`margin` +`line-height` +`--tw-font-weight` +`color` |
| `.qt-dialog-description` | ~`font-size` ~`color` ~`margin-top` +`line-height` |
| `.qt-dialog-body` | −`padding` +`padding-inline` +`padding-block` |
| `.qt-dialog-footer` | −`align-items` ~`gap` −`padding` −`padding-top` +`padding-inline` +`padding-block` +`background-color` +`border-top` +`border-radius` |
| `.qt-dialog-wide` | ~`max-width` |
| `.qt-floating-dialog` | ~`border-radius` ~`background` ~`border` ~`box-shadow` |
| `.qt-floating-dialog-header` | −`padding` ~`border-bottom` ~`background` +`padding-inline` +`padding-block` +`-webkit-user-select` +`-moz-user-select` |
| `.qt-floating-dialog-title` | ~`font-size` ~`line-height` ~`font-weight` ~`color` +`--tw-font-weight` |
| `.qt-floating-dialog-actions` | ~`gap` |
| `.qt-floating-dialog-close` | ~`padding` ~`color` −`transition` +`transition-property` +`transition-timing-function` +`transition-duration` |
| `.qt-floating-dialog-body` | ~`flex` |
| `.qt-help-msg-user` | ~`border-radius` −`padding-left` −`padding-right` ~`padding-top` ~`padding-bottom` ~`font-size` ~`line-height` ~`background-color` ~`color` +`padding-inline` |
| `.qt-help-msg-assistant` | ~`border-radius` −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`font-size` ~`line-height` ~`background-color` ~`color` +`padding-inline` +`padding-block` |
| `.qt-help-msg-character-name` | ~`font-size` ~`line-height` ~`font-weight` ~`color` ~`margin-bottom` +`--tw-font-weight` |
| `.qt-help-avatar` | ~`width` ~`height` ~`border-radius` ~`background-color` |
| `.qt-help-composer` | ~`gap` ~`padding` |
| `.qt-help-composer-input` | ~`flex` ~`border-radius` −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`font-size` ~`line-height` +`padding-inline` +`padding-block` +`--tw-ring-offset-color` |
| `.qt-help-composer-input::placeholder` | ~`color` |
| `.qt-help-composer-input:focus-visible` | ~`box-shadow` +`--tw-ring-shadow` +`--tw-ring-color` +`--tw-outline-style` |
| `.qt-help-composer-input:disabled` | ~`opacity` |
| `.qt-help-composer-send` | ~`border-radius` −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`font-size` ~`line-height` ~`font-weight` ~`background-color` ~`color` +`padding-inline` +`padding-block` … (+1 more) |
| `.qt-help-composer-send:disabled` | ~`opacity` |
| `.qt-help-char-pill` | ~`gap` −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`border-radius` ~`font-size` ~`line-height` ~`transition-property` ~`transition-timing-function` ~`transition-duration` ~`color` … (+2 more) |
| `.qt-help-char-pill[data-selected="true"]` | ~`background` |
| `.qt-help-past-chat` | ~`gap` −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` +`padding-inline` +`padding-block` |
| `.qt-help-section-label` | ~`font-size` ~`line-height` ~`font-weight` ~`color` ~`margin-bottom` +`--tw-font-weight` |
| `.qt-help-error` | −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`font-size` ~`line-height` ~`background` ~`border-bottom` +`padding-inline` +`padding-block` |
| `.qt-help-nav-button` | ~`gap` −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`font-size` ~`line-height` ~`font-weight` ~`border-radius` ~`transition-property` ~`transition-timing-function` ~`transition-duration` … (+5 more) |
| `.qt-help-nav-button:hover` | ~`background` ~`border-color` |
| `.qt-help-suggested-links` | ~`padding-left` ~`padding-top` |
| `.qt-help-suggested-links-label` | ~`letter-spacing` ~`font-weight` ~`margin-bottom` +`--tw-font-weight` +`--tw-tracking` |
| `.qt-help-suggested-link` | ~`gap` −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`transition-property` ~`transition-timing-function` ~`transition-duration` ~`background` +`padding-inline` +`padding-block` |
| `.qt-help-suggested-link:hover` | ~`background` ~`border-color` |
| `.qt-help-entity-picker-backdrop` | ~`inset` |
| `.qt-help-entity-picker` | ~`border-radius` ~`box-shadow` +`--tw-shadow` |
| `.qt-help-entity-picker-header` | −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`font-size` ~`line-height` ~`font-weight` +`padding-inline` +`padding-block` +`--tw-font-weight` |
| `.qt-help-entity-picker-filter` | −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`font-size` ~`line-height` +`padding-inline` +`padding-block` |
| `.qt-help-entity-picker-filter:focus` | ~`border-color` |
| `.qt-help-entity-picker-list` | ~`flex` −`padding-top` −`padding-bottom` +`padding-block` |
| `.qt-help-entity-picker-item` | −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`font-size` ~`line-height` ~`transition-property` ~`transition-timing-function` ~`transition-duration` +`padding-inline` +`padding-block` |
| `.qt-help-entity-picker-item:hover` | ~`background` |
| `.qt-help-guide-search-icon` | ~`left` ~`width` ~`height` |
| `.qt-help-guide-search-input` | ~`padding-left` ~`padding-right` −`padding-top` −`padding-bottom` ~`font-size` ~`line-height` ~`border-radius` ~`border-style` +`padding-block` |
| `.qt-help-guide-search-input:focus` | ~`box-shadow` +`--tw-ring-shadow` +`--tw-ring-color` +`--tw-ring-offset-width` +`--tw-ring-offset-shadow` +`--tw-outline-style` |
| `.qt-help-guide-search-clear` | ~`right` ~`padding` ~`border-radius` ~`transition-property` ~`transition-timing-function` ~`transition-duration` |
| `.qt-help-guide-category` | ~`border-bottom-style` ~`border-color` |
| `.qt-help-guide-category:last-child` | ~`border-bottom-width` +`border-bottom-style` |
| `.qt-help-guide-category-header` | ~`gap` −`padding-top` −`padding-bottom` −`padding-left` −`padding-right` ~`font-size` ~`line-height` ~`transition-property` ~`transition-timing-function` ~`transition-duration` +`padding-inline` +`padding-block` |
| `.qt-help-guide-category-chevron` | ~`width` ~`height` ~`transition-timing-function` +`--tw-duration` |
| `.qt-help-guide-category-label` | ~`flex` ~`font-weight` +`--tw-font-weight` |
| `.qt-help-guide-category-badge` | ~`font-size` ~`line-height` |
| `.qt-help-guide-category-topics` | ~`padding-bottom` |
| `.qt-help-guide-topic` | −`padding-top` −`padding-bottom` ~`padding-left` ~`padding-right` ~`font-size` ~`line-height` ~`transition-property` ~`transition-timing-function` ~`transition-duration` ~`border-radius` +`padding-block` |
| `.qt-help-guide-topic:hover` | ~`background` |
| `.qt-help-guide-back` | ~`gap` −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`font-size` ~`line-height` ~`font-weight` ~`border-bottom-style` ~`transition-property` ~`transition-timing-function` ~`transition-duration` … (+4 more) |
| `.qt-help-guide-back:hover` | ~`background` |
| `.qt-help-guide-reader` | ~`flex` −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` +`padding-inline` +`padding-block` |
| `.qt-help-guide-reader h1` | ~`font-size` ~`line-height` ~`font-weight` ~`margin-top` ~`margin-bottom` +`--tw-font-weight` |
| `.qt-help-guide-reader h2` | ~`font-size` ~`line-height` ~`font-weight` ~`margin-top` ~`margin-bottom` +`--tw-font-weight` |
| `.qt-help-guide-reader h3` | ~`font-size` ~`line-height` ~`font-weight` ~`margin-top` ~`margin-bottom` +`--tw-font-weight` |
| `.qt-help-guide-reader p` | ~`margin-bottom` |
| `.qt-help-guide-reader ul` | ~`margin-bottom` ~`padding-left` |
| `.qt-help-guide-reader ol` | ~`margin-bottom` ~`padding-left` |
| `.qt-help-guide-reader li` | ~`margin-bottom` |
| `.qt-help-guide-reader strong` | ~`font-weight` +`--tw-font-weight` |
| `.qt-help-guide-reader table` | ~`margin-bottom` ~`font-size` ~`line-height` |
| `.qt-help-guide-reader th` | −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`border-style` ~`border-color` ~`font-weight` ~`background` +`padding-inline` +`padding-block` +`--tw-font-weight` |
| `.qt-help-guide-reader td` | −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`border-style` ~`border-color` +`padding-inline` +`padding-block` |
| `.qt-help-guide-reader hr` | −`margin-top` −`margin-bottom` ~`border-color` +`margin-block` |
| `.qt-help-guide-inline-code` | −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`font-size` ~`line-height` +`padding-inline` +`padding-block` |
| `.qt-help-guide-code-block` | ~`border-radius` ~`padding` ~`margin-bottom` ~`font-size` ~`line-height` |
| `.qt-help-guide-nav-callout` | −`margin-top` −`margin-bottom` +`margin-block` |
| `.qt-help-welcome-card` | ~`border-radius` ~`border-style` ~`padding` ~`margin-bottom` ~`background` ~`border-color` |
| `.qt-help-welcome-title` | ~`font-size` ~`line-height` ~`font-weight` ~`margin-bottom` +`--tw-font-weight` |
| `.qt-help-welcome-text` | ~`font-size` ~`line-height` ~`margin-bottom` |
| `.qt-help-welcome-links` | ~`gap` ~`margin-bottom` |
| `.qt-help-welcome-link` | ~`gap` ~`font-size` ~`line-height` −`padding-top` −`padding-bottom` ~`transition-property` ~`transition-timing-function` ~`transition-duration` +`padding-block` |
| `.qt-help-welcome-footer` | ~`font-size` ~`line-height` |
| `.qt-slide-over-overlay` | ~`inset` −`background-color` +`background` |
| `.qt-slide-over-panel` | ~`right` ~`top` −`background-color` +`background` |
| `.qt-slide-over-header` | −`padding` +`padding-inline` +`padding-block` |
| `.qt-inspector-entry` | −`transition` ~`border` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` |
| `.qt-inspector-entry:hover` | ~`border-color` |
| `.qt-tab-group` | −`border-bottom` +`flex-wrap` |
| `.qt-tab` | −`background-color` −`border` ~`transition` +`display` +`min-width` +`align-items` +`gap` +`border-style` +`border-width` +`border-bottom-style` +`border-bottom-width` +`background` … (+1 more) |
| `.qt-tab-active` | −`background-color` +`background` +`border-color` +`position` |
| `.qt-chat-message` | −`max-width` +`position` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` +`box-shadow` |
| `.qt-chat-message-user` | −`background-color` −`margin-left` +`position` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` +`padding` +`border-radius` +`box-shadow` +`background` +`border` … (+4 more) |
| `.qt-chat-message-assistant` | −`background-color` ~`border` +`position` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` +`padding` +`border-radius` +`box-shadow` +`background` +`font-family` … (+4 more) |
| `.qt-chat-message-whisper` | +`position` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` +`padding` +`border-radius` +`box-shadow` |
| `.qt-confirmation-badge` | ~`border` +`-webkit-user-select` +`-moz-user-select` |
| `.qt-confirmation-badge:hover` | ~`border-color` ~`background` |
| `.qt-confirmation-badge:focus-visible` | ~`border-color` ~`background` ~`outline` |
| `.qt-chat-message-user .qt-confirmation-badge:hover` | ~`background` |
| `.qt-chat-message-user .qt-confirmation-badge:focus-visible` | ~`background` |
| `.qt-chat-established-fact-toggle` | ~`background-color` |
| `.qt-chat-message-silent` | +`position` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` +`padding` +`border-radius` +`box-shadow` |
| `.qt-chat-message-regenerating` | ~`border-color` |
| `.qt-chat-regenerating-original` | +`-webkit-user-select` +`-moz-user-select` |
| `.qt-chat-regenerating-plate` | ~`inset` ~`gap` |
| `.qt-chat-regenerating-plate-text` | ~`font-size` ~`line-height` ~`font-weight` −`padding` ~`border-radius` ~`background` ~`border` +`padding-inline` +`padding-block` +`--tw-font-weight` |
| `.qt-chat-message-action-bar` | ~`display` ~`gap` ~`margin-top` ~`padding-top` ~`border-top` +`flex-wrap` +`max-width` |
| `.qt-chat-message-action-bar-icons` | ~`gap` +`flex-wrap` |
| `.qt-chat-message-action-icon` | ~`padding` ~`transition-property` ~`transition-timing-function` ~`transition-duration` |
| `.qt-chat-message-action-icon:hover` | ~`background` |
| `.qt-chat-message-action-icon-danger:hover` | ~`background` |
| `.qt-chat-message-action-icon svg` | ~`width` ~`height` |
| `.qt-chat-message-action-icon .qt-icon` | ~`width` ~`height` |
| `.qt-chat-message-user .qt-chat-message-action-bar` | ~`border-top-color` |
| `.qt-chat-message-user .qt-chat-message-action-icon` | ~`color` |
| `.qt-chat-message-user .qt-chat-message-action-icon:hover` | ~`background` |
| `.qt-chat-message-action-timestamp` | ~`font-size` ~`line-height` ~`color` |
| `.qt-chat-message-user .qt-chat-message-action-timestamp` | ~`color` |
| `.qt-chat-response-status` | ~`gap` −`padding` ~`font-size` ~`line-height` ~`margin-bottom` ~`border-radius` +`padding-inline` +`padding-block` |
| `.qt-chat-response-status-icon` | ~`width` ~`height` |
| `.qt-chat-response-status-text` | ~`font-weight` +`--tw-font-weight` |
| `.qt-chat-response-status[data-stage="compressing"]` | ~`border-color` |
| `.qt-chat-response-status[data-stage="gathering"]` | ~`border-color` |
| `.qt-chat-response-status[data-stage="building"]` | ~`border-color` |
| `.qt-chat-response-status[data-stage="sending"]` | ~`border-color` |
| `.qt-chat-response-status[data-stage="streaming"]` | ~`border-color` |
| `.qt-chat-response-status[data-stage="regenerating"]` | ~`border-color` |
| `.qt-chat-response-status[data-stage="saving"]` | ~`border-color` |
| `.qt-chat-response-status[data-stage="tool_executing"]` | ~`border-color` |
| `.qt-badge-silent` | ~`border-radius` ~`padding` ~`font-weight` ~`font-size` +`padding-inline` +`padding-block` +`--tw-font-weight` +`display` +`flex-shrink` +`align-items` +`justify-content` |
| `.qt-badge-absent` | ~`background` ~`border-radius` ~`padding` ~`font-weight` ~`font-size` +`padding-inline` +`padding-block` +`--tw-font-weight` +`display` +`flex-shrink` +`align-items` +`justify-content` |
| `.qt-participant-status-overlay` | ~`bottom` ~`right` ~`width` ~`height` ~`border-radius` |
| `.qt-chat-composer` | −`display` −`align-items` −`gap` ~`padding` −`background-color` −`border` −`border-radius` +`background` +`border-top` +`padding-top` +`padding-bottom` |
| `.qt-chat-composer-input` | ~`min-height` ~`padding` −`background-color` ~`border` ~`font-family` ~`font-size` ~`line-height` ~`color` +`max-height` +`width` +`align-self` +`border-radius` … (+1 more) |
| `.qt-chat-composer-input:focus` | −`outline` +`--tw-ring-shadow` +`box-shadow` +`--tw-outline-style` +`outline-style` +`border-color` +`--tw-ring-color` |
| `.qt-chat-composer-input:focus-within` | −`outline` +`border-color` +`--tw-ring-color` |
| `.qt-chat-composer-send` | ~`height` ~`width` ~`border-radius` −`transition` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` |
| `.qt-chat-composer-send:focus-visible` | −`outline` ~`box-shadow` +`--tw-ring-shadow` +`--tw-ring-color` +`--tw-ring-offset-width` +`--tw-ring-offset-shadow` +`--tw-outline-style` +`outline-style` |
| `.qt-chat-composer-send:disabled` | ~`opacity` |
| `.qt-chat-stop-button:hover:not(:disabled)` | ~`background` |
| `.qt-chat-interrupt-button:hover:not(:disabled)` | ~`background` |
| `.qt-chat-interrupt-button-raised` | ~`box-shadow` |
| `::highlight(qt-punctuation-warning)` | +`-webkit-text-decoration` |
| `::highlight(qt-punctuation-no-dialogue)` | +`-webkit-text-decoration` |
| `.qt-lexical-contenteditable [contenteditable]` | +`background` |
| `.qt-lexical-placeholder` | ~`color` ~`font-size` ~`padding` +`line-height` |
| `.qt-lexical-code` | ~`font-family` ~`font-size` ~`background` +`line-height` |
| `.qt-lexical-h1` | ~`font-size` ~`font-weight` +`line-height` +`--tw-font-weight` |
| `.qt-lexical-h2` | ~`font-size` ~`font-weight` +`line-height` +`--tw-font-weight` |
| `.qt-lexical-h3` | ~`font-size` ~`font-weight` +`line-height` +`--tw-font-weight` |
| `.qt-lexical-h4` | ~`font-size` ~`font-weight` +`line-height` +`--tw-font-weight` |
| `.qt-lexical-h5` | ~`font-size` ~`font-weight` +`line-height` +`--tw-font-weight` |
| `.qt-lexical-h6` | ~`font-size` ~`font-weight` +`line-height` +`--tw-font-weight` |
| `.qt-lexical-ul` | ~`padding-left` |
| `.qt-lexical-ol` | ~`padding-left` |
| `.qt-lexical-checklist` | −`list-style` ~`padding-left` +`list-style-type` |
| `.qt-lexical-li-checked` | ~`padding-left` −`list-style` ~`opacity` −`text-decoration` +`list-style-type` +`text-decoration-line` |
| `.qt-lexical-li-unchecked` | ~`padding-left` −`list-style` +`list-style-type` |
| `.qt-lexical-li-checked::before` | ~`left` ~`top` ~`width` ~`height` −`border` +`border-style` +`border-width` |
| `.qt-lexical-li-unchecked::before` | ~`left` ~`top` ~`width` ~`height` −`border` +`border-style` +`border-width` +`border-color` |
| `.qt-lexical-blockquote` | −`border-left` ~`padding-left` +`border-left-style` +`border-left-width` +`border-color` |
| `.qt-lexical-link` | −`text-decoration` ~`color` +`text-decoration-line` |
| `.qt-lexical-code-block` | ~`font-family` ~`font-size` ~`background` +`line-height` +`-moz-tab-size` +`-o-tab-size` |
| `.qt-doc-divider` | +`-webkit-user-select` +`-moz-user-select` |
| `.qt-doc-divider-grip` | ~`gap` |
| `.qt-doc-pane` | ~`background` |
| `.qt-doc-vertical-divider` | +`-webkit-user-select` +`-moz-user-select` |
| `.qt-doc-vertical-divider-grip` | ~`gap` |
| `.qt-doc-header` | ~`gap` −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`background` +`padding-inline` +`padding-block` |
| `.qt-doc-badge` | −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`border-radius` ~`font-size` ~`line-height` ~`font-weight` ~`background` +`padding-inline` +`padding-block` +`--tw-font-weight` |
| `.qt-doc-title` | ~`flex` ~`font-size` ~`line-height` ~`font-weight` +`--tw-font-weight` |
| `.qt-doc-title-input` | ~`font-size` ~`line-height` ~`font-weight` −`border-width` +`--tw-font-weight` +`border-bottom-style` +`border-bottom-width` +`--tw-border-style` |
| `.qt-doc-header-button` | ~`padding` ~`transition-property` ~`transition-timing-function` ~`transition-duration` |
| `.qt-doc-header-button:hover` | ~`background` |
| `.qt-doc-uri-row` | ~`gap` −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`background` +`padding-inline` +`padding-block` |
| `.qt-doc-uri-label` | ~`font-weight` ~`letter-spacing` +`--tw-font-weight` +`--tw-tracking` |
| `.qt-doc-uri-value` | ~`min-width` ~`flex` ~`font-size` ~`line-height` ~`font-family` |
| `.qt-doc-uri-copy-button` | ~`padding` ~`transition-property` ~`transition-timing-function` ~`transition-duration` |
| `.qt-doc-uri-copy-button:hover` | ~`background` |
| `.qt-doc-toolbar` | ~`gap` −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`background` +`padding-inline` +`padding-block` |
| `.qt-doc-editor-area` | ~`flex` |
| `.qt-doc-status-bar` | ~`gap` −`padding-left` −`padding-right` −`padding-top` −`padding-bottom` ~`font-size` ~`line-height` ~`background` +`padding-inline` +`padding-block` |
| `.qt-doc-status-item` | ~`gap` |
| `.qt-doc-status-saving` | ~`width` ~`height` ~`border-radius` |
| `.qt-doc-status-saved` | ~`width` ~`height` ~`border-radius` |
| `.qt-chat-sidebar-resizer` | +`-webkit-user-select` +`-moz-user-select` |
| `.qt-chat-sidebar-resizer-grip` | ~`gap` |
| `.qt-formatting-toolbar` | ~`gap` ~`background` |
| `.qt-formatting-toolbar-section` | ~`gap` |
| `.qt-formatting-toolbar-divider` | ~`height` −`margin-left` −`margin-right` +`margin-inline` |
| `.qt-formatting-button` | ~`font-size` ~`font-weight` −`transition` +`line-height` +`--tw-font-weight` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` |
| `.qt-formatting-button:disabled` | ~`opacity` |
| `.qt-formatting-button-active:hover:not(:disabled)` | ~`background` ~`border-color` |
| `.qt-popover` | ~`min-width` ~`padding` |
| `.qt-dropdown` | ~`min-width` ~`padding` |
| `.qt-dropdown-item` | ~`gap` −`padding` ~`font-size` ~`line-height` ~`border-radius` −`transition` +`padding-inline` +`padding-block` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` |
| `.qt-dropdown-item:hover` | −`background` +`background-color` |
| `.qt-dropdown-item:focus` | −`background` −`outline` +`background-color` +`--tw-outline-style` +`outline-style` |
| `.qt-tooltip` | −`padding` ~`font-size` ~`border` +`padding-inline` +`padding-block` |
| `.qt-tooltip[data-pinned="true"]` | ~`border-color` |
| `.qt-tooltip-title` | ~`font-weight` +`--tw-font-weight` |
| `.qt-mention-chip` | ~`background` ~`border-bottom` |
| `.qt-mention-chip:hover` | ~`background` |
| `.qt-mention-chip:focus-visible` | ~`background` |
| `.qt-typeahead-menu` | ~`padding` |
| `.qt-typeahead-option` | ~`gap` −`padding` ~`font-size` ~`line-height` ~`border-radius` −`transition` +`padding-inline` +`padding-block` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` |
| `.qt-typeahead-option-active` | −`background` +`background-color` |
| `.qt-typeahead-option:hover` | −`background` +`background-color` |
| `.qt-typeahead-option-label` | ~`flex` |
| `.qt-typeahead-option-detail` | ~`font-size` ~`line-height` |
| `.qt-typeahead-empty` | −`padding` ~`font-size` ~`line-height` +`padding-inline` +`padding-block` |
| `.qt-emoji-picker` | ~`gap` ~`padding` |
| `.qt-emoji-picker-group-header` | ~`top` −`padding` ~`font-size` ~`line-height` ~`font-weight` +`padding-inline` +`padding-block` +`--tw-font-weight` |
| `.qt-emoji-picker-cell` | −`transition` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` |
| `.qt-emoji-picker-message` | −`padding` ~`font-size` ~`line-height` +`padding-inline` +`padding-block` |
| `.qt-lexical-contenteditable table` | −`margin` +`margin-block` |
| `.qt-lexical-contenteditable th` | −`border` −`padding` ~`font-weight` ~`background` +`border-style` +`border-width` +`border-color` +`padding-inline` +`padding-block` +`--tw-font-weight` |
| `.qt-lexical-contenteditable td` | −`border` −`padding` +`border-style` +`border-width` +`border-color` +`padding-inline` +`padding-block` |
| `.qt-lexical-contenteditable tr:nth-child(even) td` | ~`background` |
| `.qt-chat-composer-input::placeholder` | ~`color` |
| `.qt-text-primary` | ~`color` +`--tw-font-weight` +`font-weight` |
| `.qt-text-muted` | ~`color` |
| `.qt-border` | −`border-color` +`border` |
| `.qt-bg-card\/50` | ~`background-color` |
| `.qt-bg-card\/60` | ~`background-color` |
| `.qt-bg-card\/80` | ~`background-color` |
| `.qt-bg-card\/90` | ~`background-color` |
| `.qt-bg-destructive\/15` | ~`background-color` |
| `.qt-bg-destructive\/80` | ~`background-color` |
| `.qt-bg-info\/15` | ~`background-color` |
| `.qt-bg-muted-foreground\/20` | ~`background-color` |
| `.qt-bg-muted\/20` | ~`background-color` |
| `.qt-bg-muted\/30` | ~`background-color` |
| `.qt-bg-muted\/40` | ~`background-color` |
| `.qt-bg-muted\/50` | ~`background-color` |
| `.qt-bg-muted\/60` | ~`background-color` |
| `.qt-bg-muted\/70` | ~`background-color` |
| `.qt-bg-muted\/80` | ~`background-color` |
| `.qt-bg-primary\/15` | ~`background-color` |
| `.qt-bg-primary\/30` | ~`background-color` |
| `.qt-bg-secondary\/50` | ~`background-color` |
| `.qt-bg-success\/15` | ~`background-color` |
| `.qt-bg-warning\/15` | ~`background-color` |
| `.qt-border-default\/50` | ~`border-color` |
| `.qt-border-default\/60` | ~`border-color` |
| `.qt-border-default\/70` | ~`border-color` |
| `.qt-border-destructive\/20` | ~`border-color` |
| `.qt-border-destructive\/40` | ~`border-color` |
| `.qt-border-destructive\/50` | ~`border-color` |
| `.qt-border-primary\/20` | ~`border-color` |
| `.qt-border-primary\/30` | ~`border-color` |
| `.qt-border-primary\/40` | ~`border-color` |
| `.qt-border-primary\/50` | ~`border-color` |
| `.qt-border-primary\/60` | ~`border-color` |
| `.qt-border-success\/50` | ~`border-color` |
| `.qt-border-warning\/50` | ~`border-color` |
| `.qt-text-destructive\/80` | ~`color` |
| `.qt-text-info\/80` | ~`color` |
| `.qt-text-secondary\/50` | ~`color` |
| `.qt-text-secondary\/60` | ~`color` |
| `.qt-text-secondary\/70` | ~`color` |
| `.qt-text-secondary\/80` | ~`color` |
| `.qt-text-success\/80` | ~`color` |
| `.qt-text-warning\/80` | ~`color` |
| `.qt-bg-success\/5` | ~`background-color` |
| `.qt-bg-success\/10` | ~`background-color` |
| `.qt-bg-success\/20` | ~`background-color` |
| `.qt-bg-warning\/5` | ~`background-color` |
| `.qt-bg-warning\/10` | ~`background-color` |
| `.qt-bg-warning\/20` | ~`background-color` |
| `.qt-bg-info\/5` | ~`background-color` |
| `.qt-bg-info\/10` | ~`background-color` |
| `.qt-bg-info\/20` | ~`background-color` |
| `.qt-bg-destructive\/5` | ~`background-color` |
| `.qt-bg-destructive\/10` | ~`background-color` |
| `.qt-bg-destructive\/20` | ~`background-color` |
| `.qt-bg-destructive\/60` | ~`background-color` |
| `.qt-bg-success\/40` | ~`background-color` |
| `.qt-bg-success\/60` | ~`background-color` |
| `.qt-bg-muted-foreground\/30` | ~`background-color` |
| `.qt-bg-muted-foreground\/60` | ~`background-color` |
| `.hover\:qt-bg-muted-foreground\/60:hover` | ~`background-color` |
| `.qt-border-success\/30` | ~`border-color` |
| `.qt-border-warning\/30` | ~`border-color` |
| `.qt-border-destructive\/30` | ~`border-color` |
| `.qt-border-info\/30` | ~`border-color` |
| `.qt-border-success\/20` | ~`border-color` |
| `.qt-border-success\/40` | ~`border-color` |
| `.hover\:qt-bg-destructive\/10:hover` | ~`background-color` |
| `.hover\:qt-bg-success\/10:hover` | ~`background-color` |
| `.hover\:qt-bg-warning\/10:hover` | ~`background-color` |
| `.hover\:qt-bg-info\/10:hover` | ~`background-color` |
| `.hover\:qt-bg-primary\/10:hover` | ~`background-color` |
| `.hover\:qt-bg-muted\/30:hover` | ~`background-color` |
| `.hover\:qt-bg-muted\/40:hover` | ~`background-color` |
| `.hover\:qt-bg-muted\/50:hover` | ~`background-color` |
| `.hover\:qt-bg-muted\/80:hover` | ~`background-color` |
| `.hover\:qt-bg-primary\/5:hover` | ~`background-color` |
| `.hover\:qt-bg-primary\/15:hover` | ~`background-color` |
| `.hover\:qt-bg-primary\/20:hover` | ~`background-color` |
| `.hover\:qt-bg-primary\/90:hover` | ~`background-color` |
| `.hover\:qt-bg-destructive\/20:hover` | ~`background-color` |
| `.hover\:qt-bg-destructive\/90:hover` | ~`background-color` |
| `.hover\:qt-bg-success\/20:hover` | ~`background-color` |
| `.hover\:qt-bg-success\/90:hover` | ~`background-color` |
| `.hover\:qt-bg-warning\/20:hover` | ~`background-color` |
| `.hover\:qt-bg-info\/20:hover` | ~`background-color` |
| `.hover\:qt-text-destructive\/80:hover` | ~`color` |
| `.hover\:qt-text-warning\/80:hover` | ~`color` |
| `.hover\:qt-text-info\/80:hover` | ~`color` |
| `.hover\:qt-border-primary\/50:hover` | ~`border-color` |
| `.hover\:qt-border-primary\/60:hover` | ~`border-color` |
| `.file\:qt-bg-primary\/20::file-selector-button` | ~`background-color` |
| `.hover\:file\:qt-bg-primary\/30:hover::file-selector-button` | ~`background-color` |
| `.qt-spinner` | ~`border` +`animation` +`border-style` +`border-width` +`border-color` +`border-top-color` +`border-radius` +`height` +`width` |
| `.qt-spinner-lg` | ~`border` +`animation` +`border-style` +`border-width` +`border-color` +`border-top-color` +`border-radius` +`height` +`width` |
| `.qt-warning-box` | ~`background-color` ~`border` |
| `.qt-left-sidebar` | −`border-right` +`border-right-style` +`border-right-width` +`border-color` |
| `.qt-left-sidebar-content` | ~`min-height` |
| `.qt-left-sidebar-section-title` | ~`font-size` ~`font-weight` ~`letter-spacing` −`margin-bottom` −`padding` +`line-height` +`--tw-font-weight` +`--tw-tracking` +`flex` |
| `.qt-left-sidebar-item` | ~`gap` ~`padding` ~`font-size` ~`border-radius` −`transition` +`line-height` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` |
| `.qt-left-sidebar-item:hover` | −`background-color` +`background` |
| `.qt-left-sidebar-item-active` | −`background-color` +`background` |
| `.qt-collapsed-nav` | ~`gap` −`padding` +`padding-inline` +`padding-block` |
| `.qt-collapsed-nav-button` | ~`width` ~`height` ~`border-radius` −`transition` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` |
| `.qt-collapsed-nav-button:hover` | −`background-color` +`background` |
| `.qt-left-sidebar-footer` | ~`gap` −`border-top` ~`padding` +`border-top-style` +`border-top-width` +`border-color` |
| `.qt-app-layout` | ~`background-color` ~`color` |
| `.qt-app-main` | ~`min-width` |
| `.qt-page-toolbar` | −`padding` ~`top` +`padding-inline` +`padding-block` |
| `.qt-page-toolbar-center` | −`padding-left` −`padding-right` +`padding-inline` |
| `.qt-page-toolbar-right` | ~`gap` |
| `.qt-app-header` | −`padding` −`border-bottom` +`padding-inline` +`border-bottom-style` +`border-bottom-width` +`border-color` |
| `.qt-app-header-left` | ~`gap` |
| `.qt-app-header-center` | −`padding` +`padding-inline` |
| `.qt-app-header-right` | ~`gap` |
| `.qt-file-preview-scroll` | ~`max-height` |
| `.qt-file-preview-panel` | ~`padding` ~`border-radius` ~`background` |
| `.qt-file-preview-code` | ~`padding` ~`border-radius` ~`font-size` ~`background` ~`color` ~`font-family` +`line-height` |
| `.qt-file-preview-loading` | ~`min-height` |
| `.qt-file-preview-loading-text` | ~`animation` |
| `.qt-file-preview-empty` | ~`min-height` |
| `.qt-file-preview-empty-icon` | ~`font-size` ~`margin-bottom` +`line-height` |
| `.qt-copy-button` | ~`gap` −`padding` ~`border-radius` ~`font-size` ~`font-weight` −`transition` +`padding-inline` +`padding-block` +`line-height` +`--tw-font-weight` +`transition-property` +`transition-timing-function` … (+2 more) |
| `.qt-copy-button-icon` | ~`padding` ~`gap` |
| `.qt-file-preview-text-container .qt-copy-button` | ~`top` ~`right` |
| `.qt-code-block-container .qt-copy-button` | ~`top` ~`right` |
| `.qt-code-block-copy` | ~`top` ~`right` |
| `.qt-diagram-lightbox-viewport` | +`-webkit-user-select` +`-moz-user-select` |
| `.qt-wikilink` | ~`color` ~`font-weight` −`text-decoration` −`padding` ~`border-radius` ~`background` −`transition` +`--tw-font-weight` +`text-decoration-line` +`padding-inline` +`padding-block` +`transition-property` … (+3 more) |
| `.qt-wikilink:hover` | ~`background` −`text-decoration` +`text-decoration-line` |
| `.qt-wikilink-broken` | ~`color` −`text-decoration` ~`opacity` +`text-decoration-line` |
| `.qt-wikilink-broken:hover` | −`text-decoration` +`text-decoration-line` |
| `.qt-bg-primary\/5` | ~`background-color` |
| `.qt-bg-primary\/10` | ~`background-color` |
| `.qt-bg-primary\/20` | ~`background-color` |
| `.qt-shadow-sm` | ~`box-shadow` |
| `.qt-shadow-md` | ~`box-shadow` |
| `.qt-tab-divider` | −`border-top` +`width` +`border-bottom` |
| `.qt-tab-strip` | −`background` −`border-bottom` ~`--qt-tab-bg` ~`--qt-tab-fg` ~`--qt-tab-border` ~`--qt-tab-active-bg` +`scrollbar-width` +`--qt-tab-hover-bg` +`--qt-tab-hover-fg` |
| `.qt-tab-strip .qt-tab` | −`display` −`align-items` −`border-color` +`-webkit-user-select` +`-moz-user-select` |
| `.qt-tab-strip .qt-tab-active` | −`border-color` |
| `.qt-tab-close:hover` | ~`background` |
| `.qt-workspace-divider` | +`width` +`height` |
| `.qt-workspace-divider:hover` | ~`background` |
| `.qt-workspace-divider:focus-visible` | ~`background` |
| `.qt-workspace-divider-grip` | ~`background` |
| `.qt-tab-drop-zone` | ~`background` ~`border-left` +`z-index` |
| `.qt-tab-drop-zone-hint` | ~`box-shadow` |
| `.qt-dialog-overlay` | ~`inset` −`background-color` ~`z-index` +`background` |
| `.qt-navbar` | −`display` −`align-items` −`justify-content` −`padding` −`background-color` −`border-bottom` +`position` +`z-index` +`border-bottom-style` +`border-bottom-width` +`background` +`border-color` … (+1 more) |
| `.qt-navbar-link` | −`display` −`align-items` ~`font-size` ~`font-weight` −`text-decoration` −`transition` +`line-height` +`--tw-font-weight` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` |
| `.qt-navbar-link:hover` | −`background-color` +`background` |
| `.qt-navbar-link-active` | −`background-color` ~`color` +`font-size` +`line-height` +`--tw-font-weight` +`font-weight` +`transition-property` +`transition-timing-function` +`transition-duration` +`--tw-duration` +`padding` +`border-radius` … (+1 more) |
| `.qt-terminal-embed` | ~`border-radius` |
| `.qt-terminal-embed-header` | −`padding` +`padding-inline` +`padding-block` |
| `.qt-terminal-embed-footer` | ~`gap` −`padding` ~`font-size` +`padding-inline` +`padding-block` +`line-height` |
| `.qt-terminal-popout-header` | −`padding` +`padding-inline` +`padding-block` |
| `.qt-terminal-closed-badge` | ~`top` ~`right` −`padding` ~`font-size` +`padding-inline` +`padding-block` +`line-height` |
| `.qt-queue-badge` | ~`gap` +`--tw-leading` |
| `.qt-queue-badge-memory` | ~`gap` +`--tw-leading` |
| `.qt-queue-badge-embedding` | ~`gap` +`--tw-leading` |
| `.qt-queue-badge-summary` | ~`gap` +`--tw-leading` |
| `.qt-queue-badge-danger` | ~`gap` +`--tw-leading` |
| `.qt-queue-badge-story` | ~`gap` +`--tw-leading` |
| `.qt-storyteller-card-destroy` | ~`background` |
| `.qt-alert` | ~`border-radius` ~`border-style` −`padding` ~`font-size` ~`line-height` +`padding-inline` +`padding-block` |
| `.qt-alert-success` | ~`border-radius` ~`border-style` −`padding` ~`font-size` ~`line-height` +`padding-inline` +`padding-block` |
| `.qt-alert-warning` | ~`border-radius` ~`border-style` −`padding` ~`font-size` ~`line-height` +`padding-inline` +`padding-block` |
| `.qt-alert-error` | ~`border-radius` ~`border-style` −`padding` ~`font-size` ~`line-height` +`padding-inline` +`padding-block` |
| `.qt-alert-info` | ~`border-radius` ~`border-style` −`padding` ~`font-size` ~`line-height` +`padding-inline` +`padding-block` |
| `.qt-page-container[style*="--story-background-url"] .qt-settings-header` | ~`border-radius` −`padding` −`margin-left` −`margin-right` ~`background` +`margin-inline` +`padding-inline` +`padding-block` |
| `.qt-page-container[style*="--story-background-url"] .qt-tab-group .qt-tab` | ~`background` |
| `.qt-page-container[style*="--story-background-url"] .qt-tab-group .qt-tab:hover:not(.qt-tab-active)` | ~`background` |
| `.qt-page-container[style*="--story-background-url"] .qt-tab-group .qt-tab.qt-tab-active` | ~`background` |
| `.qt-page-container[style*="--story-background-url"] .qt-tab-group .qt-tab.qt-tab-active::after` | ~`background` |
| `.qt-page-container[style*="--story-background-url"] .qt-settings-panel` | ~`border-bottom-left-radius` ~`border-bottom-right-radius` −`padding` −`margin-left` −`margin-right` ~`background` +`margin-inline` +`padding-inline` +`padding-top` +`padding-bottom` |
| `.qt-footer` | ~`border-top-style` −`padding` +`padding-inline` +`padding-block` |
| `.qt-footer-container` | ~`gap` ~`font-size` ~`line-height` |
| `.qt-footer-link` | ~`gap` ~`transition-property` ~`transition-timing-function` ~`transition-duration` |
| `.qt-footer-path` | ~`font-size` ~`line-height` |
| `.qt-settings-shell` | ~`padding` ~`border-style` ~`background` |
| `.qt-settings-shell-tight` | ~`padding` ~`border-style` ~`background` |
| `.qt-settings-section-heading` | ~`font-size` ~`line-height` ~`font-weight` +`--tw-font-weight` |
| `.qt-settings-toggle-row` | ~`gap` ~`padding` ~`border-style` |

</details>
