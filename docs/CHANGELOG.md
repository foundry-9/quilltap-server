# Quilltap Changelog

## Recent Changes

### 4.11-dev

#### Fix: dialog semantics and keyboard access for every modal and clickable card (release checklist 13, continued)

- Hand-built modals in 54 files (41 that hand-roll a `qt-dialog-overlay`, 13 built on raw `fixed inset-0` overlays) now carry `role="dialog"` (`alertdialog` for destructive confirmations), `aria-modal` and `aria-labelledby`/`aria-label`, use `useDialogFocus` (focus in, Tab trap, focus restored), and close on Escape where they did not before (busy-state gating kept). Markup otherwise unchanged; none were moved onto `BaseModal`, since doing so would have changed their layout.
- `useDialogFocus`: the opener is now recorded during render. Before, an `autoFocus` field had already taken focus by the time the effect ran, so focus was never restored for those dialogs (BaseModal included).
- `FloatingDialog` (Help, Brahma Console, compose dialogs): `role="dialog"`, `aria-modal="false"` (the page behind stays usable, so no Tab trap), `aria-labelledby`, focus in on open and back on close. Escape now closes it from anywhere unless a modal dialog is open; inside a topmost one it still swallows the key.
- New `activateOnKey` (`components/ui/activate-on-key.ts`): Enter/Space clicks a `role="button"` element. Used where a `<button>` would not do (table rows; Art Deco and Great Estate uppercase every bare `button`): Scriptorium store-card titles, `FileTable` file names (`aria-expanded`), `FileBrowserList` folder and ".." rows, LLM log rows, image-gallery tiles (`aria-pressed`) and the Document Mode title.
- Aurora character cards: the name is now a link to the character, so a card can be opened from the keyboard.
- Alias remove "×" in the character editor has an `aria-label`; quick-hide tag toggles have `aria-pressed`.

#### Fix: WCAG AA contrast, focus and reduced-motion pass across all themes (release checklist 13)

- Status colours: every theme × mode now meets 4.5:1 for `success` / `warning` / `info` / `destructive` as text on background, card and popover, and for each `XForeground` on its fill. Light modes darken the status colours (warning foreground becomes white); dark modes lighten `destructive` and put dark text on success/info/destructive fills. Default theme changed in `lib/themes/default-tokens.ts` and `app/globals.css`. Hue and saturation are unchanged; only lightness moved.
- Also fixed: `mutedForeground` (Art Deco, Old School, default dark), `accent` and `chatUser` fills (Earl Grey, Rains, Old School), `ring` (Art Deco light 1.37:1 → bronze, Great Estate light, Rains light), Rains dark `primary` on card, and the default `sidebarMuted`.
- Earl Grey and Rains: status `--theme-*` lines in `styles.css` repointed (palette variables untouched); `--text-400` / `--text-300` lifted to 4.5:1 (placeholders, auth hints, chat-sidebar labels); Earl Grey links per mode.
- Art Deco and Great Estate light: links and the active tab used gold on cream (1.85:1 and 3.2:1). New `--deco-bronze` / `--estate-bronze`. Great Estate dark active tab uses `--estate-gold`.
- Header queue badges (`Mem` / `Sum` / `Dgr` …): fills darkened to 4.5:1 against their text in core and five themes.
- Reduced motion: the global `prefers-reduced-motion` rule was scoped to `[data-theme="default"]`, so no bundled theme honoured it. It now applies everywhere.
- Toasts: container was `role="toast-container"` (invalid) with no live region and used raw Tailwind white-on-green/yellow. Now `role="status"` + `aria-live="polite"` (errors `role="alert"`), coloured with theme status tokens via new `qt-text-{success,warning,info,destructive}-foreground` utilities.
- `BaseModal`: now `role="dialog"`, `aria-modal`, `aria-labelledby` the title; moves focus in on open, traps Tab, restores focus on close. Focus logic extracted from `SlideOverPanel` into `hooks/useDialogFocus.ts`, which both now use.
- 16 icon-only close/dismiss buttons gained `aria-label`.
- Theme versions: Art Deco 1.0.13, Earl Grey 1.3.9, Great Estate 1.0.9, Madman's Box 1.1.9, Old School 1.0.14, Rains 1.3.13. theme-storybook 1.0.89 (defaults, queue badges, new utilities, reduced motion); create-quilltap-theme 2.0.21 (starter tokens pass AA).
- Removed the unused root `create-quilltap-theme` dependency (and its knip ignore). Nothing imports it; `quilltap themes create` calls it through `npx`, which now always fetches the published version instead of a stale local copy.

#### Docs: new release checklist item 13 (UI, look-and-feel, WCAG); docs check becomes item 14

- New `/release-checklist-13-ui` command: a whole-UI review under every bundled theme in light and dark mode. Covers token contrast measured from each theme's `tokens.json`, a live design pass on the V4test instance, and WCAG 2.2 AA checks (keyboard and focus, accessible names, labels and landmarks, live regions, color-only cues, reflow at 320px, 200% zoom, target size, reduced motion). States which layer each fix belongs in.
- `/release-checklist-13-docs` renamed to `/release-checklist-14-docs`. It now also asks that the README explain how to use the repo, install, run and develop Quilltap and link the public JSON schemas; that DEVELOPMENT.md cover contributing with links to PRs and Issues; that the About page keep version numbers and dependency credits current; and that every public schema be documented.
- Every checklist command now says "of 14". DEVELOPMENT.md's release checklist gains the new item 13.

#### Docs: feature-spec cleanup

- Removed three stale proposals and every link to them: the ComfyUI image plugin, block-scoped roleplay narration (superseded by the Novel template and prose mode), and provider usage/balance tracking.
- `composer-typeahead.md` moved to `features/complete/` with a status line recording what shipped. Its unbuilt Phase 3 (`#` document references) is now a separate proposal, `composer-document-references.md`, revised for the current code (`qtap://` addresses, a trailing context section, a `?action=search-files` collection action, its own `composerDocReferences` toggle).
- `svar-bridge-spike-findings.md` moved to `features/complete/`; the SVAR implementation plan's status line now records what shipped and what remains.
- ROADMAP: dropped the stale 3.3.0 release checklist (including the website recommendations-file item), added the `#` references item, fixed the CHANGELOG_V2 link.

#### Fix: legible dialogue in user messages; Rains user text; Great Estate light sidebar

- Core: quoted dialogue (`.qt-chat-dialogue`) inside a user message now takes `--qt-chat-user-fg` (theme hook `--qt-rp-user-dialogue-color`). `--qt-rp-dialogue-color` defaults to the page foreground, so on a dark user bubble in a light theme it was dark on dark: Art Deco light 1.2:1, Great Estate light, and the default theme's blue bubble.
- Rains 1.3.12: `--qt-chat-user-fg` was a fixed near-white on a bubble that is white in light mode. It now uses `--text-000`.
- Great Estate 1.0.8: the left sidebar is estate brown in both modes, but in light mode its icons and labels used the dark-brown page foreground. They now use cream, with muted items and the active item in lighter gold.
- Mirrored to theme-storybook 1.0.88, which also gains the dialogue/narration/inner-monologue/OOC chip family.

#### Docs: bugs move to GitHub Issues; in-repo catalogue frozen at Bug 269

- New `.github/ISSUE_TEMPLATE/bug.yml` issue form carries the catalogue's metadata: severity, who it bites, provenance (Original to v4 / Pinned / Faithful / Inert), how it was found, v5 status, symptom, root cause, why it survived, fix site, how to verify. Applies the `bug` label.
- `docs/developer/bugs.md` and `docs/developer/bugs/` take no new entries. Bugs 1–269 keep their numbers and files, so existing "bug N" references still resolve there. New bugs are cited as `#N` and closed with `Fixes #N`.
- CLAUDE.md "Filing bugs" and the documentation index updated to match.

#### Fix: legibility pass over the `qt-*` surfaces added since 4.9, in all six bundled themes

- Measured every class added since 4.9.0 (storyteller board and mode control, Pascal intervention dialog and hand toggles, regeneration plate, composer Stop/raise-hand, Concierge badge and mark, diagrams, name chips, gallery captions, prose-mode highlights, Brahma launcher) in each bundled theme, light and dark, against WCAG AA. The failures and their fixes are listed below.
- Core: small warning/danger text now reads the text-safe alert tokens instead of fill colors. `.qt-intervention-note` uses `--qt-alert-warning-fg` (was `--color-warning`, 2.0–2.8:1 on light themes); `.qt-storyteller-warning` and the `.qt-concierge-mark` glyph use `--qt-alert-error-fg`; `.qt-danger-badge` takes its text from a new `--qt-concierge-badge-fg` (alert error ink; body ink for the Locked variant), with tint and border still from `--qt-concierge-badge-color`.
- Core: `.qt-chat-regenerating-plate-text` sets its words in `--qt-chat-assistant-fg` (new hook `--qt-chat-regenerating-plate-fg`). The streaming green stays on the border and the quill. Was 1.6:1 on Art Deco light.
- Core: `.qt-intervene-toggle--off` draws a diagonal slash through the hand instead of using 50% opacity, which left the icon at about 2:1 everywhere. On and off no longer differ by color alone.
- Core: default light `--qt-response-status-streaming-fg` deepened from `hsl(152 55% 38%)` to `29%`.
- Earl Grey 1.3.8: light-mode `--qt-status-warning/danger/success-fg` and streaming green deepened (raise-hand button, Paused segment and warning badges were 2.4:1); dark-mode `--qt-status-danger-fg` uses `--danger-000`.
- Rains 1.3.11: light-mode orange accent `28 75% 50%` → `24 80% 40%`, primary `hsl(10 53% 53%)` → `hsl(11 55% 45%)`, muted foreground → `hsl(30 4% 40%)`, status ink and streaming green deepened. In dark mode, white on the orange was 2.4–3.1:1, so buttons, primary badges, active filter chips and `primaryForeground` now use warm charcoal ink (`--oncolor-brand`). The orange itself is unchanged and still works as text and accent.
- Great Estate 1.0.7: muted foreground deepened in light (`45%` → `39%`) and lifted in dark (`52%` → `60%`); light destructive `48%` → `43%`; streaming green deepened. Dark mode now defines `--qt-alert-error-fg` and `--qt-alert-info-fg`; without them the light values applied in dark mode, leaving dark red at 1.9:1.
- Old School 1.0.13: light destructive `hsl(0 72% 51%)` → `hsl(0 70% 44%)` (white on the Stop button was 4.07:1); streaming green deepened.
- Art Deco 1.0.12: light alert ink deepened to suit its darker parchment cards; streaming green deepened. `.qt-intervention-row` is exempt from the theme's uppercase button rule, since Pascal outcomes are sentences. Great Estate gets the same exemption.
- Madman's Box 1.1.8: diagrams use the console's near-black pane (`--qt-terminal-bg`), a dim phosphor-cyan rim and a faint inner glow. Mermaid still takes its node colors from the theme palette.
- Mirrored to theme-storybook 1.0.87.
- Help: `help/pascals-workbench.md` describes the struck-through hand.

#### Feature: composer prose mode — narration/OOC preview and a no-dialogue warning

