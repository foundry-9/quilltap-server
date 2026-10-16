# Feature: `/` slash commands in the Salon composer

**Status:** Implemented in 4.11-dev (2026-10-15) — see [As built](#as-built) at the end for where the code departs from the text below. **Supersedes** Phase 4 ("`/` slash commands") of [composer-typeahead.md](../composer-typeahead.md), whose "Known State" predates the typeahead shell, the `@` mention plugin and Pascal's run dialog; that phase is marked superseded, and nothing in it is binding here.
**Owner subsystem:** Calliope (the composer) for the typeahead; Prospero (`RunToolModal`, `?action=run-tool`) and Pascal (`CustomToolRunDialog`, `custom-tools?action=run`) for what the commands run.
**Read first:** `components/chat/lexical/plugins/MentionTypeaheadPlugin.tsx` (the adapter to copy), `components/chat/lexical/typeahead/useTypeaheadShell.tsx` (the shell), `lib/mentions/mention-typeahead.ts` (the framework-free tier to mirror), `lib/char-insert/trigger.ts` (`findTrigger`), `components/chat/RunToolModal.tsx`, `components/chat/CustomToolRunDialog.tsx`, `app/salon/[id]/hooks/useModalState.ts`.
**Implementation note:** Written to be executed by Claude Code (Opus) with no further design input. Where a choice existed it has been made — see [Design decisions](#design-decisions-resolved). Follow CLAUDE.md standing rules (changelog, help docs with `url` frontmatter, migration pretty-labels, `qt-*` classes mirrored into theme-storybook with its publish hard-stop, no stubs, the "no new polling site" rule).

## Motivation

Everything the operator can do from the composer's gutter and the sidebar's Run Tool drawer takes a mouse trip: open a menu, find the wand, pick the tool, fill the form. Writers who live in the composer want to type `/unlock` and be looking at the form — or, for a tool with nothing to fill in, be looking at Pascal's answer. This feature adds a `/` typeahead to the Salon composer that lists **composer actions** (attach, library, image, announce, mail, inform, roll), **Prospero's user-invocable built-in tools**, and **Pascal's custom tools** for the chat; picking one either runs it at once (no parameters to complete) or opens the existing dialog pre-selected at its form step so the operator completes the prompts and runs it there.

## Doctrine (read first)

1. **Decisions in `lib/`, adapters in `components/`.** Where a `/` trigger starts and ends, which commands match a query and in what order, and which command a tool becomes are pure functions in a new `lib/slash-commands/` that imports nothing from React, Lexical or Next — the `lib/mentions/` and `lib/char-insert/` pattern, for the same portability reason. The Lexical plugin asks and applies.
2. **No new way to run anything.** A built-in tool runs through `POST /api/v1/chats/[id]?action=run-tool` and the `RunToolModal`; a custom tool through `POST /api/v1/chats/[id]/custom-tools?action=run` and the `CustomToolRunDialog`; a composer action through the handler the gutter button already calls. This feature adds launch points, not executors.
3. **A dialog when there is something to complete; otherwise, run.** A tool that declares **no parameters at all** runs the instant it is picked. A tool with any parameter — required or defaulted — opens its dialog at the form step with defaults filled, so the operator sees and may change them (and, for Pascal, may whisper the roll). The user asked for the dialog "to complete any prompts that need to be completed"; a tool with nothing to complete should not make them click Run.
4. **The typed text goes away.** Picking a command removes the `/query` from the composer in one history entry (a single undo restores it). Nothing a command does is inserted as text, except `/roll`-family quick rolls, which produce the same pending-result chip the dice button produces.
5. **Prose is never hijacked.** `/` opens a menu only at the start of a line or after whitespace or an opener character (`findTrigger`'s rule), never inside `and/or`, `10/15`, `http://`, a path, or a code span. A dedicated chat setting turns the whole thing off.

## 1. Pure tier — new `lib/slash-commands/`

Same portability contract as `lib/mentions/`: `lib/slash-commands/**` imports only from `lib/char-insert/` and its own files. Add it to the ESLint `no-restricted-imports` override that guards `lib/char-insert/**` (or an identical override for this directory).

### 1.1 `types.ts`

```ts
export type SlashCommandKind = 'action' | 'builtin-tool' | 'custom-tool';

export interface SlashCommand {
  /** Stable identity: 'action:attach', 'builtin:wardrobe_wear', 'custom:<name>::<asCharacterId>'. */
  key: string;
  kind: SlashCommandKind;
  /** The word after the slash: 'attach', 'wardrobe_wear', 'unlock'. Lowercase; matched as typed. */
  command: string;
  /** Human label: 'Attach file', 'Wear Wardrobe Items', 'Force the Lock'. */
  label: string;
  /** One line, shown muted. Tools use their description. */
  description: string;
  /** Extra match terms: words of the label, the tool's category, a custom tool's character label. */
  keywords: string[];
  /** Muted trailing detail: 'Composer', 'Prospero · wardrobe', 'Pascal', 'Pascal · as Vivienne'. */
  source: string;
  /**
   * Whether picking it needs the dialog. Actions decide for themselves; tools are
   * `declaresParameters` (Doctrine 3).
   */
  needsDialog: boolean;
  /** The payload the adapter dispatches on. */
  payload:
    | { kind: 'action'; action: ComposerAction }
    | { kind: 'builtin-tool'; toolId: string }
    | { kind: 'custom-tool'; name: string; asCharacterId: string | null };
}

export type ComposerAction =
  | 'attach' | 'library' | 'image' | 'announce' | 'mail' | 'inform'
  | 'tool'      // the Run Tool dialog, no pre-selection
  | 'pascal'    // the custom-tool dialog, no pre-selection
  | 'roll' | 'd6' | 'd20' | 'coin' | 'bottle';
```

### 1.2 `trigger.ts`

```ts
export const SLASH_TRIGGER: TriggerConfig = {
  opener: '/',
  queryPattern: /[A-Za-z0-9_-]/,
  queryStartPattern: /[A-Za-z]/,   // `/1`, `/-` are never commands; keeps `1/2` and `--/--` quiet
  minQueryLength: 0,               // a bare `/` opens the full menu
  maxQueryLength: 64,              // longer than any tool id; pasted text must not hold a menu open
  closer: null,
  lowercaseQuery: true,            // command words are lowercase by construction
};
export function findSlashTrigger(textBefore: string): TriggerMatch | null;  // = findTrigger(textBefore, SLASH_TRIGGER)
```

Those are the six fields `TriggerConfig` (`lib/char-insert/types.ts`) declares today; nothing is added to the type. A space ends the query (as in every profile) — so `/roll 2d6` is **not** a form this feature parses; see `roll` in §2.

### 1.3 `ranking.ts`

```ts
export function rankSlashCommands(commands: readonly SlashCommand[], query: string, limit = 12): SlashCommand[];
```

Tiers, in order, then by `kind` (`action` < `custom-tool` < `builtin-tool` — the operator's own tools above the house's) then by `label`:

1. `command === query` (exact).
2. `command.startsWith(query)`.
3. a word of the label, or a keyword, starts with `query` (`matchTier`'s word-prefix rule in `lib/mentions/mention-typeahead.ts`; `_` and `-` split words too, so `/wear` finds `wardrobe_wear`).
4. nothing else. Mid-word substrings are deliberately not matched (the mention precedent).

Empty query: every command, `action` rows first, then custom, then built-in, each group by label. Folding is `toLocaleLowerCase`.

### 1.4 `registry.ts`

```ts
export interface SlashCommandSources {
  /** Which composer actions are wired in this composer (the gutter's optional handlers). */
  actions: ReadonlySet<ComposerAction>;
  builtInTools: readonly { id: string; name: string; description: string; category?: string; available?: boolean; unavailableReason?: string; userInvocable?: boolean; parameters?: { properties?: Record<string, unknown> } }[];
  customTools: readonly { name: string; title: string; description: string; parameters: Record<string, unknown>; characterLabel?: string; asCharacterId?: string | null }[];
}
export function buildSlashCommands(sources: SlashCommandSources): SlashCommand[];
```

- **Actions** (the fixed table in §2), filtered to those the composer wired.
- **Built-in tools:** every entry with `userInvocable !== false` **and** `available !== false` — an unavailable tool (no image profile, no project, web search not configured) is simply not a command; the Run Tool dialog still lists it with its reason, and the menu shell has no disabled-row state to invent one. `command` = the tool id verbatim (`wardrobe_wear` — users see these ids in the Run Tool dialog already); `needsDialog` = `parameters.properties` has at least one key; `source` = `Prospero · <category>` or `Prospero · <pluginName>`.
- **Custom tools:** every roster listing; `command` = `name`; `label` = `title`; `needsDialog` = `Object.keys(parameters).length > 0`; `source` = `Pascal` or `Pascal · as <characterLabel>`; `payload.asCharacterId` from the listing.
- A custom tool and a built-in with the same command word are **both** listed (sources differ visibly; ranking puts the custom one first).

Tests: `lib/slash-commands/__tests__/` — trigger vectors (`/`, `/un`, ` /un`, `(/un`, `and/or`, `10/15`, `http://`, `/1`, inside a word), ranking tiers and group order, registry generation (every available `userInvocable` built-in becomes a row; non-invocable and unavailable dropped; `needsDialog` from parameters; custom variants keep their character label; collisions keep both).

## 2. The commands

| Command | Kind | Needs dialog | What it does |
|---|---|---|---|
| `/attach` | action | no | `onAttachFileClick` |
| `/library` | action | no | `onLibraryFileClick` |
| `/image` | action | no | `onStandaloneGenerateImageClick` (its own dialog) |
| `/announce` | action | no | `onInsertAnnouncementClick` (its own dialog) |
| `/mail` | action | no | `onComposeMailClick` (its own dialog) |
| `/inform` | action | no | `onInformClick` (its own dialog) |
| `/tool` | action | — | opens `RunToolModal` with no pre-selection |
| `/pascal` | action | — | opens `CustomToolRunDialog` with no pre-selection (listed only when `customToolsAvailable`) |
| `/roll` | action | — | opens `RunToolModal` pre-selected on `rng` (its form has sides and count) |
| `/d6`, `/d20`, `/coin`, `/bottle` | action | no | the dice button's own request (`?action=rng` preview) → `onPendingToolResult` chip, exactly as `RngDropdown` does |
| `/<tool_id>` | builtin-tool | per parameters | run now, or `RunToolModal` pre-selected |
| `/<name>` | custom-tool | per parameters | run now, or `CustomToolRunDialog` pre-selected |

`/roll <notation>` with an argument is **out of scope** (a space closes the query; parsing arguments is a different feature). `/d6` etc. are the quick path; `/roll` is the form.

`RngDropdown`'s fetch (`components/chat/RngDropdown.tsx` ~:94, the `?action=rng` request and its pending-result shaping) is extracted into `components/chat/rng-request.ts` (`requestRngPendingResult(chatId, args): Promise<RngPendingResult>`) and called by both the dropdown and the slash adapter — one request, one chip shape.

## 3. The dialogs — pre-selection

### 3.1 `RunToolModal`

New prop:

```ts
/** Open straight onto this tool's form. Re-applied on every open (the nonce changes). */
initialTool?: { toolId: string; nonce: number } | null
```

When the tools fetch completes and `initialTool` is set: find the row by id; if found and `available !== false`, `handleSelectTool(it)`; if not found, stay on the list, `showErrorToast('No tool named "<id>" is available in this chat')`. "Back" still returns to the list. The modal's existing reset-on-open is kept; `initialTool.nonce` is in the effect's deps so picking `/unlock` twice in a row re-selects.

### 3.2 `CustomToolRunDialog`

New prop:

```ts
initialTool?: { name: string; asCharacterId: string | null; nonce: number } | null
```

On open with it set: once the roster query resolves, `setSelectedKey(toolKey(match))` where `match` is the listing with that `name` and (when given) `asCharacterId`; no match → toast and the picker. The dialog's "what it remembers" (per-tool values and privacy) is untouched: a pre-selection lands on the remembered values for that tool.

### 3.3 Where the dialogs live

- `RunToolModal` already mounts in `ChatModals.tsx` from `useModalState` (`runToolModalOpen`, `openRunTool`, `closeRunTool`). `openRunTool` becomes `openRunTool(toolId?: string)`, storing `runToolRequest: { toolId: string | null; nonce: number }`; `ChatModals` passes `initialTool`. The sidebar's `onRunToolClick` keeps calling it with no argument.
- `CustomToolRunDialog` currently mounts inside `CustomToolsButton` with local open state. **Lift it:** mount it in `ChatModals.tsx` (unconditionally, so it keeps its memory while closed — the component's documented reason for being rendered always), driven by `useModalState`'s new `customToolDialogOpen` / `openCustomTool(initial?: { name: string; asCharacterId: string | null })` / `closeCustomTool` and `customToolRequest`. `CustomToolsButton` becomes a plain button with an `onClick` prop; `ComposerGutterTools` gains `onCustomToolsClick` and drops `onCustomToolRan` (the dialog's `onRan` → `fetchChat` is wired in `ChatModals`, where `RunToolModal`'s `onToolExecuted` already is). Both gutter and slash paths therefore open the **same** dialog instance.

## 4. The adapter — `components/chat/lexical/plugins/SlashCommandPlugin.tsx`

Modelled line-for-line on `MentionTypeaheadPlugin.tsx`: `LexicalTypeaheadMenuPlugin` with a `triggerFn` that reads `$textBeforeCursor()` / `$isGluedToPreviousRun()` (`typeahead/trigger-context.ts`) and converts `findSlashTrigger`'s match through `toMenuTextMatch`; rows via `TypeaheadOption<SlashCommand>` and `useTypeaheadShell({ listboxId: 'slash-command-listbox', emptyLabel: 'No such command', activeDescendantTarget: editor.getRootElement() })`; Enter/Tab at `COMMAND_PRIORITY_CRITICAL` (KeyboardPlugin's HIGH-priority Enter would send the draft); Escape closes; Space is **not** a commit key here (there are no arguments to keep typing — a space simply closes the menu and leaves the text).

Row shape: `glyph` an `<Icon>` by kind (`paperclip` / `file-plus` / `camera` / `megaphone` / `mail` / `info` / `dice` for actions; `wrench` for built-ins; `wand` for custom), `label` = `/${command} — ${label}`, `detail` = `source`. Every row is selectable (unavailable tools never become rows — §1.4).

On select, inside one `editor.update(…, { tag: HISTORY_MERGE_TAG })`:

1. Remove the trigger text: `nodeToReplace.remove()` (the node Lexical split off holds exactly `/query`); if the paragraph is now empty, leave the empty paragraph.
2. Dispatch on `payload` **after** the update commits (`editor.update`'s `onUpdate`, or `queueMicrotask`) so a dialog opening never races the editor's selection restore:
   - `action` → the matching handler from `SlashCommandContext`.
   - `builtin-tool` with `needsDialog` → `openRunTool(toolId)`; without → `runBuiltInNow(toolId)`.
   - `custom-tool` with `needsDialog` → `openCustomTool({ name, asCharacterId })`; without → `runCustomNow({ name, asCharacterId })`.
3. `logger`-free client code: `console.debug('[slash] …')` is not the convention — use the existing client debug pattern the mention plugin uses (none) and keep logging server-side; the two run routes already log.

`SlashCommandContext` (new `components/chat/lexical/slash-commands/context.ts`):

```ts
export interface SlashCommandContext {
  chatId: string;
  actions: Partial<Record<ComposerAction, () => void>>;   // what the composer wired; `d6`…`bottle` are built here from onPendingToolResult
  openRunTool: (toolId?: string) => void;
  openCustomTool: (initial?: { name: string; asCharacterId: string | null }) => void;
  runBuiltInNow: (toolId: string) => Promise<void>;
  runCustomNow: (tool: { name: string; asCharacterId: string | null }) => Promise<void>;
  customToolsAvailable: boolean;
}
```

`LexicalComposerWrapper` gains `slashCommands?: SlashCommandContext | null`; the plugin mounts only when it is non-null **and** the `composerSlashCommands` setting is on (`useChatSettingsQuery`, as `CharTypeaheadPlugin` gates on `composerEmoji`). `ChatComposer` builds the context from its existing props plus the new `onOpenRunTool` / `onOpenCustomTool` it receives from `SalonView` (`modals.openRunTool` / `modals.openCustomTool`). Document Mode's editor does **not** mount it (a `/` in a document is prose).

### 4.1 Data

- Built-in tools: `useQuery({ queryKey: queryKeys.tools.byChat(chatId), queryFn: ({ signal }) => apiFetch(`/api/v1/tools?chatId=${chatId}&includeSchemas=true`, { signal }), enabled: menuOpen, staleTime: 60_000 })`. Add `tools.byChat(chatId)` to `lib/query/keys.ts` beside `tools.all`.
- Custom tools: `useQuery({ queryKey: queryKeys.customTools.byChat(chatId), …, enabled: menuOpen, staleTime: 0 })` — the key's own doc-comment says not to hold it across an open; `enabled: menuOpen` with `refetchOnMount: 'always'` semantics is the honest reading (first `/` of a session fetches; reopening refetches). Nothing polls.
- Both are `enabled` only while the menu is open, so a composer that never sees a `/` never fetches.
- `buildSlashCommands` runs in a `useMemo` over the two results and the wired actions; `rankSlashCommands` over that and the query.

### 4.2 Immediate runs — `components/chat/useSlashCommandRunner.ts`

A hook returning `runBuiltInNow` / `runCustomNow`:

- Built-in: `POST /api/v1/chats/${chatId}?action=run-tool` with `{ toolName, arguments: {}, characterId: <the RunToolModal's default — the first active character participant>, private: false }`; on success `onRan()` (→ `fetchChat`), on failure `showErrorToast`.
- Custom: `POST /api/v1/chats/${chatId}/custom-tools?action=run` with `{ tool: name, parameters: null, asCharacterId }` (privacy = the definition's default); on success `onRan()`, on failure `showErrorToast(apiErrorMessage(…))`.
- Both show a brief `showSuccessToast` naming the tool, since nothing else in the composer acknowledges a zero-parameter run before the chat refetches.

A private run is **not** reachable from an immediate run; the dialog remains the place for it (documented in help).

## 5. The setting

`composerSlashCommands: boolean`, default `true`. Mirror every file `composerUnicode` touches:

| Site | Change |
|---|---|
| `lib/schemas/settings.types.ts` | `composerSlashCommands: z.boolean().default(true)` beside `composerUnicode`, doc-comment noting the gutter buttons and sidebar are not gated. |
| `lib/database/repositories/chat-settings.repository.ts` | default `true`. |
| `migrations/scripts/add-composer-slash-commands-field.ts` + `index.ts` | `ALTER TABLE chat_settings ADD COLUMN "composerSlashCommands" INTEGER DEFAULT 1`, id `add-composer-slash-commands-field-v1`, modelled on `add-composer-unicode-field.ts`. No loop. |
| `lib/startup/prettify.ts` | `'add-composer-slash-commands-field-v1': 'Fitting the composer with a speaking-tube to the tool room'`. |
| `app/api/v1/settings/chat/route.ts` | accept / validate / return. |
| `components/settings/chat-settings/types.ts`, a new `ComposerSlashCommandsSettings.tsx` (copy `ComposerUnicodeSettings.tsx`), `hooks/useChatSettings.ts`, `tabs/ChatTabContent.tsx` | the toggle, `sectionId="composer-slash-commands"`. Label **"Slash commands"**, helper: "Type / at the start of a word to run a tool or open a composer action. The gutter buttons and the sidebar are never affected." |
| `docs/developer/DDL.md` | the column, same comment style as `composerUnicode`. |

## 6. Styles

The shell's menu classes already exist (emoji/mention menus) and `MenuPortal` has no disabled-row state — which is why unavailable tools are omitted rather than greyed (§1.4). **No new `qt-*` class is expected.** If one turns out to be needed, write every state form out by hand in `app/styles/qt-components/_utilities.css`, mirror it into `packages/theme-storybook/src/css/qt-components.css`, bump that package's patch version and **stop and ask the human to `npm publish`** before committing (CLAUDE.md hard-stop).

## 7. Documentation

- `help/chat-settings-composer.md` — a new **"Slash commands"** section (before "Auto-Scroll"): the trigger rule (start of a word), the fixed commands table in prose, that every Run-Tool tool and every Pascal tool in the chat is a command, the run-now-or-dialog rule and why, that a private roll needs the dialog, the setting and what it does not gate, and that Document Mode has no slash commands. Steampunk voice; `url: /settings?tab=chat&section=composer-slash-commands`; In-Chat Navigation updated to match.
- `help/run-tool.md` — "Accessing the Run Tool": the `/tool` and `/<tool id>` shortcuts.
- `help/custom-tools.md` — "Rolling one yourself": `/pascal` and `/<name>`.
- `help/rng-tool.md` — "How to Use": `/d6`, `/d20`, `/coin`, `/bottle`, `/roll`.
- `docs/developer/features/composer-typeahead.md` — Phase 4 header: "Superseded by [composer-slash-commands.md](composer-slash-commands.md)"; its file-touch summary's slash entries struck.
- `docs/developer/API.md` — the settings field. No new routes.
- `docs/developer/DDL.md`, `docs/CHANGELOG.md` (plain voice), `.claude/commands/update-documentation.md` (this spec's row; move to `complete/` when done).

## 8. Engineering tasks (phased; each phase compiles and tests green)

1. **Pure tier** — `lib/slash-commands/{types,trigger,ranking,registry}.ts` + tests; ESLint import override.
2. **Dialogs** — `RunToolModal.initialTool`; `CustomToolRunDialog.initialTool`; `useModalState` request state + `openCustomTool`; lift the custom dialog into `ChatModals`; `CustomToolsButton` → plain button; `ComposerGutterTools` / `ChatComposer` / `SalonView` prop plumbing. Component tests for both pre-selections (`renderWithQuery`, `jest-fetch-mock`).
3. **RNG request extraction** — `components/chat/rng-request.ts`; `RngDropdown` on it; its test unchanged.
4. **Setting** — every row of §5.
5. **Adapter** — `SlashCommandPlugin.tsx`, `slash-commands/context.ts`, `useSlashCommandRunner.ts`, `queryKeys.tools.byChat`, wrapper prop, composer context. Plugin test following `MentionTypeaheadPlugin`'s test shape: `/` opens, `/un` narrows, Enter removes the text and dispatches, Escape leaves the text, `and/or` does not open, setting off → never mounts.
6. **Docs** — §7.

## 9. Verification

- `npx tsc`; `npm run lint` (the `qt-*` gate runs if any class was added).
- `npx jest lib/slash-commands components/chat __tests__/unit/components/chat` and the settings route suite.
- Live, on the V4test instance, dev on :3005: (a) `/atta` ⏎ opens the file picker and the composer is empty; Cmd/Ctrl+Z brings `/atta` back. (b) `/wear` lists `wardrobe_wear` under Prospero; ⏎ opens Run Tool on its form with the operations field. (c) `/self_inventory` (no parameters) runs at once; a toast names it; the Prospero result bubble appears after refetch. (d) `/unlock` (a Pascal tool with a `bonus` parameter) opens the custom-tool dialog on `unlock`'s form with the remembered values; `/wear_regalia` (no parameters) runs at once and Pascal announces. (e) A per-character variant lists twice, labelled; each pre-selects its own. (f) `/d20` drops a dice chip; `/roll` opens Run Tool on `rng`. (g) Type `and/or`, `10/15`, `http://x`, `` `/code` `` — no menu. (h) Toggle the setting off — `/` is just a slash; the gutter wand and the sidebar still open their dialogs. (i) Document Mode — no menu.

## Design decisions (resolved)

1. **Reuse the two dialogs, pre-selected.** They already own form generation (`JsonSchemaForm`, `CustomToolParamsForm`), character selection, privacy, presets and memory. A third "slash dialog" would be a worse copy.
2. **Run at once when nothing can be completed.** The user's words were "complete any prompts that need to be completed"; a tool with no prompts needs no dialog. The line is "declares any parameter", because a defaulted parameter is still a prompt the operator may want to answer.
3. **Tool ids verbatim as command words.** `wardrobe_wear` is what the Run Tool dialog shows and what the model calls; inventing `/wardrobe-wear` means two spellings. Word-prefix ranking (`/wear`) covers discoverability.
4. **No argument parsing.** `/roll 2d6` would need a grammar, an argument-aware trigger and per-command parsers; `/d20` and the `rng` form cover the need. Arguments are a separate feature if ever wanted.
5. **A dedicated toggle, default on.** The emoji and Unicode typeaheads each have one; `/` is likelier than either to collide with a writer's habit (`/me`, `/scene`), so it gets one too. The gutter and sidebar are not gated — an explicit button press is never a surprise (the existing doctrine).
6. **The custom-tool dialog is lifted to `ChatModals`.** Two launch points must open one instance, and the instance must stay mounted to keep its memory; a dialog owned by a gutter button cannot be opened from the editor.
7. **Fetch only while the menu is open.** Two queries, both `enabled` by the open state — no polling, no fetch for composers that never see a slash, and the custom roster stays fresh per open as its key's doc-comment demands.
8. **Salon composer only.** Document Mode is prose; it mounts the `:` emoji and `\` Unicode typeaheads (people want those in a document) and not the `@` mention one; nobody runs a tool from a paragraph, so `/` follows `@`.

## As built

Implemented 2026-10-15 in 4.11-dev, phases 1–6 as written, with these departures:

1. **The trigger removal is not tagged `HISTORY_MERGE_TAG`.** Merging folds the removal into the history entry of the typing that produced `/query`, so an undo would take the whole word away rather than bring it back — the opposite of Doctrine 4. The plugin uses its own tag (`slash-command-commit`), which history records as a separate entry; the plugin test pins that one Cmd/Ctrl+Z restores `/atta`.
2. **A bare `/` is not capped by `limit`.** `rankSlashCommands` returns every command for an empty query (the menu scrolls); the limit (12) applies once a query character is typed. This is what "Empty query: every command" in §1.3 requires.
3. **The toggle is its own settings card.** The existing Composer card's `sectionId` is `composer-spellcheck`, so `section=composer-slash-commands` needed a card of its own: **Slash Commands**, between Composer and Auto-Scroll. `help/chat-settings-composer.md`'s `url` moved to that section as §7 says; `help/impersonation-voice.md` still covers `composer-spellcheck`.
4. **Custom-tool pre-selection prefers the exact variant.** Every roster listing carries an `asCharacterId` (the run route's perspective), so the dialog matches `name` + `asCharacterId` first and falls back to the first listing by name only when the request carries `null`. It waits for the roster fetched by this open (`isSuccess && !isFetching`) before applying, once per nonce.
5. **Built-in sources** carry `pluginName` as well, so a plugin tool's `source` reads `Prospero · <pluginName>`; its category and plugin name are keywords.
6. **A found-but-unavailable `initialTool`** in `RunToolModal` toasts its `unavailableReason` and stays on the list (the spec covered only "not found").
7. **Enter and Tab are held while the lists load and nothing matches** (the mention plugin's precedent), so `/self_inv` + Enter typed before the tools arrive does not send the draft.
8. **The sidebar** now calls `() => modals.openRunTool()` rather than passing `openRunTool` as the click handler, which would otherwise receive the click event as a tool id.
9. **`rng-request.ts`** also exports `requestRngDirect` for `RngDropdown`'s legacy (non-preview) mode, so the dropdown makes no request of its own. `RngPendingResult` moved there and is re-exported from `RngDropdown`.

Files: `lib/slash-commands/{types,trigger,ranking,registry,index}.ts` (+ `__tests__/slash-commands.test.ts`); `components/chat/lexical/plugins/SlashCommandPlugin.tsx`, `components/chat/lexical/slash-commands/context.ts`, `components/chat/useSlashCommandRunner.ts`, `components/chat/rng-request.ts`; `RunToolModal` / `CustomToolRunDialog` `initialTool`; `CustomToolRunDialog` lifted into `ChatModals`; `CustomToolsButton` a plain button; migration `add-composer-slash-commands-field-v1`. Live verification (§9) on V4test, 2026-10-15: (a) pick empties the composer and one Cmd+Z restores the text, (b) `/wear` → Run Tool on `wardrobe_wear`'s form, (d) `/pascal_dr` → the custom-tool dialog on that tool's form, (f) `/d20` → a dice chip, (g) `and/or 10/15 http://x` opens nothing, and the migration and the settings card's deep link. Not yet exercised live: (c) and (d)'s immediate runs, (e) per-character variants, (h) the toggle off, (i) Document Mode — each is covered by the unit suites.
