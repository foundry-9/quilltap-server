# Quilltap Changelog

## Recent Changes

### 4.6-dev

#### Feature: Z.AI (GLM) provider plugin bundled with Quilltap

`plugins/dist/qtap-plugin-z-ai/` now ships in-tree (previously a separately-published `@quilltap/qtap-plugin-z-ai` package). Source moved verbatim; `package.json`, `manifest.json`, and `esbuild.config.mjs` were rewritten to match the other bundled provider plugins (unscoped name, `Foundry-9 LLC` author, plain `dependencies` instead of peer-deps, `index.js` at plugin root). Version bumped 1.1.3 → 1.1.4 to mark the move. No app-side registration changes — the build-plugins script discovers it automatically via `manifest.json` with `typescript: true`.

Provides GLM-4.6, GLM-4.5 family, GLM-4.6V / GLM-4.5V vision, tool/function calling, Z.AI's native `web_search` tool, and CogView-4 / GLM-Image image generation. Endpoint: `https://api.z.ai/api/paas/v4`.

#### Fix: Lantern story-background prompts no longer re-append portraits for participants

`appendMissingCharacterEnumerations` in `lib/background-jobs/handlers/story-background.ts` was scanning the full user-workspace character list and appending canonical `Name: A woman. <description>` entries for every participant whose name appeared in the crafted prompt without a `Name:` enumeration. Since the crafter LLM normally weaves participants into the scene inline ("On the left, Friday, a woman with strawberry-blonde…") rather than as `Friday: …` enumerations, the safety net was firing on every participant, dumping portrait-style side cards after the integrated scene. Image providers rendered the result as a divided triptych of head-shot tiles instead of a unified scene.

The fallback's original purpose (`c8df7d58`) was non-participant characters who get name-dropped via scene context or SceneState actions but were never handed to the crafter. The call site now filters `userCharacters` down to non-participants using `payload.characterIds` before invoking the helper — participants already had their descriptions woven in by the crafter, so they don't need a fallback portrait append. Non-participants still get the safety-net enumeration so the image provider doesn't invent appearances for them.

#### Fix: CLI no longer breaks node-pty's spawn-helper executable bit on macOS

`packages/quilltap/bin/quilltap.js` was unconditionally replacing the standalone tarball's bundled `node_modules/node-pty` with a symlink to the npm-installed copy under `/usr/local/lib/node_modules/quilltap/node_modules/node-pty`. On macOS, `sudo npm install -g quilltap` extracts that copy with the executable bit stripped off `prebuilds/<platform>/spawn-helper` (a known npm-as-root tar-extraction wart). The CLI tried to restore the bit with `chmodSync(helper, 0o755)`, but the file is owned by root and the CLI runs as a non-root user — the chmod returned `EPERM` and was swallowed by a silent `try {} catch {}`. Result: terminal spawns failed with `posix_spawnp failed` at runtime, with no actionable hint.

`linkNativeModules()` now checks whether the standalone dir already has a real (non-symlink) `node-pty` directory with a `prebuilds/<platform>-<arch>/` subdirectory for the current platform. If yes — which is the case on macOS and Windows, where the tarball ships working prebuilds — the symlink step is skipped entirely and the tarball's correct copy survives. Linux (no node-pty prebuild) and pre-existing broken-symlink states still fall through to the symlink + chmod path. The chmod failure case now logs a clear warning with the exact `sudo chmod 755 …` command instead of failing silently.

#### Fix: Lantern story-background prompts no longer dump full wardrobe prose

The Lantern's image-prompt pipeline was leaking wardrobe items' human-prose `description` fields straight into image-generation prompts, producing multi-thousand-character prompts full of markdown bullets and style commentary ("Good for moving between Lodge, office, balcony…", "She's not hiding those hands"). Three independent leak paths fixed:

1. `lib/wardrobe/outfit-description.ts:decorateOutfitItems` gained a `titleOnly` option. Image-gen-adjacent callers (`lib/wardrobe/avatar-prompt.ts`, `lib/background-jobs/handlers/scene-state-tracking.ts`) now pass `titleOnly: true`. The two inline `valuesFor` builders in `lib/image-gen/appearance-resolution.ts` and `lib/memory/cheap-llm-tasks/image-scene-tasks.ts:resolveAppearance` were collapsed to titles-only the same way. Chat-context formatting (which is rendered to a model that can use the prose) is untouched.