- For a template whose narration is unmarked and whose dialogue is in `"` (Novel), the Salon composer now paints narration (`::highlight(qt-composer-narration)`) and `((…))` asides (`::highlight(qt-composer-ooc)`, using the template's `--qt-rp-ooc-*` colors). Highlights only; the text is not changed. The preview is independent of the punctuation-warnings toggle.
- New `no-dialogue` lint rule under `proseMode`: when the draft has narration but no dialogue opener anywhere (quotes inside `((…))` don't count), every narrated run is painted with `::highlight(qt-punctuation-no-dialogue)` (dotted underline, lighter tint). No caret exemption. Governed by `punctuationWarnings`.
- Engine (`lib/punctuation-lint/engine.ts`): `proseMode` option, `classifyProse(blocks)` returning narration/OOC spans, and dialogue spans recorded by the quote pass. New `lib/punctuation-lint/prose-mode.ts` (`isProseTemplate`) decides the gate: `narrationDelimiters === null` and a wrap delimiter of `"`. `SalonView` computes it from the chat's template and passes `proseMode` through `ChatComposer` → `LexicalComposerWrapper` → `PunctuationLintPlugin`.
- `PunctuationLintPlugin` now publishes four highlight names with priorities (warning > no-dialogue > OOC > narration); hover explains warnings before the no-dialogue tint.
- New tokens `--qt-punctuation-no-dialogue-bg` / `-underline`, `--qt-composer-narration-fg` / `-bg`, `--qt-composer-ooc-fg` / `-bg`, mirrored to theme-storybook (1.0.86).
- Help: `help/chat-settings-composer.md`, `help/roleplay-templates.md`.
- Tests: `lib/punctuation-lint/fixtures/prose-vectors.json` (v5 contract corpus) driven from `engine.test.ts`; `__tests__/unit/lib/punctuation-lint/prose-mode.test.ts`; prose-mode cases in `PunctuationLintPlugin.test.tsx`.

#### Fix: NanoGPT image sizes are fitted to each model; Qwen Image 3 avatars no longer 400 (bug 269)

- The NanoGPT plugin sent the provider-wide portrait/landscape sizes (`832x1248` / `1248x832`) to every model. Models with their own size list rejected them; `qwen-image-3-uncensored` answered every avatar with `400 "supports 1K and 2K output"`.
- New `fitImageShape` (`plugins/dist/qtap-plugin-nanogpt/image-sizes.ts`) fits the request to the model's entry in the detailed catalog: the nearest listed size by aspect ratio, in the model's own spelling (`WxH` or `W*H`), or for tier models (`1k`, `2k`) the nearest tier plus the nearest listed `aspect_ratio`, sent as a flat body key. `generateImage` fetches the catalog when the cache is cold (always, in the job child); if the fetch fails, the size is sent as asked.
- A non-square request refused on its shape (a 400 naming size/resolution/aspect/dimension/output, or a 503) is retried once as a square. On 2026-10-27, NanoGPT returned an uncharged 503 for every non-square ratio on Qwen Image 3 while `1:1` worked, so portraits on that model currently come back square.
- `qtap-plugin-nanogpt` 1.2.10 → 1.2.11.
- Help: `help/image-generation-profiles.md` NanoGPT size note.
- Test: `__tests__/unit/plugins/nanogpt-image-sizes.test.ts`.

#### Fix: terminal Kill ignored by bash; deleted chats left their shells running (bug 268)

- The `?action=kill` and `DELETE` routes in `app/api/v1/terminals/[id]/route.ts` sent `SIGTERM`, which an interactive bash ignores, so Kill did nothing. They now call the new `ptyManager.terminate(id)`: `SIGHUP`, then `SIGKILL` if the process is still running after 3 s. `?action=signal` is unchanged.
- `PtyManager.kickAllForChat` had no callers. It is replaced by `disposeChatSessions(chatId)`, which terminates the chat's sessions and drops them from the map, and `ChatsRepository.delete` calls it after the row is deleted. This covers every chat delete path, including replace-mode restore. No closing announcement is posted for a deleted chat; its transcripts go to the bug 267 orphan sweep.
- Help: `help/ariel.md` no longer says leaving a chat closes its terminal; it says deleting the chat does.
- Tests: `lib/terminal/__tests__/pty-termination.test.ts`, `__tests__/unit/lib/database/repositories/chats-delete-terminals.test.ts`.

#### Fix: deleted chats left their terminal transcripts behind (bug 267)

- Deleting a chat (or a replace-mode restore, or an import overwrite) cascades its `terminal_sessions` rows away, but the transcripts in `logs/terminals/<id>.log` stayed. The only code that removed them, `cleanupClosedSessions`, works from rows, so they were orphaned for good. `DELETE /api/v1/terminals/[id]` had the same gap.
- The daily maintenance tick now runs `TerminalSessionsRepository.sweepOrphanedTranscripts` after the closed-session reaper. It removes `.log` files no row names, and spares a session still live in the PTY manager and any file written in the last hour (`ORPHAN_TERMINAL_TRANSCRIPT_GRACE_MS`; the transcript is opened before the row is inserted). Shell-init files are left alone. The maintenance summary reports it as `orphanedTranscriptsSwept`.
- Test: `__tests__/unit/database/terminal-transcript-orphan-sweep.test.ts`.
#### Docs: terminal sessions are excluded from backups

- `terminal_sessions` rows and their transcripts under `logs/terminals/` have never been in backups. This is now a stated decision rather than a gap: sessions cannot be resumed, `cwd` is a path on the source machine, closed sessions are reaped after `CLOSED_TERMINAL_RETENTION_DAYS` (30), and transcripts are raw shell output that can contain secrets. Ariel's dispatches are chat messages and are already backed up.
- Listed under "Not Included in Backups" in `help/system-backup-restore.md` and as a sanctioned exclusion in release checklist 10.
- `__tests__/unit/lib/backup/terminal-sessions-excluded.test.ts`: `createBackup` never reads the terminal-sessions repository, stages no terminal file or `.log`, and reports no terminal count in the manifest.
- `lib/backup/restore/__tests__/delete-service-annotations.test.ts`: mock `logEntries.deleteAll`, which `clearFormat3Entities` now calls; both cases threw on main without it.

#### Security: pdfjs-dist 6.4; pdf-parse replaced by a direct reader

- `pdfjs-dist` 5.7.284 → 6.4.299 for GHSA-hq66-cqwq-w95j (high: script execution when a malicious PDF is opened with scripting enabled; affects 5.6.83 to before 6.2.108, no 5.x fix). The Salon's PDF preview only renders pages to a canvas and the server only extracts text, so the advisory's path was probably unreachable, but there was no patched 5.x to stay on.
- `pdf-parse` 2.4.5 (unmaintained since October 2025, pinned to `pdfjs-dist` 5.4.296) is removed. Our `overrides` had forced it onto the root pdfjs, and pdfjs 6 removed the `PDFDocumentProxy.destroy()` its cleanup calls, so every extraction would have leaked a document and its worker without an error. `convertPdfBufferToText` (`lib/mount-index/converters/pdf-converter.ts`) now reads with `pdfjs-dist/legacy/build/pdf.mjs` directly, reproduces pdf-parse's default line, tab and `-- N of T --` page-marker assembly, disables XFA, and always destroys the loading task. The regex fallback in `file-content-extractor.ts` is unchanged. Compared against pdf-parse on four real PDFs: the three text documents are byte-identical; a sheet-music score loses a space between bar numbers and note glyphs in 52 lines, which comes from pdfjs 6's whitespace items, not the assembly.
- Bug 178's fix moves with it: `pdfjs-dist` replaces `pdf-parse` in `serverExternalPackages` and the standalone tracing includes, and the job-child esbuild bundle now marks `pdfjs-dist` external, so it loads from `node_modules` and finds `@napi-rs/canvas` through its own `import.meta.url`.
- `@napi-rs/canvas` 0.1.100 → 1.0.13 (pdfjs 6's optional dependency; same platform-package layout) in the root and `packages/quilltap`. The `pdfjs-dist` and `@napi-rs/canvas` entries in root `overrides` existed only for pdf-parse's nested copies and are removed. `public/pdf.worker.mjs` is re-synced to 6.4.299.

#### Fix: PDF preview showed a blank first page on dark themes (bug 266)

- `FilePreviewPdf.tsx` started a new `page.render()` on every scale change without cancelling the one in flight. The fit-to-width scale lands right after the first render starts, so the second run resized (cleared) the canvas under the first and pdf.js refused it ("Cannot use the same canvas during multiple render() operations"); the first then drew black text on a transparent canvas. The effect now cancels and awaits the in-flight `RenderTask` before redrawing, cancels on cleanup, and ignores `RenderingCancelledException`. Not caused by the pdfjs upgrade; found while checking it.

#### Chore: minor and patch dependency updates

- `npm update -S` in the root: `next` / `eslint-config-next` 16.4.3, `openai` 7.45.0, `@openrouter/sdk` 1.5.9, TanStack Query 5.105.0, `@tanstack/react-virtual` 3.14.23, `react` / `react-dom` 19.3.1, `zod` 4.6.7, `sharp` 0.35.5, `ws` 8.22.0, `mammoth` 1.13.0, `katex` 0.19.1, `postcss` 8.5.32, `autoprefixer` 10.6.2, `dotenv` 18.0.9, `@playwright/test` 1.64.1, and smaller type/test packages. Major-version updates (`typescript` 7, `eslint` 10, `better-sqlite3-multiple-ciphers` 13, `chokidar` 6, `croner` 11, `emojibase-data` 18, `jest-fetch-mock` 4, `@types/node` 26) are not included.

#### Fix: backups now carry the Log

- `log_entries` (the Log, in the LLM logs database) was left out of logical backups. It is ordinary user content, not secret, so a restore lost every line. Found in release checklist 10 (backup/restore completeness). This reverses the earlier "Not included in ... logical backups" note under *Feature: the Log*; `.qtap` exports still leave it out, as they do the LLM logs.
- Backup writes `data/log-entries.json` (manifest count `logEntries`), read through the new `LogEntriesRepository.findAllEntries()` (oldest first, empty while the logs DB is degraded). Restore re-creates each line under its own id and timestamps, after the chats, and skips the lot with a warning while the logs DB is degraded. New-account mode remaps `id`, `chatId` and `characterId` (a null character stays null). Older archives have no file and restore none.
- Replace-mode restore and "delete all my data" now clear the table through the new `LogEntriesRepository.deleteAll()`. Before, the per-user deletes never reached it, so a replace restore would have collided on preserved ids and a data wipe left every line behind.
- Help: `help/system-backup-restore.md` lists the Log under *Logs & History* and open Storyteller rounds under *Not Included*; `help/the-log.md` no longer says the Log, or the LLM logs, stay out of backups.
- Tests: a 4.11 block in `restore-field-fidelity.test.ts` pins this cycle's additions through restore (`chats.turnMode` / `storytellerInviteFilter` / `equippedInventory`, `chat_messages.storytellerBid`, `pascalMeta` trigger and intervention keys, `memories.keystone`, the three new `chat_settings` columns and `smartTypographySettings.punctuationWarnings`, `roleplay_templates.unmarkedStyle` / `markdownAsterisks`, `llm_logs.storytellerRoundId`, and the Log). Also new: a Log remap case in `uuid-remapper.test.ts`, a replace-mode clear in `delete-service.test.ts`, and whole-table read, round-trip and wipe cases in `log-entries-repository.test.ts`.

#### Docs: CLI README lists `memories keystone` among server-backed verbs

- `packages/quilltap/README.md` still said only `maintain` and `validate --repair --write` ask the running server to write, and omitted `keystone --write` from the verbs that take `--port`. Both lines now include it.

#### Fix: `quilltap db --count` printed ANSI color codes under `FORCE_COLOR`

- `--count` passed the bare number to `console.log`, which colors numbers when `FORCE_COLOR` is set. Jest workers set it when run from a TTY, so `db-raw-sql-qt-text.integration.test.js` received `\x1b[33m2\x1b[39m` and failed with "Expected: "2", Received: "2"". The count is now stringified before printing, so the output is plain text regardless of color settings.

#### Fix: two distributed plugins required `@quilltap/plugin-types` at runtime

- `qtap-plugin-default-system-prompts` (1.1.27) and `qtap-plugin-openai-compatible` (1.0.50) marked `@quilltap/plugin-types` external on the belief that its imports were type-only. The bundled `@quilltap/plugin-utils` imports it at runtime, so each `index.js` carried a bare `require("@quilltap/plugin-types")` that resolved only by walking up to a host `node_modules`. The standalone tarball kept both plugins' whole `node_modules` trees to satisfy it. Both now bundle it like the other distributed plugins; the built output differs only by that removed `require`.

#### Test: release-checklist regression gaps

- `__tests__/unit/lib/toast-stacking.test.ts`: the toast container's z-index must exceed every `z-[N]` / `z-index` declared under `components/` and `app/` (below 9999) and stay under the startup gates. Fails on the old value of 50.
- `lib/storyteller/__tests__/plan-run-order.test.ts`: `planStorytellerRun` sorts by rotation without `keepOrder`, keeps the operator's order with it (rotation never consulted), and orders an all-at-once round's Act tail by that order.

#### Fix: Automation settings checkbox uses `qt-checkbox`

- The per-row checkbox in `components/settings/chat-settings/AutomationSettings.tsx` used raw Tailwind (`h-4 w-4 rounded border-input text-primary focus:ring-primary`); it now uses `qt-checkbox`, so themes can restyle it. Found in release checklist 7 (`qt-*` classes). No other changes needed.

#### Chore: prune diagram trace logging

- Removed four per-event `console.debug` traces from the diagram components (render, Copy PNG start, lightbox open and close). Failure, fallback and summary logs stay.

#### Chore: dead code sweep

- Removed the unused `components/inventory/index.ts` barrel, `resolveMemoryMaintenance`, `isComputedTool` and `ProjectFileInfo`. Details in `docs/developer/DEAD-CODE-REPORT.md`.

#### Feature: diagram lightbox and Copy PNG

- Clicking a Salon diagram (or its new **Enlarge** toolbar button, or Enter/Space on the focused drawing) opens it full-window. Wheel, Chromium trackpad pinch (ctrl-wheel), Safari gesture events and two-finger touch zoom about the pointer; drag pans. **Fit** (the opening view; re-fits on window resize while active) and **100%** (natural size) buttons, zoom in/out buttons, `+` / `-` / `0` keys, double-click toggles Fit/100%. The drawing is scaled by resizing it, not by a CSS transform, so it stays sharp. Zoom range 10%–800%.
- **Copy PNG** writes a PNG at 2× natural size to the clipboard, on the diagram card colour (`--qt-diagram-bg`) or transparent when **Transparent** is ticked (remembered for the page's life; the sheet shows a checkerboard while ticked). The scale backs off for drawings past 16,384 px a side or 16.7 megapixels (Safari's canvas ceiling), with a toast.
- `components/chat/diagrams/export-png.ts` prepares a standalone copy of the live SVG before rasterizing it. Mermaid's `htmlLabels: false` does not reach every diagram type: Venn, event-model and architecture diagrams, math labels and `textPlacement: 'fo'` paths still emit `<foreignObject>`, which taints the canvas in some browsers and paints empty boxes in others. Each one is dropped when it sits in a `<switch>` with an SVG-text fallback, and otherwise replaced by centred `<text>`/`<tspan>` lines in the label's computed font, size and colour. Web fonts the drawing uses are found in the page's `@font-face` rules, fetched and embedded as data URLs (cached per URL; a failed fetch falls back to system fonts). The root gets the live computed `color`, `font-family` and `font-size`, so Graphviz's `currentColor` ink and unstyled text survive. The image loads from a `data:` URL (the CSP's `img-src` has no `blob:`). Verified in Chromium: an SVG with HTML labels serialized as-is came out with black serif text and black strokes on the dark card; through the pipeline it matches the screen.
- `copyPngBlobToClipboard` (`lib/clipboard-utils.ts`) hands `ClipboardItem` a promise so the write is claimed inside the click (Safari), with the existing Electron bridge as fallback.
- Escape closes the lightbox from a capture-phase listener with `stopImmediatePropagation`, so Document Mode's and Terminal Mode's Escape handlers don't also leave focus mode. Closing restores the transcript position: `scroll-anchor.ts` records the diagram's offset in its scroll container and restores it (or the plain `scrollTop` if the virtualizer unmounted the row), then returns focus with `preventScroll`.
- The lightbox mounts in its own React root on `<body>` (`diagram-lightbox-host.tsx`), not a portal from the row, so it survives the virtualized row unmounting while open. One lightbox at a time.
- The lightbox sets a `viewBox` on a drawing that lacks one (svg2roughjs's hand-drawn Graphviz output has only `width`/`height`); without it, resizing grew the canvas instead of the drawing.
- New `qt-diagram-lightbox*` classes, a zoom-in cursor and focus ring on `.qt-diagram-canvas[role="button"]`, and `--qt-diagram-lightbox-*` variables (defaulting to the `--qt-overlay-*` tokens), mirrored to theme-storybook 1.0.85.
- The diagram canvas is now `role="button"` (was `role="img"`), labelled "Diagram — open to zoom and copy" / "Drawing — …".
- `help/diagrams.md` gains "The Viewing Room". Tests: lightbox geometry, PNG preparation (sizing, `foreignObject` replacement and `<switch>` fallback, `currentColor`, font embedding and fetch failure, canvas ceiling), the lightbox (Fit/100%, wheel, Escape not reaching document listeners, Copy PNG with and without transparency, missing `viewBox`), the scroll anchor, and `DiagramBlock` opening and closing it.

#### Fix: diagram dependencies restored after merge

- The merge of origin/main into the diagrams feature (`5e18ede6a`) took origin's `package.json` and `package-lock.json`, dropping `mermaid`, `@hpcc-js/wasm-graphviz`, `dompurify` and `svg2roughjs`. The release build failed with `Module not found` in `components/chat/diagrams/`. Both files are restored from the feature commit; no other changes.

#### Feature: diagrams in the Salon

- A closed ` ```mermaid `, ` ```dot ` / ` ```graphviz ` or ` ```svg ` fence in a Salon message renders as an inline SVG instead of a code block. The message keeps the source text; nothing new is stored. Other surfaces (help, Document Mode, file previews, the Brahma console, the help chat) still show these fences as code.
- `lib/markdown/diagrams.ts` is the one list of diagram fence languages (`DIAGRAM_LANGUAGES`, `diagramEngineFor`) and of diagram styles (`DIAGRAM_STYLES`, `diagramStyleOrDefault`). `hasDiagramFence` detects a closed diagram fence (unterminated fences, fences quoted inside another fence and inline code don't count).
- New `components/chat/diagrams/`: `DiagramBlock` (dispatch, placeholder, error fallback, toolbar with View source / Copy source / Copy SVG / Download SVG, a 64-entry render cache keyed by engine, style, theme and source so a virtualized row that remounts shows its drawing at once), `render-mermaid.ts` (Mermaid 12, `securityLevel: 'strict'`, `htmlLabels: false`, `theme: 'base'` with `themeVariables` read from the active theme's CSS variables), `render-graphviz.ts` (`@hpcc-js/wasm-graphviz`; black/white defaults re-pointed at `currentColor`; hand-drawn style re-sketched with svg2roughjs), `render-svg.ts` (raw SVG, root must be `<svg>`, sized to fit), `render-queue.ts` (serializes renders; source-hash seed for hand-drawn output), `sanitize-svg.ts` (the one DOMPurify call site: strips script, event handlers, `foreignObject`, `style`, `image`, every non-`#fragment` href and every external `url(...)`; allows `<use>` with fragment hrefs), and `diagram-theme.ts`.
- `MessageContent` takes an optional `diagrams` prop (`{ style, streaming? }`); without it, fences render as code as before. `LazyMessageContent` passes it and skips the pre-rendered HTML fast path when `hasDiagramFence` is true. The streaming message and an in-progress regeneration pass `streaming: true`, so a fence shows as code until the message settles.
- `CodeBlockWithCopy` moved out of `MessageContent.tsx` into `components/chat/CodeBlockWithCopy.tsx` (no change in behavior).
- Two new keys in the character vault's `properties.json`: `canDrawDiagrams` (boolean, absent = `false`) and `diagramStyle` (`'handDrawn'` | `'clean'`, absent or unrecognized = `'handDrawn'`). Both are vault-managed fields (added to `MANAGED_FIELDS`, the read overlay, the full and patch writers, and the scaffold). No DB column, no migration. Character PUT accepts both; the character list GET returns both. v5: this is a v4 data-shape change the v5 vault reader must follow.
- The system prompt adds `DIAGRAM_FORMATTING_INSTRUCTION` (`[FORMATTING: DIAGRAMS]`) directly after the math note, only when `character.canDrawDiagrams` is true. It is not part of the identity stack; `IDENTITY_STACK_BUILDER_VERSION` and the goldens are unchanged, and a prompt without the flag is byte-identical to before.
- Diagram style follows the message's author: a character's line uses that character's `diagramStyle`; the operator speaking as no one and Staff senders use `clean` (`resolveMessageDiagramStyle`, `app/salon/[id]/components/message-row/helpers.ts`). The chat participant enrichment (`getCharacterDetail`, `getEnrichedCharacter`) and `useParticipants` carry `diagramStyle`.
- Aurora: new `CanDrawDiagramsToggle` (`components/characters/`) on the Details tab of both the character view and edit pages, with a Hand-drawn / Clean choice that is disabled (not hidden) while the toggle is off. Saves are immediate PUTs (`app/aurora/shared/save-diagram-settings.ts`) with an optimistic update and a refetch on failure.
- "Salon Images" quick-hide does not hide diagrams (they are inline SVG, never `<img>`).
- New `qt-diagram*` component classes and `--qt-diagram-*` variables (including `--qt-diagram-hand-font`), mirrored to theme-storybook (1.0.84).
- New dependencies: `mermaid` 12, `@hpcc-js/wasm-graphviz`, `dompurify`, `svg2roughjs`. All client-only and loaded on first use.
- `.qtap` export schema documents both new keys.
- New help page `help/diagrams.md`; `help/character-editing.md` and `help/quick-hide.md` mention the toggle and the quick-hide exemption.
- Tests: `lib/markdown/diagrams`, the SVG sanitizer against a hostile corpus, the raw-SVG renderer, `DiagramBlock` (routing, streaming, fallback, toolbar, cache, quick-hide), the `LazyMessageContent` fast-path bypass, the per-author style resolver, the prompt note's gating and placement, and the `properties.json` defaults, lenient style read and single-key patches.

#### Refactor: context manager

- `buildContext` (`lib/chat/context-manager.ts`) is now a sequence of phase calls; the file is 900 lines, down from 2,360, most of what remains being the option and result types. New modules under `lib/chat/context/`:
  - `turn-system-prompt.ts`: `buildTurnSystemPrompt` (compiled identity stack, fallback subprompts, Taboo phrases and standing instructions, read in parallel; truncation to budget).
  - `turn-compression.ts`: `resolveTurnBudgetInfo` (the autonomous per-turn cap), `compressTurnHistory` (budget gate, cached or synchronous summary, the verbatim window), `compressTurnMemories` (one helper instead of two copies of the compress-and-warn block), `effectiveWindowSize`, `verbatimWindowStart`.
  - `turn-scene-state.ts`: `buildTurnSceneState` — the stored scene, live-wardrobe clothing overrides, and the per-recipient emission cache, written by a `commit` once the whisper is posted.
  - `turn-recall.ts`: `assembleTurnRecall`, `retrieveTurnKnowledge`, `buildRecentWindowQuery`, `collectStandingConversationIds`.
  - `turn-whispers.ts`: `postTurnTimestamp`, `offerCoreWhisper`, `postCommonplaceWhispers`, `announceTurnMail`.
  - `turn-trailing.ts`: `composeTrailingMessage` (the one place the trailing sections are ordered and delivered, on the user message or on their own), `buildTurnNotes`, `buildReferentSections`.
  - `turn-history.ts`: `turnHistoryRows` (single- and multi-character history, compression window, summary anchors), `packTurnHistory`, `buildLeadingSystemBlocks` (system blocks 1–3, built once so the blocks measured are the blocks sent) and `historyContextMessages` (the summary cache breakpoint).
  - `turn-transcript.ts`: `createTurnTranscript` — one memoised read of the chat's events per build, shared by the timestamp gate, the conversation-list dedup, the Core and progressions cadences and the referent ledger. A failed read is retried by the next reader rather than kept. The whisper sweeps still read the chat fresh after posting, so a whisper from an overlapping build is swept too.
- `sweepPriorWhispers` (`lib/chat/whisper-sweep.ts`) replaces three copies of the snapshot-whisper sweep (Commonplace Book, Core whisper, fold-posted relevant conversations). `isInWhisperScope` (`lib/schemas/chat.types.ts`) replaces three copies of the whisper-target test. It treats an empty `targetParticipantIds` array as untargeted, as `hasWhisperTargets` and `filterWhisperMessages` already do (the old copies matched only `null`), so the untargeted sweeps and the standing-conversation dedup now include such rows. No writer creates one.
- `parseStoredSceneState` (`lib/schemas/chat.types.ts`) parses a chat's `sceneState` column; the context build and the story-background job use it.
- `toVisibleConversationMessage` (`lib/memory/cheap-llm-tasks/chat-tasks.ts`) is the per-row rule `extractVisibleConversation` now loops over.
- `buildTurnSkipInstruction` moved to `lib/chat/turn-manager/skip-signal.ts`, beside its sentinel, and uses `NOTHING_TO_ADD_SENTINEL`.
- `lazyAsync` (`lib/utils/lazy-async.ts`) memoises an async read and drops a failed one so the next call retries; the turn transcript, the mount pool and the standing conversation ids use it.
- The Host's timestamp line and the scene-state time line read one clock value; they could differ across a minute boundary.
- Recall and knowledge retrieval run in parallel, as do the progressions, Inventory, referent-ledger and inform-block reads.
- `selectRecentMessages`' keep-the-last-message fallback keeps the row's `id`, which the attachment anchor needs (bug 95).
- Fixed bug 263: the history budget did not count the trailing sections (scene state, knowledge, Core whisper, mail, progressions, Inventory, referent ledger, turn notes), system block 2, the timestamp line or the new user message, so a full context went out over `safeInputLimit` and tripped the pre-send warning. Every part of the request is now built and measured before history is packed, by the one per-message rule the pre-send check uses (`countMessageTokens` / `countMessagesTokens`; `selectRecentMessages` now uses it too); the chained-turn scene note's room is measured over the same filtered rows history is packed from. `tokenUsage.total` counts everything in `messages`.
- Fixed bug 264: in a multi-character chat, compression summarised the early history but the turns it covered were still sent verbatim. The compression window now applies on both paths.
- Fixed bug 265: the compression window counted tool-only and empty assistant rows the summary never saw, so each one dropped a real message from both the summary and the history.
- Dead code removed: `willExceedContextLimit`, `formatSummaryForContext`, `shouldApplyCompression`, the `lib/chat/context/index.ts` barrel, the backwards-compatibility re-exports from `context-manager.ts`, the unused `statusChangeNotifications` / `outfitChangeNotifications` options, `ContextBudget.summaryBudget`, and `BuiltContext.includedSummary` / `tokenUsage.summary` (always false / zero since the summary became a Librarian whisper).
- Tests: new `turn-compression`, `turn-history`, `turn-trailing` and `whisper-sweep` suites; a `buildContext` regression for bug 263; tests for the removed functions removed.
- Help: `chat-settings-ai-services.md` (compression in group chats) and `connection-profiles.md` (the budget weighs the trailing sections).
- `docs/developer/SYSTEM_FLOWCHARTS.md` has a new Context Build section; `PROMPT_ARCHITECTURE.md` lists the phase modules.

#### Refactor: Salon turn pipeline

- `processMessage` (`lib/services/chat-message/orchestrator.service.ts`) is now a sequence of phase calls; the file is 1,170 lines, down from 2,840. New modules under `lib/services/chat-message/`:
  - `turn-stream.ts`: `openTurnStream` (turn control, keep-alives, the error frame) shared by the send path and the storyteller run; `SubmissionLedger` and `handleStreamError` moved here.
  - `turn-holds.service.ts`: `resolveTurnHold` (paused / storyteller, pure), `qualifiesForFairRotationCheck` (pure), `maybePauseForUserSeatTurn`, and `finishHeldPost`, which replaces `finishHeldUserTurn` and the inline storyteller hold.
  - `operator-post.service.ts`: `recordOperatorPost`, the one function that records an operator's post: staged tool results, auto-detected dice, the USER row, attachment links, the Librarian upload note, danger flags, Pascal trigger phrases and Carina. Attachment links now fail soft with a warning instead of failing the turn.
  - `turn-preparation.service.ts`: `resolveTurnApiKey`, `resolveContextCompressionSettings` (defaults come from `ContextCompressionSettingsSchema` instead of a copied literal), `spendFullContextRequest`, `selectTurnCheapLLM`, `resolveTurnSkipOffer`, `reinjectProsperoContext`.
  - `turn-tools.service.ts`: `resolveTurnToolSlate` (tool build, effect ceiling, tool mode, tool instructions, stop sequences, the `forceToolsOnNextMessage` flag), `resolveTurnEffectCeiling`, `buildTurnToolContext`, and `runTurnTextToolPasses`, which replaces three near-identical `runTextToolPass` calls.
  - `turn-outcome.service.ts`: `resolveTurnOutcome` (pure: bare yield, pass, reply, tools-only, stopped, empty) and `settleTurn`, which carries it out; `handleTurnSkip` / `handleTurnYield` / `announceTurnYield` moved here.
- `turn-extras.ts`: `spliceTurnExtras` places the tool-change notice and agent-mode instructions.
- `buildTools` (`streaming.service.ts`) takes one options object (`BuildToolsOptions`) instead of 21 positional arguments; `BuildToolsExtras` is merged into it. All six callers updated. The legacy "`disabledTools` undefined means no tools" bail is removed (no caller used it). The orchestrator now passes the turn's effect ceiling to `buildTools` instead of filtering the list afterwards; `applyEffectCeilingToTools` is private.
- `encodeTurnDoneEvent` fills a done frame's usage, cache usage, attachment results and model from the turn's `StreamingState`; `createTurnStatusEmitter` binds status lines to a turn's character. Done frames on the turn path use `safeEnqueue` throughout (some used `controller.enqueue`, which throws once the client has gone).
- `triggerAfterTurnsHousekeeping` (`memory-trigger.service.ts`) runs scene tracking and the Scriptorium render after a stream's turns, for both the send path and the storyteller run.
- `findAttachedFiles` (`context-builder.service.ts`) is the one lookup of a send's uploads among the chat's files.
- The autonomous-room effect ceiling reads the chat settings already loaded for the turn instead of reading them again.
- Dead code removed: `MessageServiceContext`.
- Removed the `debugLLMRequest` SSE frame. Every Salon turn except a storyteller bid sent it at stream start, carrying the full system prompt, context summary, recalled memories and every tool schema, and no client read it. Removed with it: `encodeDebugInfo`, `StreamDebugInfo`, the `debugLLMRequest` field on the stream event type, the tool slate's `enabledToolOptions` field (only the frame used it), and the frame's tests. The LLM log viewer still shows each request as sent.
- Fixed bug 262: in a room where the operator drives two seats, a post that handed the floor to the other seat was recorded by the fair-rotation pause's own write, which dropped staged tool results and skipped the dice, Pascal trigger phrases and the Librarian upload note. It now goes through `recordOperatorPost`.
- A post held by a paused chat or a storyteller round is recorded even when the responder's profile has no API key; the key check runs only for a turn that will call the provider (`resolveTurnApiKey`'s `held` option).
- `resolveTurnHold` and `qualifiesForFairRotationCheck` use `isOperatorWhisperSend` instead of a second copy of the whisper rule. The tool slate reads the project's store links and the Carina answerer probe in parallel.
- `help/chat-turn-manager.md` says a post that hands the floor to your other seat is filed in full.
- Tests: new `turn-outcome`, `turn-holds`, `operator-post`, `turn-preparation`, `turn-tools` and `turn-stream` suites; `turn-extras` covers the splice; the Brahma one-shot and Scenario Builder tests read `buildTools` options by name.
- `docs/developer/SYSTEM_FLOWCHARTS.md` has a new Salon Turn Pipeline section.

#### Refactor: Inventory chokepoints

- Inventory writes parse a tier's `Inventory/` folder once per write instead of up to three times. `scanInventoryFolder` (`vault-overlay/inventory-readers.ts`) returns the records, the duplicate-id paths and the owned paths together; the projection sweeps only the owned paths. Folder operations hand the scan they read back to the write that follows it (`ItemFolderTree.refile` takes the list `read` returned), so delete-folder no longer parses the folder twice. `readDuplicateInventoryPaths` is gone.
- Every write through an `InventoryLocation` that changes something publishes the `inventory` realtime topic (a batch that matched nothing publishes nothing), so an open Inventory dialog refreshes after operator changes in another window too. The per-handler `publishRealtime('inventory')` calls in the tool handlers and `pickUpItems` are removed. The topic now also invalidates `queryKeys.inventory.archetypeLists` and `equippedLists` (a Carrying-now pane shows objects resolved, so an edit to a carried object changes it).
- `useInventoryMutations` and `useChatInventory` refresh after their own writes only while the realtime socket is down (`refreshUnlessRealtime` in `lib/hooks/use-inventory.ts`); while it is up the server's `inventory` / `chats` publish does it, so a write no longer fetches its lists twice.
- Carried-set writes in `equip.ts` and `apply-defaults.ts` go through `writeCarriedSet`, which publishes the chat topic. `dropCarriedEverywhere` now publishes every chat it changed (it used to rely on the caller, which published only the current chat).
- `equip.ts`: one cap check (`fitToCaps`) for equip and pick-up; refusals logged through one `refuse` helper; `loadEquipChat` replaces the copies in the chat actions, tool handlers, Pascal's effects and arrival, and `seatedCharacterIds` the seated-cast filters in the chat actions, `assertParticipant` and `inventory_give`; `equipItems` / `unequipItems` / `pickUpItems` are `async`, so a not-a-participant refusal rejects instead of throwing synchronously. `InventoryNotAParticipantError` moved to `errors.ts`.
- Arrival defaults pass the pool they already loaded into equip instead of reading it twice.
- `inventoryChangeContext` (`equip-effects.ts`) is the one builder for an `InventoryChangeContext`; the chat actions, tool handlers, Pascal's effects, arrival and the turn flush use it.
- `pickForGesture(…, 'unequip')` falls back to a kit match itself; the unequip tool and Pascal's effects no longer add that fallback by hand. `INVENTORY_STATES` (`refs.ts`) is the one list of states; `INVENTORY_STATE_VALUES` and `InventoryStateValueSchema` derive from it.
- `item-mutations.ts`: a `lintedWrite` helper replaces seven copies of lint → write → log rows; `detachAll` writes through locations instead of raw mounts, resolving every mount before writing any and skipping a vault that is no longer linked.
- `dependents.ts`: `mountOwnerResolver` memoises mount-owner lookups per operation and reads the project and group lists once, instead of once per mount.
- The pool no longer tags out-of-pool archetypes with a made-up `project` origin and reads tiers by mount id.
- Routes: `withInventoryErrors` (`lib/inventory/routes/responses.ts`) replaces the repeated try/catch in the route factory, the images route, the transfers route and the chat equip action. `?action=duplicate` validates its body with `duplicateInventorySchema` (a missing `itemId` is now a 400, not a 404). The images route reads its scope with `InventoryScopeSchema`.
- `loadEquippedSet` (`equipped-set.ts`) is the one "load the pool only if something is stored" reader, and the only place that shortcut is decided, for the prompt section and the image phrase.
- Tool handlers share `loadOwnRecord` and call `loadEquipChat` directly (the `loadToolChat` alias is gone); `inventory_update` resolves the written record against the pool it already holds instead of reloading the whole context.
- Client: `isInContainer` (`lib/inventory/container.ts`) is the one tier-membership test for the browser and the Workbench vantage.
- Removed dead code: `kinOf`, `normalizeInventoryFolderPath`, `inventoryFolderStorePath`, `describeEquippedInventoryForImages`, `useInventoryDependents` and the unused `queryKeys.inventory.item` / `dependents` / `dependentLists` keys.

#### Docs: 4.11.0 release notes corrections

- Keystones: notes now say keystones are recalled for the character and for everyone present or in her inner circle, not "every turn they are relevant."
- Upgrading: removed the "same as Self-Dressing" comparison for *Can manage inventory*; fixed unbalanced bold markup on *Let me take a hand* **on**.

#### Feature: punctuation warnings in the Salon composer

- New pure engine `lib/punctuation-lint/engine.ts` (`lintPunctuation`, no imports; same ESLint import ban as `lib/smart-typography/`) with a v5 contract corpus in `fixtures/punctuation-vectors.json`. Rules: a double quote opened inside open dialogue (and its partner), a closer with nothing to close, a quote with spaces on both sides or glued between words, a backwards curly quote, dialogue left unclosed when the next paragraph doesn't open with a quote, an unpaired `*`/`**` run, an unpaired `((`/`))`. Paragraphs split on blank lines; `6"` inch marks, `2 * 3`, `* * *` scene breaks and code are exempt. A caret position suppresses flags on a mark still being typed.
- New `PunctuationLintPlugin` (`components/chat/lexical/plugins/`) mounted in the Salon composer. Paints with the CSS Custom Highlight API (`::highlight(qt-punctuation-warning)`), so it adds no nodes and never edits text; the editable root's `title` explains a hovered mark. No-op where the API is missing.
- New `smartTypographySettings.punctuationWarnings` (default `true`) with a toggle on the Smart Typography card. No migration; the Zod default fills it in for existing rows.
- New `--qt-punctuation-warning-bg` / `--qt-punctuation-warning-underline` tokens and the `::highlight` rule, mirrored to theme-storybook (1.0.83).

#### Feature: non-humanoid characters

- `physical-prompts.json` gains an optional `humanoid` boolean (absent = `true`), hydrated onto `PhysicalDescription.humanoid`. The Aurora Descriptions tab has a **Humanoid** checkbox for it. A physical write that omits the flag (AI Wizard, optimizer, head-and-shoulders backfill) keeps the vault's value; new vaults are scaffolded with `humanoid: true`.
- `isHumanoid` and `NON_HUMANOID_IMAGE_DIRECTION` (`lib/characters/physical-description.ts`) are the one reader and the one instruction. For `humanoid: false`, `pickPhysicalDescription(..., 'head-and-shoulders')` skips the head-and-shoulders prompt and leads with medium.
- Avatar prompt: no head-and-shoulders crop, no pronoun-derived "man"/"woman" (subject is "non-humanoid entity"), the non-humanoid direction, whole form in frame, equipped items listed without slot cropping or nudity fallback.
- Wardrobe worn picture, Lantern scene descriptions (`sceneDescriptionParts`, story-background fallbacks), image-tool expansion (`nonHumanoid` placeholder flag, no gender hint) and the scene-state baseline all carry the direction and drop the gender anchor.
- The character's own Physical Appearance section adds a "no humanoid body" line (only when the flag is false, so existing identity stacks are byte-identical); the line is sent even when no description text exists yet.
- The vault parser reads `humanoid` leniently (`"false"`/`"true"` strings count; `null` or anything else reads as absent), so a hand-edited flag can't fail validation and drop every prompt tier.
- Changing the flag through the character PUT recompiles that character's cached identity stack in every chat (`recompileCharacterSeats`, `lib/services/system-prompt-compiler/character-fanout.ts`); the subprompt fan-out now runs on the same helper.
- Image-side gender anchors go through `figureGender` / `figureGenderNoun` / `figureGenderPrefix` (`lib/characters/pronoun-gender.ts`), which take the physical description and return no gender for a non-humanoid character. Story-background enumerations render through `sceneDescriptionParts`, which also strips a trailing period before the non-humanoid direction.
- The scene-state tracker and the appearance resolver LLM are told a character is non-humanoid on a separate line; the direction is no longer baked into the scene-state appearance text.
- A non-humanoid avatar with no prompt text and nothing equipped still gets a prompt.
- The optimizer's appearance pass is told not to suggest a head-and-shoulders prompt. The head-and-shoulders backfill skips non-humanoid characters.

#### Feature: name chips for absent characters replace the Host's introduction cards

- The Host no longer posts a card when an absent workspace character is named. Instead the Salon puts a chip on the name at its first mention in the chat; hovering (or focusing) it shows the card in the shared `Tooltip` (pinnable, scrollable): name, aliases, pronouns, identity/description. The model still gets the same card from the referent ledger.
- New `GET /api/v1/chats/[id]?action=absent-mentions` (`lib/chat/absent-mentions.ts`): for each absent character, the first spoken message naming them, the name as written, and `offSceneCardFields` (new; `renderOffSceneCard` now formats from it). Query key `queryKeys.chats.absentMentions`, on the `chats` realtime topic; hook `useAbsentMentions`.
- `presenceOf` and `spokenText` (same module) are the one rule for who is in the room and what counts as a spoken line; the context builder's ledger uses both.
- New shared matcher `lib/chat/name-mentions.ts` (case-sensitive, letter-bounded, longest token first), used by the ledger and the chips.
- Rendering: `rehypeMentionMarkers` (`lib/chat/mention-markers.ts`) wraps the first eligible occurrence (direct text of p/h1–h6/li/blockquote; not code, links, emphasis or math) in private-use markers, so the roleplay tokenizer still styles the surrounding line; `MessageContent` turns marked runs into `MentionChip`s. A message with chips skips the pre-rendered HTML fast path. Prose split around tool calls gives each chip to the first run that names it (`assignMentionsToRuns`).
- Old "spoken of" cards stay in the transcript but are hidden from the Salon feed.
- Removed: the per-turn off-scene scan and posting in `buildContext`, `findIntroducedOffSceneCharacterIds`, and `lib/chat/context/mentioned-characters.ts` (with its test). The writer's `'mentioned'` wording has no caller now; Continue Elsewhere's left-behind notice is unchanged.
- New `qt-mention-chip` class (`_chat.css`), mirrored to theme-storybook (1.0.82).
- Docs: API.md, PROMPT_ARCHITECTURE.md §2; help `help/salon-host-introductions.md` (now "Absent Acquaintances").

#### Change: absent-character cards move from the history to the referent ledger

- The Host's "spoken of" introduction (the card posted the first time an absent workspace character is named) no longer reaches the model. It is record-only: `isRecordOnlyMessage` (`buildMessageContext`) and `extractVisibleConversation` (cheap-LLM tasks, including compression) strip it, and the context builder no longer pushes the new card into the turn. It is still posted to the Salon for the operator.
- The referent ledger now carries the card of each listed person not in the room, rendered by the Host's `renderOffSceneCard` (now exported), after the entry list. Cards with nothing under the heading are skipped. Cost: absent people named in the last 6 lines are re-sent each turn on the uncached tail; anyone named earlier than that is not sent.
- An unseated persona counts as in the room wherever the operator speaks without a seat (`operatorSpeaksWithoutSeat`), so it gets no card and is not called absent; in an autonomous room it is absent, as in bug 172.
- Left-behind notices (Continue Elsewhere) now post with their own `systemKind`, `off-scene-left-behind`, and stay in the history. Older left-behind rows keep `off-scene-characters` and are told apart by their opening (`LEFT_BEHIND_INTRO_PREFIX`). `findIntroducedOffSceneCharacterIds` reads both kinds. Kinds and the predicate live in `lib/services/host-notifications/off-scene-kinds.ts`.
- The Courier transport is unchanged: it builds its own transcript, has no ledger, and still passes the cards.
- Docs: `PROMPT_ARCHITECTURE.md` §2 and §9; help `help/salon-host-introductions.md`.

#### Feature: referent ledger and closing echo in the trailing context

- Characters lost track of who a pronoun meant. On `Friday` (chat `c277aef9…`, glm-5.3-flash) Friday ended a turn with "…Abigail will absolutely make that a formal finding. You've seen how she documents." Charlie replied "When she's not scolding Vergil for his bedside manner." Friday answered as if "she" were herself. In the request, a Host card for Greg sat between the two lines, and Charlie's 50-character line was followed by about 21 KB of scene state and recall.
- New `lib/chat/context/referent-ledger.ts`, two trailing sections added after the inform block and before the turn notes:
  - `buildReferentLedger` ("Who is being spoken of"): everyone named (name or alias, case-sensitive, letter-bounded) in the last 6 spoken lines (no Staff messages), most recently named first, at most 8. Each entry has pronouns, in the room or not, who last named them and the sentence they were named in (plus the next sentence when it fits in 220 characters). Leaves out the responder and the author of the latest line. Empty when nobody is named.
  - `buildClosingEcho` ("The line you are answering"): the new user message repeated last. Over 1,500 characters, only the closing paragraphs. Empty on chained / continue turns.
- Wired in `buildContext` (`lib/chat/context-manager.ts`). Reuses the character list and message read from the off-scene introduction scan. Speaker names come from `resolveSpeakerNames` / `speakerLabel`. Warn-and-skip on error. Not in the cached prefix, not persisted; no builder version bump.
- Help: `help/salon-host-introductions.md` ("Keeping Track of Who Is Meant").

#### Fix: Pascal hold dialog can re-ask a hidden consult

- A held run's consult prompt can quote things the operator changes in the dialog (the winning row's `brief`, a parameter). When a tool hid both `llmPrompt` and `llmAnswer`, the dialog showed no Consult section, so there was no out-of-date marker and no Re-ask; the run dealt with an answer written for the old outcome. Seen on `Friday` with `read_timestream`: moving the value across 0 changed the outcome from the `bad-result` brief to the `expected-outcome` brief, and the message kept the old text.
- `?action=intervention-reask` now works for any tool with an `llm` block. It poses the prompt the run currently renders. An `llmPrompt` override on a hidden prompt is still refused (400).
- `CustomToolInterventionDialog` shows a small "The oracle" section when the consult is hidden: a Re-ask button and a note saying whether the answer still fits the question (`staleAnswer`).
- Help: `help/custom-tools.md` ("Taking a Hand in the Deal").

#### Feature: self_inventory core-file checklist and holdings counts

- New `vault.coreFiles` sub-section of `self_inventory`: the nine core files of the character's vault (`SINGLE_FILE_OVERLAY_PATHS`, in overlay order), each with its path as found (matched case-insensitively), whether it exists, its size, its named `qtap://` URI, and a one-line summary of what belongs in it. Bare `vault` now includes it. Summaries live in `CORE_VAULT_FILE_SUMMARIES` (`lib/services/character-field-semantics.ts`), keyed by the overlay path type so a new core file fails to compile until it is described.
- New top-level `holdings` section, with `holdings.wardrobe`, `holdings.inventory` and `holdings.customTools`. Counts what the character can reach, read through the same loaders the tools use: wearable garments and outfits (composites) via `loadWearablePool`; objects, kits, archetypes and objects carried in this chat via `loadInventoryContext` (roster-gated, archived skipped); runnable custom tools with their names via `resolveCustomToolRoster` (unavailable when custom tools are off). Each count is split by tier (own vault, groups, project, Quilltap General). Each part fails soft on its own. Code in `lib/tools/handlers/self-inventory/holdings.ts`.
- `SelfInventoryVaultIncludedParts` gained `coreFiles`; `vaultAccess` now uses its own `SelfInventoryVaultAccessIncludedParts`. Tool description updated (snapshot regenerated).
- Help: `help/character-system-transparency.md`, `help/inventory.md`; `docs/FEATURES.md` self_inventory summary brought up to date.

#### Fix: doc tools can read, grep and search chat uploads (bugs 260, 261)

- Bug 260: chat uploads land in the project store (or Quilltap Uploads) as blobs, and the upload bridges had text extraction off, so `doc_read_file`, `doc_grep` and search could not see an uploaded `.md`, `.txt`, `.json`, PDF or DOCX. On `Friday` a character sent to find an uploaded `CHANGELOG.md` at the project root got ENOENT and said it did not exist.
  - New `extractBlobText` in `lib/mount-index/store-file.ts`: the one place blob text is derived. PDF/DOCX through the converter, native text as its own bytes. `storeMountFile` uses it for every extractable blob (`isExtractableBlobPath` / `EXTRACTABLE_BLOB_EXTENSIONS` in `path-utils.ts`), so the REST blob route also extracts native text now.
  - `project-store-bridge` and `user-uploads-bridge` pass `extractText: true`, `enqueueEmbedding: true`. Uploads are still blobs; `files.storageKey` is unchanged.
  - `doc_read_file` falls back to a blob's extracted text when a database store has no document at a text path (read-only; edit tools are unchanged). `doc_grep` also searches blob text. Both via new `readDatabaseBlobText` / `listDatabaseBlobTexts` in `database-store.ts`.
  - New startup pass `backfillUploadBlobText` (`lib/startup/backfill-upload-blob-text.ts`), chained after the document-store scan: extracts, chunks and queues embeddings for blob links in database stores still at `extractionStatus = 'none'` with an extractable extension (`docMountBlobs.listUnextractedByExtensions`). Idempotent by status, no flag. 87 files on `Friday`.
- Bug 261: `doc_list_files`' `pattern` matched only `*.ext` or an exact name, so `**/CHANGELOG.md` found nothing. New `compilePathGlob` (`lib/doc-edit/path-glob.ts`): `**`, `*`, `?`, `{a,b}`, `[…]`; a pattern with no `/` matches file names in any folder; `**/` matches zero or more folders; case-insensitive. Tool description updated (snapshot regenerated).
- Help: `help/file-uploads.md` ("A word on manuscripts") and `help/document-editing-tools.md`.

#### Fix: every character gets every attachment in multi-character chats (bug 259)

- Characters after the first to answer get a user's attachments re-loaded from history (bug 121). That path had an 80,000-character cap per turn and skipped any file that would not fit, with only a server-log warning, while the first responder got every file with no cap. On `Friday` a 108 KB `CHANGELOG.md` reached Amy (first) and not Friday (second), and Friday's prompt gave no sign it was missing.
- Removed the cap (`REHYDRATED_ATTACHMENT_CHAR_BUDGET`) from `rehydrateUserAttachments` (`lib/services/chat-message/context-builder.service.ts`). Each character now gets every unseen upload whole on its first turn after the upload, the same as the first responder; `buildContext` trims it like any other message. Exported `rehydrateUserAttachments` for a regression test.
- Documented in `help/chat-multi-character.md` ("Everyone Reads What You Hand Round").

#### Docs: draft 4.11.0 release notes

- Added `docs/releases/4.11.0.md` (`draft: true`): overview of the 4.11 cycle and an Upgrading section covering vault-scoped custom tools, inventory self-management on by default, and the newly destructive-gated `doc_delete_blob` / `delete_annotation` in autonomous rooms.

#### Fix: wardrobe and inventory tools ask for a picture cue

- `wardrobe_create` / `wardrobe_update` (`image_prompt`, `description`) and `inventory_create` / `inventory_update` (`image_description`) now tell the model plainly that image pipelines never read the description, and ask for a literal visual cue of 200 characters or fewer with every new garment or visible object. Without one, avatars and story backgrounds got only the item's title. Wording is shared from `lib/tools/image-cue-guidance.ts`. The 200 characters is guidance only, not enforced.
- Text-block (non-native tool) instructions for `CREATE_WARDROBE_ITEM` and `CREATE_INVENTORY_ITEM` carry the same instruction and show `cue=` / `looks=` in their examples.
- Fixed: the body of a text-block `CREATE_WARDROBE_ITEM` was passed as `content`, which `wardrobe_create` does not accept, so its description was silently dropped. It now maps to `description`.

#### Feature: always-on floating Brahma Console

- New `BrahmaConsoleLauncher` button, pinned bottom-left just right of the left rail on every authenticated page. Never disabled; toggles the floating Brahma Console dialog. With no connection profile the console opens to its "wants for an engine" note.
- The floating console now works with the workspace enabled (before, the sidebar mark opened only the workspace tab there). The sidebar mark is unchanged: workspace tab inside the workspace, floating dialog elsewhere.
- `FloatingDialog` takes `topmost`: the dialog sits in a new floating layer (`--qt-floating-layer-z: 1000`, above every portal modal, below the startup gates), carries `data-qt-floating-layer`, and closes on Escape only when the key is pressed inside it (the key is swallowed). `useClickOutside` ignores mousedowns and Escapes inside that layer (`isInFloatingLayer`, `components/ui/floating-layer.ts`), so using the console never dismisses the modal beneath it.
- Refactor: the console body is `BrahmaConsolePanel` (render-prop: `headerActions` + `body`), shared by the workspace tab (`BrahmaConsoleView`) and the floating dialog (`BrahmaConsoleDialog`). Which conversation a surface is on is per surface (`useBrahmaConsoleSession`, own localStorage key each), so the tab and the dialog no longer share a current chat. The provider keeps only open/close/toggle and the profile list.
- The floating console stays mounted while hidden, so a streaming reply keeps arriving and reopening returns to the same conversation (it used to reset to the launcher on every open).
- Console header: the model picker shows on the launcher too (default profile until one is picked; the pick is used for the next new conversation), plus a "Past conversations" button beside "New conversation". A remembered conversation that 404s falls back to the launcher.
- New `qt-floating-dialog-topmost`, `qt-brahma-launcher`, `qt-brahma-launcher-active`, `qt-brahma-launcher-icon` and `--qt-brahma-launcher-*` tokens; the `qt-floating-dialog` family is now mirrored in theme-storybook (1.0.81).

#### Feature: min/max ranges in the Pascal intervention dialog

- `executeCustomTool` reports `rollSpan` and `valueSpan` (`RunSpan` in `lib/pascal/custom-tools.ts`): what the raw draw and the value after modifiers could have been under the run's resolved parameters. Range form: `[min, max)` carried through multiply, offset and round (a negative multiplier swaps the ends; rounding makes both ends reachable values). Dice: all ones to all sides, modifier included. Spans ignore pins.
- The hold dialog shows them under the roll and the value (dice also show the per-die range) and they refresh with each preview. The phrasing is `describeSpan` in the new client-safe `lib/pascal/intervention/spans.ts`.
- Recompute adds a non-blocking warning when a pinned draw or value lies outside its span.
- Spans are on the intervention view only; they do not reach `pascalMeta` or any model.

#### Feature: wardrobe pronoun guidance

- Wardrobe items take an optional `pronounGuidance` list (frontmatter key `pronounGuidance`): the standard pronoun sets the item is meant for, named by subject (`he`, `she`, `they`, `it`). The values are the Aurora pronoun picker's presets, now shared from `lib/characters/pronoun-presets.ts`. Empty or absent means the item is offered to everyone. Unknown values are dropped on read.
- One rule, `fitsPronounGuidance` / `filterByPronounGuidance` (`lib/wardrobe/pronoun-guidance.ts`): an item with guidance is offered only to characters whose pronouns are one of its sets. A character with unset or custom pronouns is offered everything. Guidance never blocks wearing an item by id or title.
- `wardrobe_list` is pronoun-aware by default. New `pronoun_aware` parameter (default `true`); currently equipped items are always listed. The result reports `hidden_by_pronoun_guidance` and each item's `pronoun_guidance`, and the formatted text says how many were held back. `wardrobe_read` reports `pronoun_guidance`. `wardrobe_create` and `wardrobe_update` take `pronoun_guidance`.
- The "Let character choose" outfit pass only offers the cheap LLM items that fit the character's pronouns.
- Wardrobe UI: a Pronoun Guidance field in the item editor; a "Pronoun-aware" checkbox (default on, shows the hidden count) in a character's Wardrobe list, which also narrows the Live / Outfit Builder pickers; the same checkbox in the chat-start composer. Rows show their guidance. New `usePronounGuidanceFilter` hook and `PronounAwareToggle` component; `OutfitComposer` / `EquippedSlotRow` take an optional `pickableItems`.
- Export schema documents the new `WardrobeItem.pronounGuidance` field. No migration: the field lives in vault frontmatter.

#### Feature: Novel roleplay template

- New built-in roleplay template **Novel** (`lib/chat/novel-template.ts`): narration is unmarked prose shown in italics, dialogue goes in straight or curly double quotes, `*emphasis*` (single asterisks, hidden) is shown bold and italic, `**` means nothing and is dropped from display, and `((OOC))` uses the OOC style. Its system prompt ends with a correctly formatted example passage. Its rendering patterns come from `generateTemplateRenderingPatterns`, the same generator user templates use.
- Template capabilities, all available in the template editor:
  - `narrationDelimiters: null` means narration is unmarked prose (editor: "None — plain prose").
  - `unmarkedStyle` (`{ style, addOns? }`) styles text that no delimiter claims. New editor style option `qt-roleplay-plain` (a theme hook with no CSS of its own).
  - `markdownAsterisks: false` escapes single `*` before Markdown parsing, so a `*` delimiter can claim it. It also strips `**` runs. Scene-break lines, list bullets, inline code, math and fences are left alone. The composer hides its Bold button for such templates.
  - Wrap delimiters accept `matchCurlyQuotes` (straight quotes also match `“”`/`‘’`) and `closeOptional` (an unclosed span runs to the end of the text run, for speech carried over several paragraphs).
- `RenderingPattern.scope` gains `unmarked`, `literal` and `strip`; `className` may be empty for the last two. `tokenizeInline` takes `{ unmarkedClassName }` and runs the other inline rules inside each matched span (up to three levels deep), so emphasis inside dialogue is styled. `Segment` gains `children`. The client (`MessageContent`) and server (`markdown-postprocess`) adapters apply the unmarked class only to text directly inside an unclaimed block. A line-claimed block drops it.
- `isQuoteSensitiveRoleplayConfig` no longer turns off smart quotes for a wrap pattern that names each straight quote's curly forms.
- The formatting-hint generator describes unmarked narration, curly-tolerant and unclosed wraps, and the `**` rule.
- Migration `add-roleplay-template-unmarked-fields-v1` adds `roleplay_templates.unmarkedStyle` (TEXT) and `markdownAsterisks` (INTEGER, default 1). The export schema and DDL.md include the new fields.

#### Fix: roleplay template narration pairs read back as strings

- `narrationDelimiters` is a string-or-tuple union, so the schema classifier did not treat it as a JSON column. A pair such as Quilltap RP's `["[","]"]` was stored as JSON text and read back as a single string, and a `null` read back as `'*'`. The roleplay-templates repository now writes the field as JSON text and decodes it on every read (`roleplay-template-narration-codec.ts`). Legacy raw values still decode.

#### Feature: drag storyteller bids into running order

- The storyteller board's cards are sortable (`@dnd-kit`, mouse drag, long-press on touch, keyboard). Only cards with a live bid can be picked up. Once rearranged, chosen cards show their place in the run, and a "Reset order" button returns the board to the round's own order.
- `POST /api/v1/chats/[id]?action=storyteller-run` takes `keepOrder`. When `true`, `planStorytellerRun` runs `participantIds` in the order given instead of sorting by `resolveCycleOrder`; this also orders an all-at-once round's Act / Destroy tail. Without it, behavior is unchanged.
- New `qt-storyteller-board-tools`, `qt-storyteller-card-draggable`, `qt-storyteller-card-dragging` and `qt-storyteller-card-order` classes, mirrored to theme-storybook 1.0.80.

#### Feature: operator intervention in Pascal custom tools

- A custom tool can be marked intervenable: top-level `intervention: { enabled, fields? }` and per-member `intervene` flags on parameters and effects, in the Zod schema, the published JSON Schema and the Workbench draft. Workbench gains a "Let me take a hand in each roll" toggle, per-field hand toggles, and a library marker.
- `runCustomTool` takes `mayHold`. `run_custom` and trigger phrases pass `true`; the popup passes `false`. An intervenable run is held after the deal and before effects and the post, but only in the parent process, outside autonomous rooms, and with `chatSettings.customToolIntervention` on (new column, default on, migration `add-custom-tool-intervention-field-v1`, Settings → Chat → Automation).
- New `lib/pascal/intervention/`: a `processSingleton` hold registry (first resolve wins, no timeout, Stop vetoes, keep-alive pings through the turn's new `keepAlive` hook in `turn-control.ts`), the overrides schema and hidden-field check, a pure recompute, and the veto wording.
- `executeCustomTool` returns the random draw it used (the unit draw for ranges, the faces for dice) and accepts `draw`, `consult` and `pins`, so a held run is recomputed by the same engine without rerolling or calling the model.
- New actions on `/api/v1/chats/[id]/custom-tools`: `GET ?action=interventions`, `POST ?action=intervention-preview|intervention-reask|intervention-resolve`. An override naming a hidden field is a 400; a second resolve is a 409.
- New realtime topic `customToolInterventions` and query key `customTools.interventions(chatId)`. The Salon mounts `CustomToolInterventionDialog`, which reopens after a reload or in a second tab and queues several holds.
- A veto posts nothing and applies nothing. `run_custom` gets "The tool did not run." for a plain character and the "table is closed" wording for a `systemTransparency` character or a user-controlled seat.
- A changed deal records `pascalMeta.intervention` (what was dealt, which fields changed, Re-ask count, stale-answer flag). An as-rolled decision, or a deal that changed nothing, records nothing. The Pascal chip shows a hand badge with a dealt → final tooltip. No model-facing path reads `pascalMeta`.
- New `qt-intervention*` / `qt-intervene-toggle*` classes in `_intervention.css`, mirrored to theme-storybook 1.0.79.

#### Fix: every Salon LLM call reaches the LLM Inspector

- `streamMessage` (`lib/services/chat-message/streaming.service.ts`) writes one log row per call however it ends. A call that throws is logged with its error and partial content; one its consumer abandons is logged with a note. Before, only calls that reached a terminal chunk were logged, so a refused or stalled primary never appeared beside the failover that replaced it.
- Swipe regeneration (`regenerate-swipe.service.ts`) now streams through `streamMessage` instead of calling the provider directly, so it is logged (with cache usage) against the chat and the new swipe's id. It also picks up the versioned character cache key the ordinary turn uses.
- Request-limit recovery (`recovery.service.ts`) passes `userId`, `chatId`, `characterId` and a pre-minted `messageId`; it was never logged.
- Image description (`sendVisionRequest`) takes a `chatId`, threaded from `file-attachment-fallback.ts` through every describe attempt, and records `connectionProfileId` and cache usage. Its rows used to carry no chat link.
- Cheap-LLM tasks (`core-execution.ts`) log failed attempts with their error and record `finishReason` and `cacheUsage`. The danger classifier does the same.
- The opening greeting records `cacheUsage`, `rawProviderUsage`, `finishReason` and `connectionProfileId`.
- `POST /api/v1/images?action=generate` logs each image attempt as `IMAGE_GENERATION` with the chat that asked.
- Inspector: badge colours and labels are typed `Record<LLMLogType, …>`, so a new log type will not compile until it has both. Scene tracking joins System Ops; image generation and wardrobe/inventory pictures join Image; "Other" is derived as every type no named filter claims.

#### Docs: spec for operator intervention in Pascal custom tools

- New spec `docs/developer/features/pascal-operator-intervention.md`. Not implemented.
- A custom tool can be marked intervenable, with a per-field flag for what the operator may change. When a model's `run_custom` call or a trigger phrase runs one, the run is held in the parent process. The operator can edit the parameters, roll, value, consult prompt and answer, outcome, message, state, effects, visibility, announcer, title and chip label for that run only, run it as rolled, or veto it. Edits recompute the later fields without rerolling.
- The model is never told. A veto returns "The tool did not run." to a plain character; only a `systemTransparency` character or a user-controlled seat hears that "the table is closed." Changes are recorded in `pascalMeta.intervention`, which no model reads.

#### Feature: Storyteller mode and declared tool effects

Spec: `docs/developer/features/complete/storyteller-mode.md` (implemented; moved to `complete/`).

- Tool effects (Part 1):
  - Every tool declares an effect: `none`, `read`, `write` or `destroy`. Undeclared counts as `write`.
  - Built-in tools declare it beside their definitions (`xxxToolEffect`); `lib/tools/effects.ts` collects them (`BUILT_IN_TOOL_EFFECTS`) and resolves any call with `effectOfToolCall` / `maxEffectOfTool`. `state`, `edit_custom_tool`, `doc_open_document` and `run_custom` compute theirs from the validated input.
  - The tool-definitions snapshot test fails on an undeclared tool, records each effect, and checks every computed effect's branches.
  - `ToolExecutionContext.effectCeiling`: `executeToolCallWithContext` refuses a call above the turn's ceiling with a tool result saying why. `buildTools()` (`BuildToolsExtras.effectCeiling`, `applyEffectCeilingToTools`) drops tools whose static effect is above it and adds a one-line note to computed ones.
  - `DESTRUCTIVE_TOOL_NAMES` (`lib/tools/destructive-tools.ts`) is deleted. The autonomous-room gate now sets a `write` ceiling when destructive tools are not permitted, so `destroy` tools are filtered and refused at execution. `doc_delete_blob` and `delete_annotation` are now `destroy` and newly gated there.
  - Pascal: `customToolEffect` (`lib/pascal/tool-effect.ts`) is `write` for a definition with any effect, else `read`. The Workbench library shows it as a badge. Trigger phrases in a storyteller turn skip a tool above the turn's ceiling.
  - Plugins: `@quilltap/plugin-types` 2.9.0 adds `ToolEffect` and `ToolPlugin.getToolEffects?(config)` (sync or async). The host reads it through `toolRegistry.getToolEffects`. MCP plugin 1.1.45: each server's config takes an `effect` (default `write`) inherited by its tools. curl plugin 1.0.32 declares `curl` a `write`.
- Storyteller mode (Part 2):
  - `chats.turnMode` (`'rotation'` NULL / `'storyteller'`, patch-only, `ChatsRepository.setTurnMode`) and `chats.storytellerInviteFilter`. Set through `PUT /api/v1/chats/[id]` with a top-level `turnMode`. Leaving storyteller mode closes the open round.
  - An operator post in a storyteller chat is recorded, then opens a round instead of drawing a reply. Every present LLM character seat is asked for a bid in parallel; bids stream to the send as `storytellerRound` / `storytellerBid` frames, then `roundOpen` and `chainComplete` reason `round_open`. Board timeout 45 s; late bids reach the board through the new `storytellerRounds` realtime topic.
  - A bid is a full in-character call built by the ordinary turn path (`runStorytellerBid`) with `purpose: 'bid'`, run inside a dry scope (`lib/repositories/dry-scope.ts`) that discards every repository write except the LLM log. The bid section is the last trailing section. The call sends the turn's tools with the new `toolChoice: 'none'` stream option and is logged as `STORYTELLER_BID`.
  - Bid replies are parsed forgivingly (`lib/storyteller/bid-parse.ts`). The server computes the tier (Simple / Lookup / Act / Destroy) from the stated tier and the named tools (`tiers.ts`) and notes when the tools raised it.
  - New actions: `?action=storyteller-run` (SSE; `sequential` or `simultaneous`), `?action=storyteller-ask` (Ask anyway), `?action=storyteller-lie` (Let it lie), `GET ?action=storyteller-round`.
  - Speaking turns run under the tier's ceiling, carry a trailing "your plan" section, may pass with `[NOTHING TO ADD]`, and store the bid on the reply (`chat_messages.storytellerBid`). A swipe re-rolls under the same plan and copies the bid. Memory extraction, the summary fold, danger classification, scene tracking and the Scriptorium render run once after the round (`runStorytellerRoundHousekeeping`).
  - Sequential order follows `resolveCycleOrder`. "All at once" runs Simple and Lookup turns concurrently (at most 4 per connection profile), then Act and Destroy turns in order. Concurrent frames are tagged with `participantId` and `concurrent: true`; only the group's first turn posts the cadence's public Prospero announcement.
  - A nudge in storyteller mode runs one turn with no ceiling and no chain. A whisper and an `@Name:` query open no round.
  - New table `storyteller_rounds` (bids cleared on close; not exported or backed up; truncated by replace-mode restore). New `llm_logs.storytellerRoundId`, stamped through `lib/storyteller/round-context.ts`. Migrations `add-storyteller-mode-v1` and `add-llm-logs-storyteller-round-id-column-v1`.
- Client: the sidebar's Pause button is a three-way Normal / Paused / Storyteller control, with an "Invite by talkativeness" toggle. The board (`components/chat/StorytellerBoard.tsx`) sits above the composer. `useSSEStreaming` gains `runStorytellerSelection` and one streaming bubble per concurrent speaker. The LLM inspector has a "Storyteller Rounds" filter and a round chip.
- Repository method classification (read/write prefixes, `METHOD_OVERRIDES`, synthetic write results) moved from the job child's proxy to `lib/repositories/method-classification.ts`, shared with the dry scope.
- New `qt-storyteller-*` classes (`app/styles/qt-components/_storyteller.css`), mirrored into theme-storybook 1.0.78.
- Docs: new `help/storyteller-mode.md`; updates to `chat-multi-character.md`, `chat-participants.md`, `pascals-workbench.md`, `custom-tools.md`, `autonomous-rooms.md`, `tools-settings.md`; DDL.md, API.md, FEATURES.md, `BACKGROUND_JOBS_CHILD.md`, the plugin-types README, and the export schema (`turnMode`, `storytellerInviteFilter`, `storytellerBid`).

#### Fix: a whisper no longer starts a turn chain of its own (bug 258)

- A whisper from the Whisper dialog now gets one reply from its target and no chain afterward. The floor goes back to the operator.
- A whisper sent while another Salon stream is running in the chat waits for that stream to finish (`waitForEarlierTurns` in `lib/chat/turn-control.ts`) instead of running beside it.
- Before: the whisper ran a full chain in a stream the Salon never displayed, concurrently with any chain already running, both drawing on the same turn queue and rotation.
- `isOperatorWhisperSend` (`lib/services/chat-message/whisper-send.ts`) decides which sends get this treatment. Docs: `help/chat-multi-character.md` ("Who Answers a Whisper").
- Docs: new spec `docs/developer/features/storyteller-mode.md` for a third Salon turn mode, in which characters bid to answer and the operator picks who speaks. It also covers declared tool effects (`none` / `read` / `write` / `destroy`). Not implemented.

#### Feature: keystone memories

- New `memories.keystone` column (migration `add-memory-keystone-v1`, with a partial `(characterId, aboutCharacterId)` index). It marks a memory as an operator-set standing fact.
- In the frozen archive, keystones come before digests for each present character, for the holder, and for each inner-circle member.
  - A present character's keystones move into `## Those Closest to You`.
  - Self keystones stay in the anchors.
  - Any keystone renders as full text, including in the anchors and the head.
  - When the circle cap or token budget binds, every digest is cut before any keystone.
- Maintenance never touches a keystone.
  - The near-duplicate fold, consolidation (as member or seed) and demotion skip keystones, and they don't count against the cap.
  - `foldInto` adds no `[+]` footnotes and no anchor fields to a keystone.
  - Chat wipes spare keystones (`policyProtectionOf` returns `'keystone'`).
  - A keystone digest survives when its last member retires.
- Limits:
  - At most 5 hot keystones per holder and subject (`KEYSTONES_PER_SUBJECT_MAX`). Self counts the holder's own id and NULL together.
  - Cold rows can't be marked.
  - Both rules are enforced in `updateMemory`. Manual create checks the limit before admission, then marks the row through `updateMemory`.
- Fixed: raw-query memory reads now convert the stored 0/1 to a boolean before schema validation.
- New repository methods `findKeystones` (ordered by creation) and `countKeystones`.
- UI: a "Keystone — always remembered" checkbox in the memory editor, a Keystone badge on cards, and a "Keystones only" list filter (`?keystone=true`).
- CLI:
  - `memories ls --keystone` (◆ marks keystones in tables).
  - `memories show` prints a Keystone line.
  - New `memories keystone <id> [--off] [--write]` PUTs through the running server and is a dry run without `--write`.
  - Shell completions updated.
- Export schema, DDL.md, help (`memory-recall-relevance.md`, `memory-maintenance.md`, `cli-memories.md`) and the CLI README are updated.
- The inner-circle-recall spec moved to `features/complete/` with as-built notes, and the roadmap now lists it.

#### Feature: group members get reserved full-text slots in recall

- The frozen archive now has an inner-circle step, after present characters and self digests and before the importance fill. Every character who shares a group with the speaker, except anyone present and archived characters, gets hot digests by the tier of the smallest shared group: 3 for the tightest group, 2 for the next, 1 for the rest.
- The step is capped at one third of the archive. When the cap or the token budget binds, the loosest tier loses rows first, and each member's later digests go before anyone's first.
- Circle rows render in full text under a new `## Those Closest to You` section ahead of `## Memory Anchors`, with no age tags, in a fixed order (tier, group name, member name), so the section stays byte-stable within a compaction generation. They count as archive rows for dedup and delivery.
- The archive cache now also checks the circle's signature, re-read from group membership each turn. Membership changes, renames that reorder the circle, and archived members take effect on the next turn without explicit invalidation.
- `recall-replay --tuning` accepts `innerCircleShare` and `innerCircleAllowance`.
- `findNamesByIds` takes an `excludeArchived` option.
- The recall-replay result now includes the assembly's `warnings`, so a pool that failed is reported instead of showing up empty with no trace entry.
- Spec: `docs/developer/features/complete/inner-circle-recall.md` (Phase 2).

#### Fix: memory importance scale no longer rates work commitments with family facts

- The SELF and OTHER extraction prompts, the episode prompt and the consolidation prompt share one recalibrated scale. 0.95 is for facts that redefine a life or bond (marriage, vows, pregnancy, birth, death, a change of body, joining or leaving the family); 0.85 for revelations and spoken personal commitments about a relationship; work commitments to build, file, fix or rule on something sit at 0.60–0.65; work decisions in passing at 0.45. The old 0.90 "spoken commitment" anchor put every "agreed to build X" beside pregnancies, and with newest-first tie-breaking the frozen archive's importance fill became the latest build-session rows.
- New `WORK_IMPORTANCE_CEILING` (0.65) and `IMPORTANCE_WORK_CEILING_NOTE` in `lib/memory/extraction/prompts/shared.ts`, stated verbatim in all four prompts. The prompts' worked examples were rescored to match, and each gained a 0.95 family-fact example.
- All four prompts also carry `IMPORTANCE_FACT_NOT_TELLING_NOTE`: a pregnancy, marriage, birth, death, change of body, or someone joining or leaving the family scores 0.95 however it arrives; the 0.85 band is for revelations whose content is not itself such a fact. Without it, a dry run over a breakfast pregnancy announcement scored most pregnancy memories 0.85 as "revealed …".
- Existing rows are not rescored. The hourly rate limit's importance floor (default 0.7) now drops work notes first under pressure.
- Tests: `lib/memory/extraction/__tests__/importance-rubric.test.ts`. Help: `help/memory-recall-relevance.md` ("How the Book Rates a New Note"). Phase 1 of `docs/developer/features/complete/inner-circle-recall.md`.

#### Fix: a custom tool's LLM consult can narrate a verdict the table already reached (bug 257)

- An outcome row can carry a `brief` (the conclusion it means). When no row tests `llm`, the table is dealt before the consult and the prompt can quote `{{outcome.brief}}`, `{{outcome.state}}` and `{{outcome.index}}`, so the model is told the verdict instead of asked to compare numbers. The same placeholders work in messages, the chip label and effects. Tables that test `llm` keep the old order.
- Load-time rules: `{{outcome.*}}` in a prompt whose table tests `llm` is rejected; a `brief` needs an `llm` block and cannot quote `{{llm}}` or `{{outcome.*}}`.
- Workbench: a brief field per outcome, a warning on prompts that compare numbers, a warning on rows without a brief when the prompt reads one, and an audit flag on reachable rows without a brief.
- Docs: `help/custom-tools.md` ("When the table, not the oracle, decides") and `help/pascals-workbench.md`. Schema mirror updated in `public/schemas/qtap-custom-tool.schema.json`.

#### Docs: blank Inventory drawing descriptions are invisible

- The Inventory editor's "How it should be drawn" hint and `help/inventory.md` now say an empty or whitespace-only `imageDescription` keeps the object out of avatars, story backgrounds and the image tool; the object's own picture falls back to description, title, then name. Behavior was already this way (`renderCarryingPhrase` trims and skips). Added `__tests__/unit/lib/inventory/image-description.test.ts` to pin it.

#### Fix: composer action buttons stack vertically

- Send, raise-hand and Stop now sit in a column beside the editor at every width, at 2.5rem each, instead of a row of three 3rem buttons that took width from the editor. `.qt-chat-composer-actions` in `_chat.css`, mirrored in theme-storybook 1.0.77.

#### Feature: custom-tool gates and `when` tests gain OR and an `inventoryAggregate` subject

- `availableWhen` / `withheldWhen`, outcome `when` and effect `when` accept an array of their existing objects; the array holds when any element holds (AND inside an element, one level, at most 8). Readers go through new `gateGroups` / `whenGroups` / `effectWhenGroups` helpers in `lib/pascal/custom-tool.types.ts`; a grep-test in `custom-tool-definition.test.ts` blocks raw reads. Load-time issue paths include the group index.
- New `inventoryAggregate` subject (gates, outcome and effect `when`), keyed `<scope>.<field>`: scopes `equipped`, `owned`, `reachable` (cumulative); fields `count`, `names`, `titles`, `metadata.<key>` (a list) and `metadata.<key>.min` / `.max` / `.sum` / `.count`. New module `lib/pascal/inventory-aggregate.ts`; `InventoryContext.scopeObjects` on the real and mock contexts. Archetypes, archived objects and kits are excluded. A null inventory context declines every aggregate test.
- `metadataComparatorHolds` now compares an array of primitives entry by entry (`eq` any, `neq` none, `contains` any, `ncontains` none; ordering declines). This also applies to a character-sheet `metadata` key holding a list, which previously never matched. Arrays holding objects, arrays or null still decline.
- `evaluateToolGate` reports `heldGroup` for an array clause. The roster's withheld log line adds `groups` and `heldGroup`. Run-time inventory now loads when a tool uses only aggregates.
- `describeWhen` renders any-of groups and aggregate tests for the model; the roster description adds a `Takes stock of:` line. `ToolVocabulary.inventoryAggregates` is new and shown in the run dialog. The gate-key census walks every group and ignores aggregate keys.
- `formatDefinitionIssues` drops a union branch that only says "expected array", and surfaces the nested reason under "Invalid key in record" (aggregate and progress keys now report why they were rejected).
- Workbench: AND/OR toggle between chips in the gate and outcome table (OR starts a new line); `inventory aggregate` subject with an Insert-key helper; duplicate-slot checks per line; validation errors for ordering a list or searching a number, warning for a metadata key ending in a fold word. Proving Bench mock rows take a `metadata` JSON object (invalid JSON blocks rolling) and the gate verdict names the line that held.
- JSON Schema mirror and `CUSTOM_TOOL_SPEC.json` updated (one any-of row with `inventoryAggregate` tests). Help: `custom-tools.md` (OR, list matching, new `inventoryAggregate` section, gates), `pascals-workbench.md`. Spec moved to `features/complete/pascal-gate-broadening.md` with an As-built section.

#### Feature: `edit_custom_tool` can return the definition format

- New input `action: "schema"` on `edit_custom_tool`. It reads and writes no store and returns `schema` (the published `public/schemas/qtap-custom-tool.schema.json`, self-contained with its `$defs`) and `examples` (`docs/developer/CUSTOM_TOOL_SPEC.json` and `CUSTOM_TOOL_SPEC_DICE.json`), so a model can write a definition from scratch. Any other fields passed with it are ignored.
- `mount_point` and `file` are now optional in the input schema, with a refine requiring both unless `action` is `"schema"`. Save and validate behave as before.
- Tests: handler cases for the schema action (specimens pass `validateToolDefinitionText`, no store touched) and the still-required fields; tool-definition snapshot updated. `help/custom-tools.md` describes the action.

#### Docs: spec for broader custom-tool gates

- New design `docs/developer/features/pascal-gate-broadening.md`: an `inventoryAggregate` subject for gates and `when` tests (names, titles and `metadata` folded over the equipped, owned or reachable objects, keyed `<scope>.<field>`, with `.min` / `.max` / `.sum` / `.count` numeric folds), per-entry comparison of list values in the one comparison table (which also lets a character-sheet `metadata` key holding a list match), and OR as a one-level any-of array of the existing AND-groups in gates, outcome `when` and effect `when`. Approved, not yet built. Listed in `ROADMAP.md`.

#### Feature: raise a hand or stop from the composer

- The Salon composer has three buttons where it had one: **Send**, an amber **raise your hand** (soft interrupt), and a red **Stop** octagon (hard interrupt). The interrupt buttons are enabled only while a character is generating; Send is disabled then. The sidebar participant card's Stop button is removed (`ParticipantCard` / `ChatSidebar` lose `onStopStreaming`; `ChatComposer` loses `hideStopButton`).
- New server registry `lib/chat/turn-control.ts` (a `processSingleton`, since the actions and the SSE stream run in different route bundles). `handleSendMessage` runs each stream under `runWithTurnControl`, which registers a handle and makes it the ambient `AsyncLocalStorage` store, so `streamMessage`, the tool loops and the finalizer ask about their own stream without a chatId lookup. A stop aimed at a stream that is still winding down does not touch a new send.
- New actions `POST /api/v1/chats/[id]?action=stop-turn` and `?action=raise-hand` (`{ raised }`), in `app/api/v1/chats/[id]/actions/interrupt.ts`.
- Hard stop: the action pauses a multi-character room first (as the old Stop did), then aborts the stream and waits up to 15 s for it to settle. `withStallWatchdog` takes an `abortSignal`; when it fires, the provider stream ends quietly (no error, so no fallback or failover) and the source is unwound without awaiting. `streamMessage` passes `currentTurnStopSignal()`, which covers every chat-message call site. After a stop: the native and text tool loops run no further tool call, `attemptEmptyResponseRecovery` returns at once, reasoning is dropped, no sentinel is read, and the finalizer skips answer confirmation, dice auto-detect, reply trigger phrases and Carina markup. Whatever prose had streamed is saved as an ordinary message (not the error path's OOC-marked partial), along with any tool results. A stop before any prose saves nothing and sends `done` with `stopped: true`. `executeTurnChain` closes with `chainComplete` reason `stopped`, `paused: true`.
- Raised hand: the first LLM turn built after the hand goes up consumes it (`takeRaisedHand`) and gets a trailing Turn note (`buildTurnYieldInstruction`, `lib/chat/turn-manager/yield-signal.ts`) inviting `[YIELD]`. `detectYieldSentinel` accepts the sentinel on the first or last line, or bracketed at the start of a line; surrounding prose is kept as the reply. A yield posts a Host `turn-yield` message (`postHostTurnYieldAnnouncement`), sends a `handAnswered` SSE event, and the chain closes with reason `yielded`, `paused: false`. The rotation is not advanced and informs stay pending on a bare yield. A decline sends `handAnswered` with `yielded: false`, and the Salon shows a notice. `matchesSentinelLine` is now shared by the skip and yield sentinels.
- New icons `stop-sign` and `hand-raised` (registry, defaults, `_icons.css`, Madman's Box overrides, `ICON_INVENTORY.md`, the Madman's Box preview list). New CSS `.qt-chat-interrupt-button` / `.qt-chat-interrupt-button-raised`. `.qt-chat-stop-button` now uses the danger colours: it used to lose to `.qt-chat-composer-send`, which sat later in the file. The three buttons stack vertically below 640 px. `.qt-participant-stop-button` is removed. The theme-storybook (1.0.76) gets the composer action-button family and the new icons.
- Help: new `help/interrupting.md`; `chat-turn-manager.md`, `chats.md` and `chat-participants.md` updated.
- Tests: `yield-signal`, `turn-control`, watchdog abort cases, and chain `yielded` / `stopped` cases in `turn-orchestrator`. The `ParticipantCard` Stop tests are replaced.

#### Fix: toasts raised from inside a dialog were hidden behind it

- The toast container (`lib/toast.tsx`) sat at `z-index: 50`, below every dialog overlay (`qt-dialog-overlay` is `z-[60]`, nested dialogs up to `z-[101]`). An error toast from a save inside a modal — e.g. the Inventory object editor refusing a title as a kind-name shadow — appeared behind the dialog where it could not be read. It now sits at `z-index: 1000`, above all dialogs and below the full-screen startup gates (`z-[9999]`).

#### Change: the Inventory gets its own icon

- New icon `inventory` (an open box with flaps) in `ICON_REGISTRY`, with the default at `public/images/icons/inventory.svg` and its rule in `_icons.css`. The sidebar Inventory button, the participant card's inventory button and the Prospero Inventory card and the Inventory workspace tab (`lib/workspace/tab-meta.ts`) use it instead of `dice`, which stays with the RNG dropdown and Pascal's Workbench.
- Madman's Box ships a matching override (`themes/bundled/madmans-box/icons/inventory.svg`). Other bundled themes fall back to the default.
- `docs/developer/ICON_INVENTORY.md` lists the new name, and `help/inventory.md` describes the button as the open box rather than the dice.
- `themes/tools/madmans-box-icon-preview.html` lists `inventory`, plus `mail`, `thinking` and `brahma-console`, which it was already missing; `check-madmans-box-icons.mjs` passes again.
- New guard test `__tests__/unit/components/icons/inventory-icon.test.ts` (registry entry, generated CSS rule, Madman's Box override, workspace tab).

#### Fix: the Log's date bounds and regex errors

- `log_read`: a bare-date `to` (e.g. `"2026-10-19"`) now means the last millisecond of that UTC day, not its first, so `from` and `to` naming the same date read that whole day. Before, that query returned nothing. The from-not-after-to check uses the same rule. One helper, `logReadBoundInstant` (`lib/tools/log-read-tool.ts`), serves the check and the handler.
- `log_grep` and the `regexp()` SQL function no longer say "Invalid regular expression: Invalid regular expression: …". `compileSqlRegexp` strips V8's own prefix from the reason.
- Help (`help/the-log.md`): a line written by the operator through run-tool is stamped with the character it was run as (the first active one by default), not with no character; and bare dates are explained.

#### Feature: the Log

- New table `log_entries` in the LLM logs database (`id`, `message` 1-4000 chars written once, `chatId`, `characterId` nullable, `createdAt`, `updatedAt`), created from the Zod schema in `lib/schemas/log-entry.types.ts` by `LogEntriesRepository` (no migration). Indexes on `createdAt`, `(chatId, createdAt)` and `(characterId, createdAt)`. Repo key `logEntries` joins `LLM_LOGS_REPO_KEYS`; in the job child its writes are buffered, so a `log_create_entry` then `log_grep` in the same autonomous turn does not see the entry.
- New SQL function `regexp(pattern, value[, flags])` (`lib/database/backends/sqlite/regexp-function.ts`, JavaScript `RegExp`, flags `i m s u`) registered on the LLM logs connection, so `REGEXP` works there.
- Three built-in tools, on by default in the Salon and switchable in chat/project tool settings under a new group "The Log"; not on the Brahma Console. `log_create_entry({ message })` stamps the current chat and calling character. `log_grep({ pattern, ignore_case?, limit? })` runs a JavaScript regex over every entry, newest first (default limit 50, max 200). `log_read({ conversationId?, character?, from?, to?, limit? })` filters by chat (`"current"` allowed), character (name or id) and inclusive ISO-8601 range. Both readers return `{ entries, count, limit }` over the whole instance.
- Pascal custom tools gain a fourth effect kind, `{ "log": "<template>" }` (optional `when`; max 1000 chars; applied after all other effects; empty renders skipped). The run_custom description says "writes to the log". `qtap-custom-tool.schema.json` updated. Pascal's Workbench offers it as "Enter a log line", with the same placeholder checks as an outcome message.
- Retention: `LLM_LOG_CLEANUP` also prunes `log_entries` older than the LLM logging retention days, even when LLM logging is off. Not included in `.qtap` exports or logical backups.
- The Brahma SQL tool and prompt, and `quilltap db` (`logs` group), know the new table.
- Docs: `DDL.md`, `BACKGROUND_JOBS_CHILD.md`, `API.md` tools table. Help: new `help/the-log.md`; `help/custom-tools.md`, `help/pascals-workbench.md`, `help/tools-settings.md`, `help/system-llm-logs.md`.

#### Change: custom tools in a character's vault are that character's only

- A character's vault `Tools/` folder is no longer read for other characters in the same chat. Before, the roster had a `participant` tier: every co-participant's vault tools were dealt to every character, and a `disabled` definition in one character's vault suppressed that name for everyone else in the room.
- `resolveCustomToolRoster` (`lib/pascal/custom-tools.ts`) resolves the pool without `includeParticipants`; the tiers are character → group → project → global. `characterIds` is removed from `RosterContext`, `RunCustomToolContext` and `RunTriggeredCustomToolsParams`, and from the callers that fed it (orchestrator, tool executor, trigger-phrase sites, `GET/POST /api/v1/chats/[id]/custom-tools`). Other users of the tiered pool (document access) are unchanged.
- The Salon popup still lists a vault tool and runs it as its owner; the row is tagged with the owner's name unless the operator is playing that character.
- Help: `help/custom-tools.md` (tiers), `help/pascals-workbench.md` (precedence note). Tests: `custom-tools-discovery`, `trigger-runner`, `trigger-phrase-sites`.
- Test fix: `memory-maintenance-card.test.tsx` waits for the loaded settings before reading or editing a field (the card renders defaults first, so the test was flaky under a full-suite run).

#### Change: `/photos` leaves out character vaults and gains an album selector

- `/photos` ("My Photos") no longer includes character vaults. Its default view covers every enabled non-character store: Quilltap Uploads, Quilltap General, project stores and other document stores. Previously, promoting an Avatar Roll to a portrait copied it into the character's `photos/` folder, and that copy also showed up in My Photos. The rule is `isUserGalleryMount` in `lib/photos/user-gallery-service.ts`.
- New album selector on `/photos`: My Photos, or any one store's album (characters, projects, document stores, Quilltap General). It is backed by `GET /api/v1/photos?action=albums` (`listAllPhotoAlbumOptions`, which leaves out archived vaults) and `GET /api/v1/photos?album=<mountPointId>` (`listUserGallery({ mountPointId })`). Search, dedupe and paging work the same in both views. An unknown or disabled album returns 404.
- Removing a photo from a character's album on `/photos` goes through `DELETE /api/v1/characters/[id]/photos/[linkId]`, as Aurora does. `removeFromUserGallery` and `getUserGalleryEntry` now refuse character-vault links.
- New query key `queryKeys.photos.albums()`. Help: `help/photo-gallery.md`. Tests: `__tests__/unit/lib/photos/user-gallery-service.test.ts`.

#### Feature: `edit_custom_tool`

- New LLM tool `edit_custom_tool` (`lib/tools/edit-custom-tool-tool.ts`, handler `lib/tools/handlers/edit-custom-tool-handler.ts`). It saves or validates one custom-tool definition. Input: `mount_point` (`self` allowed), `file` (`unlock`, `unlock.tool.json` or `Tools/unlock.tool.json`), optional `content` (JSON string or object).
- Only `Tools/<name>.tool.json` at the top level of a store. Any other folder or a nested path is refused (`toolDefinitionPathFor` in `lib/pascal/custom-tools.ts`).
- With `content`, the definition must pass `validateToolDefinitionText` (JSON parse + `QtapCustomToolSchema`, split out of `loadToolsFromMount` so the editor and discovery use one check) and must not reuse a `name` another file in the same store defines. Only then is it written, through `doc_write_file`'s handler, so store access, `character_write`, the Librarian announcement and the reindex are a document write's. An object is written pretty-printed; a string is written verbatim.
- Without `content` (or with `null`), nothing is written: the file is read under the read policy and judged the same way.
- Offered whenever the chat's Custom Tools setting is on (`editCustomTool` build option, keyed on `customToolContext`), including when the roster is empty.
- Tool settings: new built-in category `pascal` ("Pascal's Custom Tools"). `run_custom` moved there from `utility`; built-in tools are disabled by id, so existing settings are unaffected.
- `CustomToolLoadError` carries `name` on a `duplicate` error.
- Help: new section in `help/custom-tools.md`. Test: `__tests__/unit/lib/tools/handlers/edit-custom-tool-handler.test.ts`.

#### Change: Image prompts are cleaned only for a Moderated chat bound for a moderated painter

- New `isUncensoredImageProfile` (`lib/services/dangerous-content/understudy.ts`): an image profile ticked Uncensored-compatible, or the one named on the Concierge desk.
- `sanitizeAppearancesIfNeeded` takes `imageTargetUncensored` (the profile that will actually generate the image is uncensored) in place of `isDangerousChat` + `routesDangerousToUncensored`. It returns unchanged, with no classifier call, when the target is uncensored, in any chat state. Otherwise it sanitizes only under the pre-screen (Moderated, on duty). An Unmoderated chat bound for a moderated provider is no longer sanitized; a refusal is left to the post-hoc failover.
- `generate_image` passes the profile it ended up on after the pre-flight reroute, so a Moderated chat rerouted to the desk by the pre-screen is no longer sanitized on its way there.
- Story backgrounds craft candidly (`uncensoredImageTarget`) when the chat's own image profile is uncensored or the chat is Unmoderated (on or off duty, desk named or not), as well as for "Try uncensored". Concealment remains for Moderated and Locked chats on a moderated painter. The up-front route to the desk is unchanged (Unmoderated, on duty, desk named) and is skipped when the chat's own profile is already uncensored.
- `resolveImageProviderForDangerousContent` no longer reroutes from a profile that is already uncensored (it used to swap it for the desk's or another compatible one). Applies to the tool, story backgrounds, character avatars and wardrobe item images. The post-hoc failover is unchanged.
- Help: new "What Gets Cleaned Up" section in `help/the-concierge.md`; story-background conditions, the Locked note and `help/image-generation-profiles.md` updated to match.

#### Fix: published vault addresses name the vault (bug 256)

- No address Quilltap hands out depends on who reads it. `qtap://self/…` means the vault of whoever follows it, and the URI producers handed a character's own-vault documents out in that form in tool results, Librarian announcements and `self_inventory`, which every character in a chat reads. A second character following one opened their own file of the same name (a request for Abigail's `metadata.json` returned Friday's), with no error.
- `docStoreUriFor`, `uriForResolvedPath` and `buildDocStoreUriResolver` (`lib/doc-edit/uri-producers.ts`) always name the store (UUID when the name is ambiguous) and no longer take a character argument.
- The doc handlers pass the resolved store's name to every Librarian announcement and to Document Mode's `chat_documents` row (`publishedMountPoint` in `lib/tools/handlers/doc-edit/shared.ts`). `librarianUri` prints a bare path for a leftover `self` (an old `chat_documents` row).
- `self_inventory` names the vault in each listed file's `uri`; a context-file row stored as `self` gets no URI and an explanation; the footer says `self` is the reader's own vault.
- The path resolver's `NOT_FOUND` names the store asked for; `MISSING_CONTEXT` says a path alone names no store.
- A character's own `self` reads are unchanged. Prospero's vault whisper and the knowledge injector, which only the owner reads, still use `self`.
- Test: `__tests__/unit/lib/doc-edit/vault-addresses-reader-independent.test.ts`.

#### Feature: Inventory title lint

- Every Inventory write runs `lintInventoryTitle` (new `lib/inventory/title-lint.ts`) with the object before and after the write. `resolveInventoryRef` stops at the first of id → title → name that matches, so a title equal to a string something means by name silently takes its place.
- The lint judges the change to the set of reachable titled objects, not a field. A title enters on a create, a rename, a restore from the archive, a cleared title override, a copy, or a move into `Inventory/`, and on a name change under a standing title. It leaves on a rename, an archive, a delete or a move out. Other edits (description, folder) are neither.
- An entering title is refused (`TITLE_SHADOW`, `InventoryTitleShadowError`) when, after `normalizeTitle` (the resolver's `trim` + `toLowerCase`, then whitespace collapsed and diacritics stripped), it equals the resolved name of any object the location's pool reaches, its own included (`kind-name shadow`), or a literal `inventory` / `inventoryCount` key in any custom tool's `availableWhen` / `withheldWhen` that resolves, with the object left out, to some other object (`live gate shadow`). The message names the title, each collision and the tool. A key that resolves to nothing else passes as `gate key naming` (one `info` row).
- An entering title fails closed (`TITLE_CHECK_UNAVAILABLE`, `InventoryTitleCheckUnavailableError`), naming what could not be read: a pool tier whose read failed, a consulted store that does not exist, a failed `Tools/` listing, a tool file listed but missing on open, or a tool file whose bytes or JSON cannot be read.
- A leaving title is never refused. When a gate keys on it, a row is logged at once with `gate dark`, `gate redirected: <owner>`, `gate unverifiable: <what could not be read>` (all alerts) or `gate key moved`.
- Every lint call writes one `debug` census line (`[InventoryTitleLint] Census`) naming the pools and tool stores read and their sizes.
- The document-write layer lints too. `writeDatabaseDocument`, `deleteDatabaseDocument`, `moveDatabaseDocument` and `moveDatabaseFolder` (`lib/mount-index/database-store.ts`) call `lintInventoryDocumentChange` (new `lib/inventory/title-lint-documents.ts`) for `Inventory/*.json` and `Tools/*.tool.json` paths, so an edit made with `doc_*` tools or the Scriptorium is linted from the file's prior state. A prior state that cannot be read refuses a titled write. A `Tools/` edit writes the census line only. The Inventory mutations' own projection runs inside `withInventoryWritesLinted` (new `lib/inventory/lint-scope.ts`) and is not linted twice.
- Not linted: a transfer between tiers (`preserve`), an instance with no title of its own, filesystem-backed stores (they hold no Inventory).
- New `lib/pascal/tool-gate-keys.ts` (`collectToolGateKeys`) takes the instance-wide census of gate keys. `loadToolsFromMount` / `listAllCustomTools` now return `unread` (failed listings and files listed but missing on open, which the roster still skips) and `storesConsulted`; `CustomToolLoadError` gains `stage`. `InventoryPool` gains `consultedMounts` and `unreadMounts`.
- The Inventory editor's toast (`describeInventoryRefusal`) shows the two new refusals' lines joined with "; "; the API, tool results and logs keep one line per collision.
- Tests: `__tests__/unit/lib/inventory/title-lint.test.ts`, `__tests__/unit/lib/inventory/title-lint-documents.test.ts`, `__tests__/unit/lib/mount-index/database-store-title-lint.test.ts`, `__tests__/unit/lib/pascal/tool-gate-keys.test.ts`; the shared Inventory test store gains a fake census (`toolGateKeysModule`, `putGateKey`), `missingMounts` and `docMountDocuments.findByMountPointAndPath`.

#### Test: unit suite ignores an inherited environment

- `npm run test:unit` sets `NODE_ENV=test`, and `jest.setup.ts` clears `QUILLTAP_TIMEZONE`. A shell opened from Quilltap exports `NODE_ENV=production` (React tests then load the production build and fail on `React.act`) and `QUILLTAP_TIMEZONE` (the memory day-reference suites, which compute expectations in the process's own zone, then fail).

#### Fix: Ariel reads full-screen programs (bug 255)

- `terminal_read` and Ariel's periodic summaries now render terminal output through a server-side terminal emulator (`@xterm/headless`, new `lib/terminal/screen.ts`) instead of stripping escape codes. Full-screen programs (Claude Code, vim, less) draw with cursor addressing on the alternate screen, and stripping reduced them to fragments: 422 KB of Claude Code output read back as 526 characters.
- Each live PTY session keeps an emulator sized at spawn and resized with the pane. `terminal_read` returns its lines: a shell's scrollback (soft-wrapped rows joined), or a full-screen program's current screen, flagged with the new `buffer: 'alternate'` output field. `raw: true` now returns the last 64 KB of the raw stream.
- An exited session's transcript (last 4 MB) is replayed through an emulator at the session's stored size. Migration `add-terminal-session-geometry-v1` adds `terminal_sessions.cols` / `rows`, set at spawn and on exit; older sessions replay at 80×24.
- Ariel's summaries post a snapshot of the screen ("Screen of session …") while a full-screen program has the terminal, skipping an unchanged screen, and otherwise the shell lines written since the last summary. Flushes are chained per session, so the session-closed announcement lands after the final output.

#### Test: Inventory-gated custom tool end to end

- New `__tests__/unit/lib/pascal/custom-tools-measure-twice.test.ts` runs a real inventory-gated tool ("Measure Twice") over the shared Inventory test store: a title-keyed `availableWhen` gate opens for the character carrying the titled instance, stays closed for a character carrying another instance of the same archetype, and stays closed with no inventory context (`eq: "equipped"` and `inventoryCount` `lt: 1`). It also checks that `{{inventory.<ref>.title}}` and `.metadata.<key>` render a title containing an apostrophe. Test only; no runtime change.

#### Fix: Scenario lists sort by title

- Every list of scenarios now sorts by title (frontmatter `name`, or the parser's fallback), then filename, case-insensitively, ignoring a leading "The" (also "the-" / "the_" in filenames). New `lib/scenarios/sort.ts` (`compareScenarios`, `sortScenarios`, `scenarioSortKey`).
- `buildScenarioList` (every store-tier location's `list`, the instance-wide scenario browser) returns title order. Default-conflict resolution still walks path order, so the alphabetically-first filename still wins.
- A character vault's scenario array is built by the new `parseScenarioFilesSorted` (`vault-overlay/parsers.ts`) in both the read overlay and `readCharacterVaultScenarios`, in the same order. The implicit scenario for a chat that names none (`firstActiveScenarioContent`) is now the first by title rather than by path.
- `ScenarioSelect` sorts each optgroup too, so an entry a surface appends locally after a save shows in place.

#### Fix: Inventory dogfood fixes

- The project roster now gates the project's Inventory shelf as it does the project wardrobe. For a character the roster does not admit, `loadInventoryContext` (every `inventory_*` tool and every Pascal read, gate and effect) hides project-tier objects they are not carrying, and `equipItems` / `pickUpItems` refuse a `character` or `pascal` gesture that would take from the shelf with the new `OFF_ROSTER` refusal (`InventoryOffRosterError`). Objects already carried stay visible and can be set down. `inventory_pick_up`, `inventory_equip` and `inventory_read` answer a reference to a hidden shelf object with the roster refusal rather than "not found" (`closedShelfMessage`; `LoadedInventoryContext.closedShelf` keeps the hidden objects for this alone). Operator gestures, arrival defaults, the prompt section and the image pipelines are not gated. New `lib/inventory/roster-gate.ts`; the shared inventory test store gains a roster (`putOffRoster`).
- The character progressions report is now built on every turn as well. It had the same continue-mode guard, so chained, nudged and autonomous-room turns never reported a progression (bug 254). The Core whisper keeps its deliberate continue-mode skip; `isContinueMode`'s doc comment and PROMPT_ARCHITECTURE.md now say what continue mode is.
- The `## Carried and equipped` section is now built on every turn. It was skipped in continue mode, which covers every chained speaker, Nudge and autonomous-room turn, so characters knew what they carried only on turns answering a user message (bug 253).
- Pascal's netted Inventory line for a turn is now posted after the turn is saved (a `finally` around the orchestrator's terminal branches) instead of before the tool messages and reply it summarizes.
- Pascal's line uses "some" for plural-looking names ("takes up some lockpicks", not "a lockpicks") and "a" before `uni`/`eu`/`one` spellings.
- A character's project tier is labelled with the project's name ("Project: Scenario Builder Test") instead of "Project: Project". `loadInventoryPool` reads the name through an optional `projects` repository and falls back to "Project".
- The Inventory browser's shared-tier rows count only objects matching the Items / Kits / Archetypes filter.
- The row `⋮` menu is positioned `fixed` beside its button, opening upward when there is no room below, so the list's scroll box no longer clips it. It closes on scroll or resize.
- The Take up… picker has a close button and Cancel. Its open state lives in the dialog, so Escape or a click inside the picker no longer also closes the Inventory dialog.
- The Carrying now pane and Take up… picker show titled objects as "Excalibur (sword)", like the list.
- A copy refused because an object cannot be copied now says so in words instead of listing ids.
- The kit editor's placeholders are a kit's ("burglar's kit", "Loadouts"), not a sword's.
- Workbench: the side-effects vantage select says "inventory" (or "wardrobe and inventory") when the tool has inventory effects, and the Inventory picker's header says "inventory".
- Help: `help/inventory.md` names the buttons as they appear (**+ New Item**, **+ New Kit**, **+ New Archetype**, **+ From archetype**).

#### Feature: Inventory tools and Pascal inventory support

- Review fixes:
  - `inventory_give` moves the file first and clears the giver's carried sets only after the move succeeds. A refused transfer no longer leaves the giver unequipped everywhere.
  - `ChatsRepository.removeEquippedInventoryId` now takes `(chatId, characterId, itemId)` and rewrites one chat. New `findChatIdsCarryingInventoryId` and `dropCarriedEverywhere` (`lib/inventory/equip.ts`) clear an id from every chat, each under `withChatInventoryLock`.
  - `inventory_archive` clears the archived object from the character's carried set in every chat, so a restore does not re-equip it.
  - Pending Inventory announcements: an unequip also removes the object from `pickedUp`, a give strikes its object from the giver's pending entry, and each entry records `provenances`, which the flush logs instead of a hard-coded `character`.
  - Job child: `docMountDocuments.findManyByMountPointsInFolder` answers through a per-job overlay of buffered `linkDocumentContent` writes and `deleteWithGC` deletes, so later gestures in one job see instances it created.
  - Text-block parser: `inventory_*` tools convert only `max_equipped` to a number and `archived` / `equip` to booleans; names, titles and descriptions stay strings.
  - `refs.ts` builds a pool's id map once; `inventory_give` resolves a receiver id without loading the cast and loads names in parallel.
- New `lib/inventory/refs.ts`: `resolveInventoryRef` (id → title → name, case-insensitive, own tier first), `stateOf` (`equipped` > `carried` > `reachable` > `absent`), `equippedKinCount`, `pickForGesture`, and the `InventoryContext` every reader shares. `lib/inventory/context.ts` loads one per tool call or run.
- New character flag `canManageInventory` (migration `add-character-inventory-flag-v1`, null = on), with an Aurora toggle beside Self-Dressing, the export schema, DDL.md, the Almanack ledger and the tools API.
- Nine new tools gated by it: `inventory_list`, `inventory_read`, `inventory_equip`, `inventory_unequip`, `inventory_pick_up`, `inventory_create`, `inventory_update`, `inventory_archive`, `inventory_give` (`lib/tools/inventory-*-tool.ts`, handlers and `inventory-tool-table.ts`). Registered in the plugin tool builder (nine per-tool flags via `lib/tools/inventory-tool-flags.ts`), the executor, the simple-JSON and text-block prompts and parsers, `/api/v1/tools`, and the Salon tool bubble. Off on the Brahma Console, the Scenario Builder, Carina and help chats.
- `buildTools` and `determineTextBlockToolOptions` take a new positional `canManageInventory` after `canCreateOutfits`.
- `lib/inventory/equip.ts`: `pickUpItems` instantiates archetypes into the character's vault root and equips them, checking the cap before any instance is written; `equipItems` takes `known` for objects written in the same call.
- `lib/inventory/transfers.ts`: `transferInventoryItem`, extracted from the transfers route, which now calls it. Same-location and duplicate-id refusals now answer 400 with code `INVALID_SHAPE`.
- `InventoryChangeContext.provenance` is `operator` / `character` / `pascal`. Inside a turn, `notifyInventoryChanged` records into a new `pendingInventoryAnnouncements` map (created by `newWardrobeTurnContainers()`) and `flushPendingInventoryAnnouncements` posts one netted Pascal line per character at turn end. Gives post their own line. `describeInventoryChange` gains "picks up" and "hands … to …".
- Job child: `chats.findById` / `getEquippedInventory` answer through a per-job overlay of buffered `setEquippedInventory` and `removeEquippedInventoryId` writes.
- Pascal: new `inventory` (state, `eq`/`neq`) and `inventoryCount` (numeric) subjects in outcome and effect `when`s and in gates; gate keys must be literal. A null context declines every inventory comparator. New `{{inventory.<ref>.title|name|description|state|metadata.<key>}}` placeholders. New `$inventory` operand (`<ref>.metadata.<key>` + fallback) wherever `$state` is allowed, and as a whole roll with a dice fallback. Loaded lazily at roster time and once per run.
- New `inventory` effect (`equip` / `unequip` / `pick_up`, `equip` on pick_up), applied by `lib/pascal/inventory-effects.ts` after wardrobe gestures, fail-soft per gesture. Audit targets `inventory.equip`, `inventory.unequip`, `inventory.pick_up`.
- Roster description, vocabulary (`inventoryReads`, `equips`, `unequips`, `picksUp`) and the run dialog's reference panel name inventory reads and gestures.
- Published schema `qtap-custom-tool.schema.json`, `CUSTOM_TOOL_SPEC.json` and the agreement corpus updated.
- Workbench: "Change the inventory" effect kind with reference chips and an Inventory picker over the shared vantage; Inventory state / count condition and gate chips; a "From an object" roll form; the Proving Bench's Mock inventory (`lib/pascal/bench-inventory.ts`, sent as `inventory` on preview and audit).
- Realtime: new `inventory` topic (lists and folders), published after object writes in the parent and inferred from job-child `Inventory/` file writes.
- Tests: refs, handlers over the fake store, the Pascal read side, the applier, the partition order, the child overlay, the draft model and Workbench components.

#### Feature: the Inventory

- Review fixes:
  - A second file claiming an object's id is skipped on read and is no longer swept on the next write. The file at the object's own name wins, and the copy's name is reserved from the projection (`readDuplicateInventoryPaths`).
  - The Concierge's appearance screen now classifies and sanitizes the carrying phrase along with the rest of the appearance. A sanitized appearance drops `carryingDescription`, so it is not appended again.
  - Editing a character's kit checks its members against the same project shelf it was created with. The editor and `PUT` pass `?projectId=`, and `updateInventoryItem` takes the context.
  - The greeting's Inventory section rides the greeting's user turn as a trailing section (`trailingContextSections` on `generateGreetingMessage`), including on the uncensored desk. It is no longer in the system prompt.
  - Restored the `setConciergeMode` compare-and-set tests beside the `setEquippedInventory` ones.
  - Reset to defaults and each character's arrival run under the chat's carried-set lock (`withChatInventoryLock`, `equipItemsHoldingLock`), so a concurrent equip is never rewound.
  - The pool's archetype fallback queries only the `Inventory/` files that mention the wanted ids (`DocMountDocumentsRepository.findManyInFolderContaining`), instead of reading every object in the instance on each turn.
  - Transfers keep kits whole. A kit must reach its members from the destination (`INVALID_SHAPE`), and a move that would leave kits naming an unreachable object is refused with the new `KIT_STRANDED` (409).
  - A malformed JSON body on `?action=generate` for object pictures is a 400, not a 500.
  - The dialog detects a cap refusal by `code === 'CAP_EXCEEDED'`, not by message text.
- `chats.equippedInventory` joins `CHARACTER_KEYED_CHAT_FIELDS` (`lib/chat/character-keyed-fields.ts`), so new-account restore and `.qtap` import re-key it in the same pass as the outfit (bug 252). The Inventory's own remap helper is removed.
- Shared folder rules: the pure folder-path helpers moved from `lib/wardrobe/folders.ts` into `lib/mount-index/item-folders.ts`, parameterised by `ItemFolderRules` (root, reserved segments, depth cap, noun). `lib/wardrobe/folders.ts` and the new `lib/inventory/folders.ts` are delegates; `isWardrobeItemDocumentPath` delegates to `isItemDocumentPath`. Wardrobe behaviour and messages are unchanged.
- The wardrobe's folder operations (list, create, rename, delete-and-send-up) are now one implementation in `vault-overlay/item-folder-ops.ts` over an `ItemFolderTree` descriptor, with the per-folder write chain (`runSerialized`) and `resolveVaultFolderMount` (the tombstone-aware mount resolver; `resolveWardrobeMount` and `resolveInventoryMount` delegate to it).
- `projectArrayIntoVaultFolder` takes an `ext` option (default `.md`, so existing callers are byte-identical).
- New `lib/schemas/inventory.types.ts`: `InventoryItemSchema` (strict), the sparse `InventoryItemFileSchema` (no defaults, via `patchSchemaOf`), `inventoryShapeIssues` (archetype / kit / item / instance rules), request bodies, `EquippedInventorySchema`.
- New `vault-overlay/inventory-readers.ts` / `inventory-writes.ts`: one `.json` file per object under `Inventory/` at any depth, identity from the `id` inside the file; `parseInventoryItemFile` (unknown keys dropped with a warn, bad files skipped with a warn), the predicate pair `isInventoryItemDocumentPath` / `isInventoryItemDocument` (a file that does not parse is never swept), JSON projection serialised per folder.
- New `lib/inventory/svg.ts`: allowlist SVG sanitiser for object glyphs (drops scripts, `foreignObject`, styles, event attributes, external refs; 16 KB cap).
- New column `chats.equippedInventory` (migration `add-chat-equipped-inventory-v1`), patch-only, written only by `ChatsRepository.setEquippedInventory` (deduplicated, sorted, buffered in the job child). Export schema and DDL.md updated.
- Archiving a character keeps `Inventory/` in the pruned vault, beside `Wardrobe/`.
- Tests: `inventory-files.test.ts`, `svg.test.ts`, `add-chat-equipped-inventory.test.ts`, patch-only and archive-prune cases.
- `lib/inventory/location.ts` (`resolveInventoryLocation`, the four tiers as one surface), `pool.ts` (`loadInventoryPool`: character > group > project > general, archived dropped per tier before shadowing; an archetype outside the pool's tiers is fetched instance-wide so an instance always resolves), `resolve.ts` (sparse overrides over the archetype, `metadata` merged key by key, picture falls through; `parentMissing` only when the archetype exists nowhere), `equipped-set.ts`, `dependents.ts` (`findDependents` across every mount).
- `lib/inventory/item-mutations.ts`: create, instantiate, update (an instance stores only what it overrides), `clearOverrides`, archive, detach / `detachAll` (bake resolved values), delete (archetype in use refused without `force`; forced deletes bake every instance first; refused while an archived character holds one), duplicate / copy-items (refused when `canCopy` is false), move-items. A deleted kit member is dropped from its tier's kits. Refusals carry codes (`lib/inventory/errors.ts`).
- `lib/inventory/item-images.ts`: object pictures under `Inventory/images/<itemId>/`, reusing the wardrobe's picture steps; the wardrobe image bridge and its generic steps take an optional images folder (wardrobe default unchanged).
- Tests: `resolve.test.ts`, `item-mutations.test.ts` over an in-memory store (`__tests__/helpers/inventory-fake-store.ts`).
- `lib/inventory/equip.ts`: `equipItems` / `unequipItems`, serialised per chat. Plan, then write: kits expand (an archetype member becomes an instance in the character's vault, reusing an uncarried instance they already own), archetypes and archived objects named directly are refused (`NOT_EQUIPPABLE`), and the kin cap (`count(equipped kin) + planned + 1 ≤ maxEquipped`) is checked over the whole plan before anything is written (`CAP_EXCEEDED`). One `setEquippedInventory` per gesture; unresolvable ids are pruned on that write. Unequipping a kit sets down its members and keeps the instances.
- `lib/inventory/equip-effects.ts`: `notifyInventoryChanged` posts one Pascal line per gesture (`systemKind: 'inventory-change'`, no `pascalMeta`; `postPascalInventoryChange` in `lib/services/pascal/writer.ts`) and refreshes the per-chat avatar. `refreshAvatarForOutfit` is now `refreshAvatarForAppearance` (old name kept as an alias). The Salon labels the kind "inventory".
- `lib/inventory/apply-defaults.ts`: `applyInventoryDefaults` runs beside `applyOutfitSelections` at chat creation, participant add and merge. A continuation or merge copies the source chat's list; otherwise a character with no entry yet gets every reachable `equippedByDefault` object, silently, with a cap breach dropped (warn) rather than failing the arrival. `resetInventoryToDefaults` clears and re-applies.
- Tests: `equip.test.ts`; `apply-chat-merge.test.ts` asserts the merge applies inventory.
- `lib/inventory/prompt-section.ts`: `buildInventorySection` renders `## Carried and equipped` from the carried objects' `description`s (title first, name in parentheses; kits never appear). A trailing per-turn section after the progressions report and before the inform block in `buildContext`; also on Carina's user message and on the opening greeting's prompt (added in `autoGenerateFirstMessage`, after arrival defaults, since `buildChatContext` runs before the chat exists). Null when nothing carried has a description, so a turn is byte-identical. Never in system block 1; no builder version bump.
- `lib/inventory/image-description.ts`: the carried objects' `imageDescription`s as one phrase ("carrying a longsword with a jewelled pommel, ..."). `resolveCharacterAppearances` adds it as `carryingDescription` on every path; the Lantern renders it after "Wearing:" (new `sceneDescriptionParts`), the image tool's expansion context lists it as a "Carried" entry, and the avatar job passes it to `buildCharacterAvatarPrompt` (new `carrying` option). The avatar cache keys on the prompt, so a new carried object is a new configuration.
- Tests: `delivery.test.ts`, `appearance-carrying.test.ts`, `context-management.test.ts` (order and byte identity).
- Routes: `lib/inventory/routes/inventory-route-factory.ts` behind `/api/v1/characters/[id]/inventory`, `/groups/[id]/inventory`, `/projects/[id]/inventory` and `/inventory` (General), each with `/[itemId]`. Collection: list (resolved; the character tier's `?shared=true` lists the whole reachable pool), `?action=folders`, `?action=archetypes`; create, `instantiate`, the folder trio, `move-items`, `copy-items`. Item: get, `?action=dependents`; update, `clear-override`, `detach`; delete with `?force=true`. New `POST /api/v1/inventory/transfers` and `/api/v1/inventory/[itemId]/images` (generate / upload / set-current / delete-image / save-targets / save-to-store; an instance with no pictures shows its archetype's). Chat actions `GET ?action=inventory`, `POST ?action=inventory-equip`, `inventory-unequip`, `inventory-reset-defaults`. Refusals answer 409 (or 400) with `details.code` through `inventoryErrorResponse`. Documented in `API.md`.
- Object pictures generate through `generateImageWithConciergeFailover` with an object still-life prompt (`lib/inventory/item-image-generation.ts`); new log type `INVENTORY_ITEM_IMAGE`, counted as image spend.
- Tests: `routes.test.ts`; dispatch and image-spend tests updated for the new action and log type.
- UI: new `components/inventory/` — `InventoryControlDialog` (container select over the four tiers; opened from a chat, rows gain Equip / Unequip and a *Carrying now* pane per cast member shows carried objects, kit states, *Take up…* and *Reset to defaults*), `InventoryView` (workspace `'inventory'` tab) and `InventoryPanel` (the new Prospero `InventoryCard`). `InventoryBrowser` (search, Items / Kits / Archetypes, Equipped only, Show archived, Show shared, folders, tier rows, select mode), `inventory-item-row` (glyph SVG → emoji → default, never the picture; chips for Archetype, Instance of X, Kit · state, Equipped, Default, borrowed tier; ⋮ menu), `inventory-item-editor` (both descriptions, an *Inherit* toggle per field for instances, a kit member picker with pictures, SVG preview with size counter, metadata, pictures), `InventoryTransferDialog`, `InventoryInstantiateDialog`, `InventoryFolderPickerDialog`, `inventory-image-viewer`. Warnings for Detach, an archetype in use (*Detach all and delete*, blocked by name for archived holders) and a cap breach.
- Entry points: the left rail's Inventory button (a tab in the workspace, the chat-scoped dialog from a Salon chat), an Inventory button on each Salon participant card beside the wardrobe's, and the Prospero project card. `InventoryDialogProvider` mounts beside the wardrobe's in `app-layout.tsx`.
- Shared browser pieces lifted from the wardrobe into `components/item-browser/` (`ItemFolderRow`, `ItemFolderBar`, `NewFolderInput`, `ItemSelectBar`, `ItemTierRow`, `ItemFolderPickerDialog`); `WardrobeBrowser` and `WardrobeFolderPickerDialog` now use them with unchanged markup. No new `qt-*` classes (existing badge and card classes cover the chips and glyph tile).
- Query keys `queryKeys.inventory.*`; the `chats` realtime topic now refetches `inventory.equipped(chatId)`. `?action=inventory` also returns the chat's `projectId`. New collection action `?action=duplicate`. `SaveImageDialog` gains an `inventory` door.
- Tests: `components/inventory/inventory-ui.test.tsx`, `topic-map.test.ts`.
- Backup and restore: a new-account restore re-keys each chat's `equippedInventory` to the remapped character ids and keeps the object ids (they live in the files and travel verbatim, as do `parentId` and kit `itemIds`); picture `files` rows keep their `linkedTo` / `tags` link to the object; `planInventoryImagePointerFixes` repoints each object's `imageFileId` at its picture's new file id after the vaults land (step 22f-quater, one batch per mount, tombstoned vaults skipped).
- Tests: `__tests__/unit/lib/backup/inventory-backup.test.ts` (archetype, instance, kit and a carrying chat round-trip through the remap).
- Docs: new `help/inventory.md` (`url: /salon`) and `help/project-inventory.md` (`url: /prospero/:id`); cross-links from the wardrobe, project wardrobe, projects and Pascal's Workbench pages; README and FEATURES.md mention the Inventory; CLAUDE.md glossary, `pascal` sender duties and a chokepoint bullet; the spec moved to `features/complete/inventory.md` with an As-built section; ROADMAP row checked.

#### Fix: restore and import keep chat outfits (bug 252)

- New `lib/chat/character-keyed-fields.ts`: `remapCharacterKeyedChatFields` re-keys every chat column keyed by character id (`equippedOutfit`, `characterAvatars`, `courierCheckpoints`, `pendingOutfitNotifications`) and moves the ids inside them: outfit slot item ids through the wardrobe item remap, outfit-avatar `imageId` through the file remap, Courier `lastResolvedMessageId` through the message remap. Outfits come back as full five-slot bags, matching the outfit-history remap. A column stored as a JSON string is parsed; an unreadable one is left alone and logged at `warn`.
- New-account restore (`remapBackupData`) and `.qtap` import (`reconcileRelationships`, which now takes the imported wardrobe item map) both call it. Restore drops an entry for a character the backup does not carry instead of minting an id for it. Before this, those columns kept the old character ids, so no character was wearing anything in a restored chat, outfit avatars were gone, and Courier checkpoints were lost.
- Tests: `__tests__/unit/lib/chat/character-keyed-fields.test.ts`, `__tests__/unit/lib/backup/uuid-remapper.test.ts`, `__tests__/unit/lib/import/quilltap-import/reconcile-character-keyed-fields.test.ts`.

#### Docs: Inventory design specs

- New `docs/developer/features/inventory.md`: the design of record for the Inventory (per-tier `Inventory/` JSON objects with archetypes, instances, kits, two descriptions and per-chat equipped state). Pascal the Croupier owns it. Decisions settled; nothing built yet. Roadmap row added.
- New `docs/developer/features/inventory-tools-and-pascal.md`: the follow-up design for the `inventory_*` tool family (gated by a new `canManageInventory` flag), the `inventory` / `inventoryCount` `when` and gate subjects, `{{inventory.*}}` placeholders, the `$inventory` operand and the `inventory` effect, plus the Workbench and Proving Bench changes. Depends on the Inventory spec; nothing built yet.

#### Feature: wardrobe pictures in the Aurora gallery

- The character gallery tab has a third, collapsible section, **Wardrobe Pictures**, below Avatar Rolls: every GENERATED image of every wardrobe item in the character's wearable pool (own vault, group stores, Quilltap General; no project tier, since there is no chat). Archived items included. Each tile carries a caption overlay with the item title and its tier ("Own wardrobe", "Group · X", "Shared · Quilltap General"). Read-only: download on hover, detail modal on click.
- New `GET /api/v1/characters/[id]/wardrobe-images`, backed by `listWardrobeGalleryImages` (`lib/wardrobe/gallery-images.ts`), which loads the pool through `loadWearablePool` and reads the items' files in one `FilesRepository.findByLinkedToAny` lookup (new). Archived characters return an empty list. Query key `characters.wardrobeImages(id)`.
- `GalleryGrid` / `GalleryImage`: `onSetAvatar` and `onDeleteImage` are optional (buttons hidden when omitted); new `captionFor` / `caption` prop renders the overlay and moves hover actions to the top corner. New `qt-gallery-caption`, `qt-gallery-caption-title`, `qt-gallery-caption-detail` classes, mirrored into theme-storybook (1.0.74).
- Tests: `lib/wardrobe/__tests__/gallery-images.test.ts`. Docs: `help/character-gallery.md`, `API.md`.

#### Feature: wardrobe outfit history

- New table `chat_wardrobe_history`: per (chat, character) a numbered timeline of outfits from 0 (what they arrived in), with an `isCurrent` cursor. Two unique indexes keep indices unique per timeline and allow one current row. DDL lives only in `lib/database/backends/sqlite/chat-wardrobe-history-ddl.ts`; types in `lib/schemas/chat-wardrobe-history.types.ts`.
- New `ChatWardrobeHistoryRepository` (`repos.wardrobeHistory`). `settle(chatId, characterId, intent)` is the only runtime writer: an `append` intent reads the chat's live slots and adds entry `max + 1` unless they hash equal to the current entry; a `cursor` intent moves the cursor without appending. A first touch with no rows records the arrival outfit as 0, or, for a seat that predates the history, an empty seeded 0 before the change. `settle` never throws. `upsertRows` is for restore and import; `deleteByCharacter` runs from character delete.
- `wardrobeHistory.settle` is a buffered write in the job child (`METHOD_OVERRIDES`), replayed in the parent after the turn's `commitEquippedOutfit`.
- Migrations `add-chat-wardrobe-history-table-v1` (the table) and `seed-chat-wardrobe-history-v1` (one current entry 0 per character in each chat's `equippedOutfit`, dated by the chat's `updatedAt`).
- Tests: `chat-wardrobe-history.repository.test.ts`, `migrations/chat-wardrobe-history.test.ts`, `outfit-history-fence.test.ts`, `child-proxy-wardrobe-wear.test.ts`, `cascade-delete.test.ts`.
- Recording: `OutfitChangeContext` gains a required `provenance` (`operator`, `character` with the calling character, `pascal` with the rolling character) and an optional `historyIntent` (rollback's cursor move). `notifyWardrobeChanged` settles the history beside each announcement: at once outside a model turn, or into the turn's new `pendingWardrobeHistory` map (last intent per character wins), drained with the announcement set by `flushPendingWardrobeAnnouncements`. So one tool call, dialog Done, Pascal run or model turn records one entry.
- New `lib/wardrobe/turn-containers.ts`: `newWardrobeTurnContainers()` creates the announcement set and history map together; `turnContainersOf()` threads them. `createToolContext` and both Brahma surfaces use the factory; a grep-test forbids a hand-made set. `WardrobeToolContext` is now `OutfitChangeContext` minus `historyIntent`.
- `applyOutfitSelections` settles each character after a successful commit with its `chat-start` / `participant-added` / `merge` source, so arrivals record entry 0 (or `max + 1` for a returning seat).
- New `rollbackWardrobe` (`lib/wardrobe/history/rollback.ts`), the one rollback: resolves the target (default: one before the cursor; refuses `no_history`, `at_first`, `out_of_range`, `already_current`), leaves off items that are archived or gone unless an archived one is already worn in that slot, commits once through `commitEquippedOutfit` with no bundles, then fires `notifyWardrobeChanged` with a cursor intent so Aurora announces and the history cursor moves without appending.
- New tools `wardrobe_rollback` (optional `index`) and `wardrobe_history` (optional `limit`, default 20, max 100; the current entry is kept when it falls before the window). Both are gated by `canDressThemselves` and registered everywhere `wardrobe_take_off` is: tool index, plugin tool builder, executor name list and table (nine tools now), tools API, simple-JSON prompt and parser (aliases `rollback_outfit`, `undo_outfit`, `outfit_history`), legacy text-block prompt and parser (`[[ROLLBACK_OUTFIT]]`, `[[OUTFIT_HISTORY]]`), pseudo-tool and streaming options, and the Salon tool bubble ("Returned to outfit N."). Brahma and the Scenario Builder set both off. Shared rendering in `lib/wardrobe/history/describe-entry.ts`.
- Tests: `lib/wardrobe/__tests__/rollback.test.ts`, `wardrobe-history-rollback-handlers.test.ts`, `wardrobe-tool-table.test.ts`, tool-definition snapshots.
- API: `GET /api/v1/chats/[id]?action=wardrobe-history&characterId=…` (entries with resolved slots, stale ids marked `archived` / `missing`, a `changedBy` label) and `POST ?action=wardrobe-rollback` (`{ characterId, index }`; an operator change through `rollbackWardrobe`; refusals are 400). Documented in `API.md`.
- Query keys `wardrobe.histories(chatId)` / `wardrobe.history(chatId, characterId)`; the `chats` realtime topic now refetches `wardrobe.histories(id)`, so no polling.
- Wardrobe dialog: a **History** tab beside Live outfit and Outfit Builder (chat only; `components/wardrobe/outfit-history-tab.tsx`). Newest first, with index, relative time, who changed it, a summary and per-slot badges (archived or gone items shown with a secondary badge); the current entry is marked "Wearing now". **Wear again** posts the rollback and toasts the result, naming any garments left off; the button's tooltip warns ahead of time. If the Live tab holds staged edits for that character, the operator confirms, the staging is discarded first, and the Live tab re-seeds after the refetch, so Done cannot flush it over the rollback. `useStagedLiveOutfits` gains `isDirty` and `discard`.
- Tests: `wardrobe-history.test.ts` (route), `outfit-history-tab.test.tsx`, `use-staged-live-outfits-discard.test.tsx`, `outfit.test.ts` (operator provenance).
- Export: chat exports stream each chat's history as `wardrobe_history` records (count `wardrobeHistory`, `data.wardrobeHistory`; `QtapWardrobeHistoryRecord`; `WardrobeHistory` in `qtap-export.schema.json`). Import (`lib/import/quilltap-import/import-wardrobe-history.ts`, step 7f) mints new ids, remaps `chatId`, `characterId`, `actorCharacterId` and slot item ids that imported with new ids, keeps indices, cursor and dates, and never merges into a timeline already live on the instance. An older bundle's chats seed entry 0 on the first change.
- Backup: `data/wardrobe-history.json` (whole table, manifest count `wardrobeHistory`); restore writes it back through `upsertRows` after the chats (step 22n-ter), with the same id and item remaps as the wear ledger in new-account mode. Replace mode clears `chat_wardrobe_history` first.
- Tests: `export/wardrobe-history-roundtrip.test.ts` (five-entry timeline, cursor at 2), `backup/wardrobe-wear-backup.test.ts`, `backup/uuid-remapper.test.ts`.
- The History tab's and `wardrobe_history`'s one-line summary is plain text now (`describeOutfit`'s Markdown list flattened); it showed raw `**` and `- ` in the dialog. Test: `lib/wardrobe/history/__tests__/describe-entry.test.ts`.
- Docs: `help/wardrobe.md` gains "Looking Back --- the Outfit Record" and lists the two tools (nine `wardrobe_*` tools); `BACKGROUND_JOBS_CHILD.md` notes the `settle` write override; CLAUDE.md gains a chokepoint bullet. The spec moved to `docs/developer/features/complete/wardrobe-outfit-history.md` with an As-built section; ROADMAP ticked.
- Outfit history records who dressed the character. Operator changes (`?action=equip`, `?action=wardrobe-rollback`) store the user's current Speaking As character (impersonation included) in `actorCharacterId`, via the new `operatorWardrobeProvenance` (`lib/wardrobe/history/operator-provenance.ts`). Custom-tool changes store the tool's name in a new nullable column `actorToolName` (written only for `source = 'pascal'`). Migration `add-chat-wardrobe-history-tool-name-v1` adds the column; the seed migration now depends on it. `changedByLabel` reads "the operator, as Bertie" and "Pascal's dress_for_dinner (rolled by Jeeves)"; the history GET returns `actorToolName`. Export schema, DDL.md, help and the spec updated. Tests: repository, migration, `describe-entry`, `outfit.test.ts`, `pascal/wardrobe-effects.test.ts`.
- Verified live: both migrations on a copy of V4test seeded 32 current entry-0 rows for 32 (chat, character) pairs; on V4test a `wardrobe_wear` call appended entry 1, `wardrobe_history` listed it, `wardrobe_rollback` returned to 0 with Aurora announcing, and the History tab's Wear again moved the cursor back to 1.

#### Spec: wardrobe outfit history and rollback

- New design doc `docs/developer/features/wardrobe-outfit-history.md`: a per-character, per-chat record of every outfit change (one entry per Aurora announcement), `wardrobe_rollback` and `wardrobe_history` tools, a cursor that moves back and forward without renumbering, and a History tab with "Wear again" in the Wardrobe dialog. Spec only; no code yet. Indexed in `ROADMAP.md` and `update-documentation.md`.

#### Feature: `{{character}}` placeholder and character-announced custom tools

- New `{{character}}` placeholder: the rolling character's name. It works in outcome messages, the chip label, the consult prompt, effect expressions and wardrobe item references. A run with no character leaves it as written. `classifyPlaceholder` gains a `character` kind; `executeCustomTool` takes `character` in its overrides. `runCustomTool` takes an optional `characterName` (the trigger runner supplies it) and otherwise reads it with `characters.findByIdRaw`. The proving bench renders it when a character is seated.
- New custom-tool field `announceAsCharacter` (boolean, default false). When true and the run has a rolling character, `postPascalResult` sets `customAnnouncer: { kind: 'character', characterId }` on the outcome message. The message keeps `systemSender: 'pascal'` and `pascalMeta`. The Salon, the LLM context's speaker tag, the Courier transcript and the Markdown export already honor `customAnnouncer`. A run with no character is still announced by Pascal.
- Salon: the Staff bar and collapsed chip name a `customAnnouncer` in place of the Staff member (`getAnnouncementSenderName` in `system-message-labels.ts`, fed a character-id name map threaded from `SalonView` as `announcerNames`). Without it a character-announced outcome showed the character's avatar under a "Pascal" bar.
- Workbench: "The character announces it" checkbox in the builder; "Character name" in the outcome message's Insert value menu; the run dialog's reference panel lists `{{character}}`; the tool vocabulary reports it.
- JSON Schema (`public/schemas/qtap-custom-tool.schema.json`) documents both. Help: `help/custom-tools.md`, `help/pascals-workbench.md`.
- Tests: `custom-tools-execution.test.ts`, `run-service.test.ts`, `tool-vocabulary.test.ts`, `tool-draft.test.ts`, `services/pascal/writer.test.ts`, `system-message-labels.test.ts`.

#### Feature: wardrobe picker in Pascal's Workbench

- A *Change the outfit* side effect's items now have a **Choose…** picker (`components/wardrobe/wardrobe-reference-picker.tsx`): outfits and garments by slot, with thumbnail, slot badges, origin chip, a reach note (`wardrobeReachLabel` in `lib/wardrobe/wardrobe-container.ts`), search, a slot filter and an archived filter (on by default for `take_off`, off for `wear`). It fills the reference by title, or by id on request.
- A filled reference renders as a chip with the same particulars and a title/id toggle. A templated reference keeps its text box ("chosen at run time"). A reference the vantage cannot find shows an advisory, not a draft error. With `add_to_slot` or a slot-restricted `take_off`, slots none of the chosen items cover are marked "(not covered)", with a one-line advisory per mismatching item.
- The Workbench browses from a `WardrobeVantage` (`lib/pascal/tool-draft.ts`): a character or a shared wardrobe, defaulted from the file's store by `defaultWardrobeVantage`, chosen with `WardrobeVantageSelect`, shared with the proving bench's *Pick a character* mode. Editor state only; never serialized. Reads go through `useWardrobeVantageItems` over the existing wardrobe hooks; no new route or query key.
- New `lib/wardrobe/wearable-ref.ts` holds the reference lookup rule (`resolveWearableRef`, `matchWearableTitle`, `isTemplatedWearableRef`). `WearablePool.findByTitle` now delegates to `matchWearableTitle`, so the server and the Workbench resolve titles the same way.
- `POST /api/v1/custom-tools?action=preview` returns `wardrobeResolution` when the fact sheet names a character: per wardrobe gesture, each item found (id, title, types, origin, image) or skipped with `resolveWearable`'s reason. A read through `loadWearablePool` / `findInPool` / `resolveWearable` (`lib/pascal/bench-wardrobe.ts`); nothing is worn. The bench's dry-run line now says "would apply" or "would skip" per item when a character is seated.
- Tests: `wearable-ref.test.ts`, `wearable-ref-delegation.test.ts`, `wardrobe-vantage.test.ts`, `wardrobe-container.test.ts` (reach label), `route-preview-wardrobe.test.ts`, `wardrobe-reference-picker.test.tsx`. Help: `help/pascals-workbench.md`, `help/custom-tools.md`, `help/wardrobe.md`.

#### Fix: a composer typeahead menu could be left open at the top-left (bug 250)

- Undo that brought back a `@`, `:` or `/` trigger, followed at once by clearing the composer, could leave the menu rendered at the window's top-left until the next keystroke. Lexical 0.52's `LexicalTypeaheadMenuPlugin` opens its menu in a React transition, and its `closeTypeahead` skips the close while the captured resolution is still null, so a clear that lands before the open commits is lost.
- New `GuardedTypeaheadMenuPlugin` (`components/chat/lexical/typeahead/GuardedTypeaheadMenuPlugin.tsx`) wraps the plugin. After each open commits it re-runs the consumer's `triggerFn` against the live editor and, when the trigger is gone, calls `onClose` and remounts the plugin. `MentionTypeaheadPlugin`, `CharTypeaheadPlugin` and `SlashCommandPlugin` now render through it.
- New test in `__tests__/unit/components/chat/lexical/plugins/MentionTypeaheadPlugin.test.tsx` reproduces the race by seeding and clearing inside one `act()`.

#### Fix: a `when` phrase naming "constructor" as its month failed the extraction job (bug 247)

- `MONTH_NAMES`, `WORD_NUMBERS` and `UNIT_DAYS` in `lib/memory/time/clock.ts` are now read through `lookupWord`, which answers own keys only. `constructor 5` and similar phrases resolve to no event time instead of throwing `RangeError: Invalid time value`.
- `resolveEpisodicAnchors` (`lib/memory/time/anchors.ts`) now catches a parser error and keeps the fallback `occurredAt`, so one bad `when` costs that draft its event time and never fails the job.
- New test rows in `lib/memory/time/__tests__/rule-table.test.ts` and `anchors.test.ts`. The v5 harness pin `PROTOTYPE_KEY_MONTH_THROWS` can be retired.

#### Fix: Enter on a code block's blank trailing line sent the message (bug 251)

- In the Salon composer, Shift+Enter then Enter at the end of a code block was meant to leave the block. In chat mode it sent the message; in composition mode it added another line. After Shift+Enter, Lexical leaves the caret as an element point on the `CodeNode`, and `KeyboardPlugin`'s check only looked for a caret inside the block's last child. Present on Lexical 0.43 as well.
- New `$codeBlockToEscape` (`components/chat/lexical/plugins/KeyboardPlugin.tsx`) accepts both caret shapes. The exit now removes only the trailing blank line instead of rebuilding the block as one highlight node.
- New test `__tests__/unit/components/chat/lexical/plugins/KeyboardPlugin.test.tsx` (real editor; the plugin had none). Help: code-block paragraph in `help/chats.md`. Filed and fixed as bug 251.

#### Chore: Lexical 0.52

- `lexical` and the eight `@lexical/*` packages moved from 0.43.0 to 0.52.0 in lockstep; one copy installed. This ends the 0.43 pin.
- `TABLE_TRANSFORMER` (`components/chat/lexical/transformers/table-transformer.ts`) now has a bare, non-optional `regExpEnd`, which keeps it out of `@lexical/markdown`'s live shortcut runner. Tables are still built on import and paste through `handleImportAfterStartMatch`; typing a `|…|` line stays a paragraph. New test `__tests__/unit/components/chat/lexical/transformers/table-transformer.test.tsx` covers both paths.
- Lexical is ESM-only from 0.51. `jest.config.ts` now exempts `lexical`, `@lexical/*` and `@preact/signals-core` from the transform ignore list, including in the node_modules pattern `next/jest` prepends. `next.config.js` is unchanged.
- Type fixes for 0.52's stricter command typing: `KEY_DOWN_COMMAND` handlers in `CharTypeaheadPlugin` and `MentionTypeaheadPlugin` take a non-null `KeyboardEvent`; `ImagePastePlugin` accepts the full `PasteCommandType` and reads `clipboardData` only when present.
- `list-indentation.ts` stays. The 0.52 importer resolves nesting by column, but export still writes four-space indents, so the document's own indent unit still has to be restored on export.
- Known issue, filed as bug 250 (`docs/developer/bugs/bug-250-typeahead-menu-orphaned.md`): a composer typeahead menu reopened by undo and then cleared immediately stays open at the top-left until the next keystroke. Upstream `LexicalTypeaheadMenuPlugin` race, new in 0.52.
- Spec moved to `docs/developer/features/complete/lexical-0.52-upgrade.md` with an As-built section.

#### Chore: dependency safe batch

- In-range updates: `next` / `eslint-config-next` 16.4.2, `react` / `react-dom` 19.3.1, `@tanstack/react-query` / `-devtools` / `eslint-plugin-query` 5.104.3, `@tanstack/react-virtual` 3.14.20, `@playwright/test` 1.64.1, `@testing-library/user-event` 14.6.8, `openai` 7.34.0, `zod` 4.6.7, `postcss` 8.5.30, `react-syntax-highlighter` 16.1.2, `@types/node` 24.19.2.
- Range bumps: `katex` ^0.19.0, `@types/better-sqlite3` ^9.6.0, `@types/yauzl` ^3.4.0, `@testing-library/jest-dom` ^7.0.1, `dotenv` ^18.0.8. The rendered KaTeX HTML still comes from the 0.16 copy nested under `rehype-katex`; only the CSS and symbol table moved to 0.19.
- Removed the unused `@vitest/mocker` dev dependency and its `knip.json` ignore.
- Rebuilt the eight plugins that bundle the `openai` SDK and bumped their patch versions: anthropic 1.0.62, curl 1.0.31, default-system-prompts 1.1.26, google 1.1.56, mcp 1.1.44, ollama 1.0.53, openrouter 1.0.67, search-serper 1.0.26.
- Held (reasons in `docs/developer/features/complete/dependency-upgrade-safe-batch.md`): TypeScript 7, ESLint 10, `@types/node` 26, `pdfjs-dist` 6, `jest-fetch-mock` 4, `better-sqlite3-multiple-ciphers` 13, and Lexical 0.52 (own spec).

#### Docs: dependency upgrade specs

- Added `docs/developer/features/dependency-upgrade-safe-batch.md` (in-range updates, KaTeX 0.19, `@types/*` bumps, `@vitest/mocker` removal, and the recorded holds on TypeScript 7, ESLint 10, `pdfjs-dist` 6 and `better-sqlite3-multiple-ciphers` 13) and `docs/developer/features/lexical-0.52-upgrade.md` (lockstep bump, table-transformer `regExpEnd` fix, Jest ESM exemption, behaviour-change checklist, manual smoke test). No code changes.

#### Feature: slash commands in the Salon composer

- Typing `/` at the start of a word in the Salon composer opens a command menu: composer actions (`/attach`, `/library`, `/image`, `/announce`, `/mail`, `/inform`, `/tool`, `/pascal`, `/roll`, `/d6`, `/d20`, `/coin`, `/bottle`), every available user-invocable built-in tool under its id, and every Pascal custom tool in the chat under its name. Unavailable built-ins are left out. Matching is exact, then command prefix, then word prefix of the command, label or keywords (`_` and `-` split words); never mid-word.
- A tool that declares no parameters runs at once (public, or the custom tool's default visibility) with a toast; one with any parameter opens its existing dialog on its form. Picking a command removes the typed `/query` as one undo step. `/d6` and friends produce the same pending-result chip as the dice button.
- The trigger uses `findTrigger`'s opener rule plus a letter-first query, so `and/or`, `10/15`, `http://`, paths and code never open it. No arguments; a space closes the menu. Not mounted in Document Mode.
- New pure tier `lib/slash-commands/` (trigger, ranking, registry), under the same ESLint import restriction as `lib/char-insert/`. Adapter `SlashCommandPlugin`; immediate runs in `useSlashCommandRunner`; tool and custom-tool lists fetched only while the menu is open (`queryKeys.tools.byChat` added).
- `RunToolModal` and `CustomToolRunDialog` take an `initialTool` pre-selection (re-applied per nonce). `CustomToolRunDialog` moved from `CustomToolsButton` into `ChatModals` so the gutter wand and the slash menu share one instance; `CustomToolsButton` is now a plain button. `useModalState.openRunTool(toolId?)` and new `openCustomTool(initial?)`.
- The dice button's request moved to `components/chat/rng-request.ts`, shared with the slash quick rolls.
- New chat setting `composerSlashCommands` (Settings → Chat → Slash Commands), default on; gutter buttons and the sidebar are not gated. Migration `add-composer-slash-commands-field-v1` adds the `chat_settings` column.
- Help: `chat-settings-composer.md` (new Slash Commands section; page URL now `section=composer-slash-commands`), `run-tool.md`, `custom-tools.md`, `rng-tool.md`. Spec moved to `docs/developer/features/complete/composer-slash-commands.md` with an As-built section; Phase 4 of `composer-typeahead.md` marked superseded.

#### Fix: one-character chat chained the character to the depth cap (bug 249)

- In a Salon chat with one LLM character and no persona seat, every operator message made the character reply about 20 times in a row, until the chain hit `maxChainDepth`. Since `83f4368a8` the turn selector returns a lone character unconditionally, and `shouldChainNext` treated that as a reason to continue; the all-LLM pause did not apply because the operator was present.
- `shouldChainNext` (`lib/services/chat-message/turn-orchestrator.service.ts`) now returns `user_turn` when the selector picks the only character, that character spoke last, and a human is present. Genuinely all-LLM chats and autonomous rooms keep the monologue; a queued or nudged turn still runs. The selector is unchanged.
- Filed and fixed as bug 249 (`docs/developer/bugs/fixed/bug-249-lone-character-chain-runaway.md`).

#### Feature: Pascal wardrobe effects

- A custom-tool effect may now be a wardrobe gesture instead of a write: `{ "wardrobe": { "action": "wear" | "take_off" | "clear_slot", "items"?, "mode"?, "slot"? } }`. An effect is either `target` + `value` or `wardrobe`, never both. Per-action rules are checked at load (`wardrobeGestureProblems` in `lib/pascal/custom-tool.types.ts`); the published JSON Schema checks shapes only and states the per-action rules in prose.
- Item references are templates (rendered with the outcome message's placeholders, then trimmed) resolved by id, then case-insensitive title, in the rolling character's wearable pool. Up to 8 items per gesture, 200 characters each. A gesture whose items all render empty is skipped.
- New applier `lib/pascal/wardrobe-effects.ts`: runs after the value writes commit, one gesture at a time through `wearItem` / `takeOffWearable` / `applyDisplacement` with source `'tool'`, then calls `notifyWardrobeChanged` once if anything changed. Unresolvable, archived (for wear) or slot-mismatched items are skipped per item; a run with no rolling character changes nothing. Each change is recorded in `pascalMeta.effects` with target `wardrobe.wear`, `wardrobe.take_off` or `wardrobe.clear_slot`; no schema or migration change.
- `applyCustomToolEffects` takes `userId` and an optional `pendingWardrobeAnnouncements`; `run_custom` passes the turn's set so a tool's wardrobe change and the model's own wardrobe calls produce one Aurora announcement.
- Fix: `wardrobe_take_off` `remove` on a composite outfit removed nothing, because worn composites are stored as their leaves. It now removes every equipped leaf of the composite (`takeOffWearable` in `lib/wardrobe/wear-ops.ts`), shared with the Pascal applier.
- `run_custom` description: the preamble mentions outfits, and the per-tool `Side effects:` line lists `wears …`, `takes off …`, `clears <slot>`. Tool vocabulary gains `wears`, `takesOff`, `clearsSlots`, shown in the run dialog's reference panel.
- Pascal's Workbench: each side-effect row has a Kind select (write a value / change the outfit) with action, items, mode and slot fields; draft round-trip, validation and parameter rename cover wardrobe items. The Proving Bench lists gestures as "would attempt".
- Help: `custom-tools.md` (new "Dressing and undressing" section), `wardrobe.md`, `pascals-workbench.md`. Specimen `CUSTOM_TOOL_SPEC.json` gains a `take_off` effect. Spec moved to `docs/developer/features/complete/pascal-wardrobe-effects.md`.

#### Feature: Pascal trigger phrases

- Custom tools may declare `triggers`: up to 8 phrases (3–80 characters, no leading/trailing whitespace, unique ignoring case). Matching is a case-insensitive substring test with no word boundaries.
- New chat setting `customToolTriggers` (Settings → Chat → Automation, "Auto-Run Custom Tools on Trigger Phrases"), default off and ignored while `customTools` is off. Migration `add-custom-tool-triggers-field-v1` adds the `chat_settings` column.
- With the setting on, the operator's message (after it is saved) and each character's reply (after it is saved) are scanned; each matching tool runs once with every parameter at its default, from the speaker's perspective (their roster, fact sheet and groups; the bare operator rolls as nobody). Carina query lines are not scanned, nor are Pascal, Carina or staff messages, and swipes fire nothing. At most 4 tools fire per message; the rest are logged. A private (whisper-default) tool whispers to the speaker. Failures post the Prospero error bubble.
- `pascalMeta.invokedBy` gains `'trigger'`, with the phrase in `pascalMeta.triggerPhrase`. Export schema updated. An export containing a triggered run fails `pascalMeta` validation on builds older than 4.11 for that message.
- Extracted `runCustomTool` (`lib/pascal/run-service.ts`): the cascade → execute → effects → post sequence the `run_custom` handler and the manual run route each carried a copy of. Both entrances and the trigger runner now call it. A manual run request that omits `private` now follows the tool's `defaultVisibility` (the run dialog always sends it, so dialog runs are unchanged).
- Pascal's Workbench: a trigger-phrase chip input in the builder form, draft round-trip and validation, a warning when an outcome message, chip label or oracle prompt quotes one of the tool's own phrases, and a "✦ N phrases" badge in the library.
- Migration registry test now fails on a dependency cycle (including a migration that names itself in `dependsOn`), which would otherwise stop the server at boot.
- The Almanack and the `help_settings` tool report the new setting. Help: `custom-tools.md`, `chat-settings.md`, `rng-tool.md`, `pascals-workbench.md`. Spec moved to `docs/developer/features/complete/pascal-trigger-phrases.md`.

#### Docs: three Pascal and composer feature specs

- Added `docs/developer/features/pascal-wardrobe-effects.md`: a `wardrobe` side effect on custom tools (wear, take off, clear a slot) applied to the rolling character through the existing wardrobe chokepoints.
- Added `docs/developer/features/pascal-trigger-phrases.md`: a `triggers` key on custom tools plus an off-by-default chat setting that runs the tool when anyone in the chat says one of its phrases; includes the extraction of one shared run service out of the two existing entrances.
- Added `docs/developer/features/composer-slash-commands.md`: `/` commands in the Salon composer for composer actions, built-in tools, and Pascal's tools, running at once when there is nothing to fill in and opening the existing dialog otherwise. Supersedes Phase 4 of `composer-typeahead.md`.
- Catalogued all three in `.claude/commands/update-documentation.md`. No code changes.

#### Fix: styled hair slot read as contradicting the physical description

- `describeOutfit` now appends a note to the hair line (`HAIR_STYLING_PRECEDENCE_NOTE` in `lib/wardrobe/slot-guidance.ts`) saying the hairdo is the current styling and overrides the natural hair's texture and style in the physical description.
- Image prompts put the physical description ("perfectly straight hair") before the outfit list ("hair: Voluminous Emerald Curls") with nothing saying which applied. A kept photo's catalogue entry quotes that prompt, so a character reading it described the natural hair instead of the hairdo in the picture. The note reaches every caller of `describeOutfit`: avatar and Lantern prompts, wardrobe tool output, and Aurora announcements.

