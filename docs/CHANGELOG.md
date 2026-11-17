# Quilltap Changelog

## Recent Changes

### 4.14-dev

#### Fix: Responses-API output-token cut-offs read as truncation (#228)

- `isTruncatedFinishReason` now matches `max_output_tokens`, the reason OpenAI and Grok (Responses API) report in `incomplete_details.reason`. The Salon tool loop's truncation guard, the AI Wizard's truncated-field check and the image-description fallback's reasoning-model message now see these cut-offs
- OpenAI (1.0.74) and Grok (1.0.63) plugins: `getFinishReason` checks `status === 'incomplete'` before `function_call`, so a tool call cut off mid-arguments reports `max_output_tokens` instead of `tool_calls` and is rejected and re-prompted rather than run with half-parsed arguments
- `lib/chat/file-attachment-fallback.ts` uses the shared predicate instead of comparing to `'length'`
- Tests for the predicate, both plugins' raw responses and the tool loop's truncation branch

#### Docs: Calliope Live closed (Spec K)

- `CLAUDE.md`: the `packages/` publish exception names only `packages/quilltap`; design docs are the specimen gallery; the Themes rules drop the generated Storybook CSS and point a qt-* change at `npm run generate:theme-styled-by`
- `.claude/commands/`: removed the two packages' doc rows and the Storybook spec rows; checklists refer to the styled-by table and the specimen gallery
- `calliope-live.md` and Spec K moved to `features/complete/`, with links fixed. The proposal's status, Storybook section, Phase 3 and open questions are updated; each question names the spec that answered it
- ROADMAP: Calliope Live and the package retirement marked done; the theme author's guide (necessary) and layout variants added as open
- Retirement notes on the two Storybook CSS refactor docs; a dated note in `DEAD-CODE-REPORT.md`

#### Calliope and theme docs: no packages, and screenshots (Calliope Live, Spec K)

- Calliope's prompt adds a paragraph on what she can see: not the app, only the draft. When the draft does not show what the author means, she asks for a screenshot if her model reads images (`profileCanReceiveAttachment`), and for a description if it does not. New `calliopeSightBrief`; snapshot updated
- `help/theme-editor.md`: she cannot see the app, so attach a screenshot of what looks wrong
- `help/themes.md`, `THEME_DEVELOPMENT.md`, `DEVELOPMENT.md` and `README.md` point to the Atelier and `quilltap themes create` instead of `create-quilltap-theme`, and to the Atelier's Icons section instead of the Storybook story. `THEME_DEVELOPMENT.md` now says where the styled-by table's compiled CSS comes from

#### Themes: `create-quilltap-theme` retired; `quilltap themes create` writes the bundle (Calliope Live, Spec K)

