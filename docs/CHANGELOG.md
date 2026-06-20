# Quilltap Changelog

## Recent Changes

### 4.8-dev

### 4.7.0

#### Fix: Cold boot on iCloud could hollow out characters (partial-materialization + lost vault links)

A cold boot of an instance kept in iCloud Drive could leave every character empty — no name, no description, nothing — even though no data was actually lost. Two bugs stacked:

1. **The cloud-materialization detector missed partially-downloaded files.** Phase -1 only flagged *fully*-evicted placeholders (`blocks === 0`). A database that iCloud had partly faulted in — header pages present (`blocks > 0`) but the tail still in the cloud — slipped through, so SQLCipher opened it and got `file is not a database` for ~20 seconds until the OS finished pulling it down. Fixed the detector to flag any file whose allocated bytes fall short of its size (`blocks * 512 < size`), which catches both the evicted and the partial case; a fully-resident file always reports `blocks * 512 >= size`, so healthy files are never touched. Applied to both the startup phase and the `npx quilltap file-verify` twin.

2. **The character cutover dropped the legacy columns without confirming the vault link stuck.** During that dataless window, `ensureCharacterVault` wrote each character's content to the vault (a separate, healthy database) but its write of `characterDocumentMountPointId` to the still-broken main database silently vanished — yet it logged success, and the cutover dropped the legacy content columns anyway because it only verified that the vault *files* existed, never that the row's link persisted. The result: content safe in the vault, but no character pointing at it. Hardened the path so this fails loud instead of silent: `ensureCharacterVault` now re-reads the row to confirm the link write stuck (throwing if not), and adopts an existing populated same-name vault instead of creating a duplicate (so a re-run can't orphan good content behind a fresh empty vault); the cutover now re-checks every character's link before dropping any column and aborts if any is missing.

Recovery for an instance already hit (links null, columns dropped, content intact in the vaults) is to relink each character to its vault — the content is recoverable, not lost.

#### Fix: Home dashboard briefly showed empty data right after startup

On the first page load after a heavy startup (e.g. a large migration backlog), the home dashboard could render "Welcome back, there!" with no chats, projects, or characters — then a reload showed everything. The home page is a server component whose data is fetched once at render time; the server reports `complete` and starts serving before the fire-and-forget post-startup backfills (character vault backfill chain and mount-index scan) finish, so that first render read empty or partial data. The startup gate released at `complete` and revealed that stale empty render, and the existing query-cache invalidation only refreshes client-fetched data, not server-rendered pages. Added a UI-only `backgroundSettled` signal (separate from `isReady`, so request handling is never delayed): instrumentation flips it once both backfills settle (bounded by a 5-minute cap). The startup progress screen now holds — showing "Settling everything into place" with live backfill/scan progress — until settled. Because a soft `router.refresh()` does not reliably re-run server components in this case, the layout instead does one full document reload on release (keeping the progress screen up across it so the empty render never flashes); the reloaded page sees the data settled and renders it. Steady-state boots are unaffected — the flag flips near-instantly, so they never hold and never reload.

#### Fix: Character vault cutover migration failed on a cold boot

On an instance that cold-booted with `cutover-characters-to-vault-v1` still pending — typically one restarted after a long dormancy — startup aborted and the migration refused to drop the legacy columns. Two separate ordering gaps were involved, both already fixed for the sibling `cutover-projects-to-store-v1` but never carried over to the character cutover:

1. `ensureCharacterVault failed: Mount index database not initialized`. The cutover's first database touch (`docMountPoints.create`) is a mount-index repository that reads its connection from a process-global singleton; that singleton is only populated by the app backend's `connect()` (which runs *after* migrations) or by the projects cutover (which runs *after* this one). In a warm dev process the singleton survives in `globalThis` from a prior boot, masking the gap, but on a genuinely cold boot nothing had opened it. Fixed by opening the mount-index connection explicitly at the top of the migration (mirroring the projects cutover) and aborting cleanly if it can't be opened.

2. `table doc_mount_file_links has no column named allowEmbed`. Writing each character's vault files inserts `doc_mount_file_links` rows that reference the `allowEmbed`/`allowCharacterRead`/`allowCharacterWrite` columns, but those are added by `add-doc-mount-file-policy-flags-v1`, which the topological sort placed *after* the cutover. Added it to the cutover's `dependsOn` so the columns always exist first.

No data was at risk — the cutover takes physical backups and drops no columns until every character verifies, so it aborted cleanly and re-runs on the next startup.

#### Feature: Pre-download cloud-evicted database files at startup

Instances stored in a cloud-synced folder (iCloud Drive, and later OneDrive / Google Drive File Stream) can have their database files evicted to dataless placeholders to reclaim disk. If a database is still a placeholder when SQLCipher opens it, the read fails with `file is not a database` or returns partially-materialized data — which has wedged whole startups (recreated users, every character vault read as broken, and a cascade of DEAD avatar/background image jobs). Added a new startup Phase -1 (`lib/startup/materialize-cloud-files.ts`) that runs before anything reads the data directory — even the `.dbkey` — and forces the top-level `data/` files to fully download first. It detects evicted files on macOS by their dataless signature (a real `size` with `blocks === 0`, mirroring the `SF_DATALESS` flag, with no subprocess), then streams each one to completion to fault it in. The download guard is per-chunk, not per-file: a timer that resets on every chunk, so a steadily-downloading multi-gigabyte database never trips it and only a genuinely stalled/offline fetch is abandoned (default 30s of no bytes; override with `QUILLTAP_CLOUD_MATERIALIZE_STALL_MS`, or skip the whole pass with `QUILLTAP_SKIP_CLOUD_MATERIALIZE=1`). Best-effort: it never throws and never blocks the boot indefinitely. Only top-level `data/` files are touched — the `backups/` subdirectory is left alone. Detection is the only platform-specific seam; the streaming read, stall timer, and progress reporting are shared, so adding Windows placeholder support later is a single new branch. Added a matching `npx quilltap file-verify` subcommand (the manual/diagnostic twin, with `--all`, `--stall-ms`, and `--json`) for running the same pass from the shell, since the CLI opens the encrypted databases directly. This is a mitigation, not a cure — a live database in a cloud-synced folder can be evicted again when idle; the sturdier fix is to keep `data/` on local storage or disable "Optimize Mac Storage".

#### Fix: Project store cutover migration ran before the policy-flag columns existed

On an instance where both the `cutover-projects-to-store-v1` and `add-doc-mount-file-policy-flags-v1` migrations were still pending, startup aborted with `table doc_mount_file_links has no column named allowEmbed`. The cutover writes each project's overlay files into its document store, inserting `doc_mount_file_links` rows that reference the `allowEmbed`/`allowCharacterRead`/`allowCharacterWrite` columns — but those columns are added by the policy-flags migration, and nothing ordered it first. The dependency-free topological sort placed the cutover ahead of the policy-flags migration, so the link inserts failed. Instances that had already run the policy-flags migration in an earlier dev build were unaffected; only those upgrading across both at once hit it. Added `add-doc-mount-file-policy-flags-v1` to the cutover's `dependsOn` so the columns (and their frontmatter-driven protection backfill) always exist before the cutover writes. No data was at risk — the cutover takes physical backups and drops no columns until every project verifies, so it aborted cleanly and re-runs on the next startup.

#### Chore: CLI documentation, completions, and help caught up with the full subcommand surface

Audited the `packages/quilltap` CLI and fixed drift between its actual dispatch table and everything that describes it. The `maintenance` subcommand was missing from all three shell-completion templates (bash, zsh, fish) and from `quilltap --help`; the `docs` verbs `rmdir`/`mvdir` were missing from all three templates and `link` from bash. The top-level `quilltap --help` listed only 6 of the 10 subcommands (omitting `completion`, `logs`, `migrations`, `maintenance`). `docs/developer/CLI.md` gained sections for `maintenance`, `memory-diff`, and `themes` (and completed the `docs` write-verb list); `packages/quilltap/README.md` gained sections for named instances, `memory-diff`, `logs`, and `migrations`. Added `packages/quilltap/lib/__tests__/completion-coverage.test.js`, which parses the `SUBCOMMANDS` set from `bin/quilltap.js` and fails if any subcommand is absent from a completion template or from `--help`, so this can't silently drift again. Docs/tooling only; no runtime or product change.

#### Feature: Pre-theme bootstrap screens share the About background art

The screens that render before the user's theme has loaded now use the same `public/images/about.webp` backdrop as the About page, so the first thing a visitor sees is on-brand instead of a flat slab. This covers the setup and unlock (passphrase) pages, the version-mismatch and database-in-use (instance lock) gates, and the startup progress screen. Placement matches the About page exactly — `right center / cover`, so vertical crops stay centered and horizontal crops anchor right (the crop comes off the left). Because the art is dark and these screens have no theme background to sit over, the image is kept near full strength with only a light translucent scrim laid over it (rather than the About page's 0.35 dim), so the artwork stays visible while the centered cards remain legible. There is deliberately no theme-gating and no intro animation here — these screens have no theme to wait for. A single `--qt-pretheme-backdrop` variable, declared at `:root` so it resolves at first paint before `data-theme` is set, is the source of truth for the image, placement, and scrim; the auth-page layout and the gate/startup components all reference it via the shared `.qt-pretheme-bg` class. CSS plus three className changes only; no schema, migration, or export change.

#### Chore: Lint and test configs ignore Claude Code worktrees

ESLint (`eslint.config.mjs`) and Jest (`jest.config.ts`) now ignore everything under `.claude/`. Agent worktrees are full repo checkouts nested there; their copies of `plugins/dist`/`pdf.worker.mjs` slipped past the root-anchored ESLint ignores (spurious lint errors), and their `packages/*`/`plugins/*` registered as duplicate Haste modules in Jest ("looked up in the Haste module map ... several different files"), failing unrelated suites. Added `.claude/**` to the ESLint ignores and `/\.claude/` to Jest's `testPathIgnorePatterns` and `modulePathIgnorePatterns`. Tooling only; no runtime or product change.

#### Fix: Back up and restore character groups

Groups were missing entirely from the backup/restore system. A backup followed by a restore silently dropped every group: the group rows, their character membership (`group_character_members`), and their links to additional document stores (`group_doc_mount_links`). The group's official document store content (description, instructions, scenarios, knowledge) survived as orphaned mount data with nothing pointing at it.

The backup now collects groups exactly as it already collects projects — the two are structurally parallel (a slim DB row plus an official document store). Added: `groups.json`, `group-doc-mount-links.json`, and `group-character-members.json` to the archive; manifest counts and restore-summary counts for all three; restore steps (groups created after projects via the store-backed repository, which provisions a fresh official store from the hydrated fields; the two join tables restored after `project_doc_mount_links`); new-account UUID remapping so membership and store links follow the remapped group/character/mount-point ids; and replace-mode deletion of groups plus truncation of the two join tables. Bumped the backup format to 4; older restorers skip the new files, and pre-4 backups restore unchanged (the new arrays default to empty).

API key values remain the only intentionally excluded user data (encrypted per-instance and not transferable).

#### Feature: About page background image with a staged intro

The About page now shows `public/images/about.webp` as a fixed background behind its content, the same across every theme (light and dark) at the standard dimmed story-background opacity. When the viewport forces the image to crop: vertical crops stay vertically centered, and horizontal crops anchor to the right edge so the crop comes off the left. The content layer holds until the active theme has finished loading, then plays a one-time intro — hidden for ~1s, fade in over ~0.5s, fade out over ~0.5s, fade back in over ~0.5s and stay — so it no longer animates against default styling and then visibly re-skins. Gating the intro on the theme being ready also removes the flash. Honors `prefers-reduced-motion` (content simply appears once the theme is ready, with no flashing). The shared `.qt-page-container` background layer gained a `--story-background-position` variable (default `top center`) so other story-background pages are unchanged. CSS and one client component only; no schema, migration, or export change.

#### Chore: remove leftover development debug logging

Removed seven happy-path debug log calls added while building the more recent 4.7 work (conversation-summary vault mirroring, vault conversation search, the Brahma Console one-shot/streaming paths, the relevant-conversations refresh whisper, and the `run_sql` tool). They only narrated successful normal operation — "wrote", "complete", "running", "answered", "executed", "posted" — and became log noise once the features worked. Kept all error/warn logging plus the debug logs that aid diagnosis: rejection/failure branches, "blocked"/"skipped"/"empty"/"unavailable" notes, and deletion/state-change events. Also dropped a now-unused timing variable in the `run_sql` handler. No behavior change; `tsc` and `eslint` stay green.

#### Chore: Dependency updates

Ran `npm update -S` across the root project, all packages, and all distributed plugins. Notable bumps: Next.js 16.2.7→16.2.9 (and `eslint-config-next`), `better-sqlite3-multiple-ciphers` 12.10.0→12.11.1, `openai` 6.42.0→6.44.0, `esbuild` 0.28.0→0.28.1, `storybook`/`@storybook/react` 10.4.2→10.4.6, `@playwright/test` 1.60.0→1.61.0, plus assorted `@types/*` and tooling patches. All five packages and all fourteen plugins had real dependency changes, so each had its version bumped; the plugins were rebuilt. No source changes.

#### Feature: Per-document Scriptorium policy flags (`embed`, `character_read`, `character_write`)

A mounted markdown document may now carry three frontmatter flags that control how Quilltap treats it. Each defaults to `true` and only takes effect when the frontmatter says `false`. Values may be quoted (`embed: "false"`) or bare (`embed: false`); coercion is case-insensitive and treats `false`/`no`/`0`/`off` as false.

- `embed: false` keeps the document out of the embedding pipeline and erases any embedding it already has (chunk text is kept; only the vectors are cleared).
- `character_read: false` hides the document from every LLM character: the `doc_read_*` tools report it as not-found, `doc_list_files`/`doc_grep` omit it, and it never surfaces in RAG retrieval. The "not found" message is identical to a genuinely missing file so a character can't probe for protected filenames.
- `character_write: false` blocks every character-initiated mutation: write, str-replace, insert, frontmatter/heading update, move, rename, delete, and copy-as-source. A folder delete/move that would touch a protected document fails for characters, naming the document.
- `character_read` is the master gate: when it is false the other two are forced false as well (a document characters can't read can be neither embedded/retrieved nor written), regardless of what `embed`/`character_write` say. When `character_read` is true, the other two stand on their own.
- The Librarian does not announce changes to a `character_read:false` document. The operator can still open, edit, rename, and delete one in Document Mode, but those actions post no chat announcement, so the hidden document's existence and contents stay out of the characters' view.
- The human operator (Document Mode, Brahma Console) is never restricted by these flags — they govern characters only.

The flags are stored on the `doc_mount_file_links` row (`allowEmbed` / `allowCharacterRead` / `allowCharacterWrite`, added by a migration that also backfills them from existing markdown frontmatter and de-embeds `embed:false` documents on upgrade) and re-derived on every reindex, so editing the frontmatter — by the operator or directly on disk — is the control surface.

#### Feature: The Librarian announces every character-initiated document change

Previously, when a character used a `doc_*` tool to write, edit, move, rename, copy, or create a file or folder, the change happened silently — only deletes, folder creates/deletes, and document opens posted a Librarian announcement. Now every change-effecting `doc_*` tool posts one, matching the Document-Mode experience you get when you edit a document yourself.

- **Creating a file** (`doc_write_file` on a new path) reports the new file's full contents; **editing** a file (`doc_write_file` over an existing file, `doc_str_replace`, `doc_insert_text`, `doc_update_frontmatter`, `doc_update_heading`) reports a unified diff. An edit that changes nothing posts no announcement.
- **Moving/renaming** (`doc_move_file`, `doc_move_folder`), **copying** (`doc_copy_file`), and **filing or deleting binary assets** (`doc_write_blob`, `doc_delete_blob`) each post an announcement naming the change.
- Every announcement is attributed to the calling character (or the user/operator), carries the document's clickable `qtap://` link, and — like all Librarian notes — has a neutral, persona-free body for characters who don't see Staff voicing.
- Large new-file contents and large diffs are capped in the announcement with a "[truncated …]" notice and a link to the full document, so a big change can't blow the model's context budget. The document itself is never truncated.
- New `systemKind` values (`created-by-*`, `edited-by-*`, `moved-by-*`, `copied-by-*`, `blob-written-by-*`) are labeled in the Salon's collapsed system-message bar and rated high-importance. No schema, migration, or export change.

#### Fix: Test suite self-heals a stale native-module ABI before running

Added a Jest `globalSetup` (`jest.global-setup.js`) that runs once before the suite and rebuilds the real SQLCipher binding if it was compiled against a different Node ABI than the one running. The real-binding DB suites (db-backup, graph-integrity, memories-commands, and the migration/content-hash/run-sql-handler suites) load the actual `better-sqlite3` addon rather than the mock, so after a Node upgrade they all failed with `NODE_MODULE_VERSION` until someone rebuilt by hand. The setup heals whichever copy is present — the root `better-sqlite3` alias and/or the `packages/quilltap` `better-sqlite3-multiple-ciphers` install, each with its correct rebuild target — using the same binary-symbol ABI check as the CLI. It's a no-op when the ABI already matches.

#### Fix: CLI and server self-heal a stale native-module ABI instead of erroring

After a Node.js upgrade, the cached SQLCipher binding (`better-sqlite3-multiple-ciphers`) is compiled against the old Node ABI and throws `NODE_MODULE_VERSION` on first load. The launcher already rebuilt native modules before starting the server, but the `db`, `docs`, `memories`, `migrations`, `maintenance`, and `memory-diff` subcommands loaded the binding directly and never reached that heal — so they failed with the raw ABI error.

- The ABI check now reads the compiled-for version straight from the `.node` binary (its `node_register_module_v<ABI>` symbol) and compares it to the running Node ABI — no `dlopen`, no reliance on matching an error-message string. Only a genuine mismatch (or a missing binary) triggers a rebuild.
- A lightweight heal (`ensureDatabaseNativeModule`) now runs at the CLI subcommand dispatch point, before any command loads the database, so every DB-touching subcommand self-heals the same way the server launch already did. It prints a brief "Rebuilding native modules…" notice rather than throwing, then continues normally.
- `sharp` and `node-pty` are N-API (ABI-stable) and can't hit this failure, so they're no longer treated as ABI-fragile; their checks remain only for the missing-binary / platform cases they actually have.

#### Docs: moved four more completed feature specs into `features/complete/`

Second pass over `docs/developer/features/` after more work shipped. Moved `brahma-console`, `commonplace-whisper-overhaul`, `qtap-uri`, and `backup-text-replacement-and-export-cleanup` into `features/complete/`, each verified against the CHANGELOG and code (migrations, named code paths, tests) rather than the doc header. The backup/export spec is the previously-ambiguous one: both halves are now done — `text_replacement_rules` round-trips through backup/restore with tests, and the dead legacy `.qtap` export builders were removed with a regression test guarding the import path (entry in `docs/CHANGELOG_V4.md`). Fixed one relative link broken by the move: `complete/carina.md` → `brahma-console.md` (same directory now). No code change.

#### Fix: Character avatars follow the character's pronouns

The avatar prompt builder now anchors the figure's apparent sex from the character's standard pronouns: `she/her` renders "a single woman," `he/him` renders "a single man," and anything else (`they`, neopronouns, or unset) stays neutral as before. Previously the avatar prompt named only the character and described their face and outfit, with no gender signal, so a gender-neutral physical description plus an outfit cue (e.g. a "men's" shirt) could make the image generator render the wrong sex — a woman wearing a man's shirt came out looking like a man.

The `he → male` / `she → female` derivation, which the story-background and manual-image-prompt builders already used, is now a single shared helper (`lib/characters/pronoun-gender.ts`) consumed by all three paths. No schema, migration, or export change.

#### Feature: Reach the Brahma Console from a Salon via Carina (`@Brahma`)

The Brahma Console is now reachable as a Carina answerer named "Brahma" from inside a Salon — through `@Brahma:` / `@Brahma?` markup and the `ask_carina` tool — so a console/SQL answer can be dropped straight into the scene, public or whispered.

- **Pseudocharacter, not a character.** Brahma has no `characters` row, no participant, and forms no memories; it never appears in any character list. A Brahma answer is posted as an ordinary `systemSender: 'carina'` message whose `carinaMeta.answererId` is a reserved sentinel UUID (`lib/services/carina/brahma-answerer.ts`), so it reuses Carina's memory suppression and reference-card rendering with no new `systemSender` value and no schema/migration/export change.
- **Isolated one-shot engine** (`lib/services/brahma-console/one-shot.service.ts`): runs the Brahma agent loop (SQL inspection, document stores, search-without-memories) against a `[system, question]`-only slate — never the Salon transcript — persisting nothing and emitting no SSE, then returns the answer text. The streaming console orchestrator (`processBrahmaResponse`) is unchanged.
- **Authorization.** Brahma is reachable only by the operator (markup they type), a user-controlled persona, or a character with `systemTransparency`. An unauthorized asker gets the same "no answerer by that name" result as if Brahma did not exist. A `systemTransparency` character is now offered the `ask_carina` tool even when no other answerer exists.
- **Precedence.** A real character named "Brahma" always wins; the Console only answers to the name when no character bears it.
- No memory recall is injected and no `CARINA_MEMORY_EXTRACTION` job is enqueued for Brahma answers. Requires a Brahma avatar at `public/images/avatars/brahma-avatar.webp`. Help docs (Carina, Brahma Console) and tests updated.

#### Fix: Help Chats and the Brahma Console are never moderated

The Concierge now leaves Help Chats (`chatType: 'help'`) and Brahma Console chats (`chatType: 'brahma'`) alone entirely — no classification, flagging, rerouting, or in-chat announcements, regardless of the global dangerous-content setting. Previously the scheduled danger scan and the post-turn trigger swept these utility chats like any roleplay chat, so Brahma Console sessions could be marked dangerous and receive Concierge warnings.

A single predicate `isModerationExemptChatType()` (in `lib/schemas/chat.types.ts`, kept separate from `isHelpLikeChatType` so moderation policy and titling policy can diverge) gates moderation at every entry point:
- `resolveDangerousContentSettings()` returns OFF (source `chat-type-exempt`) for these types — covering the per-message path and the post-turn trigger, which both pass the chat.
- The scheduled scan (`scheduled-danger-scan.ts`) never enqueues them.
- The classification handler (`chat-danger-classification.ts`) bails as a backstop, so any job enqueued before this rule never posts an announcement.

Moderation still applies to the Salon and autonomous rooms. No schema, migration, or export change. Existing Brahma/Help chats already marked dangerous keep their stale flag until cleared (the flag is inert on those surfaces). Help doc and tests updated.

#### Improvement: Concierge danger notice distinguishes a provider flag from a threshold crossing

A chat is marked dangerous when either the overall severity meets the threshold or the moderation/cheap-LLM assayer flags the content of its own accord (`isDangerous = flagged || score >= threshold`). OpenAI's moderation endpoint returns `flagged` against its own internal catalogue, independent of the configured threshold, so it commonly fires while every reported severity sits below the threshold. The in-chat notice previously read "registering 0.68 against the present threshold of 0.80" in that case, which implied a crossing that did not happen.

The notice now branches on whether the score actually met the threshold:

- **Threshold met** (`score >= threshold`): unchanged — "registering X against the present threshold of Y."
- **Flagged below threshold**: the matter was marked "by the direct verdict of" the assayer; the (sub-threshold) severities are still reported for context, with a note that it was the assayer's judgement, not the arithmetic, that drew the line. The opaque/neutral variant reads "Flagged directly by &lt;provider&gt;, below the numeric threshold … (not reached)."

Change is confined to the Concierge notice writer (`lib/services/concierge-notifications/writer.ts`); the writer infers the case from the existing `score`/`threshold` fields, so no classifier, settings, schema, migration, or export change. Help doc and tests updated.

#### Fix: Brahma Console no longer repeats the same query and burns its turn cap

The Console's agent loop could repeat a successful query over and over — getting the same result each time — until it exhausted its 25-turn cap and ended without answering. Root cause: the loop rebuilt the conversation for each turn without the model's tool-call context. Assistant turns that issued native tool calls were stored and replayed with empty content and no `tool_calls`, and tool results were replayed as `tool`-role messages bound to no call (and, on a later request, as raw stored JSON). With no record of what it had already done, a reasoning model re-derived the opening step every turn and re-ran the same query.

The fix threads tool turns the way the Salon already does, via a new shared helper (`lib/services/chat-message/tool-call-threading.ts`) used by both loops so they can't drift:

- Within a turn, the assistant message now carries its native `tool_calls` and each result is paired back by `toolCallId` (or framed as `[Tool Result: …]` text for providers without call IDs). The model can see it already issued a query.
- On a later request, the Console reloads history through the Salon's `buildConversationMessages`, so a prior turn's tool activity replays as readable `[Tool Result: …]` text (with the existing 3-turn elision) instead of orphaned `tool`-role JSON. Empty tool-turn assistant messages (kept for the tool-card UI) are dropped from the model context.
- The stuck-loop guard was tightened: it now folds whitespace/case before comparing call signatures, and additionally forces a finalize when consecutive tool iterations surface no result the model hasn't already seen — catching surface-different queries that return identical rows.

The Salon's `runNativeToolLoop` was refactored onto the same helper (behavior unchanged; covered by existing tests). No schema, migration, API, or export change.

#### Docs: correct the autonomous-room daily-token-budget default

The daily token budget for autonomous rooms ships off — `dailyTokenBudget` defaults to `null` (no cap until the user sets one). The help doc and the `AutonomousRoomSettingsSchema` JSDoc both described it as a "pilot: 1,000,000" default, which was never an enforced value. Updated `help/autonomous-rooms.md` and the schema comment in `lib/schemas/settings.types.ts` to state the real behavior. No code or schema change.

#### Improvement: Brahma Console surfaces real SQL errors and pushes schema inspection

Failed `run_sql` calls now show the actual database error (e.g. "no such column: …") in the Result panel instead of a generic "The query failed." Previously the error text was only visible after the transcript reloaded, because the streamed `toolResult` SSE event carried the (often null) result but not the error string; `processToolCalls` now includes the human-readable error on failure, and the console's live tool cards render it. The settled transcript already showed the real error; live and settled now match.

The `run_sql` system prompt was also strengthened to cut down on guessed-column failures: a new "Confirm the schema before you guess" section tells the model to list tables (`sqlite_master`) and confirm columns (`PRAGMA table_info(<table>)`) for any unfamiliar table before querying it, and to inspect the schema — not retry variations — after a `no such column`/`no such table` error. No schema, migration, or export change.

#### Fix: Brahma Console crash opening older chats

Opening an older Brahma Console conversation could crash with "Cannot read properties of undefined (reading 'toUpperCase')". The new transcript-render loop called `m.role.toUpperCase()` directly, but `getMessages` can return non-message events (and older chats predate some fields) whose `role` is undefined. The loop now coerces a missing `role`/`content` defensively so such events are simply skipped, as the prior filter did.

#### Feature: Brahma Console shows run_sql queries and results inline

When the Brahma Console runs a `run_sql` query, the transcript now surfaces it as a tool card with two collapsible panels: a **Query** panel showing the SQL as a syntax-highlighted, copyable code block (rendered through the shared `MessageContent`/Prism path), and a **Result** panel showing the returned rows as a scrollable table (column headers, NULLs dimmed, a row count, and a "truncated" note when the row cap was hit). Failed/rejected queries show the error text instead. Only `run_sql` tool calls are surfaced; the console's other tools (search, doc_*, web) remain silent intermediate turns as before.

The cards render both in the settled transcript — parsed from the persisted TOOL message (`parseBrahmaSqlToolMessage`, a React-free helper in `components/brahma-console/brahma-sql-tool-call.ts`) — and live during streaming: the orchestrator already emits `toolsDetected`/`toolResult` SSE events, which `useBrahmaConsoleStreaming` now accumulates into `streamingToolCalls` (matched by detection-batch base + index across agent turns) so each query and its rows appear as they land. The generic "Consulting the stacks…" indicator is suppressed while a `run_sql` card is on screen, since the card carries its own running/row-count state. No schema, migration, API, or export change — purely a display layer over data the console already persisted.

#### Feature: Brahma Console shows model reasoning ("thinking") live

The Brahma Console now displays a reasoning model's chain-of-thought in a collapsible "Thinking" panel, the same way the Salon does. The orchestrator forwards the provider's cumulative reasoning over the SSE stream (`encodeReasoningChunk`) as it arrives and persists it as `reasoningContent` on the assistant message, so the panel appears live (auto-expanded while streaming, collapsed once done) and survives a reload. Reasoning is accumulated across the agent loop's turns into one continuous chain. It is display-only: never fed back to a model, never stored as a memory. Non-reasoning models show no panel.

The shared `ThinkingBlock` component moved from `app/salon/[id]/components/` to `components/chat/` so both the Salon and the Console use one implementation. Plain-prose answers already streamed; the agent-mode `submit_final_response` summary still arrives as one block (matching the Salon). No schema, migration, or export change — `chat_messages.reasoningContent` already existed.

#### Feature: Brahma Console agentic tool-iteration limit raised to 25

The Brahma Console's agent loop now allows up to 25 tool iterations per turn (was 10). The help chat is unchanged at 10.

#### Feature: Brahma Console read-only SQL access (`run_sql`)

The Brahma Console gains a single new read-only SQL tool, `run_sql`, plus a system-prompt section teaching the model how and when to use it. The model can query any of the three Quilltap databases — main (`quilltap.db`), llm-logs (`quilltap-llm-logs.db`), and mount-index (`quilltap-mount-index.db`) — and read rows back as JSON, so it can answer questions about characters, memories, documents, conversations, model usage, and costs by translating them into queries.

Read-only is enforced at the tool layer by three independent guards: a single-statement + write-keyword pre-scan, the authoritative `better-sqlite3` `stmt.readonly` check (fail closed), and a `max_rows` cap (default 200, hard cap 1000). Writes and schema changes (INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/VACUUM, mutating PRAGMAs, multi-statement SQL, and CTEs wrapping a write) are rejected before they run. BLOB columns (embeddings, blob data) come back as a `<blob: N bytes>` placeholder, never inlined. Errors are returned as data so the model can self-correct.

The tool is offered only when the Brahma builder flag `sqlAccess` is true (Brahma Console only) and executed only when `operatorSurface` is true — two independent gates, so no character surface (Salon, Help Chat, autonomous rooms) can reach it. It reuses the server's already-open, decrypted database handles; it opens no new connection and never re-keys. The console's existing guarantees are unchanged: it still forms no persistent memories and its `search` tool still cannot use the `memories` source. `run_sql` can *read* the `memories` table for analytics (e.g. importance distribution), which is read-only inspection, not recall — it writes nothing and is not remembered. No schema change, migration, or export/backup change.

#### Fix: database-backed document writes now chunk (and become searchable) immediately

A text document written into a database-backed store (`writeDatabaseDocument`) recorded the content and link row but never chunked it. The on-write event only enqueued embedding for *existing* chunks, so a freshly written or overwritten document had no chunks to embed and stayed out of semantic search until a manual store rescan ran. This affected every managed-field and bridge write: character vault fields (identity/description/manifesto/personality), project description/instructions/state, image aesthetics, and the conversation summaries the Commonplace Book's relevant-conversation recall depends on.

`writeDatabaseDocument` now re-chunks the document inline (via `reindexSingleFile`, which reads the just-committed content from `doc_mount_documents` and rebuilds the link's chunks, so overwrites re-chunk too) before emitting the write event; the existing debounced embedding pass then embeds the new chunks. This runs only on the parent process — inside the forked job child the write is buffered and read-your-writes doesn't hold, so in-child `doc_write_file` writes in autonomous turns still defer chunking to the next rescan. The filesystem-scan path already chunked on write; this brings database stores in line. No more manual "rescan" needed for vault writes to become searchable.

#### Feature: Commonplace Book recall overhaul (Part B)

Builds on the per-character conversation-summary vault files (Part A) to make the recall whispers a character receives before a turn more relevant and more actionable. Five independent changes:

- **Concise clothing in the Current State block.** The scene-state tracker's cheap LLM now owns a single-sentence, salience-based clothing summary (≤200 characters, enforced in code), instead of a comma-joined rattle-off of every equipped item with its full prose description. The summary is cached in `sceneState` alongside a hash of the equipped outfit and reused until the wardrobe actually changes, so it stays stable turn to turn. The context manager's live override now fires only when the wardrobe changed mid-turn (hash mismatch) and emits a concise title-only line rather than the old verbose join. New `SceneStateCharacter.clothingHash` field (optional; existing scene states repopulate it on the next tracking run, so no migration is needed). New `lib/wardrobe/outfit-hash.ts`.

- **Recap's "Recent Conversations" becomes two vault-sourced lists.** The memory recap (posted at chat start and when a character joins) now offers a **Relevant Past Conversations** list (semantic search over the character's embedded vault summaries against the current moment) and a **Recent Conversations** list (recency-ordered), instead of a single most-recent-N block. Each entry prints the conversation UUID in backticks and tells the model it can pass that UUID to the existing `read_conversation` tool to pull the full transcript. Each list scales 3→10 entries over a 4K→32K context window; a conversation appearing in both lists is kept in the relevant list and dropped from the recent one. New `lib/memory/conversation-summary-search.ts` (the only exported service that semantically searches vault documents); the recent-conversations greeting block and its 5→20 ramp are unchanged.

- **Inter-character memories are now half importance, half relevance.** The per-turn "memories about the other characters present" block previously ranked only by importance and recency. The importance/recency half is halved (10→5 per character) and the freed half is filled with memories about that character that score highly for relevance to the current turn. `searchMemoriesSemantic` gained an optional `aboutCharacterId` filter; the two halves are deduped (a memory in both is kept once, in the relevance half) and interleaved. The inter-character token budget and the 70/30 compression split are unchanged — the formatter still trims the merged block to the same budget, so two sources can't double-count.

- **Fold-triggered relevance refresh.** Relevance drifts as a conversation advances, so on every summary fold the relevant-past-conversations search is re-run (only that list) and a refreshed Commonplace Book whisper is posted to each present character. The fold writes the fresh vault summary first, then runs the search, so it reads the fresh corpus. This whisper uses a new `relevant-conversations` kind that persists across turns (until the next fold replaces it) and is exempt from the per-turn consolidated-whisper sweep and the LLM-context strip, so the freshened list reaches both the salon and the model. New `lib/services/commonplace-notifications/relevant-conversations-refresh.ts`.

- **"Regenerate conversation summaries" button (Commonplace Book settings).** A new card under Settings → Memory re-mirrors every summarised chat into its participant characters' vaults — a backfill for the files the relevant-conversation recall depends on, and a repair after format changes. It posts to `/api/v1/system/conversation-summaries?action=regenerate`, which enqueues a background `REGENERATE_CONVERSATION_SUMMARIES` job that reuses the existing vault bridge; the card polls a GET status and shows the job in the "Sum" queue badge.

#### Feature: conversation summaries are mirrored into each character's vault

Whenever a conversation's rolling context summary is generated or refreshed, a copy is now written into every participant character's vault under a `Conversation Summaries/` folder (created on demand). This is Part A of improving the Commonplace Book retrieval system: because vault documents are chunked and embedded, past-conversation summaries become retrievable per-character.

Each summary file carries YAML frontmatter: the conversation UUID, the participating characters (names and IDs), the count of real messages (USER/ASSISTANT only — staff announcements, whispers, and custom announcements are excluded), and the first/last message timestamps. The file is named after the conversation's current title.

- The conversation UUID in the frontmatter is the key for replacement: each regeneration finds and deletes its own prior file (even if the conversation has since been renamed) before writing the new one. A name collision with a *different* conversation is disambiguated with the short chat ID.
- Deleting a conversation sweeps its summary file out of every participant vault. Backup restore and import skip this per-chat cleanup since they manage vaults wholesale.
- Writes go to all participant characters with a vault (both LLM- and user-controlled). The write/delete paths run through the existing host-RPC bridge so they commit correctly from background jobs.
- New `lib/file-storage/conversation-summary-vault-bridge.ts`; hooked into `generateContextSummary` (`lib/chat/context-summary.ts`) and `ChatsRepository.delete`.

#### Fix: character model picker shows the connection-profile name; profile names must be unique

The per-character model dropdown in the Salon labeled each option by the raw model name (e.g. `claude-sonnet-4-6`) instead of the connection-profile's name. That made profiles indistinguishable when several share a provider and model but differ in settings. The dropdown now shows the profile name, with the model appended as a hint when it differs (e.g. `Opus 4.7 Adaptive — claude-opus-4-8`). Display-only change; selection has always stored the profile ID.

Connection-profile names are now unique per instance, case-insensitive and ignoring surrounding whitespace, enforced at every layer:

- A new unique index `(userId, lower(trim(name)))` on `connection_profiles`.
- Migration `add-connection-profile-unique-name-index-v1` de-duplicates existing names first (oldest keeps its name; later collisions get a ` (2)`, ` (3)`, … suffix), then creates the index.
- The create/update API returns `409 Conflict` on a duplicate name.
- The create/edit modal shows an inline error and disables Save on a duplicate, and the auto-suggested `provider/model` name is suffixed so a second profile on the same provider+model doesn't collide.
- Import and restore rename connection profiles on collision instead of letting the constraint silently drop them.

#### Chore: remove leftover development debug logging

Removed 91 happy-path debug log calls that were added while building the 4.7 features (Groups, the Post Office, Carina, the Brahma Console, the document-store overlay, the mount-index file pipeline, memory recall, wardrobe vault writes, and others). These only narrated successful normal operation — "resolved", "built", "wrote", "delivered", "listed", "assembled", and so on — and became log noise once the features worked. Kept all error/warn logging plus the debug logs that actually aid diagnosis: fallback/degradation branches, "why was this skipped/empty/unavailable" notes, state-change events, and the theme missing-asset diagnostics. No behavior change. 50 files, 487 deletions; `tsc` and the unit suite stay green.

#### Fix: Markdown inside a roleplay template's delimiters no longer breaks the delimiter

When a roleplay template wrapped text in a custom delimiter (e.g. `+narration+`) and that text also contained Markdown like `*emphasis*`, the Markdown split the span before the delimiter styling was applied, so the delimiters showed up literally and the narration styling was lost.

The shared roleplay renderer (`lib/chat/roleplay-rendering.ts`, used by both the client `MessageContent` and the server `markdown-renderer.service`) now handles this in two ways:

- **Markdown escaping is generic.** `escapeMarkdownInBrackets` previously only protected the built-in `[…]`, `{…}`, and `*…*` shapes. It now escapes the interior of *any* wrap delimiter that shows its markers (including custom ones like `((ooc))`), reading the captured body straight from the pattern's regex.
- **Hidden-delimiter wraps render their inner Markdown.** When a whole paragraph is a single delimiter that hides its markers (the `hideDelimiter` toggle), the markers are stripped and the body is wrapped in an inline styled span, so Markdown inside it (e.g. `*Father*` → italic) renders normally. New `wrapBlockMatchFor` in the core; new `applyWrapBlockClasses` step on the server and the matching path in the client block renderer.

Shown-delimiter and inline (mid-line) wraps keep their previous behavior: the styling is applied and the Markdown characters are shown literally. Added unit tests for `wrapBlockMatchFor`, the generic/skip escaping, and the server HTML pass.

#### Refactor: remove dead locals in the self-inventory prompt builder

Dropped two unused locals in `buildPromptSection` (`lib/tools/handlers/self-inventory/builders.ts`): `otherParticipants` (destructured but never read) and `projectContext` (computed but never passed to `buildSystemPrompt`). The latter also ran a wasted `repos.projects.findById` lookup on every self-inventory `prompt` section. No behavior change.

#### Fix: the Salon's desktop text-row swipe buttons rendered blank

The previous/next swipe buttons in a message's desktop text-actions row had empty bodies, so they were invisible and effectively unusable. (The icon action bar's swipe controls were unaffected.) Added the chevron icons and accessible labels/titles, matching the icon action bar. Pre-existing on `main`; surfaced during the MessageRow split.

