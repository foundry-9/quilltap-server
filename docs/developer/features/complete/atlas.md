# Feature: The Atlas — named things, what they look like and what is known of them

**Status:** Specified 2026-11-10; implemented 2026-11-10 in 4.13-dev (see §9, *As built*). Decisions in §2 were settled with the operator the same day.
**Owner subsystems:** The Atlas is its own name and has no persona; nothing "speaks" for it. The Scriptorium holds its files (an `Atlas/` folder per tier), the context builder delivers its knowledge (a trailing section beside the referent ledger), the Lantern reads its graphic prompts, and the Salon shows its chips.
**Companion designs:** [inventory.md](inventory.md) (the four-tier store, the browser and the picture gallery this is built on — read §5.1–5.5 and §9), the absent-character chips and referent ledger (`lib/chat/absent-mentions.ts`, `lib/chat/context/referent-ledger.ts`, `help/salon-host-introductions.md`), and [refactor-4-12-tier-walk.md](../refactor-4-12-tier-walk.md) (how a tier is reached).
**Implementation note:** This spec is written to be executed by Claude Code. Follow the CLAUDE.md standing rules throughout: changelog entry in plain voice, help docs with `url` frontmatter and an In-Chat Navigation section, debug logging on every touched backend path, `qt-*` classes not raw Tailwind (regenerate the storybook CSS and bump `packages/theme-storybook`), `npx tsc` not `npm run build`, routes only under `/api/v1/` through `withActionDispatch`, query keys only from `lib/query/keys.ts`, no polling, no stubs, no `TODO`. The decisions in §2 are settled. **Do not reopen them during implementation**; if one proves unworkable, stop and say so. File and line pointers are as of commit `0d73a4aee`; find the function by name if a line has moved.

---

## 1. The feature in one paragraph