2. `APPEARANCE_RESOLUTION_PROMPT` was sharpened: `clothingDescription` is now capped at 200 chars of plain prose with explicit no-markdown / no-parenthetical-asides / no-commentary rules, and the equipped-wardrobe section is no longer labeled "Current Outfit … takes precedence", which a cheap LLM was reading as the "narrative → use verbatim" branch and echoing the entire input back.

3. `appendMissingCharacterEnumerations` in `lib/background-jobs/handlers/story-background.ts` (introduced by the c8df7d58 missing-enumeration fix) was injecting the *resolved* participant description — which carried the bloated wardrobe text — back into the prompt for any character whose name appeared without a `Name:` enumeration. It now always uses the compact `buildBasicEnumeration` form (gender prefix + mediumPrompt/shortPrompt); the `resolvedDescriptionsByCharacterId` parameter was dropped.

Two test expectations in `__tests__/unit/image-gen/appearance-resolution.test.ts` updated to assert the new title-only fallback output.

#### Docs: tool plugin development guide reflects the Zod-source-of-truth convention

`docs/developer/TOOL_PLUGIN_DEVELOPMENT.md` rewrote the calculator example to declare a Zod input schema, derive the OpenAI-shape `parameters` JSON via a small `zodToOpenAISchema` helper (Zod 4's native `z.toJSONSchema()` with `target: 'draft-7'`, plus a strip of `$schema`/`$id`/`definitions`/`$defs`), and have `validateCalculatorInput` delegate to `safeParse`. Added a section on `.refine()` for trim-non-empty / allowlists / cross-field constraints that JSON Schema cannot express alone. Best-practice and troubleshooting bullets updated to point at the Zod schema when input validation fails. Provider plugin docs unchanged — provider plugins consume tool definitions rather than define them.

#### Refactor: Zod schemas as the single source of truth for all 49 tool definitions

Every tool definition in `lib/tools/*-tool.ts` now declares a Zod input schema (`xxxToolInputSchema`) as the canonical contract. The OpenAI-shape `parameters` JSON Schema served to native function-calling providers is derived from that schema via a new helper `lib/tools/zod-to-openai-schema.ts` (built on Zod 4's native `z.toJSONSchema()`), and every `validateXxxInput` function is now a one-line delegate to `schema.safeParse(input).success`. Closes the long-standing gap where the JSON Schema and the runtime validator could quietly drift apart.

The conversion exposed and fixed several real drift cases that had been masked: `web_search`'s validator silently coerced string `maxResults` via `Number()` and ignored its own documented `maxLength: 500` on `query` — Zod enforces both correctly now. `whisper` rejected empty strings; the JSON Schema didn't say so; the Zod schema does now (`.min(1)`). `help_navigate`'s allowlist of permitted route prefixes lived only in the validator, never in the JSON Schema sent to the LLM — it's now a Zod `.refine()` so both surfaces see the same rule. `wardrobe_create_item`'s cross-field "either types or components must be supplied" check moved into a Zod object-level `.refine()`.

Two web-search tests that previously documented the discrepancy ("should accept maxResults as string number — converts via Number()" and "should accept query exceeding max length — no length validation in runtime") were rewritten to assert the new strict behavior. The whole point of this refactor is that the JSON Schema and the validator are now the same thing.

Snapshot test added at `lib/tools/__tests__/tool-definitions-snapshot.test.ts` captures the derived `parameters` JSON for all 49 tools so future Zod-side edits surface as snapshot diffs in review. Removed the now-unused `zod-to-json-schema` package — Zod 4 has native JSON Schema emission and `zod-to-json-schema@3.25` does not support Zod 4 schemas anyway.

Naming convention also standardized: every tool file exports `xxxToolDefinition` as the canonical name. The previously-mixed naming (some files used `xxxTool`, others `xxxToolDefinition`) has been reconciled — `lib/tools/index.ts` still re-exports both for back-compat where consumers expected the short name.

#### Feature: Simple JSON pseudo-tool surface for models without native function calling

Replaced the legacy `[[TOOL ...]]content[[/TOOL]]` text-block pseudo-tool format with a smaller, more robustly-parsed `<tool_call>{...}</tool_call>` JSON-in-XML surface. The new format is designed around three principles: a familiar syntax (JSON inside an XML tag), exactly one tool call per turn, and a hard provider stop sequence (`</tool_call>`) so the model can't emit a valid call and then keep narrating fake results.

New modules: `lib/tools/simple-json-parser.ts` (three-tier lenient parser — strict `JSON.parse`, `jsonrepair`, then a balanced-brace walker that recovers when the closing tag is dropped entirely; alias tags `<toolcall>`, `<tool>`, `<call>`, `<function_call>` are accepted) and `lib/tools/simple-json-prompt.ts` (uniform `(name: type)` signatures derived from each tool's existing OpenAI-shape `parameters` JSON Schema, replacing 15 hand-written prompt blurbs).

Strategy wiring: `TextToolStrategy` in `lib/services/chat-message/text-tool-loop.service.ts` gains `formatToolResult(toolName, content)` and an optional `stopSequences?: string[]`. The inline `[Tool Result: ...]` template that the loop hard-coded is now strategy-scoped — simple-json frames results as `<tool_result name="...">...</tool_result>`, while the legacy text-block and provider-text-markers strategies keep the existing template. Orchestrator picks the strategy from a new `resolveToolMode()` helper in `lib/tools/pseudo-tool-support.ts` and injects `stop: ['</tool_call>']` into both the initial primary stream and the continuation re-stream when simple-json is active.

Provider stop-sequence plumbing: `StreamOptions.stop?: string[]` flows through to each provider adapter. OpenAI's Responses API, Anthropic (`stop_sequences`, capped at 4), Ollama's streamMessage path, OpenRouter's chat-completions + SDK paths, and the shared `OpenAICompatibleProvider.streamMessage` all honour it now. Google and Grok already did. Each touched plugin bumps its patch version; `packages/plugin-utils` goes 2.2.8 → 2.2.9 and must be republished before the next plugin release.

Profile schema: new `pseudoToolMode` column on `connection_profiles` (enum: `auto` | `native` | `simple-json` | `text-block`, default `auto`). Migration `add-pseudo-tool-mode-field-v1` ALTER-adds the column and backfills existing rows to `'auto'`. The "Tool format" selector now lives in the connection-profile editor (`components/settings/connection-profiles/ProfileModal.tsx`, conditional on `allowToolUse`). Default `auto` resolves to native on capable models and simple-json on everything else (the spec's Phase 5 flip); the legacy text-block surface remains selectable for compatibility while users migrate.

Forcing `pseudoToolMode = 'native'` on a model that genuinely can't do native function calling now falls back to simple-json (graceful degradation) rather than shipping a broken native request. The pseudo-tool.service test that asserted the old behavior was updated accordingly.

Legacy modules moved: `lib/tools/text-block-parser.ts` and `text-block-prompt.ts` (plus their tests) now live in `lib/tools/legacy/`. Public re-exports through `lib/tools/index.ts` keep behavior identical for all consumers; only direct relative-path importers (`whisper-handler.ts` and one mock) were updated.

Help: `help/connection-profiles.md` gained a "Tool Format" section in the project's steampunk-Wodehouse voice, explaining each setting and why simple-json is the modern default. The help message-pack index needs rebuilding before release.

Tests: 55 unit tests covering the parser (three tiers, alias tags, jsonrepair recovery, balanced-brace fallback, failure modes) and the prompt builder (signature rendering for primitive/enum/array/oneOf/zero-param shapes, instruction structure); 3 new integration tests in `text-tool-loop.service.test.ts` covering the strategy's `formatToolResult` indirection and `stopSequences` passthrough. All 805 existing service/repo tests still green.

The Zod refactor of tool definitions called for by the implementation plan is deferred to a follow-up commit so this diff stays reviewable. `describeToolSignature` walks the existing OpenAI-shape `parameters` JSON, so the simple-json feature works fully without the refactor.

#### Fix: CI test suites couldn't resolve the SQLCipher driver

Four test suites (`__tests__/unit/packages/quilltap/{memories-commands,db-backup,graph-integrity}.test.js` and `__tests__/unit/lib/database/migration/repair-dangling-related-memory-edges-v1.test.ts`) failed in GitHub Actions with `Cannot find module 'better-sqlite3-multiple-ciphers'`. Their `loadDriver()` helpers tried `packages/quilltap/node_modules/better-sqlite3-multiple-ciphers` first and fell back to the bare `better-sqlite3-multiple-ciphers` require. Locally the first path resolves because `packages/quilltap/` carries its own `node_modules/`, but in CI only the root `npm ci` runs, and the root `package.json` declares the dep as `"better-sqlite3": "npm:better-sqlite3-multiple-ciphers@..."` — npm installs that under the alias name, so neither candidate resolves. Added a third fallback that requires `better-sqlite3` (the alias the runtime already uses) and documented the resolution rule in CLAUDE.md so future tests pick the right import path from the start.

The third fallback then failed differently — `TypeError: Database is not a constructor` — because `jest.config.ts`'s `moduleNameMapper` redirects `^better-sqlite3$` to a manual mock at `__mocks__/better-sqlite3.ts` whose `MockDatabase` is exported via `export default`. `require('better-sqlite3')` therefore returned `{ default: MockDatabase }`, not a constructor. Reworked the third fallback in all four `loadDriver()` helpers to require by absolute filesystem path (`<root>/node_modules/better-sqlite3`); moduleNameMapper only matches bare specifiers, so the absolute path bypasses the mock and loads the real native binding for these tests, which is what they need.

One more failure remained: `__tests__/unit/packages/quilltap/db-backup.test.js` → `cmdBackup round trip`. The test's own loadDriver was now fine, but `cmdBackup` reaches into the production CLI's `packages/quilltap/lib/db-helpers.js → openEncryptedDb`, which does `require('better-sqlite3-multiple-ciphers')` then falls back to `require('better-sqlite3')`. In CI the first fails (alias install), the second hit jest's moduleNameMapper and got the same `{ default: MockDatabase }` non-constructor — so the opener threw, `backupOneDb` caught it, returned `ok: false`, the snapshot file was never written, and the test's `expect(fs.existsSync(snapPath)).toBe(true)` failed. Production code shouldn't need to know about jest mocks, so the fix went into the mock: append `module.exports = MockDatabase` (mirroring the real driver's CJS shape) plus a re-attached `.default` so existing `import Database from 'better-sqlite3'` callers keep working via esModuleInterop.

### 4.5.1

#### Fix: story-background prompt missed enumerating non-participant characters

When the cheap LLM that crafts the Lantern's story-background image prompt placed characters into the scene by name (e.g. "Ariadne sits reading…, Amy nearby listening…"), only the chat's current participants got a follow-on `Name: <appearance>` enumeration. Characters named via the chat title, the derived scene context, or SceneState character actions were mentioned but never described, so the image provider invented appearances for them. Added a post-processing pass in `lib/background-jobs/handlers/story-background.ts` that loads the user's workspace characters, scans `finalPrompt` for any whose name appears but lacks a `Name:` enumeration entry, and appends a canonical enumeration built from their pronouns and primary `physicalDescription`. Participants reuse their already-resolved enumeration (with equipped wardrobe) via a `characterId → description` map; non-participants fall back to defaults. Longer names are processed first to prevent `"Catherine"` from displacing `"Lady Catherine"`. Failures are caught and logged at `warn`; additions are logged at `info` with the list of names added.

#### Fix: shell completion coverage gaps

The bash/zsh/fish completion templates were missing the `logs` and `migrations` top-level subcommands, the `instances default` and `instances rename` verbs, and the global `--passphrase` flag. The bash template's per-subcommand flag lists were also stale relative to the actual parsers in `db-commands.js`, `docs-commands.js`, and `memories-commands.js`. Rewrote all three templates (`packages/quilltap/lib/completion/{bash,zsh,fish}.template`) to enumerate the full surface — every verb, every documented flag, value-list completion for `--source` (AUTO/MANUAL), `--stream` (combined/error/stdout/stderr/startup), `--field` (request/response/both), `--sort`, `--type`. Bash now also two-level dispatches on sub-verbs (e.g. `themes registry` exposes `add/remove/refresh/keygen/sign`), and instances-targeting verbs (`show`, `remove`, `rename`, `default`, `set-passphrase`) tab-complete registered instance names. Bash smoke-tested with nine scenarios covering all new verbs and flag-value completions; zsh syntax-checked with `zsh -n`. Users who already saved a completion script need to regenerate it.