#### Refactor: split the WardrobeItemEditor god-component

Broke the 954-line `components/wardrobe/wardrobe-item-editor.tsx` into the parent plus two presentational subcomponents, with no behavior change. All hooks, state, effects, and the save logic stay in the parent — only self-contained JSX blocks moved out, so there is no hook-ordering risk.

- New `components/wardrobe/wardrobe-item-editor/`: `WardrobeComponentPicker` (the whole bundle-mode components section — coverage badges, selected-component chips, the searchable grouped candidate list, and the replace-slots designation) and `WardrobeModeChangePrompt` (the bundle→single confirmation dialog), plus shared `types.ts` (`CandidateItem` / `CandidateGroup`) and `constants.ts` (the group labels/order, type badge classes, and `getCandidateGroup`).
- `wardrobe-item-editor.tsx` drops from 954 to 709 lines; the props contract and the `WardrobeCreateScope` export are unchanged.

#### Refactor: split the Salon MessageRow god-component

Broke the 863-line `app/salon/[id]/components/MessageRow.tsx` render function into focused presentational subcomponents, with no behavior change (every className, conditional, and callback wiring is preserved verbatim). `MessageRowInner` has no hooks, so the extraction adds no new state or memo boundaries.

- New `app/salon/[id]/components/message-row/`: `MessageDesktopAvatar` (the left/right avatar column, dedup'd from the three sites that hand-rolled it), `MessageActionBar` (the in-bubble icon toolbar plus timestamp/token badge), and `MessageDesktopActions` (the hover toolbar and desktop text actions), plus shared `types.ts` (`MessageAvatarInfo`) and `helpers.ts` (`getImageAttachments`).
- `MessageRow.tsx` drops from 863 to 602 lines; it keeps the props contract, the courier/collapsed/main branch structure, the content + tool-layout rendering, and the `memo` comparator unchanged.

#### Refactor: single-source the Carina inline-markup handling

The user-message path (the orchestrator) and the assistant-markup path (the message finalizer) ran near-identical `@Name:` / `@Name?` blocks: detect the markup, fire the isolated reference query, surface the answer live, and route a failure through Prospero. Collapsed both into one shared `runCarinaMarkupQuery` (`lib/services/carina/markup-runner.ts`), with the caller-specific bits — the "Consulting…" status event and the public-answer splice into the live turn, both user-message-only — passed as callbacks. No behavior change; the detection/failure log wording each path used is preserved via label parameters. Net ~60 fewer lines across the two services, plus a new unit test for the shared runner.

#### Refactor: split the self-inventory tool handler into focused modules

Broke the 1,867-line `lib/tools/handlers/self-inventory-handler.ts` god-file into a module directory by responsibility, with no behavior change. The dozens of small functions inside it already had single responsibilities; they were just all in one file. `tsc`, eslint, and the unit suite stay green.

- New `lib/tools/handlers/self-inventory/` holds `helpers.ts` (the shared `SelfInventoryToolContext` type, the high-importance threshold, and the number/date/vault-file primitives), `builders.ts` (the GATHER half — every `build*Section` / `resolve*IncludedParts`), and `formatters.ts` (the RENDER half — every `format*` plus the public `formatSelfInventoryResults`).
- `self-inventory-handler.ts` is now just the orchestrator (`executeSelfInventoryTool`) and re-exports the public surface (`formatSelfInventoryResults`, `SelfInventoryToolContext`), so every existing import path is unchanged.
- Builders and formatters are independent (a formatter never calls a builder and vice versa); both depend only on the shared helpers, so the split is a clean DAG. The handler's existing 16-test suite drives the public API end-to-end and is unchanged.

#### Refactor: unify the project-store and group-store implementations

Collapsed the near-verbatim duplication between the project and group document-store subsystems into one shared implementation. No behavior change; `tsc`, eslint, and the full unit suite (7437 tests) stay green.

- New generic `createDocumentStoreOverlay` engine (`lib/database/document-store-overlay.ts`) holds the read overlay (hydrate from `properties.json` / `description.md` / `instructions.md` / `state.json`, with the asymmetric throw-on-single / drop-on-list failure), the write overlay (route store-resident fields, strip managed keys), and the per-mount-point write serialization. `lib/projects/project-store` and `lib/groups/group-store` now instantiate it with their own schema/paths/error; their `read-overlay.ts` / `write-overlay.ts` re-export the bound operations, so every existing import path is unchanged.
- New `AbstractStoreBackedRepository` (`lib/database/repositories/store-backed.repository.ts`) holds the store-aware CRUD skeleton (overlay-on-read, route-and-strip-on-write, provision-on-create, `findByIdRaw` / `findAllRaw`, `setOfficialMountPointId`, and the store-aware `_create` / `_update`). `ProjectsRepository` and `GroupsRepository` now extend it; projects keep only the character-roster methods and seed their create-time roster defaults through a `prepareCreateData` hook.
- Net ~490 fewer lines, and the two subsystems can no longer drift.
- Post-review polish (no behavior change): reattached the `reconcileAutonomousRunsAtStartup` JSDoc that the new `buildResumablePausePatch` helper had displaced, and replaced an `any`-typed null filter in the group mount-points route with a type guard.

#### Refactor: dedup, dead-code, and API-conformance pass over post-4.6.0 code

A behavior-preserving refactor of code added since the 4.6.0 release, per `.claude/commands/refactor.md` (single source of truth / DRY, SRP, KISS, dead-code removal, API conformance, `qt-*` utilities). No functional, schema, export, or migration changes; `tsc` and the full unit suite stay green.

- Data backend: extracted `nextUniqueMountPointName` (`lib/mount-index/unique-mount-point-name.ts`) to replace four copies of the mount-point name-uniquifier (the two `ensure-*-store` helpers and two migration scripts), and `ensureOfficialStore` (`lib/mount-index/ensure-official-store.ts`) so `ensureProjectStore`/`ensureGroupStore` become thin wrappers over one provisioning flow. Removed the dead `WardrobeRepository.findByCharacterIdAndTypes`. Fixed a stale "14 property-bag keys" comment.
- Shared JSON-fence stripping: routed all 11 hand-inlined ` ```json ` fence strips (memory tasks, image-scene tasks, chat tasks, outfit selection, the dangerous-content gatekeeper) through the existing `stripCodeFences` (`lib/services/ai-import.service.ts`), rewritten to the regex form those sites used (identical output for every tested input).
- Memory/compression: extracted `coerceMemoryCandidate` (one coercion path for the three memory-candidate parsers, preserving the batch path's no-tag behavior) and a `runCompression`/`estimateTokens` core (the three compression functions are now thin wrappers). Fixed a stale `subjectIsUser` doc comment.
- Services: lifted the duplicated `extractSubmitFinalResponseFromText` into `agent-mode-resolver.service` (shared by the Brahma Console and Help Chat orchestrators); collapsed the byte-identical Carina stream-accumulation loop in `carina.service` into one local `runStream`; collapsed the duplicated connection-profile-change opaque builder and removed the dead `buildProjectContext*` builders in the Prospero writer (the combined builders now share one `appendProjectBodySection`); extracted `buildResumablePausePatch` shared by the startup and terminal-failure autonomous-room reconcilers; dropped a dead `maxLength` parameter in `character-rename.service`.
- API: removed the dead group `?action=stores|linkStore|unlinkStore` handlers (the client uses `/mount-points` only); removed per-handler `try/catch` wrappers that collapsed the middleware's deliberate 400/503 mappings into a flat 500 across the groups/wardrobe/scenarios/group-stores routes; switched manual `NextResponse.json` success returns to `successResponse`/`created`; extracted `verifyBrahmaChat` (`app/api/v1/brahma-console/_shared.ts`); shared the aesthetic kind-parse/read/write (`lib/image-gen/aesthetic.ts`) between the project and system routes; single-sourced the wardrobe create/update Zod schema in `lib/schemas/wardrobe.types.ts`; single-sourced the "a character the operator plays" authorization predicate (`app/api/v1/chats/[id]/participant-auth.ts`) used by the Post Office mailbox and send-mail actions.
- Chat rendering: removed the dead `lineClassFor` wrapper (production uses `lineMatchFor`); its unit tests now exercise `lineMatchFor` directly.
- UI: adopted the existing `qt-alert-*` and `qt-button qt-button-primary` utilities in place of hand-rolled alert/button class sets in the wardrobe, scenarios, roleplay-templates, and groups views.

#### Fix: opening Document Mode (or Terminal Mode) erased unsent composer text

Typing a message and then opening Document Mode wiped whatever was in the Salon composer. `SplitLayout` rendered the chat pane — and the Lexical composer inside it — in a structurally different DOM tree for each mode (`normal`/`split`/`focus`), so switching modes unmounted and remounted the editor, discarding its in-memory text. Because the page-level `input` value intentionally lags live typing (the composer owns the live text to avoid per-keystroke re-renders), the remounted editor reseeded from a stale/empty value and the text was gone. The same loss applied to opening Terminal Mode, toggling focus mode, and closing a document. `SplitLayout` now keeps the chat pane mounted in one stable structure across all modes and varies only its width/visibility, so the composer (and its undo history, cursor, and scroll position) survives every mode change. Touched `app/salon/[id]/components/SplitLayout.tsx` only; no CSS or behavior changes to the document/terminal panes.

#### Fix: SillyTavern export mislabeled every speaker in multi-character chats

Exporting a multi-character chat to SillyTavern JSONL tagged every assistant message with the first character's name instead of the actual speaker. The export only ever received one character name and stamped it on every non-user line, ignoring each message's `participantId`. The export now resolves the speaker per message from a participant-id → name map covering all character participants, falling back to the role-based character/user name for single-character or legacy messages that carry no `participantId`. User-controlled characters export under the character's name, not the human operator's name. Touched `lib/sillytavern/chat.ts` (new optional `participantNames` arg on `exportSTChat`/`exportSTChatAsJSONL`) and the `?action=export` handler in `app/api/v1/chats/[id]/handlers/get.ts` (loads all character participants, threads `participantId` through). Added multi-character export tests.

#### `qtap://` document URIs: one address for any file

Added a single, first-class way to address any document the Scriptorium can reach — a `qtap://` URI — and made it the form Quilltap emits everywhere. A URI is just the existing `{ scope, mount_point, path }` triple folded into one string: `qtap://<authority>/<path>`. The authority is matched name-first, UUID as fallback; three reserved authorities name the non-store scopes: `qtap://self/…` (the acting character's own vault), `qtap://project/…`, and `qtap://general/…`. Reserved words always win the authority slot; a store literally named one of them is reachable by its UUID. No database, storage-model, `.qtap`/backup, or migration changes — the URI is a serialization of the existing triple, nothing more.

- New pure codec `lib/doc-edit/qtap-uri.ts` (`parseQtapUri`/`formatQtapUri`/`isQtapUri` plus producer helpers `formatSelfUri`/`formatScopedUri`/`formatDocStoreUri`). Dependency-free and client-safe (no Node-only imports), so the Salon renderer can import it. Server-side producers that touch the DB live in `lib/doc-edit/uri-producers.ts`. New `countByName`/`findByName` on the doc-mount-points repository back the name-ambiguity check.
- Every `doc_*` tool now accepts an optional `uri` parameter that supersedes `scope`/`mount_point`/`path` (and `source_uri`/`dest_uri` on `doc_copy_file`); the legacy parameters still work. Every tool result, the self-inventory file rows, and `search` results now carry a `uri` field.
- The personified staff quote documents by `qtap://` URI: Prospero's project/store announcements, the Librarian's open/rename/delete/folder/attach notices, Suparṇā's mail whispers, the Post Office / `list_email` letter actions, the knowledge injector, and the `send_mail` confirmation (which uses the recipient store's URI, not `qtap://self/`).
- The Salon linkifies a `qtap://` URI that points to a confirmed, accessible document into a clickable link that opens Document Mode; missing/unreachable/unparseable URIs stay plain text. New chat action `POST /api/v1/chats/{id}?action=resolve-document` does the existence check without returning bytes. (Also added a `urlTransform` so react-markdown stops stripping the `qtap://` scheme.)
- CLI (`npx quilltap docs`): every verb that takes `<mount> <path>` now also accepts a single `qtap://` URI (two for `move`/`copy`/`link`); `find`/`grep` accept it via `--mount`. `--json` output for `find`/`grep`/`ls`/`files`/`tree` carries a `uri` field, and `--uri` shows the URI as the locator in text output. The CLI addresses document stores only — `qtap://self/…`, `qtap://project/…`, and `qtap://general/…` are rejected with guidance.
- Docs: new sections in `help/document-editing-tools.md` and `docs/developer/CLI.md`; `help/post-office.md` examples updated. Tests: codec (server + CLI ports), repository ambiguity helper, the `resolve-document` action, and the `QtapDocLink` component; the tool-definition snapshot was regenerated.

#### Salon composer font now matches your sent messages

The Salon message composer (the Lexical input) now renders in the same typeface used for your rendered user messages, so what you type matches what you read back. The composer previously set no `font-family` and inherited the body sans, while user message bubbles use `--qt-chat-user-font`. In themes that give user messages a distinct font this caused a mismatch — e.g. Madman's Box typed in Raleway but rendered in Mulish; Rains, Old School, and Earl Grey diverged similarly. Pointed `.qt-chat-composer-input` at `--qt-chat-user-font`, the same token user messages use, so the two stay in sync per theme automatically. No-op in the default theme (and Great Estate/Art Deco), where that token already resolves to the body sans. CSS-only; no theme tokens or bundled themes changed.

#### Brahma Console: copy any message as Markdown

Each settled message in the Brahma Console transcript — user and assistant alike — now has a small copy button beneath it. Pressing it copies that message's raw Markdown to the clipboard (the same text the model sent/received, not the rendered HTML) and briefly flips to a checkmark to confirm. The button sits on the dialog background just below the bubble, so it stays legible on any theme. Self-contained per-button state (no toast dependency), mirroring the existing code-block copy control.

#### Fixed: unreadable user messages in the Help Chat and Brahma Console on dark themes

User chat bubbles in the Help Chat and Brahma Console rendered their text with the global foreground color instead of the primary-foreground color, so on dark themes (e.g. Madman's Box) you got light text on the gold/primary bubble fill — effectively unreadable. The bubble's `text-primary-foreground` was being overridden by the markdown prose styles (`.qt-prose-auto` pins `--tw-prose-body` to the global foreground in dark mode). Added a `.qt-help-msg-user .qt-chat-message-content` rule that pins the prose body and text color back to `--color-primary-foreground`, mirroring the treatment the Salon's user bubbles already use. CSS-only; no theme tokens or bundled themes changed.

#### Larger sidebar icons

Bumped the collapsed left-sidebar icons up one size so they read closer to the user avatar. The navigation and footer action icons went from 20px to 28px, and the Home/brand quill went from 28px to 32px (matching the profile photo). Sizes are set at each `<Icon>` call site via Tailwind `w-`/`h-` utilities (the qt-icon size default intentionally defers to them), so no theme tokens or bundled themes changed.

#### Fixed: character Rename/Replace tab failed with "Unknown action: rename"

The Aurora character editor's Rename/Replace tab has been broken since the v1 API cleanup: the UI posted to `POST /api/v1/characters/[id]?action=rename`, but that action was never carried over when the legacy `/api/characters/[id]/rename` route was removed, so both Preview and Execute returned `400 Unknown action: rename`. Restored the action against the current data model.

- New `lib/services/character-rename.service.ts` (`runCharacterRename`) does the scan-and-replace in one of two modes — dry run (preview counts + per-occurrence detail) or execute (commit the writes). Wired into the v1 characters POST handler as `action=rename` with a Zod-validated body.
- Adapted to the post-4.6 model: `physicalDescription` is now a single object (was an array), `scenarios` is an array (was a single field), and the swept fields include `manifesto`, `identity`, and `aliases`. Character-field writes go through `repos.characters.update`, which routes the vault-managed fields into the character's document-store vault; only `name` lands on the row.
- Sweeps the character's own fields, the physical description and its image prompts, the character's memories (content/summary/keywords), and the titles and message bodies of every chat the character appears in. Staff/personified-feature messages (`systemSender != null`) are skipped so their structured payloads aren't corrupted.
- After an executed rename that changed chat messages, each affected conversation is re-rendered and re-embedded (the same path the "Refresh Archive" action uses) so the searchable archive reflects the new text. Memory rows are updated in place; their embeddings refresh on next touch.
- Help: rewrote the Rename/Replace section of `help/character-editing.md` to match the actual UI and document exactly what the sweep reaches. Tests: +5 for the rename service.

#### Startup self-heal: re-render and re-embed half-finished conversations

Added a startup sweep that finds conversations the Scriptorium pipeline left incomplete and re-enqueues them, so the chat list stops accumulating chats that were never rendered or never embedded. Two cases are healed: a chat with real user/assistant messages but no `renderedMarkdown` (the per-turn render never fired, or a render job died on an interrupted shutdown), and a chat with interchange chunks whose `embedding` is still NULL (typically the embedding provider was down when the turn finished). Re-running `CONVERSATION_RENDER` fixes both — it upserts the chunks (preserving existing embeddings) and re-enqueues `EMBEDDING_GENERATE` for any chunk still lacking one.

- New `lib/startup/reconcile-conversation-rendering.ts` (`reconcileConversationRendering`), wired into `instrumentation.ts` as Phase 3.6 (fire-and-forget, after the background schedulers start). One indexed scan selects incomplete chats; each is enqueued via `enqueueConversationRender`, which dedupes against any render job already pending for the chat. Runs on every startup because the gap recurs; it's a no-op on a healthy instance.
- Oversized chunks (content longer than `EMBEDDING_MAX_CHARS`) and empty chunks are excluded from the "needs work" test. They're deterministically unembeddable today (the embedder marks them FAILED without retry; oversized interchanges await sub-chunking), so counting them would re-render their chat on every boot for nothing.
- Runs in the parent process (the sole DB writer), like the other startup self-heals, so the enqueue writes land directly instead of buffering through the job child.
- Tests: +5 for the sweep.

#### Brahma Console: a character-less, memory-free generic-LLM chat

Added the Brahma Console — a second floating chat surface, sibling to the Help Chat, reached from a new tetra-radial console icon below the Help icon in the sidebar footer. Unlike the Help Chat (a character answering with help-doc context), the Brahma Console is a plain LLM: pick a connection profile and talk to that model directly. It persists, lists past conversations, and lets you switch the model at any time, continuing the same chat.

- New `chatType` value `'brahma'`. Widened `ChatTypeEnum` and every union/string-literal list; `isHelpLikeChatType()` helper routes both `help` and `brahma` chats through the lightweight titling/summary path (auto-retitled at interchange 1, story-background generation skipped). Excluded `brahma` from the per-character memory-recap pool (`findRecentSummarizedByCharacter`).
- New nullable `chats.consoleConnectionProfileId` column (migration `add-console-connection-profile-field-v1`) holds the console's active model; switching the model PATCHes it and the same chat continues. DDL and `qtap-export.schema.json` updated; Brahma chats export and import like any other chat (full-row spread carries the new field and `chatType`).
- New parallel modules mirroring the Help Chat: orchestrator (`lib/services/brahma-console/orchestrator.service.ts` — single-turn, character-less), system prompt builder (`lib/brahma-console/system-prompt-builder.ts` — neutral, no page context), API routes (`app/api/v1/brahma-console/{route,[id]/route,[id]/messages/route}.ts`), provider, dialog, message list, model picker, and streaming hook. The orchestrator deliberately omits `triggerTurnMemoryExtraction` — the console forms no persistent memories.
- Tool set: `search` (a Brahma variant whose schema drops the `memories` source), the full `doc_*` read/write family, web search (when the connection profile allows it), `curl` (when the plugin is enabled), and `submit_final_response`. The always-on workspace tools (Post Office mail, annotations, terminal, conversation reading, self-inventory, RNG/state) are stripped via a new `includeWorkspaceTools` flag on the tool builder. Because the console is character-less, its tools run with an operator scope (`operatorSurface` on the tool context → the existing `operatorOverride` "look everywhere" path): search and `doc_*` reach every document store the operator owns, and conversation search runs operator-wide; memory search is forced off.
- Not page-aware: no pathname tracking, no `update-context` endpoint, no page-URL column.
- Default tetra-radial console icon (`public/images/icons/brahma-console.svg`) registered in the icon registry; Madman's Box ships a Gallifreyan-style override (`themes/bundled/madmans-box/icons/brahma-console.svg`, version bumped to 1.1.4).
- Help: new `help/brahma-console.md`, registered in the Guide's `chats` category.

#### Docs: moved completed feature specs into `features/complete/`

Reorganized `docs/developer/features/` so the active folder holds only unshipped or in-progress work. Moved 17 specs whose features have shipped into `features/complete/`: `carina`, `memory-extraction-enrichment`, `memory-recall-relevance`, `adhoc-npc-and-summon-from-lore-in-salon`, `chat-as-any-participant-plan`, `groups`, `per-character-prompt-caching`, `plan-themeable-page-backgrounds`, `post-office`, `scenario-append-plan`, `scenarios-card-redesign-plan`, `scheduled-retention-cleanup`, `themeable-icons`, `user-controlled-character-memories`, `project-store-cutover`, `remove-character-overlay-residue`, and `rp-template-formatting-overhaul`. Each was verified against the CHANGELOG and code (migrations, named code paths) rather than the doc header, several of which were stale ("Planned"/"Proposed" on shipped work). Fixed two relative links broken by the move: `llm_api_costs_breakdown.md` → `complete/per-character-prompt-caching.md`, and `complete/post-office-ui.md` → `post-office.md`. No code change.

#### Post Office: letters to your own character now surface

Mail addressed to the character you play (a `controlledBy: 'user'` participant) is now announced to you, the same way it is for an AI character. Previously the Suparṇā delivery whisper was only generated during an LLM character's turn, so a letter delivered to your character sat in its vault unannounced (`alerted: false`) forever — you never saw it.

- New shared helper `lib/post-office/surface-operator-mail.ts` (`surfaceOperatorMailForChat`): for every user-controlled CHARACTER participant, it sweeps that character's vault for unalerted letters and posts a Suparṇā `mail-delivery` whisper targeted at that participant, then marks each letter alerted. It posts the whisper only — no LLM context is injected, since your character makes no model call. Idempotent (`markAlerted`) and warn-only, so it never breaks a load or a turn; it replays correctly from the forked background-jobs child.
- Called from two places: the chat-load GET (`app/api/v1/chats/[id]/handlers/get.ts`, alongside the existing terminal-session reconcile) so a pending letter appears the moment you open the chat, and each turn's `buildContext` (`lib/chat/context-manager.ts`) so a letter that arrives mid-session surfaces within a turn (including autonomous rooms).
- The Salon already shows a targeted whisper when it targets a user-controlled participant, so no visibility change was needed. Mail-delivery whispers now render expanded by default instead of collapsing into a chip (`app/salon/[id]/announcement-render-items.ts`), the same exemption Carina answers get, because a letter to your character is significant.
- Tests: +9 for the helper, +1 for the render-item expansion.

#### Compose Mail button in the Salon composer (Post Office UI)

Added a Compose Mail button to the Salon composer gutter: the operator can send a letter as one of their player-characters (`controlledBy: 'user'`) to another character, optionally quoting a letter from the sender's mailbox. Delivered by Suparṇā through the same Post Office service the `send_mail` tool uses, so the UI and the tool stay in lockstep.

- New composer-gutter button (envelope, *"Post a letter"*) opens the **Compose Mail** modal (`components/chat/ComposeMailDialog.tsx`): From (fixed when you play one character, a dropdown when more — restricted to characters you control in this chat), To (**any** character in the workspace, loaded from `/api/v1/characters`, minus the From — you can mail someone who isn't in the scene), In-reply-to (defaults to "No quoted reply.", lists the From character's mailbox), and a Markdown letter body. Threaded `onComposeMailClick` through `ComposerGutterTools` → `ChatComposer` → `page.tsx`, with `composeMailOpen` state in `useModalState`.
- Suparṇā joins the Insert Announcement "Staff" list, so the operator can post an announcement bubble in her voice (`StaffSender`/`STAFF_SENDER_ENUM`/the modal's staff options). Her avatar + display name were already wired from the Post Office backend.
- New chat action `POST /api/v1/chats/[id]?action=send-mail`: validates that `fromCharacterId` is a user-controlled participant of the chat (never trusting the client), then delivers via the shared service. New `GET /api/v1/chats/[id]?action=mailbox&characterId=…` lists a player-character's mailbox letters for the reply dropdown (authorized the same way).
- Refactor: extracted the compose-and-deliver path (vault provisioning, `in_reply_to` quoting, frontmatter/filename stamping) into `lib/post-office/deliver.ts` (`composeAndDeliverLetter`); the `send_mail` tool handler now calls it instead of duplicating the logic.
- New `mail` icon (default `public/images/icons/mail.svg` + registry entry + regenerated icon CSS) with a Madman's Box override (`themes/bundled/madmans-box/icons/mail.svg` + manifest line). Other bundled themes fall through to the default envelope.
- Help: updated `help/post-office.md`.

#### Multi-character anti-hijack safeguards

Hardened multi-character turns so one character (especially a weaker model) can't speak as the others or write the whole scene as a `[Name]`-tagged screenplay.

- Removed a fragile/contradictory prompt instruction: the Anthropic multi-character path used to append "Always begin your response with [Name]," which both contradicted the always-on Identity Reminder ("do not prefix with your name") and taught weaker models the very `[Name] …` transcript format they then ran away with. It now anchors identity in prose and explicitly forbids writing or tagging any other participant's turn (`lib/services/chat-message/context-builder.service.ts`). Non-Anthropic providers keep the structural assistant-prefill anchor.
- Strengthened the always-on Identity Reminder (`buildIdentityReinforcement`) to forbid writing dialogue/actions/narration for any other character or the user, continuing the scene from another viewpoint, or emitting another character's `[Name]`/`Name:` speaker tag.
- Added a model-agnostic structural backstop: `truncateAtForeignSpeaker` (`lib/llm/message-formatter.ts`) cuts a finalized response at the first line that opens with another participant's `[Name]`/`Name:` tag, so a hijacked turn can never carry another character's lines into the transcript. Wired into `finalizeMessageResponse` (runs for every provider; matches only the chat's other participant names/aliases, never arbitrary brackets; leaves a response that *opens* with a foreign tag intact to avoid an empty message, and logs it). +7 unit tests.

#### `mount_point: "self"` taught and accepted across all `doc_*` tools

Extends the Post Office's reserved `mount_point: "self"` token (own-vault access via `characters.characterDocumentMountPointId`) to the rest of the document toolset, so every character has one stable, rename- and collision-proof handle for its own vault rather than reconstructing the vault's name.

- Tool definitions: every `doc_*` tool's `mount_point` description now states that `"self"` addresses the caller's own character vault — `doc_read_file`, `doc_write_file`, `doc_str_replace`, `doc_insert_text`, `doc_delete_file`, `doc_create_folder`, `doc_delete_folder`, `doc_move_file`, `doc_move_folder`, `doc_open_document`, `doc_read_frontmatter`, `doc_read_heading`, `doc_update_frontmatter`, `doc_update_heading`, `doc_list_files`, `doc_grep`, `doc_copy_file` (`source_mount_point`/`dest_mount_point`), and the `doc_*_blob` family.
- Acceptance: `doc_list_files`, `doc_grep`, and the blob handlers now resolve `"self"` to the acting character's vault, matching the path resolver. Tools that route through `resolveDocEditPath` (read/write/edit/move/copy/folder) already honored it.
- Shared helpers: new `resolveSelfVaultMountPointId` and `resolveMountPointRef` in `lib/doc-edit/path-resolver.ts` are the single source for self-token resolution; the path resolver's existing inline logic was refactored onto the former, and the name/ID-matching handlers use the latter.
- Staff guidance switched to `"self"`: Prospero's group + personal-vault whisper teaches `mount_point: "self"` on the own-vault line (the vault's name and ID still shown as equivalents); `self_inventory`'s Character Vault section footer recommends `"self"`.
- Backwards-compatible: vault name and ID matching still work everywhere. `"self"` only resolves for a character acting as itself, so a store literally named "self" stays reachable for operators and non-character callers.
- Tests: added `resolveSelfVaultMountPointId` / `resolveMountPointRef` unit tests; extended the Prospero group-context-whisper tests; refreshed the tool-definition snapshot.
- Help: `help/document-editing-tools.md` gains a "`self` shorthand" section.

#### The Post Office: inter-character mail

Characters can now send and receive Markdown letters. Delivered by Suparṇā (a new personified Staff member), stored in each character's `Mail/` vault folder, and announced at memory-recall time.

- Two new character tools: `send_mail` (write a letter to another character — any character may write to any character) and `list_email` (list your own mailbox with the exact calls to read/answer/discard each letter). Both are always available to character participants. Reading and deleting reuse the existing `doc_read_file` / `doc_delete_file` tools; replying uses `send_mail`'s `in_reply_to`.
- A delivered letter lands as `Mail/<epochMillis>-from-<sender-slug>.md` in the recipient's vault. The delivery system owns the frontmatter (`from`, `fromCharacterId`, `sentAt`, `alerted`, `inReplyTo`); the sender writes the body only. No "Sent" copy is kept in the sender's vault.
- New `systemSender: 'suparna'`. After the Commonplace Book whisper each turn, the Post Office checks the responding character's mailbox; any letters not yet announced trigger a Suparṇā whisper that reads each new letter aloud, names the sender and date, and flips the letter's `alerted` flag. The whisper is event-like (it does not sweep prior mail whispers). Suparṇā is non-opaque (`opaqueContent === content`), so opaque characters still see her announcements.
- New reserved `mount_point: "self"` token in the document-store path resolver: it maps to the acting character's own vault via `characters.characterDocumentMountPointId`, so the read/delete calls handed to a character are rename- and collision-proof. Falls through to ordinary name/id matching when there is no acting character.
- Refactor: extracted a shared `resolveCharacterByNameOrId` / `findCharactersByName` helper (`lib/services/character-resolver.ts`) from Carina's inline name matching; Carina now calls it (its reachability gate is unchanged).
- Schema: added `'suparna'` to the `systemSender` enum (Zod message schema, repository ops schema, `qtap-export.schema.json` enum + description, Salon types/labels/avatar). No migration — the `chat_messages.systemSender` column is unconstrained text. Avatar: `public/images/avatars/suparna-avatar.webp`.
- Help: `help/post-office.md`.

#### Fix: project default image profile dangled on import/restore

A project's `defaultImageProfileId` was not remapped during quilltap-import or backup restore, so the reference pointed at a stale (or nonexistent) profile id after importing the project into a different instance. This was a pre-existing bug, not a regression.

- `lib/import/quilltap-import/reconcile.ts`: the project reconcile loop now remaps `defaultImageProfileId` through `idMaps.imageProfiles` (mirrors the character path).
- `lib/backup/restore/uuid-remap.ts`: added `defaultImageProfileId` to the project `remapFields` list.
- Added regression tests (`uuid-remapper.test.ts` for `remapBackupData`; quilltap-import project reconciliation). No schema/DDL change — the field was already exported.

#### Per-project default roleplay template

Projects can now set their own default roleplay template, overriding the global default for chats created in that project.

- New `defaultRoleplayTemplateId` field on a project's `properties.json` (added to `ProjectPropertiesSchema`, `PROJECT_STORE_MANAGED_FIELDS`, and the project PUT validation schema). Null means inherit from the global default.
- A **Default Roleplay Template** dropdown was added to the **Model Behavior** card on the project (Prospero) page. Choosing a template saves immediately; "Inherit from global default" leaves it unset.
- New chats created in a project resolve their template as: project default → user/global default → none, and the resolved id is baked onto the chat at creation.
- Runtime fallback: `getRoleplayTemplate` now prefers the project default over the user default for any project chat that still has no template set, and auto-saves it onto the chat (covers chats created before a project default existed).
- Import/restore now remap a project's `defaultRoleplayTemplateId` so custom-template references survive an import (quilltap-import reconcile + backup restore uuid-remap). Added to the `.qtap` export schema and DDL.
- Help: documented in `help/project-settings.md` (new "Default Roleplay Template" section) and cross-linked from `help/roleplay-templates.md`.

#### Salon "Add Character": ad-hoc NPC fixes and "Summon from Lore"

The Salon's Add Character dialog gained a second way to bring in a character, and the ad-hoc NPC dialog now actually saves two fields it had been dropping.

- **Ad-hoc NPC data-loss fix.** The "Create Ad-hoc NPC" dialog sent payload keys the server schema didn't accept, so Zod silently stripped them — every NPC lost its **Scenario** and **Physical Description**. The dialog now sends a `scenarios` array (was a scalar `scenario`) and a singular `physicalDescription` object (was a plural `physicalDescriptions` array), matching `createCharacterSchema`. Both fields now persist. Added a `CreateNPCDialog` regression test asserting the outgoing POST body shape.
- **New "Summon from Lore" button.** Add Character → **Summon from Lore** opens the existing Aurora AI-import wizard inside the Salon. On success the summoned character is preselected in the picker so you finish adding it (connection profile, outfit) through the normal controls — no immediate auto-add. The button always appears (the wizard accepts pasted text). New `components/chat/SummonFromLoreModal.tsx` wraps `AIImportWizard`; no new API or schema.
- **Created-character id is now surfaced.** `executeImport`'s `ImportResult` gained `importedCharacterIds` (the destination character id-map values), threaded through the import-execute response, `useAIImport`, and `AIImportWizard.onImportSuccess(characterIds?)` so the Salon can select the summoned character. Backward-compatible: the Aurora caller ignores the argument. The Salon wrapper surfaces a clear message when a summon yields zero or more than one character (single-character summon is the supported case).

#### Roleplay delimiters: hide toggle, style palette, and per-rule flourishes

Each roleplay-template delimiter can now hide its own marks when rendered and carry layered text decorations, and there's a new set of theme-aware style classes to assign.

- New per-delimiter **hide** toggle (`hideDelimiter`). When on, the renderer strips the delimiter/prefix from the displayed output while keeping the styling — `+narration+` renders as a styled `narration` with no `+`. Works for all three kinds: wrap bookends, line-prefix markers, and the leading `[TAG]` of a tag prefix. The stored text is unchanged; hiding is render-only.
- New per-delimiter **add-ons** (`addOns`): bold, italic, reverse (foreground/background swap), underline (single/double), border (solid/dashed), and a font choice (theme sans/serif/mono/display/script). These compose onto the base style class — no renderer changes were needed because `RenderingPattern.className` already accepts a space-separated class list.
- New style classes selectable per delimiter: `qt-roleplay-1..4` (four distinct high-contrast color chips) and `qt-roleplay-danger/warning/success/info/muted/code`. Defined for the default theme and all six bundled themes (each picks its own four hues for 1–4); the semantic classes draw from the theme's existing `--color-*` tokens.
- Implementation: `hideDelimiter`/`addOns` are optional fields on every delimiter kind (Zod), so legacy and built-in delimiters are unaffected. `generateRenderingPatterns` composes the add-on classes and sets a new optional `hideDelimiters` flag on the pattern; the pattern builders wrap the kept content in a named `rpBody` capture group. The shared core (`tokenizeInline`, new `lineMatchFor`) strips the marks, so the client and server renderers stay in lockstep. The template editor gains a hide checkbox, the add-on controls, and the expanded style quick-picks. The `.qtap` export schema now documents the full `delimiters` array (it already round-tripped via NDJSON).
- No database migration: the new fields live inside the existing `delimiters` JSON. Existing custom templates pick up the new options when re-saved; built-ins re-seed at startup.

#### Image orientation gating and resolution negotiation

Image generation previously hard-coded a request size that was wrong for about half the providers. Avatars asked for `1024x1792` and backgrounds for `1792x1024` regardless of model; on OpenAI's gpt-image that silently degrades to `1024x1024`, so "portrait" avatars came back square — and the stored width/height lied about it. There is now one provider-agnostic way to ask for a shape.

- New semantic `orientation` (`portrait | landscape | square`) is the single way callers and the `generate_image` tool request shape. A host resolver (`lib/image-gen/orientation.ts`) maps it onto each provider's real mechanism — a concrete size (OpenAI, Z.AI), an aspect ratio (Google, Grok, OpenRouter), or prompt wording — using capabilities the plugins advertise. Avatars default to portrait, story backgrounds to landscape.
- Providers now advertise orientation support. New `OrientationStrategy`, `OrientationMapping`, and `ImageOrientationSupport` types in `@quilltap/plugin-types` (bumped to 2.5.2), added to `ImageProviderConstraints` (provider-level) and `ImageGenerationModelInfo` (per-model, required where legal sizes differ by model). OpenAI is keyed per model: gpt-image portrait is `1024x1536`, DALL·E 3 is `1024x1792`, DALL·E 2 is square-only (its portrait/landscape degrade to a prompt hint rather than sending a size the API rejects). Aspect-ratio providers map portrait→3:4 and landscape→16:9.
- The `generate_image` tool gains an `orientation` parameter (preferred over the now provider-dependent `size`/`aspectRatio`). The stale hand-rolled provider-constraints switch was removed in favor of the registry-backed data.
- Stored dimensions are now measured from the actual returned image. `convertToWebP` reads back the WebP's real width/height via sharp; the avatar, story-background, and `generate_image` handlers store those instead of hard-coded constants. Moderation reroute paths re-resolve orientation for the fallback provider.
- Built-in plugin bumps: openai 1.0.50, google 1.1.38, grok 1.0.41, z-ai 1.1.12, openrouter 1.0.46.

#### Reworked roleplay-template formatting (delimiter kinds, unified renderers and toolbar)

Roleplay-template formatting was built from three independently-authored layers that had drifted: the schema, the toolbar's two insertion paths, and two duplicated renderers. A delimiter is now defined once and all three behaviors derive from it.

- Delimiters are now a discriminated union on `kind`: `wrap` (open/close around an inline span, the previous behavior), `linePrefix` (a line-start marker that styles the whole line, e.g. `// ` OOC), and `tagPrefix` (a bracketed token at the line start — e.g. `[CAPTAIN] …` — that styles the whole line when the token matches a per-rule `tokenPattern`). The default `tokenPattern` is `[^\p{Ll}]+` (uppercase/non-cased, never lowercase), compiled with the `u` flag and editable per rule. Quilltap ships the capability, not any specific "ranks" template.
- New shared core `lib/chat/roleplay-rendering.ts` (`tokenizeInline`, `lineClassFor`, `compileRenderingPatterns`, `escapeMarkdownInBrackets`, dialogue detection). The client renderer (`MessageContent.tsx`, React nodes) and the server renderer (`markdown-renderer.service.ts`, HTML) now both derive from it, so they can't diverge. Whole-line (`linePrefix`/`tagPrefix`) styling is applied at the block element (like dialogue detection), not as an inline span.
- New pure transforms `lib/chat/text-transforms.ts` (`toggleWrap`, `toggleLinePrefix`, `insertTagPrefix`). Both the formatting toolbar's source-textarea path and its Lexical path now route through these. The previously-dead `INSERT_DELIMITER_COMMAND` is now `APPLY_DELIMITER_COMMAND`, dispatching by kind. `toggleLinePrefix` now toggles the marker off when re-applied.
- `RenderingPattern` gains an optional `scope` (`inline` | `line`; absent ⇒ inline). Rendering patterns are still regenerated from delimiters on write.
- Template editor: each delimiter now has a **Kind** selector with kind-specific fields (wrap open/close, line marker, or tag brackets + token pattern). The **Style** field is now a free-text CSS-class input with the four built-in classes as quick-picks. A new **Draft formatting instructions** button appends a kind-aware starter paragraph to the prompt (which stays user-owned and editable).
- API: `POST`/`PUT /api/v1/roleplay-templates` now validate `delimiters` against the discriminated-union schema (400 on malformed input, including an uncompilable `tokenPattern`).
- Migration `rp-delimiter-kinds-v1` tags every existing template delimiter with a `kind` (`['marker','']` ⇒ `linePrefix`, otherwise `wrap`) and regenerates rendering patterns; built-in seeds were updated to the new shape. Legacy delimiters with no `kind` are read as `wrap`.

#### Renamed and consolidated the wardrobe LLM tools

The four inconsistently named wardrobe tools were replaced with a consistent, `wardrobe_`-prefixed CRUD-plus-wear set. This also adds the ability for characters to read item detail, edit stored items, and set the Portrait Cue — none of which the old tools could do — and fixes a latent registration bug.

- New tool set (7): `wardrobe_list` (was `list_wardrobe`), `wardrobe_read` (new), `wardrobe_create` (was `create_wardrobe_item`), `wardrobe_update` (new), `wardrobe_archive` (new, soft-archive only), `wardrobe_wear` (new), `wardrobe_take_off` (new). The old `wardrobe_change_item` and `wardrobe_set_outfit` are removed — wearing and removing are now split into `wardrobe_wear` / `wardrobe_take_off`, each taking an ordered `operations` array so several changes apply in one call (and avatar generation + the Aurora announcement fire once per call, not once per change).
- `wardrobe_create` and `wardrobe_update` can set the Portrait Cue (`image_prompt`); `wardrobe_list` and `wardrobe_read` now return it. Previously the field could not be set or seen by any tool even though it drives image generation.
- Multi-tier resolution: `wardrobe_list` and the other tools now resolve items across the character's own wardrobe **plus** the project stores and Quilltap General. `wardrobe_list` previously showed only the character's own items. List/read results carry an `is_own` flag. (The **group** tier is not yet wired into the wardrobe repository — a known limitation, tracked for a follow-up.)
- Write guard: `wardrobe_update` and `wardrobe_archive` can locate a shared item but refuse to mutate it (own items only), since shared archetypes are communal.
- `wardrobe_archive` is soft-only — it sets `archivedAt` (restorable from the Aurora UI) and never hard-deletes. Permanent deletion stays a human-only action.
- Fixed a registration drift in `GET /api/v1/tools`: it previously registered an `update_outfit_item` id that never matched the executor's dispatch name and omitted the equip tool entirely; tool ids, dispatch names, and `function.name` are now identical across the board (which also revives a dead wardrobe-summary branch in the chat UI).
- Capability gates unchanged: `canDressThemselves` enables list/read/wear/take_off; `canCreateOutfits` enables create/update/archive.

#### Added a "Head & Shoulders" physical-description prompt for avatars

Character avatars are a head-and-shoulders crop, but avatar generation used the full-body physical description — which often described below-the-crop anatomy that image-provider moderation (e.g. OpenAI `gpt-image-2`) rejects, even for fully-clothed characters. Added a dedicated head-and-shoulders prompt variant and made avatars prefer it.

- New optional `headAndShouldersPrompt` field on `physicalDescription` (max 500 chars), stored in the vault `physical-prompts.json` under the `headAndShoulders` key. Legacy files without the key still load (the field reads back as null).
- Avatar generation now prefers `headAndShouldersPrompt`, falling back to the medium/short/long/complete/full chain when it's empty. Story-background and system-prompt builders are unchanged (they keep using the full-body variants).
- The character creation wizard, AI import, and the character optimizer now generate/refine the field, with guidance to describe only face, hair, expression, and neckline — never breasts, torso, waist, hips, or legs.
- A one-time startup scan enqueues background `CHARACTER_HEADSHOULDERS_BACKFILL` jobs to fill the field for existing characters that have appearance text but no head-and-shoulders prompt yet. Jobs run in the background so a large library never blocks startup.
- Editable in Aurora → character → Descriptions.

#### Removed the wardrobe DB mirror and dropped the `wardrobe_items` table

Wardrobe items already lived in the document store (`Wardrobe/*.md`), but the code kept a parallel `wardrobe_items` DB table as a mirror and reconciled the two on every write. That second path is now gone; wardrobe lives solely in the vault.

- Removed the DB-mirror sync machinery: `syncCharacterVaultWardrobe`, `performVaultWardrobeSync`, and `ingestVaultOnlyWardrobeIntoDb` (`lib/database/repositories/vault-overlay/wardrobe-sync.ts`), plus the unused `CharactersRepository.syncWardrobeToVault` wrapper. `getOverlaidWardrobeItems` now reads vault-only (logs and returns `[]` for a character with no usable vault instead of falling back to DB rows).
- `WardrobeRepository`: removed the legacy DB update/delete fallbacks (update/delete now require a resolvable vault mount and throw otherwise), deleted `createFromVault` and the now-callerless `findByIds`, and dropped the raw-DB fallbacks from the id/archetype lookups so no per-request read touches the table.
- Decoupled wardrobe from `writeCharacterVaultManagedFields`; the full-character vault writer no longer projects wardrobe (which would risk wiping existing `Wardrobe/*.md` files). Repointed `ensureCharacterVault` and the character-vault backfill off `findByCharacterIdRaw`.
- Cleaned dead managed-fields mirror writes: the `prompts-dir`/`scenarios-dir` cases no longer write `systemPrompts`/`scenarios` back to dropped DB columns.
- New migration `drop-wardrobe-items-table-v1` snapshots all rows to `<dataDir>/backup/pre-drop-wardrobe-items.json`, then drops the index and table. It is gated behind both vault-population flags (`wardrobe_folder_migrated_v1`, `shared_wardrobe_moved_to_general_v1`), so the table is dropped only on a startup after both one-time population tasks have run.
- `findByCharacterIdRaw` and the `refresh-vault-wardrobe` / `move-shared-wardrobe-to-general` startup tasks are intentionally retained for now; they still run once on straight-through upgrades and are slated for removal in a later release.

#### Wardrobe items: optional image-generation cue ("Portrait Cue")

Wardrobe items gained an optional `imagePrompt` field — a short plain-text phrase fed to the avatar and Lantern image pipelines *in place of* the item's title when set, falling back to the title when blank. The title and prose `description` are unchanged; `description` is still stripped from image prompts (it's human prose). This lets a garment carry a literal visual cue the bare title can't convey (e.g. a rank glyph) without disturbing the human-readable title.

- New optional `imagePrompt` on `WardrobeItemSchema` (`lib/schemas/wardrobe.types.ts`); not Markdown.
- `decorateOutfitItems(..., { titleOnly: true })` now emits `imagePrompt` over `title` when present (`lib/wardrobe/outfit-description.ts`); the prose path is unchanged. Threaded through the avatar prompt (already title-only) and the scene/appearance paths (`lib/image-gen/appearance-resolution.ts`, `lib/memory/cheap-llm-tasks/{types,image-scene-tasks}.ts`, `lib/background-jobs/handlers/story-background.ts`, `lib/tools/handlers/image-generation-handler.ts`).
- Persisted as `imagePrompt:` vault frontmatter (`buildWardrobeItemFile` / `parseWardrobeItemFile`); round-trips through `.qtap` export/import and is documented in `qtap-export.schema.json` and `DDL.md`.
- Editor: new "Portrait Cue" input in the wardrobe item editor (`components/wardrobe/wardrobe-item-editor.tsx`), accepted by all six wardrobe create/update API routes.
- Project wardrobe manager: the project-level wardrobe editor (`components/wardrobe/ProjectWardrobeManager.tsx`) gained the same "Portrait Cue" input, threaded through `CreateProjectWardrobeInput` (`app/prospero/[id]/hooks/useProjectWardrobe.ts`); the item list now shows the cue in place of the description when set.
- Wardrobe is vault-only: removed the stale no-vault SQL-write fallback in `WardrobeRepository.create` (it now throws when no Character Vault / Quilltap General mount resolves instead of writing a primary `wardrobe_items` row). The sync-mirror path (`createFromVault`) is unchanged; the legacy `wardrobe_items` table has no `imagePrompt` column and never receives one.

#### Configurable background-job concurrency

The global cap on how many background jobs run at once is now adjustable instead of hardcoded at 4. A "Simultaneous Labours" slider in the Tasks Queue card (Settings → Data & System) sets it from 1 to 32; the default stays 4. Use a higher value when a more capable backend can handle more parallel work.

- New `maxConcurrentJobs` instance setting with `getMaxConcurrentJobs`/`setMaxConcurrentJobs` accessors (`lib/instance-settings/index.ts`, clamped 1–32, default 4).
- The dispatcher (`lib/background-jobs/host/job-dispatcher.ts`) reads the cap fresh each claim cycle, so a change applies within ~2 s without a restart; falls back to 4 if the read fails.
- New API action `GET`/`POST /api/v1/system/tools?action=job-concurrency` (validated 1–32); the tasks-queue status response now includes `maxConcurrentJobs`.
- Removed the dead "Memory extraction concurrency" number input from the Memory Regenerate card — it set `instance_settings.memoryExtractionConcurrency`, which the dispatcher stopped honoring when concurrency was unified into the global cap. The legacy key and its `/api/v1/memories?action=extraction-concurrency` route remain for the `memory-diff` CLI.

#### TanStack Query migration — Phase 7 (SWR removal)

SWR is fully gone. With every read and mutation now on TanStack Query, the surviving provider and dependency were removed.

- Removed `<SWRConfig>` from `components/providers/session-provider.tsx` (now `<QueryProvider>` is the sole top-level server-state provider).
- Deleted `lib/swr-fetcher.ts` (nothing imports it; `apiFetch`/`ApiFetchError` in `lib/query/fetcher.ts` carry the same throw-on-non-2xx semantics).
- Removed the `swr` dependency from `package.json` / lockfile.
- Moved the migration spec to `docs/developer/features/complete/`.
- Verified: no `useSWR`/`SWRConfig`/`swr` imports remain in app/components/hooks/lib/tests; `npx tsc`, full lint, and the unit suite (7108 tests) pass.

#### TanStack Query migration — Phase 6 (SSE boundary)

Documented the boundary between the Salon's live message transport and TanStack Query. The Fetch-Streams/SSE path (`useSSEStreaming`) stays as-is: stream chunks are never written into the query cache; the query reads *around* streaming (chat list, settings, LLM logs) are on TanStack Query and refresh through their own hooks. No behavior change.

- `app/salon/[id]/hooks/useSSEStreaming.ts`: added an explicit boundary comment. Verified the streaming hooks (`useSSEStreaming`, `useMessageStreaming`) are free of `useSWR`/`useQuery`.

#### TanStack Query migration — Phase 5 (page-level reads + remaining consumers)

Migrated the last `useSWR` reads — the big page components and remaining dialogs/cards. After this, no `useSWR`/`useSWRConfig` remains outside the surviving `<SWRConfig>` provider (removed in Phase 7).

- Pages: `app/aurora/page.tsx` (characters read + a `mutateCharacters` shim preserving the optimistic `mutate(updater, { revalidate: false })` toggles for favorite/controlledBy/Carina), `app/salon/page.tsx` (5 reads + `mutateChats`→`refetch`), `app/profile/page.tsx`, `app/salon/new/page.tsx`, `app/generate-image/page.tsx`.
- Dialogs/cards: `AddCharacterDialog`, `ChatSidebar` (3 conditional reads), `HelpChatDialog`, `LLMLogsSection`, `ProjectToolSettingsModal`, `DataDirectorySection`, `AutoLockSettingsCard`, and `CoreWhisperSection` (optimistic `setQueryData`).
- `StartupProgress`: the global `useSWRConfig().mutate(() => true, …)` cache-bust on server-ready became `queryClient.invalidateQueries()`.
- Grew `lib/query/keys.ts`: `userProfile`, `system.dataDir/unlock`, `llmLogs.byCharacter`, `tools`, `helpChat.pastChats`.
- Front-end only: no API/route, schema, DDL, migration, export, or backup change.

#### TanStack Query migration — Phase 4 (wrapper hooks + inline read/mutate pairs)

Migrated the self-contained wrapper hooks and the inline read+mutate component pairs. Behavior preserved: SWR `mutate()` revalidations became `refetch()`/`invalidateQueries()`, optimistic `mutate(x, false)` became `setQueryData`, and the autonomous-room optimistic `mutate(post, { optimisticData, rollbackOnError })` pattern became `useMutation` with `onMutate`/`onError`/`onSettled`. Polling `refreshInterval` became `refetchInterval`.

- Wrapper hooks: `useLLMLogs`, `useChatControls` (its one connection-profiles read), `useTextReplacementRules`, `useStoryBackground` (polling + change detection), `useTasksQueue` (polling + job controls), `useGalleryData` (optimistic `setQueryData`), `useSystemPrompts`, `useRoleplayTemplates`, and `useChatSettings` (4 reads + ~30 handlers — kept byte-identical via a `mutateSettings` shim that maps to `setQueryData`/`invalidateQueries`).
- Inline pairs: `image-gallery`, `api-keys-tab`, `tags-tab`, `ThemeBrowser`, `StateEditorModal`, `help-chat-provider`, `capabilities-report-card`, `llm-logs-card`, and the two autonomous-room components (`autonomous-rooms-card`, `autonomous-room-badges`) which now use `useMutation` for their optimistic toggles.
- Grew `lib/query/keys.ts`: `llmLogs`, `system.tasksQueue/capabilitiesReports/autonomousRooms`, `chats.background`, `projects.background/state`, `settings.textReplacements`, `roleplayTemplates`, `embeddingProfiles`, `imageProfiles`, `images`, `apiKeys`, `themes`, `helpChat.eligibility`.
- Tests: `tasks-queue-card` and `image-gallery-deleted-handling` moved from `SWRConfig` to `QueryClientProvider`; new focused `useChatSettings` optimistic-update test.
- Front-end only: no API/route, schema, DDL, migration, export, or backup change.

#### TanStack Query migration — Phase 3 (module-level cache hooks)

Replaced the three hand-rolled module-level fetch caches with `useQuery`. They keep their "fetch once, share everywhere" reference-data feel via `staleTime: Infinity` and TanStack's by-key dedup, dropping the manual `fetchPromise` plumbing.

- `hooks/useProviders.ts`, `hooks/useConnectionProfiles.ts`: `useQuery` + a `select` mapper; the `getProviderIcon`/`getProviderDisplayName`/`getProfileProvider` helpers are unchanged.
- `hooks/usePersonaDisplayName.ts`: `useQuery` for `?controlledBy=user`, with the duplicate-name `Set` derived in `select` (referentially stable, which matters since every ChatCard mounts this hook). Removed the module cache and the test-only `resetDisplayNameCache()` export.
- Test harness: added `createQueryWrapper()` to `__tests__/helpers/renderWithQuery.tsx` for `renderHook`. `usePersonaDisplayName.test.ts` now uses a fresh QueryClient per test instead of `resetDisplayNameCache()`. Two component suites that render these consumers (`homepage-components`, `ParticipantCard`) now render through `renderWithQuery` so a QueryClient is in scope.
- Front-end only: no API/route, schema, DDL, migration, export, or backup change.

#### TanStack Query migration — Phase 2 (conditional/simple reads)

Migrated the low-risk, read-only SWR call sites to `useQuery` (no mutations in this batch). Behavior preserved: conditional `useSWR(cond ? url : null)` became `useQuery({ enabled: cond })`.

- 16 files moved off SWR: `search-dialog.tsx` (dead import removed), `HelpEntityPicker.tsx`, `LibraryFilePickerModal.tsx` (5 reads), `FolderPicker.tsx`, `useFilePreview.ts` (raw-text queryFn, not JSON), `PluginConfigModal.tsx`, `useDictionaryFeed.ts`, `useEntitySearch.ts`, `GenerateImageDialog.tsx`, the Lexical spellcheck reads (`LexicalComposerWrapper.tsx`, `TextReplacementPlugin.tsx`, `DocumentPane.tsx`), `tag-style-provider.tsx`, `MoveToProjectModal.tsx`, `ChatProjectModal.tsx`, `CreateNPCDialog.tsx`.
- `FolderPicker`'s `mutate()` revalidation became `refetch()`. Dynamic URLs are built inside the queryFn from the same inputs the query key encodes (satisfies `@tanstack/query/exhaustive-deps`).
- Grew the `lib/query/keys.ts` factory: `chats.photoAlbums/groupStores`, `projects`, `mountPoints`, `tags`, `plugins`, `photos`, `files`, `helpChat`.
- Front-end only: no API/route, schema, DDL, migration, export, or backup change.

#### TanStack Query migration — Phase 1 scaffolding

First step of migrating the client's server-state fetching from SWR to TanStack Query v5 (see `docs/developer/features/tanstack-query-migration.md`). This phase adds the foundations only; no fetch site has moved yet, so there is no behavior change.

- Added deps: `@tanstack/react-query`, `@tanstack/react-query-devtools`, `@tanstack/eslint-plugin-query` (all ^5.101.0).
- New `lib/query/`: `query-client.ts` (`makeQueryClient` factory — `staleTime: 30s`, `refetchOnWindowFocus: false`, `retry: 1`), `QueryProvider.tsx` (client provider holding the client in `useState`, dev-only devtools), `fetcher.ts` (`apiFetch` + `ApiFetchError`, mirroring `swrFetcher`'s throw-on-non-2xx and `error.status` shape, forwards `AbortSignal`), and `keys.ts` (the query-key factory — the single source of cache identity; grows per migration phase).
- `components/providers/session-provider.tsx`: `<QueryProvider>` now wraps the existing `<SWRConfig>`. Both coexist until the last `useSWR` is gone.
- `eslint.config.mjs`: added `@tanstack/eslint-plugin-query` flat recommended rules.
- Test harness: `__tests__/helpers/renderWithQuery.tsx` (fresh client per render, retries off, `gcTime: 0` — the TanStack analogue of the old `provider: () => new Map()` SWR wrapper). `fetch` stays mocked via `jest-fetch-mock`.
- Front-end plumbing only: no API/route, schema, DDL, migration, export, or backup change.

#### CLAUDE.md slimmed; CLI reference extracted to docs/developer/CLI.md

Restructured `CLAUDE.md` to lead with the standing rules that apply on every task and push reference material to the end. Cut it from ~280 lines/~5,000 words to ~177 lines/~2,140 words by extracting the full `npx quilltap` CLI manual into a new `docs/developer/CLI.md` and trimming the inline background-jobs and Carina write-ups to short pointers at their existing docs (`BACKGROUND_JOBS_CHILD.md`, `features/carina.md`).

- New file `docs/developer/CLI.md`: complete CLI reference (db inspection/maintenance/health, docs/memories/logs/migrations namespaces, instance resolution precedence, read-only-vs-`--write` lock-gating, low-level raw SQL, global flags). Registered in `.claude/commands/update-documentation.md`.
- `CLAUDE.md`: grouped the always-obey rules (spelling, writing voice, pre-commit, hard stops, code-path chokepoints) up top; stopped inlining the volatile `systemSender` enum list and now points at the source enum in `lib/schemas/chat.types.ts` instead. No behavior or schema change — documentation only.

#### Aurora header: the Carina and User-controlled toggles now light up when active

The favorite star already filled in when a character was favorited, but the two icons beside it — the Carina (monitor) and User-controlled (person) toggles — were permanently golden regardless of state, giving no on/off feedback. They now mirror the star: golden (`qt-text-favorite`) when active, muted grey (`qt-text-secondary`) when inactive, with the color change animated via `transition`. Applies to both the `/aurora` list cards and the `/aurora/[id]/view` detail header.

- `app/aurora/[id]/view/components/CharacterHeader.tsx` and `app/aurora/page.tsx`: conditional color class keyed off `canBeCarina` / `controlledBy === 'user'`. On the list page, also collapsed two dead ternaries that rendered the same `<Icon>` in both branches into a single icon with the conditional moved into `className`.
- Front-end only: color goes through existing `qt-*` utility classes (no new Tailwind, no new `qt-*` tokens); no schema, DDL, migration, export, or backup change.

#### Carina: a line opens when either side is an answerer

Carina reachability is no longer gated on the answerer alone. A Carina line now opens when **either** party qualifies: a Carina answerer can still be reached by anyone, a Carina-enabled **asker** can reach any character — even a non-answerer — and the **human operator** can always reach anyone regardless of whether their persona is an answerer (or whether they have a persona participant at all).

- `lib/services/carina/carina.service.ts`: `runCarinaQuery` resolves the answerer name without the prior `canBeCarina` filter, then decides reachability from both sides. It prefers a `canBeCarina` name match (reachable by anyone); only when none of the name matches is an answerer does it consult the asker side via the new `askerOpensCarinaLine` helper. That helper opens the line when (1) the query is `operatorInitiated` (new option, set by the orchestrator's user-message path — short-circuits before any DB read), (2) the asking participant is `controlledBy: 'user'` (the operator's persona), or (3) the asking character is `canBeCarina` (read via the overlay-free `findByIdRaw`). When no side opens the line, the result is still `not-found`.
- `lib/services/chat-message/orchestrator.service.ts`: the user-message markup path passes `operatorInitiated: true`.
- The `ask_carina` tool definition (`lib/tools/ask-carina-tool.ts`) and the `self_inventory` `carina`-section descriptions were updated to state the either-side rule. Tool-definitions snapshot regenerated (two description strings).
- `self_inventory` `carina` section now reports **who you can reach**, not just the other answerers (`lib/tools/self-inventory-tool.ts`, `lib/tools/handlers/self-inventory-handler.ts`): when the calling character is itself an answerer, `reachable` lists **every** other character, each flagged whether it is also an answerer; when it is not an answerer, `reachable` lists only the Carina answerers (the only characters it can reach). Replaced the `otherAnswerers: string[]` field with `reachable: { name, isAnswerer }[]` and reworked `formatCarinaSection`.
- No schema, DDL, migration, `.qtap`/SillyTavern export, or backup change (`canBeCarina` is unchanged). Help: `help/carina.md` ("A line opens from either side"). Dev doc: `docs/developer/features/carina.md`. Tests: new either-side cases in `lib/services/carina/__tests__/carina.service.test.ts` and a new carina-section block in `__tests__/unit/lib/tools/handlers/self-inventory-handler.test.ts`.

#### self_inventory: new `carina` section

Added a tenth top-level section to the `self_inventory` tool, `carina`, so a character can introspect its Carina (inline `@`-query) standing: whether it is itself a Carina answerer (`canBeCarina === true`), and the names of every other Carina-enabled character in the instance.

- `lib/tools/self-inventory-tool.ts`: added `'carina'` to `SELF_INVENTORY_SECTIONS`, the `SelfInventoryCarinaSection` type, and the `carina?` field on `SelfInventoryToolOutput`; updated the tool/section descriptions (nine → ten top-level sections).
- `lib/tools/handlers/self-inventory-handler.ts`: `buildCarinaSection` resolves the data from `repos.characters.findAllRaw()` — the overlay-free raw read, since `canBeCarina` is a DB column, not a vault field — so a single broken character vault can't sink the listing (mirrors the orchestrator's per-turn answerer probe). Added `formatCarinaSection` and wired both into the execute/format paths.
- Regenerated the tool-definitions snapshot (`lib/tools/__tests__/tool-definitions-snapshot.test.ts`); diff is additive (one enum value + description text). No schema, DDL, migration, export, or backup change.

The **Play As (Optional)** dropdown on the New Chat and "Continue Elsewhere" forms now offers every character already added to the chat, not just characters whose default `controlledBy` is `'user'`. Choosing one switches that participant in place to `controlledBy: 'user'` (its connection profile is cleared) — the same in-place mechanism the expanded picker panel's "Play As (User)" select already used. Both controls now read and mutate one source of truth: `selectedCharacters[].controlledBy`.

- When any user-controlled participant is present, the **Make this an autonomous room** toggle is disabled with an explanatory note (on top of the existing submit-time and server-side guards, which are unchanged).
- Reverting a character to "Chat as yourself": a default-user persona pulled in by the dropdown is removed from the cast; a default-LLM character that was flipped is handed back to the LLM with its connection profile cleared (so the submit guard asks for a profile again — same behavior as the picker panel).
- Retired `state.selectedUserCharacterId` from `NewChatFormState`; the user persona now lives only in `selectedCharacters`. The submit path no longer appends a separate user participant. Seeding (continuation, single-character, single-LLM defaults) now adds the user/partner as an in-place user entry, skipped in autonomous mode.
- `useNewChat` keeps the full character roster so a default-user character can be pulled into the cast and seeding can resolve a user character whose default is either `'llm'` or `'user'`.
- UI/state-layer only: no schema, DDL, migration, `.qtap`/SillyTavern export, or backup changes. Help: `help/chats.md` (new "Play As" section), `help/autonomous-rooms.md` (toggle-disabling note). Tests: 7 new cases in `components/new-chat/__tests__/NewChatForm.test.tsx`.

#### Fix: badges with `qt-text-xs` were illegible on bold-accent themes (app-wide)

Badges carrying `qt-badge … qt-text-xs` (e.g. the `Default` scenario badge, wardrobe type/default/info/warning badges) went low-contrast on bold-accent themes such as Madman's Box. A `.qt-badge*` already sizes itself via `--qt-badge-font-size` (0.75rem) and sets its own per-variant foreground, but `.qt-text-xs` ALSO forces `color: var(--qt-text-secondary-fg)`; defined later in the cascade with equal specificity, that muted color overrode the badge's intended foreground — illegible amber-on-amber where `primary`/status fills are loud.

- Swept the redundant-and-harmful `qt-text-xs` off every badge call site (12 spans across `components/scenarios/ScenarioRow.tsx` and the wardrobe UI: `wardrobe-item-row.tsx`, `equipped-bundle-card.tsx`, `equipped-slot-row.tsx`, `ProjectWardrobeManager.tsx`, `wardrobe-item-editor.tsx`). Solid-fill variants now show their own foreground; the two bare `qt-badge` labels (Composite/Archived) use color-only `qt-text-secondary` to keep their muted tint. Sizes are unchanged (the badge token already equals `text-xs`).
- Chose a call-site sweep over a CSS guard on `.qt-text-xs` itself: many non-badge elements legitimately layer `qt-text-xs` with an explicit color (`qt-text-success`/`qt-text-warning`/`qt-text-muted`/`qt-text-secondary`), so raising `qt-text-xs`'s color specificity would have clobbered those. No `qt-*` class changed, so no theme-storybook / stylebook / bundled-theme update; no schema, DB, or export change.

#### Fix: Scenario Edit dialog showed the wrong (previous) scenario's body

Opening the Edit dialog for one scenario, then another, showed the first scenario's body in the editor for every subsequent scenario — and the first scenario opened (often the default, alphabetically first) showed an empty editor. Root cause: `ScenarioEditorModal` seeded its `body` state in a `useEffect`, but the Lexical editor's `remountKey` (`edit:<path>`) is computed during render. `MarkdownLexicalEditor` only reads its value at mount and remounts when `remountKey` changes, so the editor remounted on the new key while `body` still held the previous scenario's text; the effect's `setBody` landed a commit too late and never re-triggered a remount. Affected both project and general scenarios (shared modal).

- `components/scenarios/ScenarioEditorModal.tsx`: seed the form synchronously during render (React's "adjust state when a prop changes" pattern, guarded by a `seededKey`) instead of in an effect, so `body` is correct in the same commit that flips `remountKey`. Re-seeds fresh on every open (including re-opening the same scenario). Removed the now-unused `useEffect`/`useMemo`.
- New `components/scenarios/__tests__/ScenarioEditorModal.test.tsx`: the editor mock faithfully mimics the "read value only at mount, remount on remountKey" contract, so the switch-while-open case fails on the old code and passes on the fix (4 cases). UI-only React state fix; no schema, DB, or export change.

#### Fix: Scenarios rows no longer wrap into unreadable single-letter columns in narrow cards

In the narrow project Scenarios card (the three-column Prospero grid at `xl`, ~370px), the per-row `Edit` / `Rename` / `Delete` text buttons had no horizontal room and flexbox wrapped them down to one character per line. The row is now width-adaptive: inline buttons when the container is wide, a single `⋮` kebab menu when it's narrow. One component serves both the project card and the wide `/scenarios` page.

- New `components/scenarios/ScenarioRow.tsx`: presentational row owning its own kebab open-state (outside-`mousedown` + capture-phase `Escape` close, mirroring `wardrobe-item-row.tsx`). Renders both an inline `Edit`/`Rename`/`Delete` cluster (`hidden @lg:flex`) and a kebab (`@lg:hidden`) built from the existing `qt-dropdown` / `qt-dropdown-item` classes; a Tailwind v4 container query (`@container` on the `ScenariosManager` root) picks one by the row's actual width. The default radio and Default badge are unchanged in both modes.
- `components/scenarios/ScenariosManager.tsx`: extracted the inline `<li>` into `<ScenarioRow>`; all mutation handlers (set-default / edit / rename / delete) stay in the manager.
- `app/prospero/[id]/components/ScenariosCard.tsx`: dropped `overflow-hidden` (rounded the header button instead) so the kebab menu on the last row isn't clipped by the card.
- New `components/scenarios/__tests__/ScenarioRow.test.tsx` (12 cases: content, default radio, inline buttons, kebab open/close via Escape + outside click, menu-item callbacks). No new `qt-*` tokens or Tailwind utilities; no schema, DB, migration, or export change. Documented in `help/project-scenarios.md` and `help/general-scenarios.md`.

#### Fix: Carina answers no longer fail with "empty response" when the answerer thrashes tools

A Carina query routed to a tool-eager reasoning model could exhaust the tool-iteration budget without ever composing a prose reply — the model emitted a tool call on the initial stream and on all 5 allowed iterations, leaving the answer buffer empty. The loop exited on the cap and `runCarinaQuery` returned `llm-failed: empty response`, which Prospero surfaced as "<Name> was unable to respond — empty response," even though the answerer had gathered plenty via document/scene/memory tools.

- `lib/services/carina/carina.service.ts`: after the detect→execute→re-stream loop, if the budget is exhausted with an empty answer buffer and the last response still carries pending tool calls, run one final "forced-text" turn — re-stream the accumulated context with `tools: []` (which resolves to `undefined` at the provider call, offering no tools), so the model must answer in prose from what it already gathered. A genuinely empty response with no pending tool calls skips the forced turn and falls through to the existing empty-response error unchanged.
- Tests: three new cases in `carina.service.test.ts` (forced turn rescues the answer and posts it with no tools offered on the 7th stream; forced turn still empty → graceful `llm-failed`; no forced turn for a genuinely empty, no-tool response). 46 tests pass.
- No schema, DB, migration, or export change.

#### New Chat: layer free-text notes onto a chosen scenario

The New Chat dialog's free-text editor now stays visible even after a preset scenario (character / project / group / general) is selected, so you can start from a scenario and add extra scene-setting on top instead of choosing one or the other.

- `NewChatForm.tsx`: the `MarkdownLexicalEditor` is always rendered (previously hidden when a preset was selected). When a preset is chosen it sits below the read-only preview with an "added beneath the scenario above" hint and an "Additional scenario notes" label; with no preset it keeps the "Starting scenario" label. `handleScenarioSelectChange` no longer clears `scenario` when a preset is picked, so typed text survives selection changes.
- `useNewChat.ts`: `scenario` is now sent independently of the preset field (split out of the precedence `if/else if`) rather than suppressing it.
- `app/api/v1/chats/route.ts`: `scenario` changed from an override to additive. The route resolves the chosen preset body first, then appends `scenario` beneath it via the new `combineScenarioText` helper (`lib/chat/scenario-text.ts`, `presetBody.trimEnd() + "\n\n" + freeText.trim()`). With no preset, the free text is the whole scenario, as before. `contextSummary` now stores the combined `resolvedScenario` (previously only the raw custom text), so preset-only chats now show the scenario body in the Salon sidebar.
- No schema, DB column, migration, DDL, or export change — the combined string still persists into the existing `chat.scenarioText`.
- Tests: new `scenario-text.test.ts` (combine helper) and `components/new-chat/__tests__/NewChatForm.test.tsx` (editor stays visible with a preset; preset selection preserves typed text). `scenario-persistence.test.ts` updated for the combine semantics (custom text now appends to the `scenarioId` body rather than overriding it). Documented in `help/general-scenarios.md` and `help/project-scenarios.md`.

#### Fix: keyword badges and accent surfaces were illegible on bold-accent themes

Memory-card keyword pills (Aurora → character → Memories) rendered low-contrast under Madman's Box: the pill set a `bg-accent` background but no text color, so the text fell back to the card's light foreground over the theme's bright-amber accent. Root cause is broader — the app follows the shadcn/Quilltap convention where `accent` is a quiet hover/selected/surface tint (the default themes set it to a near-`muted` neutral), but Madman's Box maps `accent` to a loud amber, so every "quiet surface" use turned into a bright-amber block with low-contrast text. Swept and fixed app-side; the amber accent identity is preserved.

- Filled chips/badges that carry persistent text on a solid accent fill now pair the fill with its accent foreground: keyword pills (`components/memory/memory-card.tsx`), the search dialog's `↵`/`Esc` kbd hints (`components/search/search-dialog.tsx`), and the theme-registry source pills (`components/settings/appearance/components/ThemeBrowser.tsx`) use `qt-bg-accent qt-text-on-accent`.
- New `.qt-hover-accent` utility (`app/styles/qt-components/_utilities.css`): on hover it paints the accent background and forces the accent foreground onto the row **and every descendant**, so composite rows stay legible even when children carry their own color (e.g. `qt-text-primary` names that would otherwise go amber-on-amber). Replaced 48 full-opacity `hover:bg-accent` sites across 26 files. The `/opacity` blend variants (e.g. `hover:bg-accent/50`) were left alone — they composite dark over the card and stay readable.
- Informational panels switched from `bg-accent` to the quiet `qt-bg-muted` surface (speaker-mapper, image-upload context note, theme-selector hint, timestamp-config info).
- Selected/active states switched from `bg-accent` to the codebase's standard faint `qt-bg-primary/10` tint (export-type / restore / scope-selection / display-options cards, theme + color-mode menu rows, left-sidebar popout toggles).
- `@quilltap/theme-storybook` 1.0.43: adds the `.qt-hover-accent` utility to its CSS copy and a new `Surfaces` story documenting the accent-surface contract for theme authors (filled accent + `qt-text-on-accent`, `qt-hover-accent`, and the quiet `qt-bg-muted` / `qt-bg-primary/10` surfaces).
- No schema, migration, DDL, or export change. CSS-only behavior; resolves identically on the default themes (where `accent` is already subtle), so no visual regression there.

When a human drives a character (a participant with `controlledBy: 'user'`), that character now forms its own memories from the turns the human plays it — both SELF memories and OTHER-pass observations of the other characters present — so it carries those impressions forward when control returns to the LLM. Previously a user-controlled character was only ever a thing memories were *about*, never a holder. Always on; no flag, UI, settings, schema, migration, or export change.

- `buildTurnTranscript` (`lib/services/chat-message/turn-transcript.ts`) promotes the turn opener to a first-class slice flagged `isUserControlled` when the opener's `participantId` resolves to a `controlledBy: 'user'` CHARACTER participant. The slice is built from the opener's authoritative participant (more reliable than the singular `userCharacterId`) and prepended so it reads first chronologically. New `isUserControlled?` field on `TurnCharacterSlice`.
- `processTurnForMemory` (`lib/memory/memory-processor.ts`) now picks up the user slice automatically in both the SELF and OTHER loops. The OTHER-pass subject set is de-duped by character ID (the user character would otherwise appear once via its slice and once via the explicit user-subject block); the explicit block now fires only as a fallback for a present-but-silent user character. The user character is never its own OTHER subject, and its subject entry stays tagged `isUser: true`. New `[Memory]` debug logs distinguish user-driven extraction.
- `renderTurnContext` (`lib/memory/cheap-llm-tasks/memory-tasks.ts`) renders the user-controlled character's text exactly once (labeled "the user-controlled character"), keeps it off the AI-character roster, and no longer double-feeds the opener. A new first-person clause is prepended to the SELF prompt only when the subject is user-controlled, binding "I/me/my" in the subject's own lines to the subject; it leaves the cached AI-path body prefix byte-identical.
- The dry-run "regenerate from history" path shares the same builders, so re-extracting a conversation now also surfaces the played character's candidates for review.
- New unit tests across the transcript builder, prompt rendering, and processor; documented in `help/memory-playing-a-character.md`.

#### Theme preview is now a full-page modal (gallery + icon sheet)

Replaced the inline "expanded card" theme preview in Settings → Appearance with a full-page modal dialog. The modal adds a Light/Dark toggle (driving both the banner and the live element preview), a gallery of the theme's bundled images, and an icon sheet showing each overridden icon in four states (default, muted, hover, on-primary). Also fixed banner-header contrast on vivid themes: the banner is painted in the theme's own background color with an accessible foreground (white/dark) computed from it.

- New `themeRegistry.getImages(themeId)` returns manifest-referenced preview images only (`previewImage` + `subsystems[*].backgroundImage`/`thumbnail`), resolved to asset URLs via the existing `resolveThemeAssetUrl`, de-duped and sorted alphabetically. It does not enumerate the bundle directory. The tokens endpoint (`GET /api/v1/themes/:id?action=tokens`) now returns `images` alongside the already-present `icons`.
- New `ThemePreviewModal` (built on `BaseModal`) reuses `ThemePreviewPanel` for the live preview. The icon sheet renders inside a theme-scoped container so the bundled icon-override CSS and color tokens are in effect; `generateIconOverrideRule`/`generateIconOverridesCSS` gained an optional `scopePrefix` argument for this (default empty preserves existing global behavior).
- Contrast/badge helpers (`getLuminance`, `getContrastingTextColor`, `getMutedTextColor`, `getSourceBadge`) were lifted out of `ThemeCard` into a shared `components/settings/appearance/utils/contrast.ts`. `ThemeCard`'s inline expanded branch was removed; `ThemeSelector` now renders one modal driven by `previewThemeId`.
- No schema, migration, DDL, or export change — reads existing manifest fields only. No `packages/` changes. Documented in `help/themes.md`.

#### Fix: scheduled autonomous rooms could wedge "running" with no turns

Fixed a race that left a cron-scheduled autonomous room stuck in `runState: 'running'` with zero turns consumed and no turn job in flight — sitting idle indefinitely (the schedule tick skips `running` rooms, so nothing recovered it). Cause: the scheduled-start path ran in the forked job child, where the `currentRunId` write was buffered; the first turn job it enqueued could run before that write committed, read the prior run's id, and self-abort via the stale-run guard without re-enqueuing. Most likely at a cold boot when a missed slot fires amid the startup job flood.

- The scheduled run-start now funnels through the same parent-ordered core as the manual start, reached from the child via a new `startScheduledAutonomousRun` host-RPC method, so `currentRunId`/`runState` commit on the parent's RW connection before the first turn is enqueued — the manual path was already race-free for this reason. Run-start logic is now single-sourced in `lib/background-jobs/handlers/autonomous-run-start.ts` (`beginAutonomousRun`), shared by `startAutonomousRoomManually` and the schedule tick.
- Added a defense-in-depth self-heal sweep (`healWedgedRuns`) to the per-minute schedule tick: a room left `running` with no pending/processing turn job, untouched past a 60s grace, gets a turn re-enqueued so it resumes on its own instead of wedging.
- No schema, migration, DDL, or export change. New unit tests for the run-start ordering contract, the host-RPC bridge routing, and the heal sweep.

#### Madman's Box: refreshed Settings backgrounds

Updated the `calliope-bg.webp` (Appearance) and `forge-bg.webp` (AI Providers) Settings background textures in the bundled Madman's Box theme. Asset-only refresh of two of the eight subsystem backgrounds wired in the previous entry; theme bumped 1.1.2 → 1.1.3 so installed copies pick up the new art. No code, schema, manifest-structure, or export change.

#### Theme-overridable page backgrounds

Themes can now override the per-page subsystem background images on the content pages (Aurora, Prospero, Salon, Files, Scriptorium, Photos) via the manifest `subsystems.<id>.backgroundImage` field — the same mechanism the Settings page already used. Previously those seven call sites hardcoded their `/images/<subsystem>.webp` URL inline; they now resolve it through the existing `useSubsystemInfo` pipeline via a new shared `useSubsystemBackgroundStyle(id)` hook (`components/providers/theme/`). Behavior is unchanged under the default theme. A theme that sets a subsystem's `backgroundImage` to `"none"` suppresses that page's background entirely. The Settings page was refactored onto the same hook (every settings tab is themeable, including AI Providers/`forge` and Appearance/`calliope`). No schema, migration, DDL, or export change — the manifest already supported `subsystems`. Documented in `help/themes.md`. The per-chat/per-project user-set story backgrounds in `/salon/[id]` and `/prospero/[id]` are unaffected.

The bundled Madman's Box theme is the first consumer: its manifest wires all eight subsystem backgrounds (the six content pages plus `forge` and `calliope`) and ships the matching WebP art under `textures/`. Its homepage background — which uses the whole-body `.qt-homepage-container` rather than a subsystem — is themed separately via a homepage-scoped `::before` rule in the theme's `styles.css` (`home-bg.webp`). As a dark-only theme it needs only a single background per surface, with no light/dark variant.

#### Memory recall relevance — Phase 2: context steering, participant boost, opt-in related-memory expansion, query-path unification

Completes the recall-relevance work begun in Phase 1 and unifies the two recall query paths. All adjustments remain bounded, clamped multipliers on the final blended score — the `0.4·cosine + 0.6·effectiveWeight` blend is untouched, and absent recall context still produces byte-identical historical behavior. No schema, migration, DDL-column, `.qtap`-export, or backup change; the new setting rides in the same migration-free `instance_settings['memoryRecall']` key/value store as Phase 1's `scopePolicy` (single-user model).

- **Context-axis steering (item 3).** The cheap-LLM keyword distiller (`lib/memory/cheap-llm-tasks/memory-tasks.ts` `extractMemorySearchKeywords`) now also emits a best-guess turn-level `temporal` + `context` label. A memory whose own `context` tag matches the turn's guessed context gets a small boost (×1.10).
- **Participant-aware boost (item 4).** A memory that is *about* a character present in the room this turn (the responding character plus every other character participant) gets a boost (×1.20) on the main dynamic head. It is a boost, never a filter — absent characters can still be discussed.
- **Related-memory one-hop expansion (item 5).** New opt-in setting `expandRelated` (default OFF). When on, after the top hits are ranked, recall pulls each top hit's strongly-linked related memories in as extra candidates (one hop, capped at 3 per hit and 10 total), scores them against the same query embedding, runs them through the same blend + multipliers, and re-ranks the union — catching the memory relevant by association that didn't clear the embedding threshold directly (the classic RAG miss).
- **Query-path unification.** The dynamic-head recall path now routes through the same cheap-LLM keyword distillation the proactive path already used (instead of embedding the raw last user message verbatim), so both paths build the embedding query at one quality bar and both feed the turn-level temporal/context guess into the adjustments.
- **New setting — related-memory expansion.** `expandRelated` (boolean, default `false`) joins `scopePolicy` in `instance_settings['memoryRecall']` (`getMemoryRecallSettings`/`setMemoryRecallSettings`). Surfaced as a checkbox toggle on the existing "Recall Relevance" card on `/settings?tab=memory`.

#### Memory recall relevance — Phase 1: read the targeting tags back at recall time (scope + temporal)

Recall-side follow-up to the extraction-enrichment work. The extractor already writes `temporal`/`scope`/`context` targeting tags into every memory's `keywords` and a rename-proof `projectId`, but the per-turn recall path consulted none of them — it ranked purely on `0.4·cosine + 0.6·effectiveWeight`. Phase 1 reads `scope`/`temporal` back and applies bounded, clamped multipliers to the final blended score (the blend itself is untouched), closing cross-project memory leakage and demoting stale `past`/`moment` facts. No schema, migration, DDL-column, `.qtap`-export, or backup change — tags live in `keywords`, `projectId` already exists, and the new setting lives in the migration-free `instance_settings` key/value store.

- **New pure helper `lib/memory/recall-tags.ts`** — single source of truth for the closed targeting-tag vocabularies (the extraction path `lib/memory/cheap-llm-tasks/memory-tasks.ts` now imports the Sets from here instead of re-declaring them). Exports `parseTargetingTags` (reads tags back out of `keywords` with last-match-wins so an appended tag beats a colliding free keyword; defaults match the extraction side), `scopeProjectMultiplier`, `temporalMultiplier`, and `combineRecallMultipliers`. Pure + I/O-free; 21 unit tests in `lib/memory/__tests__/recall-tags.test.ts`.
- **Scope + project gating (item 1).** `scope: wide` and `projectId: null` memories pass through unchanged. `scope: narrow` whose `projectId` matches the current chat is boosted (×1.15); a cross-project `scope: narrow` memory is strong-down-weighted (×0.15, default) or excluded, per the new setting. A narrow memory in a project-less chat counts as cross-project.
- **Temporal down-weighting (item 2).** `past` (×0.85) and `moment` (×0.70) are penalized; `present`/`future` pass through. The `moment` penalty is unconditional on the recall path because recall always runs before the current turn's extraction.
- **`searchMemoriesSemantic` gains an optional `recallContext`** (`{ currentProjectId, scopePolicy }`). When present, the targeting multipliers are applied to the blended score *after* the `0.4/0.6` sort key, before `slice(0, limit)`; cross-project-narrow exclusions are dropped pre-sort. Absent → byte-identical ranking to before (the `search` tool and tests pass nothing). `SemanticSearchResult` carries an optional `recallAdjustment` record (`multiplier`, `fired[]`, `blendedBefore`, `blendedAfter`).
- **Both recall paths wired.** The dynamic head (`lib/chat/context-manager.ts`) and the proactive path (`lib/services/chat-message/pre-compute.service.ts`) build `recallContext` from `chat.projectId` + the instance recall settings. `formatDynamicMemoryHead` now ranks by the post-adjustment score when present (it previously re-sorted by weight, which would have undone the adjustments).
- **New setting — cross-project scope policy.** Stored instance-wide in `instance_settings['memoryRecall']` (`getMemoryRecallSettings`/`setMemoryRecallSettings`), read/written via `GET|POST /api/v1/memories?action=recall-config`. Surfaced as a "Recall Relevance" card on `/settings?tab=memory` (`components/tools/memory-recall-card.tsx`). Default `down-weight`.
- **Debug instrumentation before tuning.** Every fired adjustment and every cross-project exclusion logs at `debug` from `searchMemoriesSemantic`; the salon whisper's metadata tag and the per-turn `debugMemories` now carry the fired labels + pre/post-adjustment scores, so each ranking decision is reconstructable from `logs/combined.log`.
- Help: new `help/memory-recall-relevance.md`. Phase 2 (context steering, participant boost, related-memory expansion, query-path unification) is deferred per the spec's "land 1–2 first, verify, then add 3–5."

#### SVAR file manager — Phases 0–5 (dependency, capabilities, adapter, heavy + light costumes, theme bridge, docs)

Integrates the SVAR file manager (`@svar-ui/react-filemanager`) end to end: a derived per-mount `capabilities` API field, a quarantined adapter that maps SVAR events to the v1 mount-point routes, a heavy costume (the file browser, behind an opt-in beta toggle on Scriptorium store pages), a light costume (a readonly navigate+select picker), and a `qt-*` theme bridge so the component restyles per theme with no per-theme SVAR CSS. See `docs/developer/features/svar-file-manager-implementation-plan.md` and `svar-file-manager-adapter-contract.md`. No DB schema, migration, DDL, `.qtap`-export, or backup change — the only data/API change is the derived, non-persisted `capabilities` field. The `@svar-ui` ESM + CSS bundle on Next 16/Turbopack with no `transpilePackages`, verified live. The phase-by-phase notes below trace the build (including a couple of bugs the browser harness caught that unit tests structurally could not).

- **Per-mount capability flags.** `GET /api/v1/mount-points/[id]` now returns a derived `capabilities` block (`canWrite`, `canDelete`, `canCreateFolder`, `canMoveIn`, `canMoveOut`, `canConvert`) alongside `mountPoint`, computed server-side by new pure helper `lib/mount-index/capabilities.ts` (`deriveMountCapabilities`). A mount is quiescent when `enabled` and not mid-conversion; all mutating verbs require quiescence, and `canConvert` additionally requires no scan in progress (mirrors the existing `handleConvert`/`handleDeconvert` guards). `canMoveIn`/`canMoveOut` are split so cross-pane copy/paste can gate each pane independently. Single server-side source of truth — the file-manager UI consumes this rather than re-deriving from `mountType`/`conversionStatus`. Debug log added on the GET path. Table test `__tests__/unit/mount-index/capabilities.test.ts` (8 cases). tsc clean.
- **SVAR dependency pinned (Phase 0 install + license gate).** Added `@svar-ui/react-filemanager@2.6.0` (exact pin). Verified the actual license files for the wrapper and all 27 transitive `@svar-ui/*` packages — all MIT, no native modules, no install hooks; the pre-existing `npm audit` findings are unrelated to SVAR. Recorded in `docs/developer/features/svar-bridge-spike-findings.md`. The CSS theme-bridge spike (the actual go/no-go gate) is the remaining Phase 0 work.
- **Docs (Phase 5).** `docs/developer/API.md` now documents the derived `capabilities` block on `GET /api/v1/mount-points/[id]`. The SVAR adapter contract doc (the isolation boundary — `@svar-ui/*` imported only inside `components/files/svar/` — plus the node-id scheme, ingest seam, bridge-promotion cascade reasoning, and the staged picker audit + deferred-items status) is registered in `update-documentation`. User-facing help is deliberately deferred until the file manager is verified in-Next and out of beta. The `spike/svar-bridge/` esbuild harness is throwaway and must not merge to `main`.
- **Theme bridge promoted + light costume (Phase 4).** The Phase-0 spike bridge graduated to `components/files/svar/svar-theme-bridge.css`, imported by the SVAR components right after SVAR's own CSS. It is **co-located + unlayered** (selector `:root .wx-willow-theme`, specificity 0,2,0), deliberately NOT in `app/styles/qt-components/@layer components`: SVAR's component CSS is unlayered, and unlayered styles beat any `@layer`, so a layered bridge would lose to SVAR's defaults. It references only `--color-*`/`--qt-*`/`--radius-*`/`--font-*` tokens, so `.qtap-theme` bundles restyle SVAR with zero per-theme SVAR CSS — **no new tokens added**, hence no stylebook/theme-storybook/create-quilltap-theme/bundled-theme changes. The bridge also maps the filemanager/table/popup namespaces and uses a dark accent-*tint* (`color-mix`) for selections so a theme's loud accent never sits behind SVAR's light body text (dark-theme legibility). **Light costume:** `SvarFilePicker.tsx` — the same component `readonly` (navigate + select, no mutation), reporting picks via `wirePickerSelection` (testable; `select-file` + `open-file`, `select` filters file-vs-folder). Renders + readonly + themed verified in the harness; selection logic unit-tested (56 adapter tests total; tsc clean). **Staged, not done blind:** replacing `FolderPicker` (legacy `/api/v1/files` + project APIs) and `DocumentPickerModal` (807-line two-step modal with a bespoke source picker) touches critical Salon/move flows entangled with legacy APIs — audited in `svar-file-manager-adapter-contract.md` §4 with a surgical integration path; deferred to live verification.
- **Heavy costume wired (Phase 3).** `createSvarAdapter.ts` (`wireSvarAdapter` — testable, takes a live SVAR `IApi` + injectable `fetch`, no SVAR-component import) wires `on(action)` handlers that drive the route-map to the server, serialize ops, translate failures, fire the post-copy reindex, and signal reload (reconcile on success / revert on error). `SvarFileManager.tsx` is the React wrapper (the only other SVAR-runtime importer) — loads the listing, capability-gates (`readonly` + per-action checks), and remounts on reload. Mounted on `app/scriptorium/[id]/page.tsx` behind an opt-in **"New file manager (beta)"** toggle (lazy + `ssr:false`, so the default `FileTable` path never loads SVAR); `FileTable` stays default until parity is confirmed. +8 tests (factory choreography), 53 total in the adapter; tsc clean. Verified in a throwaway browser harness (real component + mock backend): SVAR renders the tree, the adapter loads data, the bridge themes it. **Fix it caught:** node ids are the mount-relative path (`/Research/doc.pdf`), not `/<mountId>/…` — the mount-prefixed scheme orphaned the whole tree under a non-existent root folder (the mount id rides in the costume config instead). v1 adapter is single-mount; cross-mount stays in the route-map for later. The in-Next render and `@svar-ui` bundling were later verified live against a running instance.
- **Adapter pure layer built (Phase 2).** New quarantined module `components/files/svar/` translates SVAR events to the v1 mount-point routes with no SVAR runtime — the swap-out insurance. `svar-types.ts` is the only file importing `@svar-ui/*`. Pure, unit-tested modules: `event-route-map.ts` (SVAR event → `{method,url,body}`, via an injected node resolver, with cross-mount `destMountPointId` routing, file/folder discrimination, and backend gaps surfaced as `unsupported` — no copy-folder route, move-folder can't cross mounts), `listing-to-tree.ts` (`{files,folders}` → SVAR nodes keyed `/<mountId>/<relativePath>`, synthesizing missing ancestor folders), `error-translation.ts` (FileOpError/DatabaseStore codes → steampunk message + rollback + copy-offer/conflict flags), `reindex-after-copy.ts` (fire the scoped reindex only for a `byte-copy` of `.pdf`/`.docx`), and `node-id.ts` path helpers. 45 tests across 5 suites; tsc clean. The runtime factory (`createSvarAdapter`, wires `api.intercept()`) is deferred to Phase 3.
- **Adapter contract documented.** New `svar-file-manager-adapter-contract.md` pins the three backend-facing decisions the future adapter targets: the capabilities block; the cross-mount-copy ingest seam (adapter auto-reindexes the dest path only when `result.strategy === 'byte-copy'` and the dest is an extractable `.pdf`/`.docx` — the one lossy path, since fs→fs and db→fs copies already re-index on the dest); and the `mountId:relativePath` ID-stability keying (mutations re-read the listing rather than patching SVAR's tree). The PATCH-rename route already returns the new `relativePath` and logs `from → to`, so 1.3 needed no code change.

Completed the follow-up flagged in the Madman's Box icon-redesign entry: migrated the remaining inline-SVG icons in `app/*` page files to the central `<Icon>` component so themes can override them. The earlier Phase 2b sweep covered `components/*` but skipped `app/*`. No DB schema, migration, DDL, `.qtap`-export, or backup change.

- **~130 inline icon SVGs across 41 `app/*` files migrated** to `<Icon name="…">` (salon, prospero, scriptorium, aurora, generate-image, about), preserving each call site's size/color classes and aria attributes. Icon names are picked by meaning, not geometry; the name is a typed union, so an invalid name is a compile error.
- **Two new canonical icons (registry now 82).** `minus` — counterpart to `plus`; used by the Salon terminal "hide pane (keep session alive)" button and as a general remove/collapse glyph. `sort` — neutral "sortable column" indicator in sortable tables (the Scriptorium file table); active sort direction keeps using the existing `arrow-up`/`arrow-down`. Each got a registry entry, a default SVG (`public/images/icons/`), regenerated `_icons.css`, a Madman's Box override (sharp butt/miter, contract-clean), a `theme.json` map entry, a preview-contact-sheet entry, an `ICON_INVENTORY.md` §2.2 row, and a theme-storybook catalogue entry. `check-madmans-box-icons.mjs` reports 82/82 coverage, contract clean. The bundled Madman's Box theme was bumped 1.1.0 → 1.1.1 for the two added overrides.
- **`@quilltap/theme-storybook` bumped to 1.0.42 — requires `npm publish`** (added `minus` and `sort` to the override-able names catalogue).
- **Deleted the deprecated shim wrappers** (`components/ui/icons/index.tsx`: `CloseIcon`/`PencilIcon`/`RefreshIcon`/`CheckIcon`/`ChatIcon`). All remaining call sites (8 files) now use `<Icon>` directly.
- **Fixed a sizing/visibility regression the migration surfaced.** Three `.qt-chat-*` CSS rules sized the child `<svg>` directly; `<Icon>` renders a `<span class="qt-icon">`, so those selectors stopped matching. Updated `.qt-chat-message-action-icon`, `.qt-chat-attachment-overlay`, and its hover rule to also target `.qt-icon`, restoring the className-less Salon action-bar icons' size and the attachment-overlay zoom icon's hover-reveal.
- **Left inline (genuine non-icon graphics):** loading spinners, the composer's pulsing response-status ring, and the About page's GitHub and Foundry-9 brand logos — none are themeable glyphs.

#### Scriptorium canonical file API: one write pipeline + per-file REST item route

Consolidated mount-point file writes behind a single ingest pipeline and added a complete per-file REST surface for the `quilltap docs` CLI and the (future) Scriptorium file browser. No schema, migration, DDL, `.qtap`-export, or backup change — content tables and storage keys are unchanged.

- **One canonical write/ingest pipeline.** New `lib/mount-index/store-file.ts` (`storeMountFile`) is the single chokepoint for fresh writes: native-text → `doc_mount_documents`, binary → `doc_mount_blobs` with image transcode + PDF/DOCX text extraction + chunk/embedding enqueue, content-addressed dedup, folder-ensure, mtime-based optimistic concurrency, and the `emitDocumentWritten` event. It is mount-type aware (`assetStorage: 'auto'` writes filesystem mounts to disk; `'database'` keeps blob bytes in the mount-index DB — used by the `/blobs` route so persisted `<img>` URLs stay resolvable) with three collision strategies (`error-if-exists` / `overwrite` / `unique-suffix`). It is byte-ingesting and deliberately distinct from `file-ops.copyFile`/`moveFile`, which stay byte-preserving.
- **Shared leaf modules to break import cycles + dedup.** `file-op-error.ts` (the `FileOpError` class, re-exported from `file-ops.ts` for back-compat), `path-utils.ts` (`normaliseRelativePath` / `detectNativeText` / `mimeForExtension`, removing the file-ops copies), and `file-op-status.ts` (`fileOpStatus` for `FileOpError` + `DatabaseStoreError`, replacing the inline copy in the mount-point route). `file-ops.ts` now exports `resolveFsAbsolute` / `destExists` / `deleteAtDest` / the extracted `writeFsFileBytes` so the pipeline reuses them.
- **The `/blobs` POST route is now a thin adapter** over `storeMountFile` (~150 inline lines deleted); behavior and response shapes preserved.
- **New canonical per-file item route** `app/api/v1/mount-points/[id]/files/[...path]/route.ts` — GET (UTF-8 / base64 / `?raw=1` byte stream / `?offset`+`?limit` line window), PUT (JSON `{content, encoding, expected_mtime, force}` or multipart), DELETE, PATCH (`rename` and/or `description`). Backed by new `lib/mount-index/read-file.ts` (`readMountFile` / `readMountFileBytes`).
- **New action-dispatch verbs** on `POST /api/v1/mount-points/[id]`: `link-file` (true hard link via new `file-ops.linkFile` — db-link / fs-link, refuses cross-storage rather than byte-copying), `delete-folder`, and `move-folder` (new `lib/mount-index/folder-ops.ts` dispatching database vs filesystem).
- **The four file-storage bridges now funnel through `storeMountFile`.** `project-store-bridge`, `user-uploads-bridge`, `lantern-store-bridge`, and the `character-vault-bridge` *history* path drop their duplicated transcode/dedup/folder-ensure/`linkBlobContent` sequences for a single pipeline call (`collisionStrategy: 'unique-suffix'`, `treatNativeTextAsDocument: false`, `extractText`/`enqueueEmbedding: false`, `assetStorage: 'database'`) — return shapes and `mount-blob:` storage keys unchanged. The character-vault *main-avatar* path is deliberately left on its `deleteWithGC`-then-`linkBlobContent` sequence (overwrite-in-place with blob GC, which the pipeline's overwrite strategy doesn't replicate). Host-RPC job-child bounces preserved.
- Unit tests: `store-file.test.ts`, `read-file.test.ts` (mount-index + file-storage suites green — 221 tests).
- **`docs/developer/API.md`** documents the new per-file item route (GET/PUT/DELETE/PATCH), the `link-file`/`delete-folder`/`move-folder` action verbs, and the **mount-point files vs. `/api/v1/files` library** boundary (the library layer stays — it carries category/generation/tags/dimensions/avatar metadata and the persisted `GET /api/v1/files/[id]` read URL the mount index has no equivalent for).
- **`quilltap docs` CLI** (`packages/quilltap`, bumped to `4.7.0-dev.41` — **requires `npm publish`**): new `link` (hard-link via `action=link-file`), `rmdir` (`action=delete-folder`), and `mvdir` (`action=move-folder`) verbs (all server-required), plus a `--base64` flag on `write` (PUT `…/files/{path}` JSON base64) and `read` (GET `…/files/{path}?encoding=base64`). Existing `write`/`delete`/`mkdir`/`move`/`copy` verbs and their offline fallbacks are unchanged. README updated.
- **Scriptorium front-end now writes via the canonical item route.** Upload (`useMountPointBlobUpload`, `FileTable`) switched from `POST /blobs` to `PUT …/files/[...path]`; delete (`useFileActions`, `FileBrowser`, `FileTable`) and description PATCH (`FileTable`) switched to the `…/files/[...path]` route. A new `buildMountFileItemUrl` sits beside `buildMountBlobUrl` in `components/files/mountBlobUrl.ts`. The byte-serving `/blobs/[...path]` GET is deliberately kept for `<img>`/thumbnail/preview/download (it is the stable, persisted asset URL embedded in saved Markdown). tsc clean.

#### Madman's Box: full icon redesign (theme 1.1.0) + icon-system fixes it surfaced

The bundled Madman's Box theme now overrides **all 80 canonical icons** with original SVGs in its Art Deco/Gallifreyan design language (sharp butt caps and miter joins, 2.0/1.25 stroke weights, geometry-only `currentColor` masks — see `docs/developer/features/complete/madmans-box-icon-redesign.md` for the design spec). The five round-cap pilot icons from 1.0.1 were redrawn to match. Theme version bumped to 1.1.0; bundle re-validated (108 files).

- **Brand mark now maskable.** Removed the forced image mode for `brand` icon overrides in `generateIconOverrideRule` (`lib/themes/utils.ts`): an `.svg` brand override is now masked and tinted by `currentColor` like every other icon, while `.webp` keeps full-color image mode. Updated the unit tests, `help/themes.md`, `THEME_PLUGIN_DEVELOPMENT.md`, the theme-storybook Icons story (1.0.41), and the create-quilltap-theme bundle README template (2.0.12). Madman's Box ships an SVG brand quill that inherits UI tint.
- **Icon override cache-busting.** The theme assets route serves `Cache-Control: immutable`, but icon override URLs carried no version, so re-releasing a theme with a changed icon left browsers on the stale glyph forever. `/api/v1/themes/[id]?action=tokens` now appends `?v=<theme.version>` to every icon URL (the mask/image extension sniff already ignores query strings; unit test added).
- **New canonical icon `tag` (80th).** Registry entry, default SVG (`public/images/icons/tag.svg`), regenerated `_icons.css`, Madman's Box override, ICON_INVENTORY §2.2, and the storybook catalogue. Needed by the Aurora Tags tab, which previously had no canonical glyph.
- **Migrated three `app/`-level tab bars to `<Icon>`:** Aurora character view tabs (`app/aurora/[id]/view/tabIcons.tsx`), Aurora edit tabs, and the Settings page tabs were still inline SVGs — invisible to theme overrides — because the Phase 2b migration swept `components/*` but not `app/*`. Roughly 75 more `app/*` files with inline icon SVGs remain; tracked as a follow-up migration.
- **Dev tooling (not shipped):** `themes/tools/madmans-box-icon-preview.html` (contact sheet rendering every icon mask-style at 16/20/24/48 px in four theme tints beside the app default) and `themes/tools/check-madmans-box-icons.mjs` (mechanical lint for the SVG contract: root attributes, paint discipline, stroke-weight band, registry name sync, coverage count). They live outside the bundle directory so packing/export never includes them.
- The standalone `qtap-theme-madmans-box` repo was **not** synced — it is being retired; the bundled theme is canonical.
- No DB schema, migration, `.qtap`-export, or DDL change.

#### Memory extraction enrichment: canon reweighting, orienting context, targeting tags

Enriched the per-turn memory extractor (`lib/memory/cheap-llm-tasks/`, `lib/memory/memory-processor.ts`, `lib/background-jobs/handlers/memory-extraction.ts`) so it judges novelty against vantage-point-correct canon and tags every memory along three controlled axes. No schema, migration, DDL, `.qtap`-export, or backup change.

- **Vantage-point-correct canon.** Replaced the single `renderCanonBlock` with two builders. The SELF pass now feeds `manifesto` + `personality` + `description` + `identity` (rendered manifesto-first, labelled, empty fields omitted) instead of `identity` alone, so a character extracting about itself can tell "already who they are" from genuinely new. The OTHER pass keeps the observer's vault `Others/<name>.md` as the top source and falls back to `identity`, then to `description` only when identity is empty — never `personality`/`manifesto`.
- **Orienting context (cache-safe).** The extraction prompt footer now carries the project description and the rolling chat summary (`ORIENTING CONTEXT` block, each value truncated to 1500 chars), placed after the stable body and before the `CONTEXT` block so the cheap-LLM prefix cache still hits. The block is background only — a new WHAT-TO-SKIP bullet forbids extracting a memory whose only source is it.
- **Three targeting axes → keywords.** The model emits `temporal` (past/moment/present/future), `scope` (narrow/wide), and `context` (philosophy/relationships/history/banter/mannerisms/trivia/information). The parser validates them against closed vocabularies, defaults invalid/missing values (present/wide/information, logged at debug for drift visibility), and materializes them into the existing `keywords` array (`temporal` and `context` as bare words, `scope` as `scope: <value>`). They never persist as top-level memory fields.
- **`projectId` now written on derived memories.** `CreateMemoryOptions` → gate INSERT → `repos.memories.create` now plumb `projectId` (the `memories.projectId` column and index already existed but nothing wrote them), stamped from `chat.projectId`. This is the prerequisite for a later recall-side change that down-weights `scope: narrow` memories whose `projectId` differs from the current chat. Back-fills automatically on a `regenerate-all`/`regenerate-chat` run.

#### Scheduled retention & cleanup sweeps

Added a single parent-side daily maintenance tick that reaps data with no bearing on characters, stories, or memories. Runs in-process like the existing LLM-log and memory-housekeeping schedulers (no new job type, no child handler) because the asset deletion path bottoms out in `deleteWithGC`, which needs a write transaction on the mount-index DB and cannot run in the forked job child.

- **New scheduler** `lib/background-jobs/scheduled-maintenance.ts`, started from `instrumentation.ts` Phase 3.5 and re-exported from `lib/background-jobs/index.ts`. 24h interval with a 5-minute startup grace; the startup tick short-circuits if a sweep ran within the last 20h, tracked via a new `lastMaintenanceSweepAt` key in `instance_settings`.
- **Job retention split by status.** New `backgroundJobs.cleanupOldJobsByStatus(completedOlderThan, deadOlderThan)` reaps COMPLETED jobs after 7 days and DEAD jobs after 30 (both keyed off `completedAt`); PENDING/PROCESSING/FAILED/PAUSED are left untouched. `queue-service.cleanupFinishedJobs()` wraps it with the hardcoded windows. The old single-window `cleanupOldJobs` is kept as a deprecated shim.
- **Stale-chat asset collapse.** When a chat has had no activity for 30 days (`lastMessageAt`, fallback `updatedAt`), its superseded generated story-backgrounds and wardrobe avatars are deleted, keeping only the currently-referenced ones (`storyBackgroundImageId` + `characterAvatars[].imageId`). Enumerated via `files.findByLinkedTo` (source=GENERATED, category=IMAGE) and deleted through the now-exported GC-safe `deleteFileCompletely` chokepoint. Skips anything saved to a `photos/` album or a character vault, anything promoted to a character default/override, and the current keep-set (matched on both id and content sha256). Active chats are never touched.
- **Belt-and-suspenders sweeps.** The tick also runs `docMountFileLinks.sweepOrphanedFiles()` (after the collapse) and a new `terminalSessions.cleanupClosedSessions(olderThan)` that reaps closed (`exitedAt` non-null) PTY sessions older than 30 days plus their `<logsDir>/terminals/<id>.log` transcript files (best-effort, ENOENT-tolerant). Running sessions are never reaped.
- **Manual CLI verb** `quilltap maintenance run|status`. `run` is lock-gated and refuses while the server holds `quilltap.lock`; it performs the job, terminal, and orphan sweeps directly in SQL. `status` is read-only and prints the last sweep time plus dry-run counts. The asset collapse runs only on the server tick (needs the app's file-storage machinery), so `status` reports a stale-chat count instead.
- Retention windows are hardcoded constants in `lib/background-jobs/maintenance/retention-constants.ts` (no settings/UI/migration). Investigated `conversation_chunks`/`conversation_annotations` — both upsert in place via their UNIQUE keys, so no render-chunk reap is needed. No schema, migration, `.qtap`-export, or DDL change. CLI package (`packages/quilltap`) bumped to 4.7.0-dev.35.

#### Theme icon overrides: help and developer documentation

Added user-facing and developer-facing documentation for the icon override system introduced in the previous three changes.

- `help/themes.md` now documents the `icons` manifest field (under Custom Themes → Custom Icons), the `.svg`/`.webp` asset modes, the `brand`-is-always-image-mode rule, and the CLI validation behavior. The "What Are Themes?" summary list now mentions icon overrides.
- `docs/developer/THEME_PLUGIN_DEVELOPMENT.md` gains a bundle-format icon-overrides reference section before the existing deprecated-npm content: manifest snippet, asset-mode table, canonical-name pointers, CSS mechanics summary, and authoring notes.
- `components/settings/appearance/README.md` updated with an Icon Overrides section covering the 79-icon map, the two render modes, and the live-switch behavior.
- `docs/developer/ICON_INVENTORY.md` added to the `update-documentation.md` registry.

#### Centralized, theme-ready icon system (foundation + sidebar pilot)

Started moving the app's scattered inline-SVG icons into one place so a `.qtap-theme` bundle can eventually override any of them.

- **New `<Icon name="...">` primitive** (`components/ui/icon.tsx`) backed by a canonical registry (`components/ui/icons/icon-registry.ts`) that is the single source of truth for icon names and their default assets (`IconName` is derived from it). Default icons are monochrome SVGs in `public/images/icons/` rendered via CSS `mask-image` tinted by `currentColor`, so they inherit the theme foreground exactly like the old inline `stroke="currentColor"` SVGs; the `brand` quill renders full-color (background-image). Per-icon default CSS is generated from the registry into `app/styles/qt-components/_icons.css` by `scripts/generate-icon-css.ts` (`npm run generate:icon-css`); it lives in `@layer components` so Tailwind `w-`/`h-` sizing still wins. The CSS is structured so a future theme override can swap an icon by re-declaring its `[data-icon]` variables — the manifest field and runtime wiring land in a later change.
- **Left sidebar migrated** as the first call site (`collapsed-nav`, `sidebar-footer`, `profile-menu`), deleting ~15 local inline-SVG icon components. `components/ui/icons/index.tsx` and `ChevronIcon.tsx` are now thin deprecated wrappers so the remaining call sites can migrate incrementally.
- **Removed a duplicate Home link.** The always-collapsed sidebar rendered both a header brand and a nav "Home" item; the header's `<Image>` was sizeless and had hidden the duplication. Dropped the header (and its orphaned `qt-left-sidebar-header`/`-brand` CSS); the nav's quill Home item is now the single brand mark.
- Proposed canonical icon-name contract catalogued in `docs/developer/ICON_INVENTORY.md`. No schema, migration, `.qtap`, or DDL change.

#### Icon system: app-wide migration to `<Icon>` (Phase 2b)

Finished moving the app's inline-SVG icons onto the centralized `<Icon>` component. Every icon-bearing component file across the UI shells, dashboard, chat/Salon, tools, settings, characters/Aurora, wardrobe, memory, scenarios, setup wizard, images/gallery, help chat, homepage, profile, search, tags, terminal, state, import, and quick-hide areas now renders `<Icon name="…">` instead of a hand-written `<svg>`; the dozens of duplicated local icon components were deleted (`ScenariosIcon` kept as a thin `<Icon name="scenarios">` wrapper so its call sites stayed untouched).

- **Registry grew to 79 canonical icons.** The signed-off name list was implemented in full, plus 14 reusable glyphs the sweep surfaced (`arrow-up`/`arrow-down`, `ban`, `camera`, `log-out`, `users`, `wrench`, `database`, `swap`, `file-plus`, `code`, `zap`, `cpu`, `layers`) — all additions, no renames, so the public contract is unchanged. Each new icon ships a default SVG in `public/images/icons/` and a generated rule in `_icons.css`.
- **Cascade fix:** `_icons.css` is now imported first in `app/styles/qt-components/_index.css` so the `.qt-icon { 1em }` base size is the weakest sizing in `@layer components`. Call-site `w-`/`h-` utilities and `qt-*` classes that size icons (e.g. `.qt-collapsible-card-chevron`) both win, so no icon is frozen at 1em.
- The only inline `<svg>` left in `components/` are genuine non-icon graphics (loading spinners, charts, provider badges, pending-state rings, chat-bubble tails, drop-zone/empty-state illustrations, the drag handle, and the animated quill) — catalogued in `ICON_INVENTORY.md` §4. Updated three homepage component tests that asserted on the old inline `<svg>` to target the `[data-icon]` span. No schema, migration, `.qtap`, or DDL change; theme-override wiring still lands in a later change.

#### Theme icon overrides: manifest schema + runtime wiring

Themes can now replace any of the app's icons. A `.qtap-theme` bundle declares an optional `icons` map in `theme.json` (icon name → bundle-relative asset path, `.svg` or `.webp`), and the override is applied live when the theme is active — no reload.

- **Manifest schema.** Added an optional `icons` record to both `QtapThemeManifestSchema` (bundles) and `ThemeManifestSchema` (plugin parity) in `lib/themes/types.ts`, validated as `{ [kebab-name]: non-empty path }`. Documented the property in `public/schemas/qtap-theme.schema.json`.
- **CLI validator.** `packages/quilltap/lib/theme-validation.js` now checks the `icons` block: it must be an object, values must be non-empty paths ending in `.svg`/`.webp` with no path traversal, and malformed icon names warn (the canonical name list lives in the app and can't be imported into the standalone validator).
- **Runtime.** The theme registry reads `manifest.icons` into `LoadedTheme.icons` and exposes `getIcons(themeId)`; `/api/v1/themes/[id]?action=tokens` resolves each override to its `/api/themes/assets/bundle:<id>/<path>` URL (the existing assets route, not the fonts route). The theme provider threads `icons` to the style injector, which appends a `[data-icon]` rule per override into the same injected `<style>` block. Because that block is unlayered, the overrides beat the `@layer components` defaults in `_icons.css` by cascade source order.
- **Override modes.** `generateIconOverridesCSS` (`lib/themes/utils.ts`) emits mask mode for `.svg` overrides (keeps `currentColor` tinting) and image mode for `.webp` (full color); the `brand` quill is always image mode so an SVG brand mark isn't monochromed. Asset URLs are stripped of quote/backslash/newline characters before interpolation to prevent CSS injection from a malicious manifest.
- No DB schema, migration, `.qtap`-export, or DDL change. Bundles that declare no `icons` are unaffected. The authoring tooling and a bundled proof-of-concept land in a later change.

#### Theme icon overrides: authoring tooling + Madman's Box proof-of-concept

Followed the icon-override runtime (above) with author tooling and the first bundled theme to use it.

- **`create-quilltap-theme` (2.0.11):** scaffolded bundles now include an `icons/` folder (with a commented example), mirroring `fonts/`. The bundle README documents the optional `icons` manifest map and the `.svg` (theme-tinted) vs `.webp` (full-color) override modes. The scaffolded Storybook stories include the new `Icons` reference.
- **`@quilltap/theme-storybook` (1.0.40):** added an `Icons` story — a reference listing every override-able icon name (grouped by category) plus the override recipe (the `theme.json` snippet and the two asset modes), so theme authors can see what's replaceable.
- **Madman's Box (1.0.1):** the bundled theme now overrides five icons via `icons/` SVGs — a brass quill for the brand mark (full color), and Deco line variants for `settings`, `themes`, `wardrobe`, and `help` (theme-tinted). Demonstrates the override pipeline end to end; the override assets are served by the existing theme assets route. Reactivate the theme (or restart) to pick up the change.
- No DB schema, migration, `.qtap`-export, or DDL change.

#### Prospero project page: full-width cards for Lexical editors

On a project's detail page (`/prospero/[id]`), the two cards that embed a Lexical editor now span the full grid width instead of sharing a row with other cards. Project Settings (project instructions) dropped its old `row-span-2`, which forced neighboring cards to flex around its tall column, in favor of `col-span-full`; Image Generation (which hosts the two aesthetic editors) gained `col-span-full`. The compact cards (Files, Document Stores, Scenarios, Wardrobe, Characters, Model Behavior) now flow through the multi-column grid first, and the two editor cards stack full-width below them, so the editors get room rather than being squeezed into a single column. Layout-only change — no schema, migration, `.qtap`, or DDL impact.

#### New bundled theme: Madman's Box

Added a sixth bundled `.qtap-theme` at `themes/bundled/madmans-box/`. Dark-only (`supportsDarkMode: false`, both color slots identical so it ignores the host light/dark toggle). Warm walnut+brass palette with amber tube-glow, phosphor-cyan for links/focus/active state, and banker's-lamp green for success. Self-hosts Raleway (UI), Mulish (user messages — has true italics), Lora (assistant prose), and Fira Code (mono); Lora and Mulish woff2s were instantiated from the upstream variable fonts at weights 400/500/600/700. OFL licenses for Lora and Mulish are bundled in `fonts/OFL.txt`. Bundled themes auto-register from `themes/bundled/` at startup, so it appears after a restart. No schema, migration, `.qtap`-export, or DDL change.

#### Character page template buttons: full field coverage, system prompts that save, and reverse direction

Reworked the `{{char}}`/`{{user}}` template buttons on the Aurora character Details view (`app/aurora/[id]/view/`).

- **Forward buttons now cover all prompt fields and persist correctly.** The old "Name → `{{char}}`" / "Partner → `{{user}}`" handlers skipped `identity` entirely, counted `manifesto` but never replaced it, and packed system-prompt replacements into a `systemPrompts` PUT body that `updateCharacterSchema` silently strips — so system-prompt token swaps were never saved. The field set (identity, manifesto, description, personality, first message, example dialogues, every scenario, every system prompt, and the five physical-description prose/prompt fields) is now defined once in `collectTemplateFields`, walked by both the counter and the transform, so counts and replacements can't drift. System-prompt changes route through `PUT /api/v1/characters/[id]/prompts/[promptId]`. Also fixes a latent 400: the physical-description `name` (required by the PUT schema) now falls back to `'Appearance'` when empty and is never itself transformed.
- **Two new reverse buttons.** "`{{char}}` → Name" bakes the character's own name back in wherever `{{char}}` appears. "`{{user}}` → name…" opens a picker (dropdown of user-controlled characters, excluding the one being viewed) and replaces every `{{user}}` with the chosen character's name. Each reverse button appears only when matching `{{char}}`/`{{user}}` literals exist; the user picker also requires at least one other user-controlled character.
- **Shared save dispatch.** The HTTP fan-out (main PUT + per-prompt PUT/POST + partial-failure error collection) is extracted from the optimizer's `applyChanges` into `components/characters/apply-character-field-updates.ts`, now used by both the optimizer and the template buttons. Token replacement is case-insensitive (`{{Char}}`/`{{USER}}` match) and uses a function replacer so a chosen name containing `$` is inserted literally.

No schema, migration, or `.qtap` change. Help doc `help/character-editing.md` and template-helper tests updated.

#### Refine from Memories: full core-document coverage, no new scenarios, and array fields that actually save

Overhauled the Aurora "Refine from Memories" character optimizer (`lib/services/character-optimizer.service.ts`, `components/characters/optimizer/`):

- **Covers the character's full appearance.** A new dedicated pass refines the physical description — the prose `fullDescription` plus the tiered image prompts (`shortPrompt`/`mediumPrompt`/`longPrompt`/`completePrompt`) — keyed per sub-field, so the optimizer now spans all of a character's core documents/properties rather than skipping appearance. `getPhysicalDescriptionSuggestionPrompt` added; physical suggestions carry the sub-field key on `subId` and a human label on `subName`.
- **No more new scenarios.** The old "new items" pass (`getNewItemsSuggestionPrompt`) is replaced by `getNewSystemPromptsSuggestionPrompt`, which proposes only new *system prompts*. Existing scenarios may still be refined; new scenarios are out of scope and the shared schema preamble forbids them.
- **Array fields now persist correctly.** Fixed the apply step (`useCharacterOptimizer.applyChanges`):
  - **System prompts were never saved** — they were packed into a `systemPrompts` PUT body that `updateCharacterSchema` silently strips, and new prompts were dropped before that. Refinements now go through `PUT /api/v1/characters/[id]/prompts/[promptId]`; brand-new prompts go through `POST /api/v1/characters/[id]/prompts` under their **suggested name** (`Refined Prompt` fallback).
  - **Physical descriptions were applied to a nonexistent `physicalDescriptions` array.** Sub-field refinements now merge into the single `physicalDescription` object and ride the PUT body.
  - **Scenario refinements** continue via the PUT body (merged into the full array by id); new-scenario creation removed.
- **Talkativeness now saves.** Added `talkativeness` (0.1–1.0) to `updateCharacterSchema` (PUT handler) so suggested verbosity changes route through the vault overlay instead of being stripped.
- **UI/report:** suggestion cards and the apply summary show the proposed name for a brand-new system prompt; field labels updated (added Identity/Physical Description/Talkativeness, removed stale plural/clothing keys). Suggestions-file dossier groups updated (Physical Description in, Proposed New Scenarios out). No schema, migration, or `.qtap` change. Help doc `help/character-optimizer.md` and optimizer tests updated.

#### Fix: group stores now appear in the Open Document picker without "Look everywhere"

The Document Mode "Open Document" picker (`DocumentPickerModal`, backed by `?action=accessible-stores`) only collected character vaults, project-linked stores, and Quilltap General — never group stores — so a group's official/linked stores showed only when "Look everywhere" was toggled (which returns every enabled store, bucketed under Database-/Filesystem-backed). `handleAccessibleStores` now resolves the group tier (`resolveGroupMountPointIdsForCharacter` across all non-removed character participants, the same resolver the `group-stores` action and tiered mount pool use) and returns those stores tagged `isGroupStore`. The picker buckets them into a dedicated **Group Files** accordion (above Database-backed, matching tier precedence and the attach-file picker's Group Files section) and holds them out of the generic backing buckets so each store appears once — in both default and look-everywhere modes. No schema, migration, or `.qtap` change.

#### Fix: Create Project dialog now overlays as a modal

The Projects page "Create Project" form rendered inline below the project cards instead of as a centered modal. Its `qt-dialog-overlay` was a direct child of `qt-page-container`, whose `> * { z-index: 1 }` rule trapped it in a local stacking context. `CreateProjectDialog` now renders through the shared `BaseModal`, which portals to `document.body` (escaping the stacking context) and supplies the standard backdrop, click-outside/Escape close, and header/body/footer chrome. The Create button is associated with the form via a `form` id so submit and native required-field validation still work.

#### Feature: Lantern/Aurora default aesthetics, and the Ariel Clause is resolved

Added a house style for image generation. Two free-form Markdown files are woven into the image-prompt step so avatars, story backgrounds, and ad-hoc (`generate_image`) pictures share a consistent look:

- **`lantern-aesthetics.md`** (general/scene look) — feeds story backgrounds and ad-hoc images.
- **`aurora-aesthetics.md`** (how people and outfits are depicted) — feeds avatars, plus the figures rendered in backgrounds and ad-hoc images.

Each file resolves across two tiers, **project-overrides-global per file and independently**: the active chat's project **official** document store first (`project.officialMountPointId`), then the **Quilltap General** store. An empty/whitespace file is treated as absent, so clearing a project override restores the global fallback.

**The Ariel Clause (resolved):** for story backgrounds and ad-hoc images only, when a character appears in the picture, a `depiction-guidelines.md` in that character's own vault root is passed to the image-prompt generator as a **mandatory, additive, per-character** constraint, attributed by name and never silently dropped. It overrides the general aesthetic on conflict. Avatars use the character aesthetic but **not** depiction guidelines.

- New resolver module `lib/image-gen/aesthetic.ts` (filename constants, `resolveAesthetic`, `readAestheticForMount`/`writeAestheticForMount`, `resolveDepictionGuidelines`, `getProjectOfficialMountPointId`). All reads fail soft — image generation never breaks on an unreadable guidance file. Aesthetics are capped (4 KB) and the avatar preamble is capped (600 chars); depiction guidelines are capped (2 KB each) and logged at `info` when applied.
- Wired into all three pipelines: `story-background.ts` (both craft calls, including the uncensored retry), `image-generation-handler.ts` (ad-hoc, with per-character vault lookup), and `character-avatar.ts` + `avatar-prompt.ts` (aurora only, capped preamble; also the `preview-avatar` endpoint). Context types `StoryBackgroundPromptContext` / `ImagePromptExpansionContext` gained `sceneAesthetic` / `characterAesthetic` / `depictionGuidelines`; both crafting system prompts now instruct the model to treat depiction guidelines as binding.
- New Lexical editors: two **Default Aesthetic** fields on the Images settings tab (`section=default-aesthetics`), the same two on the project Image Generation card, and a **Depiction Guidelines** field on the character edit page (Descriptions tab) — all via a shared `AestheticEditorField` component (empty save deletes the file).
- New API routes: `GET/PUT /api/v1/system/image-aesthetics?kind=lantern|aurora` (Quilltap General), `?action=aesthetic&kind=…` on the project route, and `?action=depiction-guidelines` on the character route.
- These are ordinary document-store files — **no schema, migration, DDL, or `.qtap` change.** New help doc `help/image-aesthetics.md`. Tests: resolver + Ariel Clause, crafting injection, avatar preamble (29 cases).

#### Feature: `self_inventory` gains group vaults, a `context` section, and auto-image filtering

The `self_inventory` tool's `vault` and `vaultAccess` sections now split into `.character` / `.groups` sub-sections (mirroring the existing `quilltap` / `quilltap.version` dotted pattern), and a new top-level `context` section reports where the character is situated. All new sub-sections are part of `self_inventory`, so they inherit its existing System Transparency gating (withheld from opaque characters) — no new tool, no orchestrator change.

- **`vault.character`** — the character's own vault, now with auto-generated images filtered out by default. Avatars/wardrobe history under the vault's `images/` folder and document-store `character-avatars`/`story-backgrounds` images are hidden; OS cruft (`.DS_Store`, `Thumbs.db`, dot-files) is always hidden. New `includeAutomaticImages` input flag re-adds the auto-images (mirrors `doc_list_files`). Reuses `isAutomaticImagePath`/`isOsCruftName`/`IMAGE_FILE_EXTENSIONS` from `lib/files/folder-utils.ts`.
- **`vault.groups`** — files in the vaults of every group the character belongs to, one entry per group store, same filtering. Bare `vault` returns both parts.
- **`vaultAccess.character`** — unchanged behavior (who can read/write the character vault in this chat). **`vaultAccess.groups`** — membership-based and chat-independent: every member of each of the character's groups, all read/write. Bare `vaultAccess` returns both.
- **`context`** (with `.chat` / `.project` / `.groups` / `.characters` / `.files`) — this chat's id and title; the current project's id, name, and linked stores; the character's groups (ids, names, linked stores); the other present characters (id, name, aliases, identity, and which is the user persona — self excluded); and the files attached to this chat, each with a copy-pasteable `doc_read_file(...)` invocation. Project id comes from the tool-execution context (falling back to the chat's `projectId`).
- Implementation: new section builders, `resolveVault/VaultAccess/ContextIncludedParts` helpers, and a shared `resolveMyGroups` walk in `lib/tools/handlers/self-inventory-handler.ts`; reshaped output types in `lib/tools/self-inventory-tool.ts` (`vault`/`vaultAccess` are now `{ includedParts, character?, groups? }` wrappers); `projectId` threaded into `SelfInventoryToolContext` from `lib/chat/tool-executor.ts`. Debug logging added to every new builder.
- Tests: 11 new handler cases (vault filter on/off, bare vault, group vaults, chat-independent group access, each `context.*`, bare `context`); tool-definitions snapshot updated. Help: `tools.md`, `character-system-transparency.md`. No schema or migration change.

#### Fix: Carina answerers are now told who is asking

A Carina answerer received only the bare question text — it had no idea who had addressed it (the asker's identity was threaded through `runCarinaQuery` solely for whisper targeting, never put into the prompt). Answerers consequently asked "who am I speaking with?" in their replies.

- `runCarinaQuery` now resolves `askerParticipantId` against `chat.participants` to the asking character (the user's persona for `@Name?` markup, the calling character for `ask_carina`/character markup) and appends a surface-level identity card to the Reference Query block of the system prompt: name, title, pronouns, aliases, and the public `identity` field (falling back to `description`, then a neutral placeholder).
- New reusable `buildPublicIdentityCard(character, userName?)` in `lib/chat/context/system-prompt-builder.ts` (with `NO_PUBLIC_IDENTITY_FALLBACK`) builds the card. It deliberately excludes the asker's private `personality`/`manifesto` — the answerer learns only what any character would know of someone addressing them.
- Falls back to the previous anonymous framing when the asker can't be resolved (no participant context, or an unreadable character vault). Debug/warn logging added for resolution and failure.
- Tests: new `lib/chat/context/__tests__/system-prompt-builder.test.ts` covering field selection, the identity→description→placeholder fallback chain, personality/manifesto exclusion, and `{{char}}`/`{{user}}` templating. Help (`carina.md`) and feature doc (`docs/developer/features/carina.md`) updated. No schema or migration change.

#### Feature: group document stores surfaced to characters, the picker, and tools

Group document stores (a Group's official store plus any linked stores) are now advertised on the same surfaces as project/general/character stores. The shared `resolveTieredMountPool` group tier already plumbed group stores through knowledge retrieval, the unified `search` tool (`scope: "group"`), and the doc-edit path resolver; this fills the remaining gaps.

- **Prospero whisper** (`lib/services/prospero-notifications/writer.ts`): new `postProsperoGroupContextWhisper` posts a per-character *targeted* whisper (`systemKind: 'group-context'`) naming the stores the character can reach by group membership plus their own vault, with `mount_point` usage hints. Wired into the two existing context-announcement sites: every character participant at chat-start (`app/api/v1/chats/route.ts`) and the responding character at the re-injection cadence (`orchestrator.service.ts`). Unlike the public project/general announcement these are whispers — group membership is per-character and the vault is personal. Posts nothing when a character has no group stores and no vault.
- **Document-Mode picker** (`components/chat/LibraryFilePickerModal.tsx`): new "Group Files" section above Projects, listing the stores of the chat user-persona character's Groups. Backed by a new `GET /api/v1/chats/[id]?action=group-stores` action.
- **`doc_list_files`** (`lib/tools/doc-list-files-tool.ts`, handler in `lib/tools/handlers/doc-edit/text-handlers.ts`): added explicit `scope: "group"` (mirrors the `search` tool); all-scope listings now tag group-store entries with scope `group`. The underlying access set already included group stores via the path resolver, so `doc_grep` and the read/write/copy tools already operated on them.
- **Aurora Core whisper** (`lib/services/aurora-notifications/core-whisper.ts`): `assembleCorePacket` now merges `Core/*.md` from each Group the character belongs to, labeled `[Shared — <group>]`, after the character's own Core. A character with no personal vault still gets a packet when a Group supplies one. Stores already consumed (the vault, or another group) are not read twice.
- **Knowledge label fix** (`lib/chat/context/knowledge-injector.ts`): the group knowledge tier was mislabeled "general" in rendered block headers (`tierLabel` lacked a `group` case); it now reads "group".
- Tests: new Prospero group/vault whisper suite and Aurora `assembleCorePacket` group-merge suite; doc_list_files tool-definition snapshot updated. Help: `groups.md`, `core-whisper.md`, `document-editing-tools.md`. No schema or migration change — the group tables already exist.

#### Feature: `quilltap db --write` for lock-gated read-write CLI access

The `db` command now opens the database read-only by default and adds a `--write` flag for making changes safely. Previously the only writable path was `--repl`, which opened read-write without consulting the instance lock — racing a running server risked WAL corruption.

- `--write` opens the database read-write only if the instance lock is free. It claims `<dataDir>/quilltap.lock` (the same lockfile the server uses, same JSON shape) for the duration and releases it on exit (normal, Ctrl-C/Ctrl-D, signal, or crash via registered exit handlers). It refuses — with no override — when a live server or another instance holds the lock, mirroring the existing `optimize`/`backup` behavior. A dead/stale lock is claimed (same as the server); a live lock is always refused.
- `--repl` now defaults to read-only; combine with `--write` (`quilltap db --repl --write`) for an interactive read-write session.
- Attempting a write on a read-only connection (raw SQL or REPL) now prints a hint to re-run with `--write` instead of an opaque error/stack trace.
- New helpers in `packages/quilltap/lib/lock-helpers.js`: `acquireWriteLock(dataDir)` / `releaseWriteLock(dataDir)` (plus `detectEnvironmentType`), reusing the existing `getLockStatus` for the live/stale decision. Atomic `O_CREAT|O_EXCL` create, tmp+rename writes, 50-entry history with `acquired`/`released`/`stale-detected`/`stale-claimed` events, and an unref'd 60s heartbeat for long sessions — matching `lib/database/backends/sqlite/instance-lock.ts`.
- Wired into `packages/quilltap/bin/quilltap.js` (`dbCommand` legacy flag path only; verbs `optimize`/`backup` already manage the lock). Updated `printDbHelp`, the bash/zsh/fish completion templates, the CLI README, CLAUDE.md, and DDL.md.

#### Fix: project-less avatar/Lantern image writes silently failed during autonomous turns

The two project-less image-storage bridges — `writeCharacterAvatarToVault` and `writeLanternBackgroundToMountStore` — consume the `blobId`/`linkId` returned by `docMountFileLinks.linkBlobContent` and bake them into the `storageKey` they persist into `files.create`. In the forked job-runner child, that write was buffered (returning `undefined`) rather than executed, so the storageKey embedded a missing id and the resulting file row dangled. This was the latent-broken case flagged as a follow-up when the `linkBlobContent` child-proxy classification was fixed. It affected the wardrobe-avatar path (`character-avatar` handler), the project-less story-background path (`story-background` handler), and the `generate_image` tool when a character invokes it during an `AUTONOMOUS_ROOM_TURN`.

- Both bridges now short-circuit to `callHost(...)` when `QUILLTAP_JOB_CHILD === '1'`, mirroring `FileStorageManager.uploadFile`. The whole write — including the sha-deduped blob/link inserts and the server-computed storageKey — runs on the parent's RW connection and the real ids return synchronously over host-RPC. Because the short-circuit lives inside the bridge (not at each call site), every in-child caller is covered automatically; parent-side callers (startup seed, HTTP routes) skip it since `QUILLTAP_JOB_CHILD` is unset there, so there is no re-dispatch loop.
- `lib/background-jobs/ipc-types.ts`: `ChildHostRpcRequestMessage.method` union extended to `'uploadFile' | 'writeCharacterAvatarToVault' | 'writeLanternBackgroundToMountStore'`.
- `lib/background-jobs/host/host-rpc-dispatcher.ts`: added cases that import each bridge and run it against the RW layer.
- Docs: `docs/developer/BACKGROUND_JOBS_CHILD.md` IPC-protocol table now documents the `host-rpc` / `host-rpc-response` messages (previously undocumented) and the resolved image-bridge note. Tests: new `lib/background-jobs/host/__tests__/host-rpc-dispatcher.test.ts` (method routing + success/failure envelopes) and `lib/file-storage/__tests__/bridge-host-rpc.test.ts` (real-bridge child short-circuit, no DB access; no short-circuit outside the child).
- Still a follow-up: `linkFilesystemFile`'s in-child callers (`scanner.processMountFile`, `reindexSingleFile`'s filesystem branch) have the same root cause and would need the same host-RPC treatment.

#### Fix: writing files to database-backed stores during an autonomous turn threw "not classified for child execution"

The forked job-runner child classifies every repository method as read (pass through to the readonly connection), write (buffer for the parent to apply), or unknown (throw). The three high-level doc-mount content writers — `docMountFileLinks.linkDocumentContent`, `linkBlobContent`, and `linkFilesystemFile` — matched no read/write prefix and had no override, so they were classified `unknown`. Any `doc_write_file` or `doc_copy_file` landing in a database-backed store (projects, groups, character vaults) during an `AUTONOMOUS_ROOM_TURN` therefore threw `Repository method "docMountFileLinks.linkDocumentContent" is not classified for child execution`, failing the tool call. (Scans never hit this — there is no scan background-job type; `scanMountPoint` runs in the parent.)

- `lib/background-jobs/child/child-repositories-proxy.ts`: `linkDocumentContent` and `linkBlobContent` are now `write` overrides. Their in-child callers (`database-store.writeDatabaseDocument`, `file-ops.writeDestBytes`) discard the return value, so the buffered write applies cleanly on the parent's RW connection. Both route to the mount-index partition.
- `linkFilesystemFile` is deliberately **not** a buffered write. It find-or-creates a file + link row and returns ids that its callers (`scanner.processMountFile`, `reindexSingleFile`'s filesystem branch) consume to insert chunk rows; a buffered write can't supply the parent-generated id, so the chunks would dangle and `chunkCount` would lie. It is now listed in a new `CHILD_UNSUPPORTED_METHODS` table that throws a tailored, caught-able error explaining why, instead of inviting a naive `'write'` override. Those callers already catch the throw (file written, left unindexed) — unchanged behavior.
- Known follow-up (since fixed — see the host-RPC entry above): `writeCharacterAvatarToVault` and `writeLanternBackgroundToMountStore` consumed `linkBlobContent`'s `blobId` on their project-less vault paths, so they were latent-broken in the child and needed host-RPC (the pattern `FileStorageManager.uploadFile` already uses). This change left them failing loudly rather than corrupting state until the host-RPC fix landed.
- Docs: `docs/developer/BACKGROUND_JOBS_CHILD.md` method-override tables updated. Tests: new `__tests__/unit/lib/background-jobs/child-proxy-doc-mount-links.test.ts` covers classification, mount-index partition routing, the tailored throw, the consume-return loud-fail, and a `writeDatabaseDocument` handler-path assertion.

#### Fix: database-store files copied in from a filesystem store listed but would not open

Copying or writing a text file into a database-backed document store and then re-indexing it could leave the file listed in the Scriptorium but un-openable ("File row exists but no document content"). After the content writer (`linkDocumentContent` / `linkBlobContent`) correctly stored the bytes, `reindexSingleFile` (run via `triggerReindexIfNeeded` after every doc-edit copy/write) re-routed database-backed stores through `linkFilesystemFile`, which is meant for on-disk files. That helper resolves a `doc_mount_files` row by `(sha256, source='database')` and, finding none — which happens whenever the content was copied in from a filesystem mount, whose only file row carries `source='filesystem'` — forks a fresh, content-less file row and repoints the link to it, severing the document from its `doc_mount_documents` content row.

- `lib/doc-edit/reindex-file.ts`: database-backed stores no longer call `linkFilesystemFile`. The file row + link already exist, so reindex now refreshes chunk metadata (`chunkCount`, `plainTextLength`, `conversionStatus`, `lastModified`) on the existing link in place and re-writes its chunks, leaving the file row and content row untouched. If no link exists (which should never happen, since the content writer creates it first) reindex bails with a warning rather than fabricating a content-less row. The filesystem path is unchanged.
- This also covers blob-backed (pdf/docx) files in database stores, which were vulnerable to the same orphaning.
- Note: files already orphaned by the old code (one per affected store) still need a one-time repair — re-copy them, or repoint the dangling link to the surviving content row.
- Tests: `reindex-file-blobs` updated to assert in-place link refresh (no `linkFilesystemFile`), plus a regression test for the missing-link guard.

#### Aurora: Carina toggle on character cards

Added a third toggle — a small console (terminal) icon — to the character card toggle row, sitting between the favorite star and the user-control figure, on both the Aurora roster grid (`app/aurora/page.tsx`) and the character header card (`app/aurora/[id]/view/components/CharacterHeader.tsx`). Clicking it flips the character's `canBeCarina` flag (Carina inline @-query answerer eligibility) without opening the edit form. The icon is filled when enabled, outlined when disabled, mirroring the existing user-control toggle; tooltip reads "Enable/Disable Carina answers (@-queries)".

- New `POST /api/v1/characters/[id]?action=toggle-carina` flips `canBeCarina` (null/undefined coerces to true) via a new `setCanBeCarina` method on the characters repository, returning the updated character.
- The collection `GET /api/v1/characters` projection now includes `canBeCarina` (defaulting to `false`) so the grid can render the correct state; the item GET already spread the full record.
- Header card wiring: `onToggleCarina` / `togglingCarina` props on `CharacterHeader`, with `handleToggleCarina` + `togglingCarina` state added to `useCharacterView` and passed through the view page. Both the grid and header use optimistic state updates, matching the favorite/user-control handlers.

#### Aurora character card: rearranged header with stats line and group badges

Reworked the middle section of the character card at the top of an Aurora character page (`app/aurora/[id]/view/components/CharacterHeader.tsx`). The character name (`<h1>`) and the favorite/user-control toggles now sit on a top row; the title (`<h2>`) and pronouns on the row below. Aliases moved out of the name line into their own badge row. A new stats line and group badges are bottom-aligned within the card.

- New `GET /api/v1/characters/[id]?action=stats` returns aggregate counts plus the character's groups: `{ stats: { memories, conversations, wardrobeItems, photos, scenarios, knowledge, core, characterFiles, characterFilesTotal }, groups: [{ id, name, color, icon }] }`. Counts are fanned out with `Promise.all`; the vault file links are fetched once and reused for photos, knowledge, and core. Character files render as a `N/total` fraction (e.g. `8/8`); the rest are plain counts.
  - `memories` via `repos.memories.countByCharacterId`; `conversations` via `repos.chats.findByCharacterId().length`; `wardrobeItems` via `repos.wardrobe.findByCharacterId().length` (vault-overlaid); `photos` mirrors the Photo Gallery tab predicate (`photos/` plus legacy `images/avatar.webp` + `images/history/`); `scenarios` from `character.scenarios`.
  - `knowledge` = files under the vault `Knowledge/` folder; `core` = files under the vault `Core/` packet folder; `characterFiles` = how many of the canonical managed vault files (`SINGLE_FILE_OVERLAY_PATHS`) are present (the `N/8` health figure), counted per distinct canonical path so case-variant duplicate rows can't inflate it past the set size.
  - Groups hydrated via `repos.groupCharacterMembers.findByCharacterId` → `repos.groups.findByIds` (color/icon resolved from each group's store).
- Each figure in the ledger carries a hover tooltip (`title`) explaining what it represents (e.g. why a character might have no `core` files, what `knowledge`/`scenarios` are). Pronouns get a subject/object/possessive breakdown tooltip; each group badge's tooltip shows the group's description (carried through the stats payload), falling back to the name.
- Header data loads through a new `useCharacterStats` hook (separate from `useCharacterView` so secondary stats don't block the primary character load); refetched on `dataRefreshKey` changes (e.g. after Search & Replace).
- Group badges render a color swatch + emoji (`group.color` / `group.icon`) and link to `/aurora/groups/[id]`, mirroring `GroupCard`.

#### Fix: group editor page crashed under Next.js 16 (params Promise)

The group editor (`app/aurora/groups/[id]/page.tsx`) read `params.id` synchronously, which Next.js 16 no longer allows — `params` is a Promise. The direct access returned `undefined`, so the page logged a sync-dynamic-API console error and then fetched `/api/v1/groups/undefined`, which failed. Unwrapped `params` with `React.use()`, matching every other client page in the app.

#### Character vault reads fail loudly instead of returning hollow characters

Post-4.6-cutover the character vault is the sole source of truth for content fields (the DB columns were dropped), but the read overlay still silently swallowed a missing/unreadable vault and returned a character with blank identity/description/manifesto/personality/etc. — and the `// falling back to DB values` path had no DB to fall back to. Aligned the character overlay with the project/group store contract so a broken vault fails loudly.

- New `CharacterVaultUnavailableError`. The read overlay's single path (`applyDocumentStoreOverlayOne`, behind `findById`) now **throws** it when a vault-linked character's `properties.json` keystone is missing; the batched path (`applyDocumentStoreOverlay`, behind `findAll`/`findByIds`) **drops** the offending row (logged at `error`) so one bad vault can't take down the whole roster. A store-read exception now propagates instead of being swallowed.
- `lib/api/middleware/auth.ts` maps `CharacterVaultUnavailableError` to a deliberate 503 (with `characterId`). Also added the previously-missing `GroupStoreUnavailableError` → 503 mapping.
- Existence-only callers converted to `findByIdRaw` (never overlays) so a broken vault stays manageable: character delete + PUT ownership pre-checks, and cascade delete/preview (which read only `name`/`defaultImageId`/`avatarOverrides`).
- Character vault startup backfill now repopulates a linked-but-empty vault from the raw row (`ensureCharacterVault` early-returns on a set FK without checking files exist), mirroring the project/group store backfills, so a broken vault self-heals on restart.
- Tests: character-overlay suite updated to the throw/drop contract (keystone now required) plus a mixed-batch isolation test; `cascade-delete` mocks updated to `findByIdRaw`.

#### Fix: group/project store provisioning order (create returned 500)

Creating a new group failed with `POST /api/v1/groups 500` ("has no usable document store: properties.json missing"). `ensureGroupOfficialStore` persisted the new `officialMountPointId` through the overlay-applying `repos.groups.update()`, whose closing re-read demands `properties.json` — but `create()` doesn't write that file until *after* ensure returns, so the FK write threw and rolled the whole create back. The identical pattern existed in `ensureProjectOfficialStore` (latent: existing projects were provisioned by the cutover migration, so a fresh `create()` never exercised it).

- Added `setOfficialMountPointId(id, mountPointId)` to the groups and projects repositories — a raw FK write via the store-aware `_update` that never re-reads the store overlay (write-side sibling of `findByIdRaw`).
- `ensureGroupOfficialStore` / `ensureProjectOfficialStore` now persist the FK through `setOfficialMountPointId` at both the adopt and create sites, instead of `update()`.
- Half-provisioned groups left by a prior failed create self-heal on next startup (the group-store backfill reads `findAllRaw` and writes `properties.json` from the raw row).
- Regression test `__tests__/unit/lib/mount-index/ensure-store-raw-fk.test.ts` pins the contract: ensure() must call `setOfficialMountPointId` and never `update()`.

#### Groups (cross-sections of characters)

Added Groups: a Group is a cross-section of characters, parallel to how a Project is a cross-section of files/chats. Each group owns an official document store (holding `description.md`, a `Scenarios/` folder, and a `Knowledge/` folder) plus zero-or-more additional linked stores, and surfaces Description/Scenarios/Knowledge into chats, the Commonplace Book, and the search tool. Built to the `docs/developer/features/groups.md` spec.

- **Per-responding-character scope.** Group stores in scope for a turn are the union of the stores of every group the *responding* character is a member of — never the chat's participant set. A character never gains a co-participant's group stores.
- **Data model.** Slim `groups` row in the main DB (`id`, `name`, `officialMountPointId`, timestamps); membership (`group_character_members`) and additional store links (`group_doc_mount_links`) live in the mount-index DB, mirroring `project_doc_mount_links`. Substantive content (description/instructions/state/color/icon) lives in the official store, overlaid on read (`lib/groups/group-store/`).
- **Tier resolution.** `lib/mount-index/tiered-mount-pool.ts` gains a `group` tier; full precedence is `character > participant > group > project > global`. `resolveGroupMountPointIdsForCharacter` parallels `resolveProjectMountPointIds`. Group lookups fail soft (catch → empty).
- **Consumers.** Knowledge injector (new `group` tier with its own literal-boost), scriptorium search (`scope: 'group'` added to the tool enum; included in `scope: 'all'`), and the doc-edit write path (group mounts are writable for members — they resolve from the responding `characterId`, unlike read-only peer vaults). The per-turn context-manager call now passes `characterId` so the group tier resolves.
- **New Chat scenarios.** A group's `Scenarios/` are offered in the New Chat dialog whenever *any* selected participant is a member, grouped under `Group Scenarios: {name}` (the one sanctioned exception to per-responding-character isolation — a creation-time menu, not a per-turn grant). New `GET /api/v1/groups/scenarios`; chat-create accepts `groupScenarioPath` + `groupScenarioGroupId`.
- **API.** `/api/v1/groups` (list/create), `/api/v1/groups/[id]` (get/update/delete + `addMember`/`removeMember`/`linkStore`/`unlinkStore` actions, `members`/`stores` reads), plus `[id]/scenarios` and `[id]/mount-points`. Delete drops memberships, unlinks additional stores, and orphans the official store (matching project delete).
- **UI.** A Groups section above the character grid on the Aurora page, with a group editor (`/aurora/groups/[id]`) for name/description/color/icon, member management, and linked-store management.
- **Export/import.** Groups participate in `.qtap` export and backup: new `groups` exportType, `ExportedGroup` def, member ids/names + linked-store refs; import recreates groups, relinks stores, and re-establishes membership (skipping members absent from the import set).
- **Migrations.** `create-groups-table-v1` (main DB) and `create-group-join-tables-v1` (mount-index DB), with startup backfill/re-ensure of official stores and `Scenarios/`+`Knowledge/` folders.

#### Docs: Groups feature handoff plan

Added `docs/developer/features/groups.md`, a build-ready specification for a future Groups feature (a cross-section of characters that owns a designated document store and exposes Description/Scenarios/Knowledge like Projects do, scoped per responding character). Planning document only — no code, schema, or behavior changes.

#### Projects collapsed into their document store

The `projects` table is now a slim identity row — only `id`, `name`, `officialMountPointId`, `createdAt`, and `updatedAt` remain as columns. Everything else moves into the project's official document store as top-level files, mirroring the 4.6 character-vault cutover:

- `description` → `description.md`, `instructions` → `instructions.md`, `state` → `state.json`
- the 14 settings fields (`allowAnyCharacter`, `characterRoster`, `color`, `icon`, `defaultDisabledTools`, `defaultDisabledToolGroups`, `defaultAgentModeEnabled`, `defaultAvatarGenerationEnabled`, `defaultImageProfileId`, `defaultAlertCharactersOfLanternImages`, `storyBackgroundsEnabled`, `staticBackgroundImageId`, `storyBackgroundImageId`, `backgroundDisplayMode`) → one flat `properties.json`

`userId` is dropped entirely — projects are global to the instance (single-user-per-instance).

- **Overlay** (`lib/projects/project-store/`): `applyProjectStoreOverlay[One]` re-assembles the hydrated `Project` from the slim row plus the store files on every read; `applyProjectStoreWriteOverlay` routes store-resident fields back to the files on write (per-mount-point promise-chain serialization for `properties.json`/`state.json`). The hydrated `Project` shape is unchanged, so callers, resolvers, and UI are untouched.
- **Read failure is asymmetric and store-only (no DB-column fallback).** `findById` throws `ProjectStoreUnavailableError` when a project's store is missing/unreadable; list/roster reads (`findAll`, `findByCharacterId`) log at `error` and drop the offending project so one bad row can't take down the whole list.
- **Provisioning is airtight:** `repos.projects.create` provisions and populates the store before returning (fails hard otherwise); a new startup backfill (`backfill-project-stores.ts`, Phase 3.4a) populates the files for any storeless project from the still-present columns; the import path provisions + writes the files from the imported payload. `findByCharacterId` now filters in memory.
- **Repository** drops `UserOwnedBaseRepository` for the plain base; the user-scoped projects wrapper is now a global pass-through. Per-user ownership checks on projects were removed (`checkOwnership` is an existence check now); `project.userId` reads in the project-info / state tool handlers and the chat/file state actions are gone.
- **Migration** `cutover-projects-to-store-v1` (backup-first, count guard, per-project write + verify, blocking gate, single-transaction column drop including `DROP INDEX idx_projects_userId`). Depends on `add-project-official-mount-point-v1`.
- **Export/import** keep the flat, hydrated `ExportedProject` (minus `userId`) so `.qtap` files stay portable; export reads the store, import writes it. `public/schemas/qtap-export.schema.json` and `docs/developer/DDL.md` updated.
- **Error handling for a degraded store:** since `findById` can now throw `ProjectStoreUnavailableError`, the global route error handler maps it to a deliberate 503 (with `projectId`) instead of an opaque 500. Reads that only need a project's existence (file move/promote target validation, chat-creation scenario-path resolution) use `findByIdRaw`, which never throws; chat get-state degrades to empty project state when the project store is unavailable so the chat's own state still returns.
- **Fix — provisioning reads the raw row.** `ensureProjectOfficialStore` now reads the project via `findByIdRaw`, not `findById`. Provisioning runs before the store files exist (project creation, startup backfill, the cutover migration), so the store-only overlay would throw. This also fixes `POST /api/v1/projects`, which provisions the store right after writing a fileless row. The cutover migration no longer calls `ensureProjectOfficialStore` at all — it provisions from the raw-loaded row (using the existing `officialMountPointId`, or creating a store via mount-index ops + a raw-SQL FK stamp) so a legacy wide row, which the schema-validating repository read rejects this early in startup, can't block the migration.
- **Fix — migration opens the mount-index DB explicitly.** The cutover writes each project's overlay files into its mount-index-backed document store, but migrations run in Phase 1, before the app backend's `connect()` (which opens the mount-index connection). The doc-mount repositories read that connection from a global singleton and never trigger the lazy `getDatabaseAsync()` init that a main-DB repository access would, so the migration's first store write threw "Mount index database not initialized" and blocked every project. The migration now calls `getMountIndexSQLiteClient(loadMountIndexConfig())` up front (and aborts cleanly before any destructive work if the connection can't be opened); the app's later `connect()` reuses the same connection.

#### Fix: new characters now keep the identity field typed into the create form

The character create handler (`app/api/v1/characters/handlers/post.ts`) silently dropped the `identity` field on the way to the repository: `createCharacterSchema` never declared `identity`, so Zod stripped it from the request body, and the `repos.characters.create({...})` call omitted it too. The typed-in identity was discarded and the vault's `identity.md` was written empty, while every other vantage-point field (description, manifesto, personality) persisted normally. Added `identity` to both the create schema and the create call.

The AI-wizard path had the same gap in `wizardRequestSchema`: `existingData` didn't carry `identity` (so a pre-typed identity wasn't passed to the generator as context) and `fieldsToGenerate` didn't allow `'identity'` (so the wizard couldn't be asked to generate one). The wizard service already supported identity end to end; only these validators blocked it. Added `identity` to both.

No schema, migration, or export change — `identity` is a vault-backed field already handled by the update path and exports. Editing an existing character's identity was unaffected; only creation lost it.

#### Carina answers appear immediately

Carina reference answers now surface in the Salon the instant they return, instead of waiting for the post-turn `fetchChat()` refresh (previously the answer only appeared after the responding character(s) had finished reacting to it).

- `runCarinaQuery` (`lib/services/carina/carina.service.ts`) gained an optional `onPosted(message)` callback, invoked the moment `postCarinaResponse` persists the answer (before the memory-extraction enqueue). A thrown callback is logged and swallowed — a failed emit never undoes a posted answer.
- New `carinaAnswer` SSE event (`encodeCarinaAnswerEvent` in `streaming.service.ts`) carries the full posted message. Wired at all three in-stream call sites: user `@Name:`/`@Name?` markup (orchestrator), a character's `@Name:` markup in a response (finalizer), and the `ask_carina` tool (threaded via `ToolExecutionContext.emitCarinaAnswer`, set by the orchestrator after `createToolContext`). The forked-child/autonomous path leaves `onPosted` undefined (no client stream) and is unchanged.
- Client (`app/salon/[id]/hooks/useSSEStreaming.ts`): `readSSEStream` routes `carinaAnswer` to a new `onCarinaAnswer` handler that inserts the message optimistically, deduped by `id`. The end-of-turn `fetchChat()` reconciles it to the authoritative, pre-rendered copy; whisper visibility uses the same render-time filter, so there is no flash and no duplicate.
- Token-by-token streaming of the answer text remains deferred. No schema, migration, or export change — `carinaAnswer` is transport-only and the message is already persisted.

#### Fix: embedding failures and memory-housekeeping thrash no longer pile up or stall rooms

- **Embeddings — deterministic failures no longer retry to DEAD.** `EMBEDDING_GENERATE` jobs that fail for reasons that recur on retry (empty/whitespace input, NaN/non-finite vectors, over-context input, dimension mismatch) are now marked failed and dropped instead of retrying three times each and accumulating as DEAD rows — `isPermanentEmbeddingError` in `embedding-generate.ts`. Transient errors (`fetch failed`, timeouts) still retry. `skipIfOversize` also now skips empty input up front.
- **Ollama plugin (1.0.30 → 1.0.31).** Rejects empty/whitespace input before calling the server, and validates the returned vector for NaN/Inf (`assertFiniteEmbedding`) on both the `/api/embed` and legacy `/api/embeddings` paths, so a non-finite vector can't poison cosine similarity or break downstream JSON serialization.
- **Memory housekeeping — durable watermark-sweep throttle.** The de-thrash backoff was process-local: the watermark enqueue and the sweep run in different forked job children (and the cache is wiped on restart), so a character sitting at its cap kicked off an expensive `mergeSimilar` sweep on nearly every turn, starving the turn queue. Added a durable, DB-backed throttle (`WATERMARK_SWEEP_THROTTLE_MS`, 15 min/character, via `backgroundJobs.findRecentByType`) layered on top of the existing in-memory cache. The daily scheduled sweep is unaffected. No schema change.

#### Carina now forms memories and receives memory recall

Reversed Carina's original "no memory" design (the feature is still unreleased this cycle). Carina answerers now both remember their consultations and draw on what they remember:

- **Recall in the call** — `runCarinaQuery` runs a semantic search of the answerer's own memories against the question (`searchMemoriesSemantic`, default embedding profile) and injects the formatted result into the isolated call's system prompt via `buildCommonplaceLLMContext`. Recall only — still no live conversation, project, or core context. A recall miss or error never blocks the answer.
- **Memory formation** — after the answer posts, `runCarinaQuery` enqueues a new `CARINA_MEMORY_EXTRACTION` background job. Its handler (`lib/background-jobs/handlers/carina-memory-extraction.ts`) loads the posted carina message, builds a one-slice `TurnTranscript` (question = turn opener, answer = the answerer's sole contribution, no user-controlled character), and runs `processTurnForMemory`. With no user character in the transcript the OTHER pass self-skips, so only SELF memories form — the answerer remembers what it was asked and what it answered.
- **Global, both directions** — applies to every `canBeCarina` answerer (no new flag, no migration). Public and whispered exchanges both form memories.
- The `systemSender: 'carina'` tag still excludes the answer from the *normal* per-turn extractor (`buildTurnTranscript` skips every systemSender message); the dedicated job is what forms Carina's memories instead. Enqueue works from both the markup path (main process) and the `ask_carina` tool during an autonomous-room turn (forked child), the same way per-turn extraction already enqueues from the child.
- Help (`help/carina.md`) and the Carina feature doc updated.

#### Fix: autonomous-room renames no longer fire nearly every turn

The auto-rename (`TITLE_UPDATE`) and summarization-gate cadence keys off `calculateInterchangeCount`, which for autonomous rooms counted every ASSISTANT message — including staff whispers (host, prospero, aurora, commonplaceBook, librarian). Each autonomous turn emits one character message plus several whispers, so the interchange counter climbed ~5 per turn instead of ~1. The title-check gate fires once per multiple-of-10 crossed, so the inflated counter crossed a decade boundary almost every turn and enqueued a rename job nearly every turn.

`calculateInterchangeCount` (`lib/chat/context-summary.ts`) now skips messages with `systemSender` set in both the autonomous and regular-chat paths, counting only genuine user/character turns. This restores the intended roughly-every-10-interchanges cadence. No schema change; `systemSender` already exists on chat messages.

#### Tri-tier wardrobe + shared mount-tier resolver

Wardrobe is now tri-tier, matching knowledge, scenarios, and document search: a character's wearable garments are drawn from the character's own vault, the active chat's project document stores, and Quilltap General — in that precedence order (nearer tier wins on id collision). Previously wardrobe was two-tier (character vault + Quilltap General archetypes only); project stores were never consulted.

- **New `lib/mount-index/tiered-mount-pool.ts`** is the single source of truth for the `{character, participant, project, global}` mount-tier resolution that was previously re-derived (with subtly divergent dedup rules) in the knowledge injector, the scriptorium search tool, and the doc-edit path resolver. Exposes `resolveTieredMountPool`, `dedupeTierTriple`, `flattenTierPool`, `classifyMountTier`, and the lightweight `resolveProjectMountPointIds` / `resolveProjectMountPointIdsForChat`.
- **Adopted the helper everywhere**: `knowledge-injector.ts` (via `context-manager.ts`), `search-scriptorium-handler.ts`, and `path-resolver.ts`'s `collectAccessibleMountPointIds` all now delegate to it. Behavior is unchanged for those features (ownership gate, participant vaults, and operator override are preserved); the duplication is gone.
- **Wardrobe reads** (`findArchetypes`, `findArchetypeById`, `findByIdForCharacter`, `findByIdsForCharacter`) accept an optional `projectMountPointIds`, and `resolveEquippedOutfitForCharacter` threads it through. Equipped-outfit resolution in the chat context, scene-state tracking, story backgrounds, avatars, image generation, the wardrobe tool handlers, the outfit API actions, and chat creation now all pass the active project's stores. Call sites with no project context fall back to the prior two-tier behavior.
- **New `lib/mount-index/project-wardrobe.ts`** reads/ensures a project store's `Wardrobe/` folder (reusing the generic vault reader, same as `general-wardrobe.ts`).
- **Project wardrobe writes + CRUD**: generalized the vault writer (`wardrobe-writes.ts`) with an explicit project location and `scope` discriminator; cycle peers now include Quilltap General archetypes for project composites. New `/api/v1/projects/[id]/wardrobe` and `/api/v1/projects/[id]/wardrobe/[itemId]` routes (GET/POST/PUT/DELETE), mirroring project scenarios. New **Wardrobe** card on the Prospero project page (`WardrobeCard` + `ProjectWardrobeManager` + `useProjectWardrobe`).
- **Wardrobe pickers surface the project tier**: `useCharacterWardrobeItems` now merges personal + project + Quilltap General (precedence personal > project > general). The in-chat Wardrobe Control dialog resolves the project from its `chatId`; the chat-start and add-participant outfit selectors pass `projectId`/`chatId`. Project items appear as wear-only in the dialog (no edit/delete there — they're managed on the project page, like project scenarios), and equipping them is validated through the tri-tier resolution.
- **Create-destination selector in the wardrobe editor**: when adding a new item from the Wardrobe dialog, an "Add to" selector chooses where it's written — **This character** (personal, default), **Shared — everywhere** (Quilltap General), or **Shared — this project** (offered only when the dialog has a project context). The editor's composite-component picker also folds in project items so project composites can bundle project pieces. Replaces the old shared-only routing (which always wrote to Quilltap General). The redundant "Available to all characters" checkbox was removed — the "Add to" selector is now the single control for an item's tier (and editing keeps an item in its existing tier).
- No database schema or migration change — project wardrobe items are Markdown files in an existing project document store, the same storage path as project scenarios.
- Help: new `help/project-wardrobe.md`; `help/wardrobe.md` gains a "three tiers" section.

#### Carina — inline LLM queries

Added Carina, an inline query system that lets users and LLM characters ask quick questions of a designated answerer character without derailing the conversation.

- **`@Name:` / `@Name?` markup** — place at the start of a line in any Salon message to route a question to the named character publicly (`:`) or as a whisper back to the asker only (`?`). Quoted forms (`"…"` / `'…'`) accept multi-sentence questions; smart quotes are supported. One query fires per message (first match wins).
- **`ask_carina` tool** — programmatic equivalent for LLM characters; same public/whisper semantics via a `whisper` boolean parameter. Offered only when at least one `canBeCarina` answerer exists, and withheld from the answerer's own tool slate to prevent recursion.
- **Per-character `canBeCarina` flag** — opt-in on the character edit page in Aurora; off by default. Answerers need not be participants in the chat to answer.
- **Isolated calls** — the answerer sees its own identity/personality/scenario, its own recalled memories, and any prior Carina exchanges in the chat, but no full chat history and no project context. The answerer has access to the chat's tools and runs the normal tool-call loop. (Memory recall and memory formation were added later in this same dev cycle — see "Carina now forms memories and receives memory recall" above; the original spec had neither.)
- **Attribution** — answers are posted as `systemSender: 'carina'` / `systemKind: 'carina-response'` messages attributed to the answerer character and rendered with that character's own avatar (not a dedicated staff avatar), as a full-row reference card rather than a collapsed chip. Errors are reported by Prospero with `systemKind: 'carina-error'`.
- **Delivery** — answers are generated server-side and surfaced via the existing post-turn chat refresh (not live-streamed in this version). A public `@Name:` answer is spliced into the current turn so the first character to respond in the same cycle also sees it; a `@Name?` whisper is scoped to the asker and is not relayed to other characters.
- Migrations: `add-carina-flag-v1` adds `canBeCarina INTEGER DEFAULT NULL` to `characters`; `add-carina-message-meta-v1` adds `carinaMeta TEXT DEFAULT NULL` to `chat_messages` (JSON `{ answererId, question }`, drives avatar resolution and exchange continuity).
- `systemSender` enum gains `'carina'` (Zod, message-ops schema, and the `.qtap` export schema); `canBeCarina` and `carinaMeta` round-trip through `.qtap` export/import via full-record serialization.
- Help: new `help/carina.md`.

### 4.6.1

#### Removed development debug logging from the autonomous-room work

Stripped the seven `logger.debug` tracing statements added during the autonomous-room debugging push, plus the small bits of scaffolding that existed only to feed them. No behavior change.

- `context-builder.service.ts`: removed the "Tool result elision summary" log (fired on every context build) and its dead `elided`/`kept` counters.
- `autonomous-room-turn.ts`: removed the two context-summary fold trace logs (and the now-empty `else` branch).
- `autonomous-room.service.ts`: removed the "flipping row to running" and "edit no-op (empty patch)" logs.
- `text-handlers.ts`: removed the `doc_list_files` "filtered entries from results" log and its `cruftDropped`/`autoImageDropped` counters; the filtering itself is unchanged.
- `ai-import.service.ts`: removed the "Re-stamped structural fields" log; kept the in-place `restampStructuralFields` call, dropped the unused return capture.

Operational `info`/`warn`/`error` logging and client-side error handling are left intact.

#### Autonomous rooms grant a final "grace" turn when the budget is hit without warning

The near-end (90%) Host nudge is only sampled at turn boundaries, so a single turn whose spend exceeds 10% of a small budget vaults the entire [90%, 100%) band — the run exhausts with the company never having been told to wrap up. (This is exactly what happened on a 100k-token room: turns of ~25k stepped the budget 75% → 100% in one go, so `nearing-end` never fired.) Now, when a run reaches its budget and the near-end nudge never fired, the Host announces a grace round and the run is allowed exactly **one** more turn (over budget) so the scene can close gracefully. If the near-end nudge *did* fire earlier in the run, it ends with no grace turn — the company was already warned.

Implemented in `autonomous-room-turn.ts` with a new `MILESTONE_GRACE` bit on the existing `runMilestonesAnnounced` bitmask (no schema change). On budget exhaustion at either the pre-turn or post-turn checkpoint: if neither the near-end nor grace bit is set, the handler sets the grace bit, posts an `autonomous-room-grace` Host announcement, and re-enqueues one turn instead of ending. That turn runs over budget (the pre-turn check lets it through because the grace bit is set) and ends the run at its own post-turn check. Exactly one grace turn per run.

The budget-caps form (`AutonomousRoomCard`, shown in both the New Room flow and the Edit Enclave modal) now explains that a cap is a soft boundary, not a hard wall: a run that overruns its allowance without a near-end warning is granted one last grace turn to close gracefully.

#### Fix: autonomous-room conversation summaries now actually persist

Autonomous rooms run their turns in the forked job child, where repository writes are buffered and flushed only at the end of the job. The rolling-window context-summary fold was fired fire-and-forget, so its writes settled after the flush and were silently dropped — the fold anchor (`lastSummaryTurn`) never advanced past its first value, and a long room re-sent nearly its entire history on every turn. (Observed: a room at 429 character turns still pinned to `lastSummaryTurn=5`, `compactionGeneration=1`.)

- The finalizer (`message-finalizer.service.ts`) now skips the fire-and-forget summary check for `chatType: 'autonomous'`.
- The turn handler (`autonomous-room-turn.ts`) instead runs the fold inline and **awaited**, after the `runWithAutonomousRunId` scope closes and before enqueuing the next turn. Awaiting keeps the fold's writes inside the job's write buffer so they reach the parent; running it outside the run-id scope means the fold's cheap-LLM tokens are **not** billed against the per-run token budget (housekeeping, not turn spend). The next turn then sees the freshly compacted room.
- `checkAndGenerateSummaryIfNeeded` gains an `{ awaitFold }` option; interactive chats keep the fire-and-forget path unchanged.

#### Long chats no longer re-bill stale tool results every turn

Persisted tool-result messages (e.g. `read_conversation`, `doc_list_files`) were re-injected into the LLM context verbatim on every turn, and the rolling summary never folded them out (the fold anchors only USER/character messages). A single large result — a 587 KB conversation dump, a 1,100-file listing — was re-sent and re-billed indefinitely, which is what blew an autonomous room's per-run token budget in one turn.

`buildConversationMessages` (`context-builder.service.ts`) now stubs any tool result older than 3 turns (counted by ASSISTANT messages after it), keeping the tool name and a short arguments preview: `[Tool Result: <tool>] (args: …) — result elided (>3 turns old); call again to re-read.` The most recent 3 turns stay verbatim. This is a context-assembly transform only: the stored message is untouched, the Salon UI still shows the full result, and summary/memory inputs (which skip tool rows) are unaffected. Applies to all chat types.

#### doc_list_files now hides auto-generated images and OS cruft

`doc_list_files` listings filtered nothing, so they surfaced `.DS_Store` and similar, plus every auto-generated avatar/background image — bloating the tool result (and, re-billed every turn, the budget).

- Hidden OS files (`.`-prefixed names, plus `Thumbs.db` / `desktop.ini` / `__MACOSX`) are now always filtered out.
- Auto-generated images (image files under a `character-avatars` or `story-backgrounds` path segment) are filtered out by default. A new `includeAutomaticImages` flag (default `false`) on the tool brings them back. Saved images live elsewhere (character photo albums) and are unaffected.
- The filter is a shared post-collection pass covering both filesystem- and database-backed stores (`text-handlers.ts`); the helpers and folder/extension constants live in `lib/files/folder-utils.ts`. The Projects file API has its own image categorization and is unchanged.

#### Autonomous-room start/resume now reflect "running" immediately

Starting or resuming an autonomous room ("enclave") now flips the room to **running** the instant you click the control, instead of lagging until the first turn job comes around. Previously a manual or scheduled start parked the room at `idle` and let the turn handler promote it to `running` on the first turn — so if a turn for another room was already in flight, the badge/header could sit on the play icon (looking like nothing happened) for up to a minute.

- Server: `startAutonomousRoomManually` and the schedule tick now write `runState: 'running'` (counters zeroed, `runStartedAt` stamped) synchronously at request time and post the Host "run begun" banner, via a shared run-start contract in the new `lib/background-jobs/handlers/autonomous-room-announce.ts` (`runStartPatch` + `postRunStartAnnouncement`). The turn handler keeps a defensive `idle → running` fallback for any pre-upgrade turn job still carrying an `idle` row. `runStartedAt` now anchors the wall-clock budget from the button press (including any brief queue wait before the first turn).
- If the turn enqueue fails after the row has flipped, the manual path rolls the row to `error` and the scheduled path rolls it back to `idle`, so the badge never falsely shows `running` with nothing in flight.
- Client: the global autonomous-room badges and the Settings → Chat management card now update optimistically (SWR `optimisticData` + `rollbackOnError`), so the icon/label flip on click rather than after the POST + revalidation round-trip.

#### Fix: autonomous-room token counter now resets on a fresh run

A manually-started or scheduled autonomous-room run now starts its per-run token tally from zero, instead of carrying over the previous run's total. A *resumed* (paused → running) run still keeps the count it had, as intended.

The post-turn token bookkeeping in `autonomous-room-turn.ts` floored `runTokensConsumed` against `post.runTokensConsumed` — a re-read served from the forked job child's readonly connection. On the first turn of a fresh run, the idle→running `runTokensConsumed: 0` reset is still buffered in the child, so that re-read returned the *previous* run's total; `Math.max(thisRunTokens, previousRunTokens)` then carried the stale count forward. A room with `budgetMaxTokens` set would trip `budgetExhausted` on the first turn of its second-or-later run. Fixed by flooring against the local `chat` snapshot (reset to 0 on idle→running for a fresh run, preserved for a resumed run) — the same pin the turn counter already used. No schema change; same monotonic-floor and cache-hit-counting behavior otherwise.

#### Autonomous rooms ("enclaves") can now be edited after creation

The autonomous-settings form from the New Room flow can now be reused to edit an existing autonomous room. Editable: title, schedule cron, catch-up freshness window, the four budget caps (turns/tokens/wall-clock/spend), the "count only the dear tokens" cache-hit toggle, visibility, and destructive-tool authorization. The participant roster and per-character connection profiles/system prompts are not edited here — those stay on the Participants sidebar card.

Two entry points open the same **Edit Enclave** modal:

- An **Edit** button per room in the *Scheduled Autonomous Rooms* card at `/settings?tab=chat`.
- An **Edit Enclave** button in the *Organize* card of the Salon chat sidebar, shown only when the open chat is an autonomous room.

Edits apply instantly: a running run honors new budget caps / cache mode / destructive flag on its next turn (the turn handler reads them fresh each turn), and visibility applies on the next Salon list fetch — no run restart. Changing the cron recomputes `scheduleNextRunAt`; clearing it returns the room to manual-only; an invalid cron is rejected (400) and leaves the schedule untouched. Lowering a cap below current consumption ends a running run on its next turn (intended). Setting a title also pins `isManuallyRenamed` so the auto-titler leaves it alone.

Implementation:

- New `updateAutonomousRoomSettings(chatId, userId, patch)` in `lib/services/chat-message/autonomous-room.service.ts`: guards `chatType === 'autonomous'`, recomputes the cron next-run, clamps `runDestructiveToolsAllowed` to 0 when the user-level policy is `always_refuse`, writes via `repos.chats.update` (never touches run-state/counters), debug-logs the change. Tri-state patch semantics: `undefined` = leave, `null` = clear, value = set.
- New `?action=update-settings` POST on `app/api/v1/chats/[id]/autonomous-room/route.ts` with a Zod schema mirroring the autonomous block of `createChatSchema` (caps/cron/visibility made `.nullish()` so they can be cleared). Values are in milliseconds, like the create payload.
- `chatType` added to the `GET /api/v1/chats/[id]` response (and the Salon `Chat` type) to gate the sidebar button.
- `AutonomousRoomCard` extracted from `NewChatForm.tsx` into `components/new-chat/AutonomousRoomCard.tsx` and reused by the new `components/new-chat/EditEnclaveModal.tsx`. The modal converts ms ⇄ hours/minutes at its API boundary.
- Settings card (`components/tools/autonomous-rooms-card.tsx`) refreshes its SWR list after a save; the Salon page refetches the chat so the header title updates.

#### Autonomous rooms now get Host pacing announcements at the halfway and near-end marks

An autonomous-room run now posts two Host announcements as it approaches its budget, so the characters can pace themselves and wrap up before the run stops:

- **Halfway** — when the binding budget crosses 50%, the Host notes that the gathering has reached its midpoint and nudges the conversation toward what matters most.
- **Near the end** — when 10% of the budget remains (90% consumed), the Host warns that the gathering will soon close and asks the participants to say what most needs saying.

The "binding" budget is whichever configured cap is closest to exhaustion (the one that will halt the run first) — turns, tokens, wall-clock, or the cross-room daily user-token cap; the announcement phrasing adapts to it. Each milestone fires at most once per run. The daily cap *pauses* the room rather than ending the run, so its near-end nudge is framed as "finish for now — the company will reconvene" instead of a final close; the characters are still told to wrap up the present scene. The estimated-spend cap is not counted (it is not enforced in the run loop today).

Each announcement carries both a Host-voiced body (shown to the operator in the Salon) and a persona-free `opaqueContent` body that is swapped into the characters' LLM context in opaque-anywhere rooms — so the steering reaches the characters whether or not they can see the Host by name.

Implementation:

- New `runMilestonesAnnounced` column on `chats` (`INTEGER DEFAULT 0`), a per-run bitmask (bit 0 = halfway, bit 1 = near-end), added by migration `add-autonomous-run-milestones-v1`. Reset to 0 at each run start. Added to `ChatMetadataSchema`/`ChatMetadataBaseSchema`, the qtap export schema, and DDL.
- `autonomous-room-turn` computes the binding-budget fraction post-turn (across the per-run turns/tokens/wall-clock caps and the daily user-token cap) and fires the appropriate milestone once, recording it in the bitmask. A turn that vaults straight past 50% to ≥90% fires only the near-end nudge and marks both bits. When the daily cap is the binding budget the nudge uses pause-framed phrasing.
- `postAutonomousRoomAnnouncement` now accepts an `opaqueContent` body; the milestone messages populate it.
- Salon UI: display labels and importance tiers added for the `autonomous-room-*` system-message kinds (`start`, `end`, `paused`, `halfway`, `nearing-end`).

#### Fix: wall-clock-budgeted autonomous rooms could falsely exhaust after one turn on a repeat run

The post-turn budget check read the wall-clock anchor (`runStartedAt`) from a re-read of the chat row. On the first turn of a fresh run, the idle→running reset that stamps `runStartedAt = now` is still buffered in the forked job child, so the re-read returned the *previous* run's start — yielding a huge elapsed time that tripped `budget:wall_clock` and ended the run after a single turn. The check now pins `runStartedAt` and `runPausedAccumMs` from the local in-handler snapshot (which carries the fresh reset), mirroring how the turn/token counters are already pinned. The pre-turn check was already correct.

#### Autonomous-room token budgets can now optionally count all tokens (including prompt-cache hits)

The exclusion of prompt-cache hits from the autonomous-room token budget (see below) is now a per-room choice rather than a fixed rule. A new **Count only the dear tokens** checkbox in the autonomous-room creation card controls how the per-run token cap (`budgetMaxTokens` / `runTokensConsumed`) is tallied:

- **Checked (default):** count only the billable cache-miss input + completion tokens — the expensive ones. This preserves the cache-excluding behavior.
- **Unchecked:** count every token, including prompt-cache hits, the way budgets behaved before cache-read normalization.

Implementation:

- New `budgetExcludeCacheHits` column on `chats` (`INTEGER DEFAULT 1`), added by migration `add-autonomous-budget-cache-mode-v1`. Existing rooms default to 1 (exclude cache hits). Added to `ChatMetadataSchema`/`ChatMetadataBaseSchema`, the chat-creation API, the autonomous-room status response, the qtap export schema, and DDL.
- `LLMLogsRepository.getTotalTokenUsageForRun` takes a new `{ includeCacheHits }` option. The provider plugins strip cache reads from `usage.totalTokens`, so when a room opts into counting all tokens the repository adds them back from each row's `cacheUsage.cacheReadInputTokens`.
- `autonomous-room-turn` reads the per-room flag and passes `includeCacheHits` accordingly. The daily user-token cap remains cache-excluded (it is a cross-room aggregate with no single per-room flag governing it).
- New-chat form: `budgetExcludeCacheHits` added to the autonomous form state, defaulting to checked.

#### Fix: AI character import ("Summon From Lore") could fail to save the generated character

A character generated by AI import would assemble and validate but then fail at import time with `systemPrompts.0.createdAt: expected string, received undefined`, leaving nothing saved. Three compounding causes in `lib/services/ai-import.service.ts`:

1. **Assembly wrote `null` for optional text fields.** `personality`, `firstMessage`, `exampleDialogues`, `title`, `identity`, `description`, and `manifesto` were assigned an explicit `null` when a step omitted them (or failed). The qtap export schema types these as non-nullable strings, so a present-but-`null` value failed validation. These fields are now omitted entirely when there is no usable string (the DB schema treats them as nullable/optional, so the imported character is identical).
2. **The LLM repair loop stripped structural scaffolding.** When validation failed, the repair step re-sent the whole `characters` section to the model and replaced it wholesale; the model dropped the `id`/`createdAt`/`updatedAt` on nested `systemPrompts` (and could do the same to `scenarios`, `physicalDescription`, `wardrobeItems`, and memories). The qtap schema does not enforce those nested fields but the DB schemas require them. A new `restampStructuralFields` pass now re-applies that scaffolding after assembly/repair so a repaired export still imports cleanly.
3. **`parseLLMJson` rejected raw control characters.** Models routinely emit a literal newline (or tab) inside a JSON string instead of `\n`, which made the `first_message` and `chats` steps fail with "Bad control character in string literal." `parseLLMJson` now escapes in-string control characters as a repair step before re-parsing.

Net effect: AI import succeeds where it previously died, and a character whose individual sub-steps fail still imports with the fields that did generate.

#### Fix: AI-imported wardrobe items failed to import ("Cannot read properties of undefined (reading 'length')")

Even after the character itself imported, every AI-generated wardrobe item was rejected. `assembleQtapExport` built wardrobe items without `componentItemIds`/`replace`, and `wardrobeRepository.create` spread the caller's data into the new item without applying the schema's array/flag defaults — so `undefined` reached the vault writer's `componentItemIds.length` check and threw.

- `lib/database/repositories/wardrobe.repository.ts`: `create` now defaults `componentItemIds` (`[]`) and `replace` (`false`) at the construction chokepoint, so any caller handing it a partial item is safe.
- `lib/services/ai-import.service.ts`: assembled wardrobe items now include `componentItemIds: []` and `replace: false`, matching the wardrobe schema.

#### Background-job writes are now isolated per database, and concurrent doc-store folder creates reconcile instead of failing

Completes the deferred hardening from the autonomous-room poison-write fix below. A background job buffers all of its repository writes into one batch the parent applies, but those writes can target three separate SQLite databases (the main DB, the dedicated mount-index/doc-store DB, and the llm-logs DB). The applier used to wrap the whole batch in a single transaction on the *main* connection, so a doc-store write failure rolled back unrelated main-DB chat/run-state writes while any doc-store rows already written leaked (they auto-committed outside that transaction).

- **Per-database partitioned apply.** The parent now splits each batch by target database and commits each partition in its own transaction on its own connection (`lib/background-jobs/host/write-partition.ts` + the rewritten applier in `job-dispatcher.ts`). A failure in one database can no longer roll back or leak into another.
- **Ordering and failure policy by job type.** Idempotent handlers apply secondary partitions (mount-index, llm-logs) before main so a secondary failure prevents the main commit (e.g. a mount-chunk embedding write that fails won't let the chunk be marked embedded), and any partition failure fails the job so the existing retry path re-runs it. Autonomous-room turns are not idempotent, so their main-DB chat/run-state partition commits first and authoritatively; secondary doc-store writes are then applied best-effort, and a genuine doc-store failure is rolled back, logged, and dropped rather than discarding the committed turn.
- **Cross-job concurrent folder create.** When two jobs concurrently create the same doc-store folder path, the second create now hits the `(mountPointId, parentId, name)` unique index at apply time. The applier catches that, resolves to the already-committed folder, and remaps the discarded buffered folder id across the rest of that batch's writes (file links, child folders) so they point at the surviving row. Applies are serialized, so this lookup is race-free. The earlier fix only de-duplicated folder creates *within* a single job.

#### Cache-read (prompt-cache hit) tokens no longer count against autonomous-room budgets

Prompt-cache hits are now excluded from the normalized token usage every provider plugin reports. Cached input therefore no longer counts toward an autonomous room's per-run token cap (`budgetMaxTokens`), the daily user-token cap (`dailyTokenBudget`), or the per-chat token/cost aggregates.

The reconciliation lives in the provider plugins, not the app. Each provider reports usage differently — Anthropic reports `input_tokens` separately from `cache_read_input_tokens`, while the OpenAI family folds `cached_tokens` into the prompt-token count — so each plugin subtracts cache reads at the source according to its own convention. The app's budget code is unchanged: it already sums `usage.totalTokens`, which now excludes cache reads everywhere.

- `qtap-plugin-anthropic` (1.0.43): already excluded cache reads from `promptTokens`/`totalTokens` (input_tokens is reported separately from cache reads); only a clarifying comment was added so the convention isn't "fixed" away later.
- `qtap-plugin-openai` (1.0.49), `qtap-plugin-grok` (1.0.40), `qtap-plugin-z-ai` (1.1.11): subtract `input_tokens_details.cached_tokens` / `prompt_tokens_details.cached_tokens` from prompt and total.
- `qtap-plugin-google` (1.1.37): subtract `cachedContentTokenCount` from prompt and total.
- `qtap-plugin-deepseek` (1.0.10): subtract `prompt_cache_hit_tokens` from prompt and total.
- `qtap-plugin-openrouter` (1.0.45): subtract cache-read tokens across all three usage paths (non-streaming, Responses streaming, and chat-completions streaming — the last previously surfaced no cache data at all and now does).
- `cacheUsage` (the cache-read / cache-creation token counts) and `rawProviderUsage` are reported unchanged for display and diagnostics; only `usage.promptTokens` / `usage.totalTokens` changed.
- Caveat: the cost estimator has no cache-discount tier, so for the OpenAI-family providers the estimated cost and per-chat token totals now omit cache-read tokens entirely, rather than charging them at the full input rate as before.
- Docs: schema doc-comments in `lib/schemas/chat.types.ts` (`budgetMaxTokens`, `runTokensConsumed`) and `lib/schemas/settings.types.ts` (`dailyTokenBudget`); user help in `help/autonomous-rooms.md`.

#### Fix: autonomous rooms could freeze mid-run, and per-run token budgets over-counted

Two related bugs in autonomous rooms. A scheduled room would stop advancing and sit in `running` forever, and its per-run token budget was being charged for spend that wasn't part of the run.

Root causes:
1. **Poison write wedged the room.** Each autonomous turn runs in the forked job child, which buffers all of its writes — the assistant message, the turn/token counters, and the run-state transition — into one batch the parent applies atomically. When a character created a document-store folder that already existed within the same turn, the duplicate `docMountFolders.create` hit a unique constraint at apply time and rolled back the *entire* batch, including the run-state transition. The single-attempt job was marked DEAD and the chat stayed `running` with no turn in flight. `ensureFolderPath` was already written to be idempotent, but its existence-check and conflict-catch are both defeated in the child: reads use a readonly connection (no read-your-writes) and the real INSERT (and its conflict) is deferred to the parent.
2. **Per-run token budget counted the wrong tokens.** The post-turn budget check summed *all* `llm_logs` for the chat since the run started (a timestamp window), which folded in overlapping activity and fire-and-forget housekeeping (memory extraction, scene-state tracking, danger classification, title/summary generation) on top of the run's own turns. A long-running chat could blow past its per-run token cap after a single turn.

Fixes:
- `lib/mount-index/folder-paths.ts` + `lib/background-jobs/child/child-repositories-proxy.ts`: `ensureFolderPath` now consults a per-job memo (carried on the job scope) so a folder ensured earlier in the same job is never buffered for creation twice. Removes the poison write.
- `lib/services/chat-message/autonomous-room.service.ts` + `lib/background-jobs/host/job-dispatcher.ts`: when an `AUTONOMOUS_ROOM_TURN` job fails terminally, the dispatcher now reconciles the room to a resumable `paused` state (mirroring the startup reconcile) with the cause recorded in `runStateMessage`, instead of leaving it silently `running`.
- New `autonomousRunId` column + index on `llm_logs` (migration `add-llm-logs-autonomous-run-id-column-v1`). Every LLM call made within a turn is tagged with the run id via an `AsyncLocalStorage` context (`lib/background-jobs/autonomous-run-context.ts`); the turn handler now sums per-run spend by run id (`getTotalTokenUsageForRun`) instead of by timestamp window. This isolates the run's own turn spend (turns + agent-mode sub-calls) and excludes background housekeeping.