A story has things in it that are not characters: a vehicle, a house, a device, a place. Today nothing tells an image model what the Convertible looks like, and nothing tells a character what is known about it, unless someone writes it into a scenario every time. The Atlas gives every tier that has a wardrobe and an Inventory (a character's vault, a group store, a project store, Quilltap General) an `Atlas/` folder of one-file-per-entry documents. An entry has a canonical name, aliases, a short graphic prompt and free-form knowledge. When an entry's name or an alias turns up in the scenario or in what is said, the characters who can reach that entry are given its particulars in a trailing section of their turn (as they are for absent characters today), the operator gets a chip on its first mention with the same particulars in a popup, and the image prompt crafters for story backgrounds and generated images are handed its graphic prompt as a reference to use if the thing is in the picture. The operator maintains it in a browser dialog like the Inventory's, opened from the left sidebar. Characters have no tools for it.

## 2. Decisions of record

Rows marked **(operator)** were answered by the operator on 2026-11-10. Rows marked **(default)** were chosen by the spec author and accepted by the operator as written the same day.

| Question | Decision |
|---|---|
| Name | **The Atlas** **(operator)**. Folder `Atlas/`, code prefix `atlas` / `Atlas`, one thing is an **entry**. |
| Tiers | **The wardrobe's and Inventory's four** **(operator)**: character vault, group store, project store, Quilltap General. |
| Fields | **Canonical name, aliases, graphic prompt, knowledge** **(operator)**. No archetypes, kits, composites, slots, emoji or SVG glyph **(operator)**. Plus the housekeeping every item has: `id`, `metadata`, `imageFileId`, `archivedAt`, timestamps. |
| Graphic prompt length | **Warn over 200 characters, never refuse** **(operator)**. The warning is in the editor only; the API accepts any length. |
| File format | **One Markdown file per entry: YAML frontmatter for the fields, the body is the knowledge** (default). Knowledge is free-form Markdown the operator will want to edit in Document Mode, which a JSON string makes miserable. Identity is the frontmatter `id`, never the path. This is the wardrobe item's format, not the Inventory's. |
| How knowledge reaches a character | **As absent characters do now** **(operator)**: a trailing per-turn section while the thing is named in the last few spoken lines. No Host message, no transcript row, no once-per-chat bookkeeping, nothing stored. |
| Scenario-named things | **On the character's first turn, then only when named** **(operator)**. A seat that has not yet spoken since the scenario was set (or last revised) has the scenario text added to its scan. |
| What counts as named | **The scenario and anything said in conversation** **(operator)**: the last six spoken lines plus the new user message, the same window the referent ledger reads. The scene-state tracker's text counts **for pictures only** (default) — it persists from turn to turn, so letting it trigger knowledge would repeat the full text every turn while the thing is in the scene. |
| Who is told | **Only who can reach the entry** **(operator)**. A character-vault entry is told to that character alone, a group entry to its members, project and General entries to everyone seated. This needs no targeting: each character's section is built from their own pool. |
| Project roster | **Not consulted** (default). The project's Atlas is the world of the chat; every seat in a chat of that project is told. (The roster gates tool file access, the project wardrobe and the Inventory shelf — things a character *takes*. Nothing is taken here.) |
| Matching | **Whole word, case-insensitive, Unicode letter-bounded, longest term first, no stemming** (default). "car" matches "the car" and "Car", not "cars" or "carpet". Plurals are the operator's to add as aliases. A term a character's name or alias already claims is the person's, not the thing's. |
| Shadowing | **By canonical name, case-insensitively: character > group > project > general**, archived entries dropped per tier before shadowing (default) — the Inventory's rule. A character's own Convertible replaces the project's for that character. |
| Graphic prompt in pictures | **A reference for the crafter** **(operator)**: "if this thing is in the picture, it looks like this". Never appended to a crafted prompt. The one exception is a path with no crafter and an operator-typed prompt that names the thing (default; §5.8). |
| Which pictures | **Story backgrounds and every `generate_image` path** (in-chat tool, image-profile generate, uncensored retry), and the legacy image dialog (default). **Never** avatars, wardrobe or Inventory item pictures, or an entry's own picture. |
| Whose Atlas a picture uses | **The cast's** (default): a picture is public, so it reads the union of every present seat's reach (§5.4). |
| Pictures on entries | **Yes** **(operator)**: a gallery per entry with upload and generate, as Inventory objects have. The picture is for the operator; it is never sent to an image model as a reference (default). |
| Tools | **None** **(operator)**. `Atlas/` in a character's vault is a core folder, hidden from an opaque character's `doc_*` tools like `Wardrobe/` and `Inventory/`. |
| New-chat preview | **None** **(operator)**. The chip on the Host's scenario row (§5.7) is how the operator sees what the scenario matched. |
| UI home | **A left-sidebar button beside Wardrobe and Inventory; no per-character button in the chat's right sidebar** **(operator)**. Otherwise wherever the Inventory dialog is offered: the workspace tab, the Prospero project card, the Aurora character page. |
| Archived characters | **`Atlas/` is not kept by the tombstone prune** (default). `Inventory/` is kept only so archetype dependents stay countable; nothing depends on an entry. |
| Database | **No new tables, columns or migrations.** Entries are files; delivery is derived on read. |
| Export, backup | **Files ride along** as ordinary store documents. Restore needs the picture-pointer fix only (§5.11). |
| SillyTavern lorebooks | **Out of scope.** `character_book` stays ignored on import and export. |

## 3. Vocabulary

- **Entry** — one Atlas file. Code: `AtlasEntry`. User-facing: *entry*.
- **Term** — an entry's canonical name or one of its aliases.
- **Graphic prompt** — `graphicPrompt`: what the thing looks like, for image models and for a character describing it.
- **Knowledge** — the file body: what is known about the thing.
- **Pool** — the entries one character can reach, shadowed.
- **Cast view** — the entries a chat's present seats can reach between them, for pictures and chips.
- **Named** — a term matched in a text by `lib/atlas/match.ts`.

## 4. What already exists (read before building)

- **Shared item-folder machinery** (`lib/mount-index/`): `item-folders.ts` (`ItemFolderRules`, path helpers, `isItemDocumentPath`), `item-folder-location.ts` (`ItemFolderLocation`, `ItemFolderKind`, `createItemFolder` / `renameItemFolder` / `deleteItemFolder` / `moveItemsToFolderIn`), `item-folder-ops.ts` (`VaultFolderMount`, `resolveVaultFolderMount`, `runSerialized`, `chainKey`, the `*In` folder ops), `vault-projection.ts` (`projectArrayIntoVaultFolder`, default `ext: '.md'`; **its default behaviour must not change**), `item-folder-routes.ts` (`itemRoutePreamble`, `ItemRouteKind`, `withItemErrors`), `item-images-route.ts` (`createItemImagesRoute`).
- **The Inventory as the template** (`lib/inventory/`): `folders.ts`, `vault-readers.ts`, `vault-writes.ts`, `location.ts`, `pool.ts`, `item-mutations.ts`, `transfers.ts`, `container.ts`, `request.ts`, `errors.ts`, `routes/`, `item-images.ts`, `item-image-generation.ts`. Everything about archetypes, instances, kits, equip, refs, title lint and the roster gate is **not** copied.
- **The wardrobe item's Markdown format:** the frontmatter reader and writer the wardrobe item parser uses (start from `isWardrobeItemDocumentPath` and `projectVaultWardrobe`). Reuse the frontmatter helpers; do not write a second YAML reader.
- **Reach** (`lib/mount-index/reach.ts`): `resolveOwnerStore`, `groupMountsFor`, `groupOriginMap`, `castGroupMounts`, `resolveCastPool`; `resolveProjectMountPointIds` (`tiered-mount-pool.ts`); `getGeneralMountPointId`. A grep-test (`reach-chokepoint.test.ts`) forbids hand tier walks.
- **Name matching:** `buildNameMatcher` / `firstNameMatch` / `lastNameMatch` (`lib/chat/name-mentions.ts`) — one global `u` regex, longest first, letter-bounded, **case-sensitive**.
- **The referent ledger:** `buildReferentSections` (`lib/chat/context/turn-trailing.ts`) reads the last `REFERENT_LEDGER_WINDOW_LINES` spoken lines through `spokenText` and the shared `TurnTranscript`, and adds the new user message when it is not yet persisted. `TrailingSections` / `orderedSections` / `composeTrailingMessage` in the same file are the only way a trailing section is delivered. The sections are built in the parallel read block of `buildContext` (`lib/chat/context-manager.ts`, beside `buildReferentSections` and `buildInventorySection`).
- **Chips:** `findAbsentMentions` (`lib/chat/absent-mentions.ts`), `GET /api/v1/chats/[id]?action=absent-mentions`, `hooks/useAbsentMentions.ts`, `rehypeMentionMarkers` / `splitMentionMarkers` (`lib/chat/mention-markers.ts`), `components/chat/MentionChip.tsx`, `queryKeys.chats.absentMentions`.
- **Host scenario rows:** `postHostScenarioAnnouncement` (`systemKind: 'scenario'`) and `postHostScenarioRevisionAnnouncement` (`'scenario-change'`) in `lib/services/host-notifications/writer.ts`. `chat.scenarioText` is the text itself.
- **Story background:** `handleStoryBackgroundGeneration` (`lib/background-jobs/handlers/story-background.ts`) → `craftStoryBackgroundPrompt` (`lib/memory/cheap-llm-tasks/image-scene-tasks.ts`; context type `StoryBackgroundPromptContext` in `cheap-llm-tasks/types.ts`; system prompt from `buildStoryBackgroundPrompt`). The handler does not read `chat.scenarioText` today.
- **`generate_image`:** `runImageGenerationTool` → `expandPromptWithContext` → `expandPromptWithDescriptions` (`lib/tools/handlers/image-generation-handler.ts`), which **returns the prompt unchanged when it has no `{{…}}` placeholder**; `resolvePlaceholders` / `buildExpansionContext` (`lib/image-gen/prompt-expansion.ts`); `craftImagePrompt` (`image-scene-tasks.ts`, context `ImagePromptExpansionContext`).
- **Legacy image dialog:** `POST /api/v1/images?action=generate` (`app/api/v1/images/route.ts`) sends the raw prompt.
- **UI:** `components/layout/left-sidebar/sidebar-footer.tsx` (the Wardrobe and Inventory buttons), `lib/folder-browser/item-kind.ts` (`ItemKind`), `components/item-browser/*` (shared shell, folder bar, rows, pickers, `ItemImageViewer`), `components/providers/item-dialog-provider.tsx`, `components/inventory/*`, `lib/hooks/use-inventory.ts`, `lib/hooks/use-item-folders.ts`, `lib/workspace/types.ts` / `tab-meta.ts`, `components/workspace/TabView.tsx` / `WorkspaceIntent.tsx`, `app/prospero/[id]/components/InventoryCard.tsx`, the icon registry (`components/ui/icons/icon-registry.ts`, `scripts/generate-icon-css.ts`).
- **Realtime:** `lib/schemas/realtime.types.ts`, `lib/realtime/topic-map.ts`, `lib/realtime/job-topics.ts` (`INVENTORY_PATH_PATTERN`).
- **Core folders:** `CHARACTER_VAULT_CORE_FOLDERS` (`lib/characters/vault/core-guard.ts`).

## 5. Design

### 5.1 The model

`lib/schemas/atlas.types.ts`:

```ts
export const ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT = 200

export const AtlasEntrySchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(200),            // canonical name
  aliases: z.array(z.string().trim().min(1).max(200)).max(50).default([]),
  graphicPrompt: z.string().nullable().default(null), // no hard length limit
  knowledge: z.string().nullable().default(null),     // the file body, Markdown
  imageFileId: z.uuid().nullable().default(null),
  metadata: z.record(z.string(), z.unknown()).default({}),
  folder: z.string().default(''),                     // derived from the path, never stored
  archivedAt: z.string().nullable().default(null),
  createdAt: z.string(),
  updatedAt: z.string(),
}).strict()
```

Also: `ATLAS_FRONTMATTER_KEYS` (every key but `knowledge` and `folder`), `AtlasRecord` (entry + `fileStem`), `AtlasOrigin { scope, id, name }`, `AtlasScopeSchema`, and the request bodies (`createAtlasEntrySchema`, `updateAtlasEntrySchema` with `archived` and `imageFileId`, `duplicateAtlasEntrySchema`, the folder bodies, `fileAtlasEntriesSchema`, `atlasTransferSchema`) shaped as the Inventory's are. An update is validated with `patchSchemaOf`, never `.partial()`.

Aliases are normalised on write: trimmed, empty dropped, de-duplicated case-insensitively, and an alias equal to the name dropped.

**On disk:** `<store>/Atlas/[Folder/…]/<sanitized name>[-n].md`. Frontmatter carries `ATLAS_FRONTMATTER_KEYS` in schema order; the body is `knowledge` verbatim (absent body → `null`). Folder rules are the Inventory's: ≤ 8 segments, `images` reserved at any depth, the path is the truth. A file under `Atlas/` with no UUID `id` in its frontmatter is a note: skipped by the reader, never swept by a write. Unknown frontmatter keys are dropped with a `warn` on the next projection; free-form data lives under `metadata`.

### 5.2 Reading and writing files (`lib/atlas/`)

- `folders.ts` — `ATLAS_FOLDER = 'Atlas'`, `ATLAS_FOLDER_RULES: ItemFolderRules`, the path error subclasses, one-line delegates, `isAtlasEntryDocumentPath(relativePath)` (`.md` under `Atlas/`, not under `images/`). Client-safe.
- `vault-readers.ts` — `parseAtlasEntryFile`, `isAtlasEntryDocument`, `scanAtlasFolder(mountPointId)`, `atlasFileNameFor(record)`.
- `vault-writes.ts` — the only path to disk: `serializeAtlasRecord`, `projectMountAtlas` over `projectArrayIntoVaultFolder(mp, 'Atlas', …, { recursive: { excludeSubfolders: ['images'] }, ownsFile, preserveFileNames })`, `createAtlasInMount` / `updateAtlasManyInMount` / `deleteAtlasInMount`, the folder ops, all under `runSerialized(chainKey(ATLAS_FOLDER_RULES, mount))`.
- `location.ts` — `AtlasLocation extends ItemFolderLocation`; `resolveAtlasLocation(scope, id, repos, userId, { ensure })` over `resolveOwnerStore(…, { ensure: { folder: 'Atlas', onFolderFailure: 'swallow' }, archived: 'allow', context: 'atlas' })`. `ensure` only for writers. Every write that lands calls `publishRealtime('atlas')`; a read never does.
- `item-mutations.ts` — `createAtlasEntry`, `updateAtlasEntry`, `setAtlasEntryArchived` (`archivedPatch`), `deleteAtlasEntry`, `duplicateAtlasEntry` (`nextCopyTitle` on `name`), `moveAtlasEntriesToFolder`, `copyAtlasEntriesToFolder`, `ATLAS_FOLDER_KIND`.
- `transfers.ts` — `transferAtlasEntry` (move keeps the id, copy mints one, pictures carried), as `transferInventoryItem` without the kit and `canCopy` checks.
- `item-images.ts`, `item-image-generation.ts` — §5.9.
- `errors.ts` (an `AtlasRefusal` base, `AtlasShapeError`, `AtlasNameTakenError`), `request.ts`, `container.ts`.

**Name rule:** within one tier, a create or rename is refused (`409`, `AtlasNameTakenError`) when a non-archived entry there already has that canonical name, case-insensitively. A document-layer write can still produce two; the reader keeps the first by path order and logs a `warn`. Alias overlaps are never refused (§5.3 resolves them).

Where an Inventory module is generic but for its names (the picture carry in `transfers.ts`, the image gallery functions, the route factory's collection and item verbs, the restore pointer fix), **lift the shared part into `lib/mount-index/` and have both call it** rather than copying. Where lifting would mean threading archetype or kit logic through a shared signature, write the Atlas's own small module instead.

### 5.3 Matching (`lib/atlas/match.ts`)

The one place a text is tested for Atlas terms. Pure and client-safe.

- `buildNameMatcher(names, { caseInsensitive?: boolean })` gains the option (default `false`, so every existing caller is unchanged). The Atlas always passes `true`.
- `buildAtlasMatcher(entries, { excludeTerms? })` builds one matcher over every term of every entry and a folded term → entry map. One term resolves to **exactly one** entry: an entry whose canonical name is the term beats one holding it as an alias; then the order of `entries` (callers pass strongest tier first); then name order. `excludeTerms` removes terms outright (people's names, §5.5).
- `findNamedEntries(texts, matcher)` takes texts in priority order and returns each named entry once, with the matched text as written and the index of the text it was first found in.
- `firstAtlasMention(text, matcher)` for the chips.

### 5.4 Pool and cast view (`lib/atlas/pool.ts`)

- `loadAtlasPool(repos, { characterId, projectId })` — one read per tier through `groupMountsFor` / `groupOriginMap`, `resolveProjectMountPointIds`, `getGeneralMountPointId`; archived dropped per tier, then shadowed by canonical name, character > group > project > general. Each entry carries its `AtlasOrigin`. An archived character resolves to no character tier.
- `loadCastAtlasView(repos, { chat })` — for the present seats (`isParticipantPresent`), strongest first: each seat's vault in participant order, then the cast's groups (`castGroupMounts`), then the project, then General; shadowed the same way. Two seats each with their own "Convertible": the earlier seat's wins the picture.
- `loadAtlasPoolForLocation(location)` — the browser's "what else is reachable here" read (a shared tier reads itself plus General), used only for the editor's overlap warnings.

The pool is read on every turn for the responding character. That is the Inventory's cost today and is acceptable; do not add a cache.

### 5.5 Knowledge delivery (`lib/atlas/prompt-section.ts`)

`buildAtlasSection(input)` is the **only** prompt-side reader of the Atlas. It reads, never writes, never throws (a failure logs a `warn` and returns `''`), and is empty-is-absent.

**Wiring.** `TrailingSections` gains `atlas: string`, placed in `orderedSections` immediately after `referentLedger` (who is spoken of, then what). It is computed in `buildContext`'s parallel read block. The recent-lines window is extracted from `buildReferentSections` into a shared helper in `turn-trailing.ts` (`recentSpokenLines({ transcript, newUserMessage, … })`) so both sections read the transcript once and agree on the window.

**The scan, in priority order:**
1. the recent spoken lines, newest first (the last `REFERENT_LEDGER_WINDOW_LINES` plus the unpersisted new user message);
2. `chat.scenarioText`, **only on this seat's first turn under the current scenario**: the responding participant has no persisted spoken line (`spokenText`, ASSISTANT, their `participantId`) after the latest Host row whose `systemKind` is `scenario` or `scenario-change` (or in the whole chat when there is no such row). Messages in the turn's `regenerationOfMessageIds` are ignored for this test, so a swipe of a first line is still a first turn. This is derived from history every time; nothing is stored.

**Exclusions.** Terms that are the name or an alias of any workspace character (the list `buildReferentSections` already loads — pass it in, do not read it twice) are removed from the matcher: the referent ledger owns people.

**Rendering.** At most `ATLAS_SECTION_MAX_ENTRIES = 8`, in scan order. An entry with neither `knowledge` nor `graphicPrompt` is skipped. Model-facing text is plain and never says "Atlas":

```
## What is being spoken of

Particulars of things named in the scene or the recent conversation. This is what you know of them.

### Convertible
Also called: lander, car, dinghy
Appearance: Usually a 1930's roadster, convertible, silver, …

[knowledge, verbatim]
```

`Also called` and `Appearance` lines are omitted when empty. Knowledge is not truncated; the section is measured with the other trailing sections before history is packed, as bug 263 requires, which `TrailingSections` already guarantees.

**Scope.** Every chat shape that goes through `buildContext` (Salon, autonomous rooms). Not help chats, the Brahma console, Carina queries or any cheap-LLM task. The section is never in system blocks 1–3 and bumps no builder version. A turn with nothing named is byte-identical to today.

### 5.6 Routes

All built by `lib/atlas/routes/atlas-route-factory.ts` (`createAtlasCollectionHandlers`, `createAtlasItemHandlers`) on `itemRoutePreamble`, with `routes/responses.ts` (`withAtlasErrors`).

| Route | Verb | Actions |
|---|---|---|
| `/api/v1/atlas`, `/api/v1/characters/[id]/atlas`, `/api/v1/groups/[id]/atlas`, `/api/v1/projects/[id]/atlas` | GET | list (`?includeArchived`), `?action=folders`, `?action=overlaps` (terms this tier shares with other reachable entries or with character names, for the editor's warnings) |
| same | POST | create; `?action=duplicate`, `create-folder`, `rename-folder`, `delete-folder`, `move-items`, `copy-items` |
| `…/atlas/[entryId]` (four tiers) | GET, PUT, DELETE | — |
| `/api/v1/atlas/transfers` | POST | move or copy between tiers |
| `/api/v1/atlas/[entryId]/images` | GET, POST | `createItemImagesRoute`: `generate`, `upload`, `set-current`, `delete-image` (container in `?scope=&id=`) |
| `/api/v1/chats/[id]` | GET | `?action=atlas-mentions` (§5.7) |

Every route uses `createContextHandler` and the action-dispatch primitives; an unknown action is a 400.

### 5.7 Chips for the operator

`findAtlasMentions` (`lib/atlas/mentions.ts`, pure) returns, for each entry of the **cast view**, the first message that names it: `{ messageId, entryId, text, card }` where `card` is `{ name, aliases, graphicPrompt, knowledge, origin, imageFileId }`. It scans, oldest first, the spoken lines (`spokenText`) **and the Host's `scenario` / `scenario-change` rows** — the scenario is where a thing usually first appears, and the chip there replaces a new-chat preview. Character terms are excluded as in §5.5.

`GET /api/v1/chats/[id]?action=atlas-mentions` serves it; `queryKeys.chats.atlasMentions(id)`; `hooks/useAtlasMentions.ts`. The Salon merges these with the absent-character mentions into the one `rehypeMentionMarkers` pass (a person's chip wins an overlapping run). `MentionChip` gains a `kind: 'person' | 'thing'` prop: a thing's popup shows the name, "also called", the graphic prompt, the knowledge rendered as Markdown, the current picture when there is one, and which tier it came from. The Host's scenario row must run the same marker pass (confirm that Staff rows are rendered through it; extend the renderer if they are not).

The popup says where the entry is filed but does not link into the editor in v1.

### 5.8 Pictures that mention things (`lib/atlas/image-reference.ts`)

The **only** module an image path may read the Atlas through. A grep-test holds it.

- `resolveAtlasImageReferences({ view, texts, max = 8 })` → `KnownThing[]` (`{ name, aliases, look }`), from `findNamedEntries` over the texts in priority order, keeping entries with a non-empty `graphicPrompt`.
- `renderKnownThings(things)` → the one block both crafters receive, or `''`:

```
Known things. If one of these is in the picture, draw it as described. Do not add one that is not in the scene.
- Convertible (also: lander, car, dinghy): Usually a 1930's roadster, …
```

- `appendKnownThings(prompt, things)` for a path with no crafter: `"<prompt> <Name>: <look>."` per thing.

**Story background.** In `handleStoryBackgroundGeneration`, once `sceneContext` is settled and before the crafter runs: load the cast view; resolve references over, in order, the final `sceneContext`, the fresh scene state's `location` and each character's `action` (when scene state was used), the recent visible messages newest first, then `chat.scenarioText`. Pass the result as a new `knownThings?: KnownThing[] | null` on `StoryBackgroundPromptContext`; `craftStoryBackgroundPrompt` renders it in the user message beside the aesthetic section, and `buildStoryBackgroundPrompt`'s instructions gain one sentence teaching the block. Because it rides the context object, the desk re-craft carries it without further work. No append step: the crafter decides, so a Convertible named only in the scenario is not painted into every background.

**`generate_image`** (tool, image-profile generate, uncensored retry — all through `expandPromptWithDescriptions`). Before the no-placeholder early return:
- The view is the chat's cast view when the call has a chat; otherwise General plus the project's tier when the call carries a project.
- Resolve references over the prompt text. A `{{Name}}` placeholder that names no character but does name an entry term is an Atlas placeholder: it is replaced by the canonical name and the entry is added to the references. `resolvePlaceholders` keeps its rule that characters win.
- With at least one reference, the prompt is crafted even when it has no character placeholder: `ImagePromptExpansionContext` gains `knownThings`, and `craftImagePrompt` renders the same block. If the crafter fails or returns nothing, the fallback substitution runs as today and then `appendKnownThings`.
- With no reference, behaviour is byte-identical to today, including the early return.
- The expanded prompt is re-classified for dangerous content afterwards, as it already is.

**Legacy image dialog** (`app/api/v1/images/route.ts`). The operator typed the prompt and no crafter runs, so a named thing is in the picture by their own word: resolve over the prompt with General (plus the project when supplied) and `appendKnownThings`.

**Never:** `lib/image-gen/avatar-prompt.ts`, the avatar job, the preview avatar, wardrobe and Inventory item pictures, and the Atlas's own entry pictures.

### 5.9 Pictures on entries

As Inventory objects: files at `Atlas/images/<entryId>/` with `files` rows linked to the entry, upload and generate, one current picture (`imageFileId`). Generation goes through `generateImageWithConciergeFailover` (`purpose: 'dialog'`) with the subject `graphicPrompt`, else the name; it logs under a new LLM log type beside `INVENTORY_ITEM_IMAGE`. `ItemImageViewer`'s `KIND_SPECS` gains the Atlas. The picture appears in the entry editor, the full-screen viewer and the chip popup; browser rows use the `atlas` icon. A cross-tier move carries the pictures; a delete cleans them up.

### 5.10 UI

- **`ItemKind`** (`lib/folder-browser/item-kind.ts`) gains `'atlas'`, and with it every keyed map: `use-item-folders.ts` `KIND_SPECS`, `item-dialog-provider.tsx`, `ItemControlDialogShell.tsx` `KIND_COPY`, `ItemImageViewer.tsx`.
- **`components/atlas/`**: `atlas-control-dialog.tsx` (`AtlasControlDialog`, `AtlasView`, `AtlasPanel`), `AtlasBrowser.tsx` on `FolderBrowserShell`, `atlas-entry-row.tsx` (name, aliases, a truncated graphic prompt), `atlas-entry-editor.tsx`, `AtlasTransferDialog.tsx`; hooks `useAtlasListData`, `useAtlasEntryActions`; `lib/hooks/use-atlas.ts` (`useAtlasList`, `useAtlasFolders`, `useAtlasImages`, `useAtlasMutations`).
- **The editor:** Name; Aliases (a token input: Enter or comma adds, Backspace removes; labelled, keyboard-operable); Graphic prompt (textarea with a live count, a non-blocking warning past `ATLAS_GRAPHIC_PROMPT_SOFT_LIMIT`); Knowledge (the shared Markdown editor, with its typeaheads); Folder; Pictures. Beneath the terms, non-blocking notices from `?action=overlaps`: a term another reachable entry also uses, and a term that is a character's name or alias (which will never match, §5.5).
- **Browser features**, as the Inventory's: container select over all four tiers, folders (create, rename, delete, file into), multi-select, archive and show-archived, duplicate, move or copy to a folder, move or copy to another tier, delete.
- **Provider and dialog:** `components/providers/atlas-dialog-provider.tsx`, mounted with `<AtlasControlDialog/>` in `components/layout/app-layout.tsx`.
- **Left sidebar** (`sidebar-footer.tsx`), after Inventory: in `/workspace` → `workspace.openTab('atlas')`; on a Salon chat → `atlasDialog.open({ chatId, projectId })`, the container defaulting to the chat's project when it has one, else General; elsewhere → `atlasDialog.open()`. No button in the chat's right sidebar.
- **Workspace tab:** `'atlas'` in `lib/workspace/types.ts` (kind and `AtlasTabPayload`), `tab-meta.ts` (`{ title: 'The Atlas', icon: 'atlas' }`), `TabView.tsx`, `WorkspaceIntent.tsx`.
- **Other entry points:** a Prospero project card (`AtlasCard.tsx`, registered where `InventoryCard` is) and the Aurora character page where the Inventory is offered.
- **Icon:** `atlas` in the icon registry with `public/images/icons/atlas.svg` (mask mode), `_icons.css` regenerated by `scripts/generate-icon-css.ts`, the storybook Icons story, `docs/developer/ICON_INVENTORY.md`, and an icon test like `inventory-icon.test.ts`. No Madman's Box override in v1; the default serves.
- **Accessibility:** the dialog is `BaseModal` (through the shared shell); every input has a visible label; the token input and the chip popup are keyboard-reachable; warnings are text, not colour alone.
- **Voice:** user-facing copy in the house style. Model-facing text (§5.5, §5.8) is plain.

### 5.11 Query keys, realtime, guards, export

- **Query keys:** `queryKeys.atlas` — `all`, `lists`, `list(tierKey, { includeArchived })`, `folderLists`, `folders(tierKey)`, `overlaps(tierKey)`, `images(entryId)`; and `queryKeys.chats.atlasMentions(id)`.
- **Realtime:** a new `atlas` topic in `REALTIME_TOPICS`; `topic-map.ts` invalidates the Atlas list, folder and overlap prefixes and every `chats.atlasMentions` (an edited entry changes the chips); the chat row's topic adds `chats.atlasMentions(id)`. `job-topics.ts` gains `TOPIC_ID_FIELDS.atlas: []` and an `Atlas/` path pattern so a job-child document write publishes it.
- **Core folder:** add `'Atlas'` to `CHARACTER_VAULT_CORE_FOLDERS`, and update `own-vault-core-guard.test.ts`.
- **Tombstones:** `KEPT_FOLDERS` is unchanged. `resolveAtlasLocation` on an archived character refuses writes through the shared mount resolver, as the Inventory's does.
- **Export and backup:** nothing to write; `Atlas/**` and its `files` rows are ordinary store content. **Restore:** entry ids are kept verbatim, and `imageFileId` is repointed after the file-id remap — generalise `planInventoryImagePointerFixes` and its apply step (`lib/backup/restore/uuid-remap.ts`, `restore.ts`) over a small per-kind descriptor rather than adding a second copy.
- **No DDL, no migration, no `qtap-export.schema.json` change.**

### 5.12 Logging

`debug` on every pool load (tiers read, entries kept and shadowed), every match pass (texts, terms, hits), every section built (entries, characters of text, whether the scenario was in the scan), every image reference resolution (path, things passed), every mutation and transfer. `warn` for a duplicate canonical name within a tier, a dropped frontmatter key, and any failure the turn or the picture continues past.

## 6. Out of scope (v1)

- Character tools, Pascal subjects or effects, `{{atlas.*}}` template variables.
- A Host message or any other transcript row; any stored "already described" state.
- Stemming, plurals, fuzzy or semantic matching; per-alias case sensitivity.
- Entry pictures as image-model references.
- Atlas knowledge in cheap-LLM tasks (summaries, scene state, memory extraction), Carina, Brahma or help chats.
- A new-chat preview; a link from the chip into the editor.
- SillyTavern lorebook (`character_book`) import or export.
- Scenario Builder awareness of the Atlas.

## 7. Phases

Each phase ends with `npx tsc`, `npm run lint`, the touched suites green, and the stated check.

- **A — Model and files.** `atlas.types.ts`, `folders.ts`, `vault-readers.ts`, `vault-writes.ts`, a fake store modelled on `__tests__/helpers/inventory-fake-store.ts`. *Check:* round-trip of a file with frontmatter and a Markdown body; a note and a duplicate-id file survive a write.
- **B — Location, pool, mutations, transfers, routes.** `location.ts`, `pool.ts`, `item-mutations.ts`, `transfers.ts`, the route factory and the nine route files, the realtime topic, query keys, core guard. *Check:* create, rename-refused-on-clash, archive, duplicate, folder ops and a cross-tier move through the API on V4test.
- **C — Browser UI.** `ItemKind`, hooks, `components/atlas/`, provider, sidebar button, workspace tab, Prospero card, Aurora entry point, icon. *Check:* the whole browser by hand, keyboard only as well.
- **D — Entry pictures.** Gallery, generate, viewer, transfer carry, restore pointer fix. *Check:* upload and generate; back up and restore V4test and confirm the current picture survives.
- **E — Matching and knowledge delivery.** `buildNameMatcher` option, `match.ts`, `recentSpokenLines`, `prompt-section.ts`, `TrailingSections.atlas`. *Check:* §8 scenarios 1–5 against the LLM log on V4test.
- **F — Chips.** `mentions.ts`, the chat action, the hook, `MentionChip` kind, the scenario row. *Check:* §8 scenario 6.
- **G — Pictures that mention things.** `image-reference.ts`, the story background, `generate_image`, the legacy dialog. *Check:* §8 scenarios 7–10.
- **H — Docs.** `help/atlas.md` and `help/project-atlas.md` (with `url` frontmatter and In-Chat Navigation); revise `help/salon-host-introductions.md` (things get chips too) and the story-background and image-generation help pages; `docs/developer/API.md`; `docs/FEATURES.md`; `ROADMAP.md`; `.claude/commands/update-documentation.md`; a `CLAUDE.md` chokepoint bullet and glossary row; `docs/CHANGELOG.md` in plain voice. Move this file to `features/complete/` with an *As built* section.

**Tests to write:** `atlas-files.test.ts`; `item-mutations.test.ts`; `routes.test.ts`; `pool-order.test.ts` (shadowing, archived dropped before shadowing, cast view order); `match.test.ts` (case, word bounds, longest first, name beats alias, tier order, excluded terms); `prompt-section.test.ts` (empty is absent, the window, first-turn scenario rule, regeneration, cap, per-character audience, never throws); `mentions.test.ts`; `image-reference.test.ts`; additions to the story-background and image-generation handler suites (a no-reference call is unchanged); topic-map and job-topics cases; the icon test; a UI test for the editor's warning and token input.

**Grep fences** (`__tests__/unit/lib/atlas/chokepoints.test.ts`): nothing outside `lib/atlas/vault-writes.ts` writes a file under `Atlas/`; nothing outside `lib/atlas/match.ts` builds an Atlas matcher; `lib/chat/` reads the Atlas only through `buildAtlasSection` and `findAtlasMentions`; image code reads it only through `lib/atlas/image-reference.ts`; nothing under `lib/image-gen/avatar-prompt.ts` or the avatar handlers imports `lib/atlas/`. `reach-chokepoint.test.ts` must still pass.

## 8. Acceptance

Fixtures on V4test: a project with two characters, A and B. In the **project** Atlas, *Convertible* (aliases lander, car, dinghy; the graphic prompt and some knowledge). In **A's vault**, a second *Convertible* with different knowledge. In General, *Lighthouse* with a graphic prompt and no knowledge.

1. A chat whose scenario says "They arrive in the convertible." A's first turn carries `## What is being spoken of` with **A's own** entry; B's first turn carries the **project's**. Neither has it on a second turn in which nobody names it.
2. The operator then says "Is the car still outside?" Both characters' next turns carry their own entry again. Six spoken lines later, with no further mention, it is gone.
3. "The cars were lined up" and "the carpet" match nothing.
4. A chat that names nothing: the request is byte-identical to one built before the feature (compare the LLM log).
5. A swipe of A's first line still carries the scenario-named entry. Revising the scenario to name the Lighthouse delivers it on each character's next turn only.
6. The scenario row shows a chip on "convertible"; the popup shows the name, aliases, graphic prompt, knowledge and tier. A later "lander" gets no second chip. A character named *Car* seated or absent keeps the person's chip and the Atlas does not match "Car".
7. A story background for scenario 1, generated while the scene is at the car: the crafter's user message contains the *Known things* block and the picture shows a silver 1930s roadster. A background generated after the scene has moved indoors: the block is still offered (the scenario names it) and the car is **not** in the crafted prompt.
8. A character calls `generate_image` with "the convertible parked by the lighthouse" and no placeholders: the prompt is crafted with both things described. With "a bowl of fruit": the prompt is sent unchanged and no crafter runs.
9. `generate_image` with `{{Convertible}} at dusk`: the placeholder becomes the canonical name and the look is supplied. With the cheap LLM made to fail: the look is appended.
10. An avatar regenerated in the same chat: its prompt contains nothing from the Atlas.
11. An opaque character's `doc_*` tools cannot list or read `Atlas/` in their own vault.
12. Archive the project's Convertible: B's next mention carries nothing; A's still carries A's own. Unarchive: B's returns.
13. Edit an entry's knowledge in Document Mode (the `.md` file): the browser, the next turn and the chip popup all show the new text with no restart.

## 9. As built

Implemented 2026-11-10. The design above holds; the departures and the details it left open:

- **Where things live.** Model `lib/schemas/atlas.types.ts`; files `lib/atlas/folders.ts`, `vault-readers.ts`, `vault-writes.ts`; `location.ts`, `pool.ts` (`loadAtlasPool`, `loadCastAtlasView`, `loadAtlasViewFor` for a set of characters and a project, `loadAtlasPoolForLocation`, pure `shadowAtlasLayers`), `item-mutations.ts`, `transfers.ts`, `item-images.ts`, `item-image-generation.ts`, `errors.ts`, `match.ts`, `prompt-section.ts`, `mentions.ts`, `image-reference.ts`, `routes/`; client `container.ts`, `request.ts`. UI in `components/atlas/`, `lib/hooks/use-atlas.ts`, `components/providers/atlas-dialog-provider.tsx`, `app/prospero/[id]/components/AtlasCard.tsx`, an Atlas card in Aurora's Appearance section.
- **No lift into `lib/mount-index/` beyond what already existed.** The picture steps (`carryItemImages`, `cleanupItemImages`, `commitMovedImages`, `assertItemImageChoice`, `removeImageFile`) were already generic in `lib/wardrobe/item-images.ts` and the route factories already shared `itemRoutePreamble` / `createItemImagesRoute`; the Atlas calls those. The route factory's collection and item verbs are the Atlas's own (small, no archetype logic). The restore pointer fix *was* generalised: `ItemFileKind` / `planItemImagePointerFixes` in `uuid-remap.ts`, with Inventory and Atlas descriptors, one apply loop in `restore.ts`, and both kinds' ids protected from the `files.linkedTo` remap.
- **Body round-trip.** The writer emits frontmatter, a blank line, then `knowledge`; the reader trims leading blank lines and trailing whitespace from the body. Knowledge is stored with trailing whitespace trimmed.
- **Copies in the same tier** (duplicate, `copy-items`) are named "(copy)" because the name rule forbids two live entries of one name. A transfer into a tier holding a live entry of the same name is `NAME_TAKEN`.
- **Story-background system prompt.** The "known things" paragraph is added to `buildStoryBackgroundPrompt` only when the request carries the block, so a background that names nothing is crafted byte-for-byte as before (§5.8 had it unconditional).
- **`generate_image` with no cheap LLM configured** appends the looks to the prompt (as on a crafter failure).
- **Workspace characters and the recent window** are read once in `buildContext` and passed to both `buildReferentSections` and `buildAtlasSection` (`recentLines`, `workspaceCharacters` promises).
- **Chip query keys.** `queryKeys.chats.atlasMentions(id)` is `['atlas-mentions', id]`, outside the `['chats', id]` prefix, with `queryKeys.chats.atlasMentionLists` so the `atlas` topic can refresh every chat's chips with one prefix. Overlap lists have their own prefix, `queryKeys.atlas.overlapLists`.
- **Log type** `ATLAS_ENTRY_IMAGE`, in `IMAGE_SPEND_LOG_TYPES` and the LLM inspector.
- **UI departures.** The sidebar's default container with no chat project is Quilltap General. Rows show the current picture's thumbnail, falling back to the `atlas` icon. The editor has no metadata field (existing metadata is kept). Overlap notices show for saved entries only. The shared folder-browser pieces gained proper pluralisation (`pluralWord` / `pluralize` in `lib/folder-browser/view.ts`).
- **Saving a picture to a store** (added after the first cut): `SaveImageDialog`'s `SaveImageTarget` has an `atlas` kind, and the three item doors (wardrobe, inventory, atlas) share `itemImagesUrl`, so `ItemImageViewer` offers Save for every kind.
- **Not done.** The live acceptance run of §8 on V4test has not been made; the unit suites cover §8's logic (scenarios 1–3, 5, 6, 8–12 by test; 4, 7 and 13 by construction).
