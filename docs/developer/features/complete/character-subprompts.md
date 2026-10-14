# Character Subprompts

**Status:** Implemented (4.10)

Smaller, optional instructions a character can carry into a particular chat, switched on or off per seat, delivered directly after the system prompt.

## 1. Storage

- One Markdown file per subprompt in the root-level **`Subprompts/`** folder of the character's database-backed vault. Frontmatter carries `title`; the body is the instruction.
- The folder is a **lazy convention** like `Mail/` and `Tools/`: never scaffolded (`TOP_LEVEL_FOLDERS` untouched), created by `ensureFolderPath` on the first write, and a missing folder lists as `[]`. Only root-level `.md` files count (`listDatabaseFiles` filters by prefix, so nested paths are rejected explicitly).
- **Identity is the file name sans `.md`.** The id is derived from the title on create (`slugifySubpromptTitle`, `-2`/`-3` suffix on collision) and never changes afterwards, so a per-chat selection survives a title edit. Ids are validated as a single path segment (`isValidSubpromptId`).
- Archive: the bundle packs every pruned vault file, so subprompts round-trip through archive/rehydrate without being added to `KEPT_MANAGED_PATHS`. Writes refuse an archived character with `CharacterArchivedError` (tombstone rule); reads still resolve so an existing chat keeps compiling.
- Module: `lib/subprompts/subprompts.ts` — `listCharacterSubprompts`, `readCharacterSubprompt`, `createCharacterSubprompt`, `updateCharacterSubprompt`, `deleteCharacterSubprompt`, and `resolveSelectedSubprompts(characterId, ids)` (the prompt builders' entry point; drops unknown ids, sorts by title, fails soft to `[]`).

## 2. Per-chat selection

- `ChatParticipantBaseSchema.selectedSubpromptIds?: string[]` (`lib/schemas/chat.types.ts`), stored inside the `chats.participants` JSON column next to `selectedSystemPromptId`. Absent/empty → none. Reflected in the `.qtap` export schema's `ChatParticipant` properties; rides through export/import as part of the participant record (ids are vault file names, stable across import).
- Set at creation (`POST /api/v1/chats`, `createParticipantSchema.selectedSubpromptIds`; user-controlled seats always store `[]`) and changed live via `POST /api/v1/chats/[id]?action=update-participant` with `updateParticipant.selectedSubpromptIds` (replaces the whole set).
- Surfaced to the client on the enriched participant (`EnrichedParticipantDetail.selectedSubpromptIds`).

## 3. Prompt assembly

- `buildIdentityStack` gains `subprompts?: SubpromptForPrompt[]`, rendered directly after the base system prompt as `## Additional Instructions` → `### <title>` blocks, template-processed. **No `IDENTITY_STACK_BUILDER_VERSION` bump:** output for unchanged inputs is byte-identical (a seat with none selected hashes exactly as before), which is what the goldens require; a seat *with* a selection reaches the compiler through the recompile triggers below. Pinned by a variant test in `__tests__/unit/cache-determinism/system-prompt.test.ts`.
- The compiler (`buildStackFor`) resolves the seat's selection from the vault and bakes it into `chats.compiledIdentityStacks`. The per-turn read-through fallback (`context-manager.ts`) resolves them only when no precompiled stack exists and passes them through `buildSystemPrompt.subprompts`.
- The greeting path (`lib/chat/initialize.ts`, its own flat builder) appends the same block after the system prompt for the opener; the chat-create route resolves the opener's selection before `buildChatContext`.

### Recompile triggers (additions to the table in PROMPT_ARCHITECTURE.md §6)

| Event | Call | Site |
|---|---|---|
| Participant `selectedSubpromptIds` changed (order-insensitive compare) | `compileIdentityStackForParticipant` | `app/api/v1/chats/[id]/helpers.ts` |
| Subprompt content/title edited | `fanOutSubpromptChange` → recompile every live LLM seat of that character carrying the id | `PUT /api/v1/characters/[id]/subprompts/[subpromptId]` |
| Subprompt deleted | `fanOutSubpromptChange({ removeSelection: true })` → strip the id from each seat, then recompile | `DELETE …/subprompts/[subpromptId]` |

The fan-out (`lib/subprompts/chat-fanout.ts`) is the one deliberate exception to "character edits never invalidate": a subprompt is per-chat input the user just toggled, and the seat record would otherwise point at text that no longer exists. It uses `chats.findByCharacterId` (JSON-array filter — acceptable on a rare write path), publishes `chats/<id>` realtime hints, and fails soft per seat.

## 4. Green room

`applyOutfitSelections`' `llm_choose` branch reads the persisted chat's seat for the character (`resolveSubpromptsForSeat`, lazy-importing the subprompts module) and passes the resolved subprompts to `chooseLLMOutfit` as a trailing argument. They are rendered in the user message as *Additional Instructions in play for this scene (addressed to `<name>` in the second person)*, after the dressing instructions, and the system prompt's bullet list names them. All three call sites (creation, add-participant, merge) persist the seat before the outfit call, so no signature change was needed.

## 5. API

- `GET/POST /api/v1/characters/[id]/subprompts`
- `GET/PUT/DELETE /api/v1/characters/[id]/subprompts/[subpromptId]`

Archived → 409; validation → 400; unknown id → 404. Every write publishes `characters/<id>` (the realtime `characters` arm fans out to `queryKeys.characters.subprompts(id)`).

## 6. UI

- Shared: `components/subprompts/` — `useCharacterSubprompts` (query + mutations, realtime-gated fallback poll), `SubpromptEditorModal` (BaseModal + `MarkdownLexicalEditor`, `PROMPT_FIELD_HINTS.subprompt` carries the second-person note), `SubpromptPicker` (inline disclosure with checkboxes and a "New subprompt…" action that ticks the new one on).
- New Chat: `CharacterPickerPanel` (per LLM seat, under the system prompt select) and `NewChatForm` (single-character shortcut). `SelectedCharacter.selectedSubpromptIds`; `useNewChat` omits the key when empty so a plain create stays byte-identical.
- Salon: `ParticipantCard` under the prompt row, `onSubpromptsChange` threaded through `ChatSidebar` → `SalonView` → `useChatControls.handleSubpromptsChange`.
- Aurora: `SubpromptsSection` beneath `PromptList` on the System Prompts tab.
- The AI Wizard and Character Optimizer do not read or write subprompts, by request.

## 7. Tests

- `lib/subprompts/__tests__/subprompts.test.ts` — storage layer against an in-memory store fake.
- `lib/subprompts/__tests__/chat-fanout.test.ts` — fan-out selection and delete-strip.
- `__tests__/unit/app/api/v1/chats/[id]/helpers.subprompt-update.test.ts` — recompile trigger.
- `__tests__/unit/cache-determinism/system-prompt.test.ts` — rendering, placement, and the empty-is-identical guarantee.
- `components/new-chat/__tests__/useNewChat.request-body.test.tsx` — payload shape.
