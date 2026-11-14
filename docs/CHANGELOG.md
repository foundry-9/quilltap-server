# Quilltap Changelog

## Recent Changes

### 4.14-dev

#### Themes: structural hook catalogue (Calliope Live, Spec B)

- Added the theme hook catalogue in `lib/themes/hooks/`: 156 `qt-*` classes, with the data attributes and states a theme may select on, version 1
- Added `npm run generate:theme-hooks-doc`, which writes `docs/developer/THEME_HOOKS.md`; `npm run lint` now runs `scripts/check-theme-hooks.ts`, which fails when a catalogued hook leaves the markup, a literal variant value is not listed, or the reference doc is stale, and reports (without failing) the bundled themes' selectors that target something other than a hook
- Added hooks: home cards carry `data-section`, plus `qt-homepage-row`, `qt-homepage-empty`, `qt-homepage-welcome`; rail items carry `data-nav`, popouts `qt-left-sidebar-popout`; `<main>` is `qt-app-content`, its scroll area `qt-app-scroll`; workspace pane chrome and tab panes carry `data-pane`, tabs and tab panes `data-tab-kind`
- Added Salon hooks: message rows carry `data-role` (`user`, `assistant`, `staff`, `tool`) and Staff rows and announcement chips `data-staff`; `qt-chat-tool-call` with `data-tool`, `qt-chat-pending-tools`, `qt-chat-message-streaming`, `qt-chat-avatar-carried`; the shared avatar box is `qt-avatar-image`
- Added character page hooks: `qt-character-page`, `-header`, `-avatar`, `-identity`, `-tags`, `-stats`, `-actions`, `-archived-banner`; field sections are `qt-section-card` with `data-section`, `-header` and `-body`
- Added settings hooks: rail items carry `data-group`, settings cards `data-card`
- The left rail now marks the item for the focused pane's active tab with `aria-current="page"` (it had no active indication); the themes and quick-hide buttons carry `aria-expanded`
- Changed dialogs: `BaseModal` always applies `qt-dialog-body` / `qt-dialog-footer`, which now carry no styling; the default padding and footer look moved to `qt-dialog-body-default` / `qt-dialog-footer-default`, applied when the caller passes no classes of its own. Callers that relied on the old classes now name the `-default` ones. The close button is `qt-dialog-close`
- Removed great-estate's `[data-role="assistant"]` / `[data-role="user"]` border rules, which had never matched and would have started to (theme 1.0.13)
- `SectionCard`'s `anchor` prop is now required and typed from the catalogue's list of character-page sections; the seven cards that had none (Facts, Dossier, and the five Chat Defaults cards) now have one
- theme-storybook 1.0.118: regenerated CSS and the Dialogs story for the dialog change

#### Docs: feature spec for Calliope Live

- Added pre-spec for Calliope Live, an in-app theme editor and theme overhaul for Quilltap
- Added the Phase 0a audit of the theme system (`calliope-live-audit.md`, with the variable-by-theme table as a CSV): 505 component variables, how each bundled theme uses them, the hand-written rules, assets, and structural hooks
- Added Spec A (token registry and bundle format v2) and Spec B (structural hook catalogue), and linked all three from the proposal