- New `lib/themes/blank-bundle.ts`: `blankThemeBundle` (a blank theme's `theme.json` and `tokens.json`) and `themeIdFromName`. The Atelier's `createDraft` and the CLI both use it; `draftIdFromName` is now an alias
- A blank draft's `theme.json` and `tokens.json` now carry `$schema`
- `quilltap themes create <name>` writes the blank bundle to `./<id>/` and prints next steps. It refuses an existing directory. The `npx create-quilltap-theme` delegation and its Windows argument check are gone, and the command no longer needs npm
- Removed `packages/create-quilltap-theme/`; its test is replaced by `__tests__/unit/packages/quilltap-themes-create.test.ts`
- `docker-test-plan.md` row 8.3 restated for the new command

#### Themes: `@quilltap/theme-storybook` retired (Calliope Live, Spec K)

- Removed `packages/theme-storybook/` and its `publish-theme-storybook` release job. The specimen gallery and the theme editor replace it
- The qt-* component layer is no longer compiled to a tracked file: `scripts/lib/qt-components-css.mjs` compiles it in memory for the styled-by table. Removed `generate:storybook-css`, `scripts/generate-storybook-css.mjs` and the `check-storybook-css` lint gate; `check-theme-references` now does the compile
- `styled-by.generated.json` records its first source as `app/styles/qt-components`; every hook row is unchanged
- Comments, the `check-qt-classes` message, the About page and `.dockerignore` no longer mention the package or Storybook

#### Calliope: an assistant in the theme editor (Calliope Live, Spec J)

- New chat type `calliope`: a conversation with Calliope about one theme draft, named by the new nullable column `chats.themeDraftId` (migration `add-calliope-theme-draft-field-v1`; DDL, export schema and both chat Zod schemas updated). Help-like: no memories, no Concierge, no auto-title fold, and kept out of global search (`isListedInGlobalSearch`). Deleting a draft deletes its conversations
- Console engine: the Brahma Console's turn loop is now `runConsoleTurn` (`lib/services/console-engine/`), run with a `ConsolePersona`; Brahma and Calliope are its two personas. Console attachments for both live in `lib/console-engine/attachments.ts` (`Brahma/` and `Calliope/` in Quilltap General). No change to Brahma's behavior except the salvage notice below
- Her tools: `theme_read_draft`, `theme_lookup_tokens`, `theme_lookup_hooks`, `theme_check_contrast` (`read`) and `theme_propose` (`none`), run under `effectCeiling: 'read'` with a slate of exactly those (`onlyTools` on `buildToolsForProvider`). They answer only in a `calliope` conversation, against its own draft
- Proposals: a change set of ordered operations (`set-token`, `reset-token`, `add-primitive`, `set-primitive`, `rename-primitive`, `remove-primitive`, `set-choice`, `replace-css`, `set-css`), applied only by `applyChangeSet` and judged only by `assessProposal` (`lib/themes/assist/`): validated and compiled as an install would be, then compared with the draft for new errors and warnings, contrast broken or mended, and issues cleared. A refused proposal goes back to her and is never shown. She never writes the draft
- New hook reference table `lib/themes/assist/styled-by.generated.json` (what the app's rules set on each catalogued hook), generated by `npm run generate:theme-styled-by` and checked by `npm run lint`
- API `/api/v1/calliope`: list by draft, open, upload / discard-upload, rename, `set-model`, `keep` (re-judges and returns the operations; records the decision), `discard`, `try` (the result's tokens and engine-scoped custom CSS, records nothing), delete, and messages (SSE send; load with proposals judged against the draft as it now is, stale derived). Settings at `/api/v1/settings/calliope` (engine and turn budget, default 25) and a new Calliope card in Settings → Appearance
- Theme editor: a Calliope button opens her panel (beside the sections in a wide pane, in their place in a narrow one; loaded lazily). Proposal cards with Try (the preview wears the result; the draft is untouched), Keep (applied through the editor's own edit path: tokens as one undo step, CSS through the stylesheet's save) and Discard; a stale card offers to ask her again. "Ask Calliope" hand-offs from the inspector, from each validation error and warning, and from each failing contrast line start a message in her composer; nothing is sent automatically
- Shared pieces made reusable: `useBrahmaConsoleStreaming` and `useConsoleAttachments` take an `apiBase`, `ModelPicker` an `icon`, `HelpChatComposer` a `seed`
- Console salvage notice: `salvageMessage` takes a `cause`. When a model returns an empty answer before the turn budget is spent (typically a reply cut off at its output token limit), Brahma and Calliope now say so and suggest raising the profile's max tokens, instead of claiming the turn budget ran out
- `help/theme-editor.md`: Calliope, her proposals, hand-offs and settings; `help/appearance-settings.md`: the Calliope card. Avatar `public/images/avatars/calliope-avatar.webp`

#### Docs: Calliope Live Spec K

- Added Spec K (Phase 3: retire `@quilltap/theme-storybook` and `create-quilltap-theme`, close the Calliope Live proposal; the theme author's guide is noted as necessary and left for later); ready to run
- Spec K Stage 0: inventory of both packages (stories against the specimen gallery, the icon list, every reference, root dependencies) recorded in the spec

#### Docs: Calliope Live Spec J

- Added Spec J (Calliope as an assistant in the theme editor: a Brahma-like console with her own chat type, read-only theme tools and engine-checked proposals the author tries, keeps or discards)

#### Docs: Calliope Live Spec I complete

- Spec I (loose ends) marked implemented, with implementation notes for all five stages, and moved with its catalogue triage to `docs/developer/features/complete/`; linked from `calliope-live.md`. The help pages took their brace-indentation text in Stage 1; `THEME_DEVELOPMENT.md` does not describe the probe and was not changed

#### Theme hooks: 45 added (Calliope Live, Spec I Stage 4.2)

- The hook catalogue grows from 174 to 219 hooks, still version 1 (adding a hook does not change the version). Salon: the chat layout, message list, message text, the four roleplay spans (`qt-chat-dialogue`, `-narration`, `-ooc`, `-inner-monologue`), composer actions, Stop button, attachment chip and picture, reasoning block, participant sidebar, Courier card, green room, Storyteller board and card, formatting toolbar and button, mention menu and option, mention chip, and Document Mode's pane and header. App shell: the footer. Dialogs: the floating dialog and slide-over panel. Shared: the empty state and its icon, description and action, loading state, tooltip, popover, entity card, field label, link, checkbox, radio, slider, rendered Markdown, code block, inline code, and progress bar and fill
- New class states: `qt-chat-sidebar-collapsed`, `qt-green-room-docked`, `qt-storyteller-card-selected` / `-quiet` / `-dragging`, `qt-formatting-button-active`, `qt-typeahead-option-active`, `qt-mention-chip-thing`, `qt-progress-fill-success` / `-danger` / `-idle`
- Each has a specimen in Calliope's gallery (the real `EmptyState` for the empty-state family, markup for the rest). `docs/developer/THEME_HOOKS.md` regenerated. The theme probe measures 471 gallery instances per theme and mode (was 415); the existing 415 are unchanged
- The bundled themes were already clean against the catalogue, so no excepted selector changes

#### Docs: Calliope Live Spec I Stage 4.1 catalogue triage

- Added `docs/developer/features/complete/calliope-live-spec-i-catalogue-triage.md`: the 712 `qt-*` classes in app markup that are not theme hooks, sorted into proposed candidates (45), candidates worth considering, inner parts, modifiers, helpers and plumbing. Awaiting approval before Stage 4.2 adds any to the catalogue

#### UI: `qt-*` classes that resolved to nothing

- 13 `qt-*` classes were used in markup but defined by no CSS, so they had no effect. `qt-input-sm` (20 uses in the Atlas, Inventory, Wardrobe and document browsers) is now defined beside `qt-select-sm`. The rest now use classes that exist: `qt-button-danger` → `qt-button-destructive` (State editor, memory regenerate card), `qt-button-danger-outline` → `qt-button-secondary qt-text-destructive`, `qt-alert-destructive` → `qt-alert-error`, `qt-callout` → `qt-alert-info`, `qt-card-content` → `qt-card-body`, `qt-card-selected` → `qt-option-selected`, `qt-form-label` → `qt-label`, `qt-badge-muted` → `qt-badge-secondary`, `qt-accent-primary` → `qt-checkbox`, `qt-code` → `qt-code-inline` (startup gates, theme selector, optimizer), `qt-divider` → `qt-border-default`; `qt-list-row` dropped
- `scripts/check-qt-classes.mjs` now also fails on a bare `qt-*` class in `app/` / `components/` markup that is not defined in app CSS (`::highlight()` names count), not a catalogued theme hook or state, and not in its `MARKERS` list (31 anchors, each with a reason). A stale marker fails too. It reads the hook catalogue, so `npm run lint` runs it with `tsx`
- `@quilltap/theme-storybook` 1.0.124 (regenerated CSS)

#### Theme probe: measures the specimen gallery (Calliope Live, Spec I Stage 3)

- `scripts/theme-probe/run.ts` now probes Calliope's specimen gallery for how every hook looks, plus three live pages for layout: home, one Salon chat and the theme preview dialog. The character, Settings, Appearance and second Salon pages are gone, and so is `--character`; `--chat` takes one id
- `probe.js` has a gallery mode that reads each instance at `[data-specimen-for] [data-specimen-instance] [data-specimen-stage]` instead of taking the first visible match, after making every `content-visibility: auto` article visible. Instances it cannot find are listed in `missing`. Gallery mode also holds every running animation at its start (`document.getAnimations()`), so an animated property such as the turn dot's opacity reads the same on every run
- `compare` reports a gallery instance missing on either side as an error
- The gallery's instance items carry `data-specimen-instance="<key>"`; the coverage test now checks each instance on its own stage

#### Tests: longer timeouts for CI

- CI's Test job kept failing on timeouts in slow jsdom suites (the theme editor's custom CSS tests): Jest's 5 s per-test default in one run, Testing Library's 1 s `findBy` / `waitFor` default in others. The suite runs ~1,500 files under v8 coverage there and render-heavy suites take several times longer than locally
- `jest.config.ts`: `testTimeout: 30000` (matches the integration config)
- `jest.setup.ts`: Testing Library `asyncUtilTimeout` raised to 10 s
- Removed per-call and per-test timeouts that were now below those defaults and would have shortened them (theme editor, custom tool intervention dialog, connection profiles tab, backup parser, plugin initialization, DB encryption state)

#### Theme editor: layout by pane width (Calliope Live, Spec I Stage 2)

- The theme editor's section navigation and the specimen gallery's surface navigation now switch on a container query (`@2xl`, 42rem) instead of the viewport `md` breakpoint. Below that width the list is replaced by a select (`components/ui/SectionJump.tsx`) above the body that reaches every section
- The editor's field grids (token light/dark blocks, primitives, fonts, corner radii, shadow and transition fields) use container queries too; no viewport breakpoint remains in `components/theme-editor/`
- `help/theme-editor.md`: the narrow-pane menus

#### Code editor: brace indentation (Calliope Live, Spec I Stage 1)

- Enter after `{` or `[` adds one indent unit (the file's detected one). Enter between a brace pair puts the caret on an indented line and the closing brace on its own line below. `}` or `]` typed on a line holding only indentation removes one unit, unless the line is already no deeper than its opening brace's line. Applies to JSON and CSS, in the theme editor and Document Mode. Nothing is reformatted and no brace is inserted
- Braces in strings and comments do not count; this is read from the editor's highlight tokens (`$tokenTypeLookup`). The rules are pure functions, `planEnter` and `planCloseBracket` in `components/code-editor/text.ts`
- Prism's CSS selector pattern may no longer start at a quote, so `content: "{";` is highlighted as a string instead of a selector and a brace. A brace after a space inside a CSS string (`"a {"`) is still misread
- The closing-brace step-out needs a key press; text inserted without one (on-screen keyboard, input method, paste) is left as typed
- `help/theme-editor.md`, `help/scriptorium.md`: brace indentation

#### Docs: Calliope Live Spec I

- Added Spec I (loose ends from Specs E to H: brace indentation in the code editor, theme editor layout by pane width, the theme probe measuring the specimen gallery, and adding uncatalogued `qt-*` classes to the hook catalogue)

#### Dependencies: OpenRouter SDK floor raised

- `npm update` across root, packages and plugins. `@openrouter/sdk` is now `^1.5.105` in the root and the OpenRouter plugin (plugin 1.0.75), so a build no longer flips the bundled SDK between 1.5.103 and 1.5.105 depending on the machine; `@testing-library/user-event` to `^14.6.12`
- Plugin lockfiles are not tracked (`plugins/**/package-lock.json` is ignored), so the version range in each plugin's `package.json` is what keeps machines in step

#### Docs: Calliope Live Spec H complete (Stage 3)

- `THEME_DEVELOPMENT.md`: adding a hook needs a specimen and the coverage test that checks it; the specimen gallery and inspect mode under the Atelier
- `CLAUDE.md` Themes: new hooks need specimens; the inspector reads stylesheets only on selection
- Spec H moved to `features/complete/` with implementation notes (gallery vs. Storybook, theme probe on the gallery, a hook → token table for LLM assistance)

#### Themes: inspect mode (Calliope Live, Spec H Stage 2)

- "Inspect" toggle in the theme editor header and gallery toolbar. While on, pointing outlines the nearest hooked element; a click selects it and does not reach the app; Escape turns it off. Listeners are window capture listeners, removed when off
- Inspector panel: hook, variants and states, tokens grouped by property with computed value, swatch, follow chain and source, hover/focus/press groups, matching custom CSS rules. "Row" opens the token's row; "Write CSS for this" inserts an empty rule into Custom CSS (starting a stylesheet if needed); "Show in the gallery" reveals the specimen. Docks away from the editor
- Editor and gallery register bridges with the inspect provider; the editor's tab is brought forward before a jump. The gallery opens beside the calling tab's pane
- "Inspect this" / "Show on this page" on every specimen; "Inspect this" on every hook in the Custom CSS reference
- `data-inspect-ignore` / `data-inspect-target` / `data-inspect-editor` mark what may be inspected
- `scripts/check-modal-shell.mjs`: allowlisted the specimen dialog drawing
- `help/theme-editor.md`: inspecting

#### Themes: specimen gallery and the inspector's model (Calliope Live, Spec H Stages 0–1)

- New workspace tab "Calliope's Specimens" (`theme-specimens`, route `/calliope/specimens`). It draws all 174 catalogued hooks in every variant value and class/ARIA state, wearing the previewed draft or the worn theme. Modes: as the window, light, dark, or both side by side. Search by label or class; jump by surface
- "Open the gallery" in the theme editor's header and on the draft list opens the tab in the other pane
- Specimens live in `components/theme-specimens/`. Three are real components (`CollapsibleCard`, `EmptyState`, `QuillAnimation`); the rest are markup. A coverage test fails when a catalogued hook has no specimen or a variant/state is missing
- Inspector model (`components/theme-inspect/`): element to nearest hook, matching rules to custom properties in cascade order (hover/focus/active kept apart, theme custom CSS marked), property to registry token. The stylesheet walk runs on selection only (9–33 ms on a Salon page)
- Theme editor: stable token row ids and `goToToken(name)` (exposed through an optional `navigatorRef`)
- Fix: the page theme leaked into nested `data-theme` containers. Optional tokens are now reset to `initial` on nested containers at zero specificity, and `font-family`, `font-weight` and `color-scheme` are re-established there. The editor panel and gallery chrome now stay in the house default; Settings theme previews now show their own body font
- `THEME_HOOKS.md` and the CLI theme engine regenerated for the new tab kind; `@quilltap/theme-storybook` 1.0.123
- `help/theme-editor.md`: the specimen gallery

#### Docs: Calliope Live Spec H

- Added Spec H (a specimen gallery showing every catalogued hook in the draft theme, and an inspect mode that names an element's hook and the tokens that style it)

#### Docs: Calliope Live Spec G complete (Stage 4)

- `docs/developer/API.md`: `?action=import` on `/api/v1/theme-drafts`, the stylesheet `PUT` body, `set-styles-file` / `clear-styles-file`, located issues and `styles` in the draft detail
- `THEME_DEVELOPMENT.md`: writing custom CSS in the editor, importing a `.qtap-theme`, and why a draft's `styles.css` is view-only in Document Mode
- `CLAUDE.md`: `components/code-editor/` as the one highlighted source editor and its fidelity rule; the stylesheet's save pattern; import as a draft source
- `help/theme-editor.md`: draft JSON files are highlighted in Document Mode; the stylesheet is edited in the Custom CSS section
- Spec G marked implemented with implementation notes (including notes for Spec H) and moved to `features/complete/`; the proposal's text-editing decision notes the one package it needed

#### Document Mode: code editor for JSON and CSS (Calliope Live, Spec G Stage 3)

- Document Mode opens `.json` and `.css` files in the shared code editor (highlighting, line numbers, exact bytes). Other non-Markdown files, and JSON or CSS files over 100,000 characters, keep the textarea. The Markdown branch is unchanged
- The editor is chosen once per load (`app/salon/[id]/components/document-editor-kind.ts`). Edits reach `onContentChange` after 150 ms and are flushed on blur and close. The "AI editing" lock makes it read-only, outside changes replace the text without an echo write, `doc_focus` scrolls to the line, and the scroll position is saved
- The status bar says "JSON" or "CSS" instead of "Plain text"
- Code editor handle: `revealLine(line, { focus: false })` scrolls without taking focus; new `scrollElement()`
- CSS in a database store (such as a theme draft's `styles.css` in Quilltap General) is still view-only; database stores edit only Markdown, text, JSON and JSONL
- `help/scriptorium.md` describes the code editor
- Tests: `document-pane-code-editor.test.tsx`

#### Themes: custom CSS section and opening a theme file in the theme editor (Calliope Live, Spec G Stage 2)

- New Custom CSS section in the theme editor (`components/theme-editor/assets/StylesSection.tsx`): creates the stylesheet (`set-styles-file`), edits it in the shared code editor, and removes it behind an alertdialog (`clear-styles-file`, deleting the file by default). The rules are stated above the editor
- CSS saves go through the editor's save queue as `PUT { stylesRevision, css }`. A stale revision reloads the draft and shows "Changed elsewhere". Pending CSS is flushed before any draft operation, install, pausing the preview, going back to the list, closing the section and closing the tab (keepalive)
- Issues with the stylesheet's `file` and `line` become editor markers and a list with jump-to-line buttons. While the draft has errors, the preview keeps the last good server compile (font faces, icons and custom CSS) instead of dropping it
- Reference panel (`StylesReference.tsx`, pure helpers in `styles-model.ts`): the hook catalogue by surface with every variant and state selector, registry tokens and primitives with the value in force, and the draft's images. Each entry inserts at the caret. Switching lists clears the search. The section lays out side by side only when its container is wide enough
- "Open a theme file" on the draft list posts a `.qtap-theme` to `?action=import` and opens the new draft. A refusal is shown on the list (version 1: one sentence; invalid: the reasons; too large: the limit), and a changed id is announced
- `help/theme-editor.md` covers the Custom CSS section and opening a theme file
- Tests: section and reference panel (`styles-section.test.tsx`), and editor-level saving, held preview, conflict, flushing and import cases in `theme-editor.test.tsx`

#### Tests: theme editor CSS-flush test no longer times out on CI

- `theme-editor.test.tsx` "saves pending CSS before an operation on the draft" waited for "Begin a stylesheet" with the default 1-second timeout. That wait covers a flushed save, the `clear-styles-file` call and a re-render, which took longer on CI. It now uses 4 seconds, like the other custom CSS tests
- `docs/developer/TESTING_GUIDE.md` has a new troubleshooting section, "Component Tests That Pass Locally and Time Out on CI". It says to scope accessible-name queries and to give a wait an explicit timeout when it covers more than one async step

#### Tests: theme editor suites no longer time out on CI

- The theme editor component tests (`editor-structure`, `bundled-walk`, `theme-editor`) timed out on CI. In jsdom, each label-text or accessible-name query walks the whole document for every element it checks, and the editor mounts several hundred labelled rows. The tests now query inside the row, panel or toolbar they are about, using new helpers in `__tests__/helpers/theme-editor-queries.ts`. The theme-editor folder runs in 8 s instead of 85 s; the Rains walk takes about 2 s instead of 51 s
- Removed a duplicated `images` key in the `editor-structure` fixture

#### Themes: code editor, located issues, draft stylesheet and import (Calliope Live, Spec G Stages 0–1)

- New shared code editor (`components/code-editor/`): Lexical plain text with Prism highlighting for JSON and CSS, line numbers, issue markers with tooltips, Tab / Shift+Tab indent and outdent, Escape-then-Tab to leave, auto-indent on Enter, and line endings kept as the file had them. A reusing tokenizer only rebuilds the changed stretch, so a 2,000-line file types at about 16 ms a key. Not yet mounted anywhere
- Eight `--qt-code-token-*` theme tokens for the highlight colors, with contrast pairs; added `@lexical/code-prism`
- Theme engine issues are structured: the CSS scoper, the theme validator and the bundle loader return `{ message, file?, line? }` beside each message (`lib/themes/engine/issues.ts`). Message text and `quilltap themes validate` output are unchanged. Draft issues carry `file` and `line`
- Draft detail returns `styles` (`{ path, text, revision }` or `null`)
- New draft operations `set-styles-file` (creates an empty `styles.css` when absent, then names it in the manifest) and `clear-styles-file` (unnames it first, then deletes the file only with `deleteFile`), both taking `manifestRevision`
- `PUT /api/v1/theme-drafts/[id]` takes `{ revision, tokens }` or `{ stylesRevision, css }`. CSS with errors is saved and reported; a stale revision is a 409
- `POST /api/v1/theme-drafts?action=import` (multipart, one `file`) makes a draft from a `.qtap-theme`. The archive is checked and extracted by `bundle-archive.ts` into a temp directory that is always removed; a version 1 bundle is refused with the earlier-theme message; an oversized upload is refused (411 / 413) before it is read whole. The draft keeps the bundle's name and version and gets a free id; the result has `bundleId` and `idChanged`
- Tests: code editor, engine issues, stylesheet operations, import (all six bundled themes, free and numbered ids, version 1, symlinks, climbing paths, size and count limits, broken CSS, temp cleanup) and the routes

#### Docs: Calliope Live Spec G

- Added Spec G (custom CSS section in the theme editor, a shared code editor with JSON and CSS highlighting, and importing a `.qtap-theme` file as a draft)

#### Themes: fonts, images, icons, subsystems and manifest details in the theme editor (Calliope Live, Spec F Stages 0–1)

- Theme engine `bundleFileUsage` (`lib/themes/engine/usage.ts`) is the one answer to "what uses which file" (fonts, licence files, icons, subsystems, preview image, tokens and styles files, token, primitive and custom CSS references); the draft detail returns every file with its kind, size, users and an `unused` flag, plus totals against the bundle limits and a `manifestRevision`
- New draft operations (`lib/themes/drafts/operations.ts`, `uploads.ts`) on `POST /api/v1/theme-drafts/[id]`: `read-font`, `add-font`, `add-licence-file`, `add-image`, `set-icon` (multipart, fields validated by Zod) and `update-font`, `remove-font`, `remove-file`, `clear-icon`, `set-subsystem`, `set-manifest` (JSON). Stored names are built by the server; font and raster image extensions must match the file's leading bytes. Each operation checks `manifestRevision` (409 when stale) and a removal of a file still in use is a 409 naming its users
- Font facts (family, weight, style, variable axes, embedding permission, licence hint) are read with `fontkit` in `lib/themes/font-info.ts`; TTF and OTF fonts become WOFF2 (WOFF packed as is) at install with `wawoff2` in `lib/themes/convert-fonts.ts`. The draft keeps the originals
- Install leaves out files nothing uses and reports them (`leftOut`) with the font conversions (`fontConversion`)
- Theme editor: Fonts, Images, Icons, Subsystems and details, and Files sections after the token sections (`components/theme-editor/assets/`). Fonts are added in batches with read-back fields and one licence (with an optional licence file), edited and removed; images added, removed when unused and chosen as the preview image; any icon overridden with an SVG (tinted) or WebP (as drawn) or reset; author, licence, tags and the dark-mode flag edited; each subsystem renamed, described and given a thumbnail and page picture. Operations flush pending token saves first; a stale revision reloads the draft and says it was changed elsewhere
- New fonts appear in the font-family control and mark their weights in the font-weight control; new images appear in the image control
- Fixed: the font licence picker showed "Another licence" with nothing chosen and ignored the licence read from the font
- `help/theme-editor.md` covers the new sections and the install changes
- Tests: operations, uploads, font facts, file usage, and component tests for each section

#### Docs: Calliope Live Spec F

- Added Spec F (font and image upload, icon overrides, subsystem overrides and manifest details in the theme editor; fonts are read from the file and become WOFF2 at install)
- Spec F marked implemented and moved to `docs/developer/features/complete/`, with implementation notes for Specs G and H (custom CSS should save like `tokens.json`, with one named operation for the manifest's `customCSS` path; importing a `.qtap-theme` should extract it and reuse the draft copy path)
- `API.md` documents the draft manifest and file operations, the new draft detail fields, the error codes and the install result's `fontConversion` and `leftOut`; the tokens `PUT` takes only `{ revision, tokens }`
- `THEME_DEVELOPMENT.md` covers the editor's folders, what uses what, font conversion and what install leaves out
- `CLAUDE.md` names `fontkit` and `wawoff2` with their one importer each, and states that manifest edits are named draft operations and `bundleFileUsage` is the one source for served, unused and removable files
- Fixed the help page and changelog: only TrueType and OpenType fonts become WOFF2; WOFF is packed as is

#### Fix: a failed theme draft copy no longer holds its id (#226)

- `createDraftNow` (`lib/themes/drafts/service.ts`) removes the partial `Themes/<id>/` folder when any write fails, then rethrows. Before, the leftover folder never listed (no `theme.json`) but still counted as a taken id, so the next draft of that name got `-2` and the copied files stayed in Quilltap General
- Regression test: a copy whose second file write fails leaves no folder, and a retry gets the un-suffixed id

#### Docs: Calliope Live Spec E

- `help/theme-editor.md` covers the levels, sections, search, "Changed only", each type's control and the text form, following, dark values, density, primitives and undo
- `THEME_DEVELOPMENT.md`: keyword options, and what the editor can and cannot set
- `CLAUDE.md` Themes section: `lib/themes/engine/values/` is the one place a token value is parsed or formatted; the model and `engine/primitives.ts` are the one place a tokens document is edited
- Spec E marked implemented with implementation notes and moved to `features/complete/`

#### Themes: typed controls and editable primitives in the theme editor (Calliope Live, Spec E Stage 2)

- Every token type has its own control in the theme editor (`components/theme-editor/controls.tsx`): colour, length, radius (one value or each corner), shadow (layers with offsets, blur, spread, colour and inset), font family (ordered stack with the draft's fonts and system stacks, and a sample line), font weight (marks the weights the theme's font declares), keyword and font style (a choice of the allowed words), duration, transition (property, duration, easing and delay per item), opacity (field and slider, number or percent), blur, image (the draft's images or none), z-index, number and easing
- Each control has an "edit as text" form. A value its parser cannot read (a gradient, a data URI, a `calc()`) opens in the text form and is left as written until changed
- A value that follows a primitive or another token opens its controls on what it comes to; changing one gives the token a value of its own
- Primitives panel: add (name checked, starting value by type), rename (rewrites references), change type, set the value and a separate dark value, see what follows each, and remove behind a confirmation that lists the values that will take the primitive's value
- Tests: a control test per type, editor tests for the controls and the panel, and a walk that opens every row of each bundled theme and checks nothing is written

#### Themes: theme editor sections, search, undo and the density choice (Calliope Live, Spec E Stages 0–1)

- Theme engine value parsers (`lib/themes/engine/values/`): length and length lists (radius corners), blur, shadow, font stack, transition, duration, opacity, z-index, font weight and image, each with a formatter that round-trips what it accepts; anything else parses to null and is left as written
- The token type check moved to `lib/themes/engine/type-check.ts`, shared by validation and the editor; keyword tokens now carry `options` (text transform, link decoration, color scheme, scrollbar width, background attachment and repeat) and validation refuses any other word
- Primitive edits in `lib/themes/engine/primitives.ts`: add, set value and dark value, change type, rename (rewrites references) and remove (writes the value into its users)
- `GET /api/v1/theme-drafts/[id]` returns the draft's image files with their asset URLs; the draft serves every image it holds
- Theme editor: every settable token (666) laid out by level (Essentials, Components, Advanced) and registry group, with a section list, search across levels, "Changed only", the density choice, and undo/redo for the session (buttons and Ctrl/Cmd+Z). Rows follow or detach from primitives, set a dark value apart, and refuse a value that fails the type check. Rows read from an editor store and mount near the viewport, so an edit re-renders only its row

#### Docs: Calliope Live Spec E

- Added Spec E (typed controls for every theme token, editable primitives, the density choice, search and undo in the theme editor)

#### Themes: theme editor, drafts and live preview (Calliope Live, Spec D Stages 1–3)

- Theme drafts: a draft is the folder `Themes/<id>/` in Quilltap General holding an unpacked version 2 bundle; `lib/themes/drafts/` is the only code that knows the location. Drafts are created blank or as a copy of any installed or bundled theme, validated by the installed-bundle loader, and saved with a revision check (409 on a stale revision)
- New routes `GET`/`POST /api/v1/theme-drafts`, `GET`/`PUT`/`DELETE /api/v1/theme-drafts/[id]` and `POST /api/v1/theme-drafts/[id]?action=install`. The theme asset and font routes also serve a draft's files at the draft's exact version, uncached
- Installing a draft packs it and runs the ordinary bundle install, converts PNG, JPEG and GIF to WebP in the installed copy (the draft keeps its originals), registers the theme without a restart, and bumps the draft's patch version
- Theme editor tab (Calliope's Atelier, `/calliope`, "Design a theme" on the Appearance card): draft list, new/delete dialogs, colour token editing in light and dark with per-token contrast, name and description, autosave, install
- Live preview: the theme provider has a preview slot (`setPreview`) that shows a theme in place of the worn one without changing the stored preference; the Atelier compiles the unsaved tokens in the browser through `lib/themes/engine/client.ts`
- Fixed: a theme's custom CSS and icon overrides reached into nested elements wearing another theme (the Atelier panel, Appearance preview cards). Every descendant rule is now compiled inside `@scope ([data-theme="<id>"]) to ([data-theme]:not([data-theme="<id>"]))`, with the same specificity. The snapshot cascade reads `@scope`
- New `themes` realtime topic, published when a theme is installed; it refreshes theme and draft queries
- `.qtap` exports leave theme drafts out (`docStoreExportExclusion` in `lib/export/excluded-files.ts`: the `Themes` folder of Quilltap General and everything under it). Backups still carry them
- Docs: new `help/theme-editor.md`; drafts and contrast sections in `THEME_DEVELOPMENT.md`; Theme Drafts in `API.md`; Spec D moved to `features/complete/`

#### Themes: contrast checks (Calliope Live, Spec D Stage 0)

- Theme engine has a browser-safe entry point (`lib/themes/engine/client.ts`); a test walks its imports and fails on Node built-ins, PostCSS or the logger
- WCAG contrast check: `CONTRAST_PAIRS` (`lib/themes/registry/contrast.ts`, 57 foreground/background pairs, 4.5:1 for text and 3:1 for focus rings) measured by `checkContrast` in light and dark. Failures are validation warnings in `quilltap themes validate` and theme loading
- `scripts/check-theme-contrast.ts --check` runs in `npm run lint` against the default theme and the bundled themes, with an exception list at `themes/bundled/contrast-exceptions.json` (empty)
- Fixed 54 contrast failures by changing lightness only: default theme silent and wardrobe labels (light), template chips 1, 2 and 4, project badge text (dark); Art Deco, Madman's Box wardrobe badges; silent and wardrobe labels in Art Deco, Earl Grey, Great Estate, Old School and Rains; message, project, npm and tag badges in several themes; Madman's Box chip 3; Rains character, user-character, chat, tag and project badges and link colour (dark)

#### Docs: Calliope Live Spec D

- Added Spec D (contrast checks in the theme engine, theme drafts, and an editor tab with a live preview of colour tokens)

#### Themes: tools and published format (Calliope Live, Spec C Stage 4)

- Published JSON Schemas for both bundle documents, generated from the engine's Zod documents (`npm run generate:theme-schemas`): `public/schemas/qtap-theme.schema.json` (version 2 manifest) and the new `qtap-theme-tokens.schema.json`, which lists every registry token and choice. Bundles name them in `$schema`
- Added `docs/developer/THEME_TOKENS.md`, generated from the token registry (`npm run generate:theme-tokens-doc`). `scripts/check-theme-references.ts` fails lint while it or the schemas are stale
- `quilltap themes` validates, installs, updates and exports through the app's engine, bundled into `packages/quilltap/lib/theme-engine.generated.js` (`npm run build:cli-theme-engine`; lint checks it is current). Version 1 bundles are refused with the app's message. `validate` takes a bundle directory as well as a `.qtap-theme` file. `uninstall` and `export` refuse a theme id that is not a plain id. Removed `packages/quilltap/lib/theme-validation.js`
- `validateThemeBundle` reports an unreadable archive as an error instead of throwing
- create-quilltap-theme 3.0.0: scaffolds a version 2 bundle only (`theme.json`, `tokens.json`, `styles.css`, `README.md`) with `$schema` and `hooksVersion`; `--plugin` and the npm plugin templates are removed; unknown options are an error
- Added `docs/developer/THEME_DEVELOPMENT.md`, the version 2 authoring guide; removed `THEME_PLUGIN_DEVELOPMENT.md`. Updated the README, DEVELOPMENT.md, CLI.md, the CLI README, `help/themes.md` and the hook reference's note on scoping
- The theme menu's empty-state hint says "Install theme bundles", not "theme plugins"
- Moved the Calliope Live audit, Specs A, B and C, the fit report and the differences file to `docs/developer/features/complete/`
- Tests: CLI validate, install, export and uninstall against the bundled engine (bundled themes, v1 refusal, archive symlinks and escaping entries, icon overrides); the scaffolder's output validates with no warnings and names the current hook catalogue version

#### Themes: version 1 removed (Calliope Live, Spec C Stage 3)

- Version 2 is the only theme format loaded. A version 1 bundle found among the installed themes, or a theme a plugin declares, is recorded as refused (`lib/themes/refused.ts`) and never registered; nothing is deleted. The plugin itself still loads
- Install (file, URL, registry) refuses a version 1 bundle before anything is written, with the same message. Registry entries that state an earlier `formatVersion` are not offered
- The Appearance card lists refused themes ("Garments Left at the Door") with the message, a link to the Themes help page, and Uninstall for bundles. `DELETE /api/v1/themes/[id]` uninstalls a refused bundle; a plugin's refused theme is a 400
- If the stored theme is refused or missing, the app wears the default theme and shows one notice
- `GET /api/v1/themes` returns `refused` and `stats.refused`; the Almanack reports the refused count in place of "With CSS Overrides"
- The default theme injects no CSS; `_theme-defaults.css` and `_variables.css` carry its values
- Removed: `ThemeTokensSchema`, `DEFAULT_THEME_TOKENS`, `themeTokensToCSS`, `mergeThemeTokens`, the version 1 font-face and icon-override generators, every version 1 branch, the plugin theme registration code, and `scripts/convert-theme-v1.ts`, `convert-theme-to-module.ts`, `convert-plugin-themes-to-bundles.sh`. Version suffixes dropped from names (`exportThemeAsBundle`, `theme-bundle.ts`)
- Removed the 12 internal registry tokens nothing read: `--qt-auth-page-bg`, `--qt-footer-bg`, `--qt-input-placeholder`, `--qt-sidebar-fg`, `--qt-sidebar-muted`, `--qt-tab-gap`, `--qt-left-sidebar-{min-width,max-width,footer-height,item-gap,overlay-bg,overlay-z}`. Density now covers 25 sizing tokens (three of the 28 were among them)
- `scripts/check-theme-hooks.ts` fails on any off-catalogue selector in a bundled theme; loading an installed theme logs the same findings as warnings
- Bundle extraction and asset serving share the app's path rules; the themes index is rebuilt from the installed bundles when it is unreadable
- Re-recorded the theme snapshot fixtures for the removed tokens; no other resolved value changed
- Tests: refusal at install, at load and as a plugin theme; refused themes give the injector nothing; the asset route serves only the served set
- create-quilltap-theme: templates drop the removed tokens. theme-storybook: regenerated CSS

#### Themes: bundled themes refined (Calliope Live, Spec C Stage 2)

- The six bundled themes use plain, typed primitives (`brass`, `walnut`, `text-muted`, `red-deep`) with a `dark` value where the modes differ; recurring literal colours are primitives too. earl-grey and rains share primitive names
- Semantic colour families are anchored to the primitives, and overrides that reproduce them are gone. A dropped override whose value differed by ΔE ≤ 0.02 (OKLab) is listed in the differences file with its ΔE
- Hand-written rules replaced by tokens the app already reads: colour scheme, text selection, scrollbars, focus ring, primary button, badge and alert colours, radii, heading font and letter-spacing, footer link, input focus border. madmans-box's homepage glow is `--qt-page-background-image`
- New tokens: `--qt-page-background-texture` and `--qt-page-background-texture-opacity` (a tiling texture over the page background, hidden with it under a story background); `--qt-thinking-duration` and `--qt-thinking-origin`. `--qt-scrollbar-width` defaults to `thin`, which the default theme already rendered
- Smoothed text and smooth scrolling apply to every theme from `_base.css`
- The heading tokens style `.qt-page-title`, `.qt-section-title`, `.qt-homepage-section-title` and `.qt-text-section`. No change in the default theme
- Removed the themes' dead selectors (classes no markup uses), reduced-motion resets, `*` transitions and attribute-substring stand-ins; what remains targets catalogued hooks only. `scripts/check-theme-hooks.ts` reports all six clean
- Catalogued as hooks: `qt-text-brand`, `qt-font-brand`, `qt-spinner`, `qt-thinking-indicator`, `qt-diagram`, the six category badges, `qt-empty-state-title`, `qt-wikilink` (state `qt-wikilink-broken`), `qt-file-preview-panel`, `qt-participant-turn-dot`
- Decision 1: earl-grey and rains set `--theme-font-sans` / `-serif` / `-mono` to the stacks they always named, so earl-grey renders in Rethink Sans and rains' code in Fira Code (rains' chat user font was already Nunito Sans)
- New token `--qt-body-font-weight` (root font-weight, optional); rains sets 300, as its version 1 root rule did
- The root `scrollbar-color` falls back to a transparent track when a theme sets a thumb and no track; earl-grey and rains had dropped to the browser's scrollbar
- art-deco and great-estate give tabs (and the button inside a workspace tab), the sidebar items and profile, the settings rail, collapsible card headers and chips the tracked capitals their version 1 bare `button` rule gave; art-deco, great-estate and madmans-box set card and dialog titles in the heading face, and draw the character header's rule in the card border colour, as their `[class*="card"]` rule did
- art-deco, great-estate and madmans-box scrollbars take the theme's colours in Chromium too; version 1 coloured them only through `::-webkit-scrollbar`, which Chromium ignores once `scrollbar-width` is set
- Custom CSS before → after (bytes): art-deco 3063 → 1261, earl-grey 6438 → 1537, great-estate 4040 → 1732, madmans-box 4608 → 2407, old-school 1462 → none, rains 7327 → 2037
- Re-recorded the theme snapshot fixtures; every rendered change is in `calliope-live-spec-c-differences.md`
- theme-storybook: regenerated CSS

#### Themes: bundled themes converted to version 2 (Calliope Live, Spec C Stage 1)

- The six bundled themes (art-deco, earl-grey, great-estate, madmans-box, old-school, rains) are now version 2 bundles, version 2.0.0, written by `scripts/convert-theme-v1.ts` with no hand edits. Each bundle has a `fonts/OFL.txt` with its families' copyright lines as the font files state them (earl-grey's previous file named the wrong holder and year; rains' lacked Nunito Sans)
- Re-recorded the theme snapshot fixtures. No resolved value changed: private names now appear as `--p-*`, names nothing reads are gone, and some values are re-spelt (`hsl(… / a)` as the equal `color-mix(…, transparent)`), including in the default theme, whose fixtures predated that change in the app CSS
- The theme picker's cards show the font a theme's headings actually render in (its resolved `--qt-heading-font`), not its `fontSerif` token; swatch colours are unchanged
- The version 1 loader test uses its own fixture, `__tests__/fixtures/themes/v1-sample/`, now that no bundled theme is version 1
- old-school now uses the app's keyboard focus ring (2px solid in `--qt-focus-ring-color`, 2px offset) instead of the browser's default; version 2 turns `features.focusRing` on and old-school has no focus rule of its own. The other five keep their own rules
- The theme preview dialog renders from the compiled theme, so it now matches the live app. One known gap: rains' sample shows 8px cards and 12px badges (the app shows 12px and 24px), because its radii are set as root overrides, which the preview's nested container re-applies from `--theme-radius-*`
- Bundle asset URLs carry `?v=<theme version>`
- `scripts/convert-theme-v1.ts` takes `--from <dir>` to read version 1 bundles from somewhere other than `themes/bundled`

#### Themes: migration baseline and tools (Calliope Live, Spec C Stage 0)

- Added the theme probe, `scripts/theme-probe/`: a dependency-free page function that records computed styles (colour, background, border, font, padding, gap, shadow, outline, opacity, transition, animation, filters, scrollbar, `color-scheme`, plus `::before`, `::after`, `::selection`) for `html`, `body`, bare `h1`–`h3` and the first visible element of every catalogued hook, variant value and state, with match counts; and a Playwright driver (`run.ts run` / `compare`) that runs it over seven pages per theme and mode and saves screenshots. Playwright is not a repo dependency; results go to the git-ignored `.theme-probe/`
- Recorded the version 1 baseline on V4test (7 themes × 2 modes × 7 pages, outside the tree). Re-probing the default theme afterwards differs on none of its 14 pages
- Added `scripts/convert-theme-v1.ts` (removed again in Stage 3): converts a bundled version 1 theme to version 2 from what it resolves to, with private names as primitives, unread names dropped and listed, rules moved to custom CSS without the theme id, density set to `comfortable`, version 2.0.0 and `hooksVersion`. It validates its output with the engine and compares the root cascade with the version 1 theme's. All six bundled themes convert with no changed value (output not yet written into `themes/bundled/`)
- Font licences are read from each font file's name table: every font in the six bundles is SIL OFL 1.1. The converter writes one `fonts/OFL.txt` per bundle with each family's copyright line as the file states it
- Version 2 manifests accept `hooksVersion` (integer, optional). A theme behind the hook catalogue gets a load-time warning naming any removed hook its custom CSS still uses (`removedHooksUsed` in `lib/themes/hooks/lint.ts`)
- `--qt-button-transition`, `--qt-card-transition` and `--qt-app-header-blur` no longer change with `density`; it keeps the 28 sizing tokens. No version 1 theme or the default theme is affected
- The snapshot harness applies a version 2 theme's choice and feature attributes to `<html>` (`v2RootAttributes`), as `applyThemeToDom` does
- Added `docs/developer/features/calliope-live-spec-c-differences.md`, empty until a stage changes how a theme renders
- theme-storybook 1.0.121: regenerated CSS

#### Dependencies: npm update across root, packages and plugins

- Ran `npm update -S` in the root project, every package and every plugin. Notable bumps: `better-sqlite3-multiple-ciphers` 13.1.1, `openai` 7.57, `@anthropic-ai/sdk` 1.8, `@openrouter/sdk` 1.5.103, `eslint` 10.15, `storybook` 10.6.7, `ws` 8.23; patch bumps to `tar`, `postcss`, `dompurify`, `croner`, `@napi-rs/canvas`, `@testing-library/user-event`
- Plugins and plugin-utils now require `@quilltap/plugin-types` ^2.11.0; the root and plugins require `@quilltap/plugin-utils` ^2.7.6
- postcss 8.5.33 types `Declaration.important` as `boolean | undefined`; the theme snapshot cascade (`lib/themes/snapshot/cascade.ts`) now coerces it
- plugin-utils 2.7.6, theme-storybook 1.0.120; patch bumps to all 15 plugins (`package.json` and `manifest.json`), rebuilt

#### Themes: version 2 theme document (Calliope Live, Spec A Stage 3)

- Added the version 2 theme format (`theme.json` with `formatVersion: 2`): `tokens.json` holds author-named primitives (emitted as `--p-<name>`), overrides of registry tokens (one value, or light and dark) and choices; custom CSS is written without the theme id. `extendsTheme` is not part of version 2
- Added the theme engine, `lib/themes/engine/` (pure): Zod schemas for both files; validation (registry token and choice names with nearest-name suggestions, `var()` references, type checks, reference cycles in both modes, every referenced file present, app icon names, subsystem ids, font licences); `resolveTheme` with per-value provenance; `emitThemeCss`; `scopeThemeCss` (PostCSS: prefixes selectors with `[data-theme="<id>"]`, prefixes keyframe names, keeps `@media` / `@supports` / `@container` / `@layer`, refuses other at-rules); `url()` limited to bundle images and `data:image` URIs, rewritten to the asset route with the theme version
- `lib/themes/v2-bundle.ts` reads a bundle directory, validates and compiles it. `QtapThemeManifestSchema` is a union on `formatVersion`; version 1 bundles load as before. Install, load, registration and export handle both; a version 2 theme exports as installed
- `?action=tokens` returns, for a version 2 theme, its compiled CSS, choices and features instead of version 1 tokens. The theme provider injects that CSS as it is and sets `data-qt-<choice>` and the feature attributes on `<html>`; the theme picker's swatches and heading font come from the compiled theme; the Appearance preview renders a version 2 theme in a container carrying its `data-theme` (`qt-theme-preview-surface`)
- `_theme-defaults.css` also declares the semantic defaults on `[data-theme]` elements and re-declares Tailwind's `--color-*` / `--radius-*` / `--font-*` map on `[data-theme]:not(:root)`, so a theme previewed inside another starts from the defaults; no root value changes
- `postcss` moved to `dependencies` and, with its dependencies, into `outputFileTracingIncludes`: `server.ts` and the WebSocket entries reach the theme engine with packages external
- Added the fixture theme `__tests__/fixtures/themes/v2-sample/` and tests: every schema and CSS rejection, provenance, emitted and scoped CSS snapshots, a snapshot-harness run over the fixture (overridden tokens change, density applies, the rest keeps its default), and the loader round trip (validate, install, register, export) beside a version 1 bundle

#### Themes: semantic tier widened (Calliope Live, Spec A Stage 2)

- The semantic `--theme-*` tokens (colours, sidebar colours, radii, type and spacing scales, effects) are now in the registry and generated into `app/styles/_theme-defaults.css`, which replaces the hand-written `:root` / `.dark` blocks in `globals.css`. `DEFAULT_THEME_TOKENS` is read from the registry; the two had no disagreements
- Added semantic families, and re-expressed their component tokens through them: category palette (17 badge categories, colour + foreground, one tint), status palette (alert colour + foreground per status, fill and edge strengths), chat surfaces (assistant, Staff, and an accent + label per message kind), roleplay text, terminal palette, overlay scrim, and hover shade/tint. 96 tokens
- Added app-owned rules in `_base.css`: `::selection`, `color-scheme`, `scrollbar-width` / `scrollbar-color` (in `@layer base`); WebKit scrollbar styling, a `:focus-visible` ring and a page background image behind `data-qt-scrollbar`, `data-qt-focus-ring` and `data-qt-page-background`, which `applyThemeToDom` now sets on request. The default theme's `::selection` rule became the token defaults
- Added optional hooks (read with a fallback, never declared): heading weight, letter spacing, transform and colour on `.qt-heading-*`; letter spacing and transform on `.qt-button`. Added `--qt-dialog-border-width`
- Added the `density` choice: 31 tokens take a `comfortable` value under `[data-theme][data-qt-density="comfortable"]`; `compact` is the existing defaults. Nothing sets the attribute yet
- Registry: `optional` and `byChoice` on tokens, `sheet` on groups, choices in `lib/themes/registry/choices.ts`
- Added `lib/themes/color/` (CSS colour evaluation, OKLab difference), checked against Chrome on every colour in the fixtures. The theme snapshot now compares colours by rendered 8-bit RGBA, so an equal formula is not a change; `scripts/theme-snapshot.ts --add` records new names without touching recorded values
- No resolved value changed in any of the fourteen theme/mode fixtures; an in-browser comparison of 5,278 computed properties per run (headings, buttons, dialog, inputs, card, selection, root, shell) found no difference in any theme or mode
- Added the fit report, `docs/developer/features/calliope-live-spec-a-fit.md`, and `scripts/theme-fit-report.ts`, which generates its tables
- `scripts/check-css-vars.mjs` now also checks untracked, non-ignored files, so a new stylesheet is checked before it is staged
- theme-storybook 1.0.119: regenerated CSS

#### Themes: token registry generates the variable defaults (Calliope Live, Spec A Stage 1)

- Added the theme token registry in `lib/themes/registry/`: 518 tokens in 36 groups (one file per group), each with tier, type, group, label, default, optional dark default and visibility, plus lookups by name and by group
- `app/styles/qt-components/_variables.css` is now generated from it (`npm run generate:theme-variables`); `npm run lint` runs `scripts/check-theme-variables.ts`, which fails when the file and the registry disagree. Same selectors and specificity as before
- Moved the hand-written rules from `_variables.css` (root baseline, `::selection`, reduced motion) unchanged to `app/styles/qt-components/_base.css`, imported right after it
- Declared 13 hook variables the app read only through `var(--hook, fallback)` (the copy-button set, `--qt-thinking-duration` / `-origin`, `--qt-workspace-accent`, `--qt-workspace-tab-active-fg`), each defaulting to its fallback. `--qt-badge-secondary-border` is read with no fallback and was left undeclared
- Marked the 12 variables nothing in the app reads as `internal`; they stay because bundled themes still set them
- Dropped 22 dark-block declarations that repeated the shared value
- Theme snapshot: no existing value changed in any theme or mode; the fixtures gained only the 13 hooks
- theme-storybook 1.0.119: regenerated CSS

#### Themes: resolved-variable snapshot (Calliope Live, Spec A Stage 0)

- Added `scripts/theme-snapshot.ts` (`--check` to compare): compiles `app/globals.css` with Tailwind's compiler and source scan, applies each theme's injected CSS, and records what every custom property resolves to on `<html>` for the default theme and the six bundled themes in light and dark
- The resolver is `lib/themes/snapshot/` (cascade layers, specificity, order, `!important`, CSS nesting, `@supports` for the conditions Tailwind writes, `@property` initial values, recursive `var()` with fallbacks; cycles and unresolvable references are reported). Tailwind's own default theme variables and `--tw-*` internals are used for resolution but left out of the output
- Added the fourteen fixtures under `__tests__/unit/lib/themes/fixtures/snapshots/` and a test that recomputes and compares them; checked against Chrome's computed styles for all fourteen
- Confirmed that the font stacks in a bundle's `tokens.json` never take effect (recorded in the audit). earl-grey and rains render system fonts in the UI because they do not re-declare `--theme-font-*` in `styles.css`. Not fixed here

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
- Added Spec C (migrate the six bundled themes to version 2, retire version 1, move the CLI, scaffolder and JSON Schema to the new format)
