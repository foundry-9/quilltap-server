# Feature: Scenarios from anywhere — one location, a source pointer, and a browser

**Status:** Approved 2026-10-12; built 2026-10-12 (see §7, As built).
**Owner subsystems:** The Salon (both pickers), The Scriptorium (the stores scenarios live in), Aurora (character vaults), Prospero (project stores).
**Companion spec:** [wardrobe-folders.md](wardrobe-folders.md) was written the same day and shares nothing but the author; build them in either order.
**Implementation note:** This spec is written to be executed by Claude Code. Follow the CLAUDE.md standing rules throughout: changelog entry, help docs with `url` + In-Chat Navigation, debug logging on every touched backend path, `qt-*` classes not raw Tailwind, `npx tsc` not `npm run build`, DDL.md and `qtap-export.schema.json` kept current, migrations with a `PRETTY_LABELS` entry and `reportProgress`. The decisions in §2 were settled with the operator before this spec was written. **Do not reopen them.**

---

## 1. The feature in one paragraph

Today the scenario picker on the New Chat form and on the Salon's in-chat **Change scenario** control offers exactly the scenarios in a chat's own hierarchy: the project's, the groups the cast belongs to, the (single) character's, and Quilltap General. That default stays. Beside **Custom…** the picker gains **Browse all scenarios…**, which opens a dialog listing every scenario in the instance — every character vault, every project, every group, and General — searchable, with a preview, so a scene written for one project or one character can be plucked into any chat. A pick of any kind now also records *where it came from*: the chat keeps a source pointer beside its resolved text, so the in-chat control can say "From: *Project Blackwood* › *The Reading Room*", notice when that file has since changed, and offer to reload it. Under the hood the four hand-rolled tier modules are folded behind one `resolveScenarioLocation`, modelled on the wardrobe's `resolveWardrobeLocation`, so that "a scenario somewhere" is one thing the server knows how to address.

## 2. Decisions of record

| Question | Decision |
|---|---|
| Reach of "anywhere" | **Every owner of the four kinds:** every live character's vault, every project's official store, every group's official store, and General. Not linked (non-official) project or group stores, and not arbitrary Scriptorium stores. A `scenarioRef` whose mount is none of these is refused with 400. |
| Provenance | **Store a source pointer for every preset pick.** New chat columns `scenarioSource` (JSON `{ mountPointId, path, bodySha256 }`) and `scenarioNotes` (the free text layered beneath the preset). `scenarioText` stays the one thing the prompt reads; the two new fields are the recipe that produced it. Existing chats have null source and keep today's match-by-body inference as the fallback. |
| Picker UI | **Keep the native select; add `Browse all scenarios…`.** The select is unchanged for the default hierarchy. The new entry opens `ScenarioBrowserDialog`. A pick from outside the hierarchy appears in the select under an **Elsewhere** optgroup as a single option labelled *Owner › Name*. A pick that happens to be inside the hierarchy snaps to its native kind and group. |
| Consolidation | **Yes: `resolveScenarioLocation`** in a new `lib/scenarios/` module, with the four per-tier modules reduced to thin wrappers (or deleted where nothing but the location needs them). The "everywhere" lister and the `scenarioRef` resolver are consumers of the location, never a fifth code path. |
| Selection wire format | The existing four pointer fields (`scenarioId`, `projectScenarioPath`, `groupScenarioPath` + `groupScenarioGroupId`, `generalScenarioPath`) **stay accepted**. One new field, `scenarioRef: { mountPointId, path }`, carries a browser pick. Server-side, every kind is converted to a `ScenarioRef` and resolved through the location; the resolver returns `{ scenarioText, scenarioSource, scenarioNotes }`. |
| Precedence | Unchanged on the server: `scenarioRef` is resolved first (it is the most specific), then `scenarioId` > project > group > general, each failing soft to the next. |
| New Chat form state | **One selection, not four fields.** `NewChatFormState` holds a single `scenarioSelection: ScenarioSelection`; the four pointer fields are removed. Display and submit then agree by construction (today they disagree — see §4). Seeding follows the server chain: character default > project default > general default. |
| "Reload from source" | Offered in the in-chat control when the source file still exists and its body hash differs from `scenarioSource.bodySha256`. Reload recomputes `scenarioText = combineScenarioText(newBody, scenarioNotes)` through the ordinary `?action=scenario` path, so the Host's revision announcement and the identity-stack recompile happen as for any change. |
| Bodies in the lister | **Not included.** The "everywhere" list carries name, description, flags and a 240-character excerpt per scenario; the dialog fetches the full body for the highlighted row. |
| Scenario Builder | Untouched. Its mount pool and `SaveScenarioDialog` already know all four kinds of owner. |
| Realtime | No new topic. The browser dialog fetches on open with `staleTime: 0`; nothing polls. |

## 3. Vocabulary

- **Scenario location** — `{ scope, id, mountPointId, ownerName }` plus read/write methods for one owner's `Scenarios/` folder. Scopes are `character | project | group | general`.
- **Scenario ref** — `{ mountPointId, path }`: the universal pointer to one scenario file. `path` is always `Scenarios/<file>.md`, validated by `resolveScenarioPath` (no `..`, no `//`, no nesting).
- **Source** — a ref plus the SHA-256 of the body at pick time, stored on the chat.
- **Hierarchy** — the sources the picker shows without browsing: project, cast groups, single character, General. Unchanged.
- **Elsewhere** — a source outside the hierarchy, reachable only through the browser.

## 4. What already exists (read before building)

- **Four tier modules, one set of primitives.** `lib/mount-index/scenarios-common.ts` holds the file IO (`parseScenarioDoc` :134, `listScenariosInFolder` :192, `readScenarioByPath` :256, `resolveScenarioBody` :275, `setScenarioDefaultInFolder` :312, `buildScenarioFileContent` :366, `resolveScenarioPath` :397) and the request schemas (:57–79). `general-scenarios.ts`, `project-scenarios.ts`, `group-scenarios.ts` wrap them per owner; `lib/mount-index/ensure-owner-store.ts:41` finds or creates a project's / group's official store; `lib/startup/ensure-project-scenarios.ts` and `ensure-group-scenarios.ts` heal folders at boot.
- **The character tier is different.** Files are written by `buildScenarioFile` (`lib/mount-index/character-vault.ts:255`): frontmatter carries only `description` / `archived`, the title is a `# Heading`. The vault overlay re-projects the whole `character.scenarios` array over `Scenarios/` on every write (`vault-overlay/managed-fields.ts`), ids are `stableUuidFromString('scenario:<mountPointId>:<relativePath>')` (`vault-overlay/parsers.ts:557`), and the character's own default is the column `characters.defaultScenarioId`. Writes go through `charactersRepository.addScenario` and friends (`characters.repository.ts:869`). The id being path-derived is what makes a `ScenarioRef` work for this tier too: ref → id is a pure function.
- **Server resolution.** `resolveScenarioSelection` (`lib/chat/scenario-selection.ts:119`) walks `scenarioId` > project > group > general, project and group through `resolveStoreScenarioTier` (:69), then `combineScenarioText(preset, freeText)` (`lib/chat/scenario-text.ts:17`). Callers: `app/api/v1/chats/route.ts:1218` (create; schema :101–126) and `app/api/v1/chats/[id]/actions/scenario.ts:83` (`?action=scenario`; schema `setScenarioSchema`, `app/api/v1/chats/[id]/schemas.ts:44`). The scenario action recompiles identity stacks and posts `postHostScenarioRevisionAnnouncement`.
- **Client assembly.** There is no server-side "all tiers" endpoint. `useNewChat.ts` fetches General (:272), project (:280) and the group union (`GET /api/v1/groups/scenarios?characterIds=`, :292) with plain `fetch`; the character tier comes from `character.scenarios` when exactly one LLM character is cast (`NewChatForm.tsx:188–205`). `ChatScenarioControl.tsx` (~:120–168) fetches the same four with TanStack (`queryKeys.scenarios.*`, `lib/query/keys.ts:84–95`) and infers the current pick by body match in the order project, General, group, character (:182–209).
- **The display / submit disagreement.** `NewChatForm.tsx:229–264` shows the selection in the order project, General, group, character; `useNewChat.ts:847–857` submits one pointer in the order `scenarioId`, project, group, general. When a character default and a project default are both seeded (`useNewChat.ts:483–496, 591–623`), the form shows the project's scene and sends the character's. The server has always applied the character's. §2's "one selection" decision removes the second code path; §6.4 fixes the seed order to match what was actually being applied.
- **Wire types.** `components/scenario/types.ts`: `ScenarioSelection` (:123), `scenarioSelectionToValue` / `scenarioValueToSelection` / `scenarioSelectionToPayload` (:180), `ScenarioOption` (:32), `GroupScenarioOption`. `components/scenario/ScenarioSelect.tsx:69` renders Custom…, Project, General, one optgroup per group, Character.
- **The model that already does this for the wardrobe.** `resolveWardrobeLocation` (`lib/wardrobe/location.ts:140`): `(scope, id, repos, userId, { ensure })` → `WardrobeLocation | null`, with `ensure` only when a write is coming. `locationKey = scope:mountPointId`. Copy its shape, its logging, and its "a read probe never provisions" rule.
- **Export / backup / restore.** `chats.scenarioText` is in `qtap-export.schema.json:540` and travels through `lib/import/quilltap-import/import-entities.ts`. Mount-point ids are remapped on import and restore (`lib/backup/restore/uuid-remap.ts`); any new column holding a mount id must be registered there. Backup dumps whole tables.
- **Docs that describe today.** `docs/developer/features/complete/scenario-append-plan.md` (notes beneath a preset), `groups.md` §6/§13 (the group-union exception), `help/general-scenarios.md`, `help/project-scenarios.md`, `help/groups.md:35–39, 95–97`, `help/chats.md`.

## 5. Design

### 5.1 `lib/scenarios/location.ts` — the chokepoint

```ts
export const ScenarioScopeSchema = z.enum(['character', 'project', 'group', 'general']);
export type ScenarioScope = z.infer<typeof ScenarioScopeSchema>;

export interface ScenarioRef { mountPointId: string; path: string }   // path = 'Scenarios/<file>.md'

export interface ScenarioLocation {
  scope: ScenarioScope;
  /** Owner id; null for General. */
  id: string | null;
  mountPointId: string;
  /** Display name of the owner: character name, project name, group name, 'Quilltap General'. */
  ownerName: string;
  list(opts?: { includeArchived?: boolean }): Promise<ListScenariosResult>;
  read(path: string): Promise<ParsedScenario | null>;
  /** Body only; ignores `archived` (a chat whose scene was archived mid-life keeps resolving). */
  resolveBody(path: string): Promise<string | null>;
  create(input: CreateScenarioInput): Promise<ParsedScenario>;
  update(path: string, patch: UpdateScenarioInput): Promise<ParsedScenario>;
  rename(path: string, filename: string): Promise<ParsedScenario>;
  delete(path: string): Promise<void>;
  setDefault(path: string | null): Promise<void>;
  /** The id a character-tier scenario carries (`stableUuidFromString('scenario:…')`); null for other scopes. */
  idForPath(path: string): string | null;
}

export async function resolveScenarioLocation(
  scope: ScenarioScope, id: string | null | undefined,
  repos: RepositoryContainer, userId: string,
  opts?: { ensure?: boolean },
): Promise<ScenarioLocation | null>;

/** Which owner a mount belongs to, or null when it is none of the four kinds. */
export async function classifyScenarioMount(
  mountPointId: string, repos: RepositoryContainer, userId: string,
): Promise<{ scope: ScenarioScope; id: string | null } | null>;

/** Ref → location (via classify) and the parsed scenario. Null when the mount is not a scenario owner or the file is missing. */
export async function resolveScenarioRef(
  ref: ScenarioRef, repos: RepositoryContainer, userId: string,
): Promise<{ location: ScenarioLocation; scenario: ParsedScenario } | null>;
```

Rules:

- **Resolution per scope** mirrors the wardrobe: `general` → `getGeneralMountPointId()`; `character` → `repos.characters.findByIdRaw(id)` (raw, so a broken vault costs a null rather than a throw), owner-checked, `characterDocumentMountPointId`; `project` / `group` → `officialMountPointId`, or `ensureOwnerOfficialStore` when `ensure`. `ensure` also runs the folder heal (`ensureFolderPath(mountPointId, 'Scenarios')`). A read never provisions.
- **The character tier's methods delegate to the characters repository** (`addScenario` / update / delete / `setDefaultScenario`) rather than writing files, because the overlay re-projects the whole array and would otherwise delete a file it did not write. `list` maps `character.scenarios[]` onto `ParsedScenario` (`path = 'Scenarios/' + sanitizeFileName(title) + '.md'` — the same function the overlay uses to name the file, so the path round-trips; `isDefault = id === character.defaultScenarioId`; `name = title`; `body = content`). `read(path)` / `resolveBody(path)` find the entry whose `idForPath(path)` matches. This keeps the vault projection the single writer.
- **`classifyScenarioMount`** does four indexed lookups: General id equality, `characters.findByMountPointId` (add a raw read if none exists; `characterDocumentMountPointId` is indexed per DDL.md), `projects.findByOfficialMountPointId`, `groups.findByOfficialMountPointId` (add the two raw finders). Archived characters are tombstones: a mount belonging to an archived character classifies as null.
- **Validation of a ref's path** is `resolveScenarioPath` from `scenarios-common.ts`; anything outside `Scenarios/` is a 400 before any store read.
- **Logging:** `[ScenarioLocation]` debug on every resolve (scope, id, ensure, found, mountPointId), warn on every refused ref with the reason.

**The per-tier modules** (`general-scenarios.ts`, `project-scenarios.ts`, `group-scenarios.ts`) become re-exports over the location or are deleted; the startup heals call `resolveScenarioLocation(scope, id, repos, userId, { ensure: true })`. The item-route factory (`lib/mount-index/scenario-item-route-factory.ts`) and the three collection routes call location methods. `resolveStoreScenarioTier` in `scenario-selection.ts` is deleted.

### 5.2 `resolveScenarioSelection` returns a recipe

```ts
export interface ResolvedScenario {
  scenarioText: string | null;
  scenarioSource: ScenarioSource | null;   // { mountPointId, path, bodySha256 }
  scenarioNotes: string | null;
}
```

- Input fields gain `scenarioRef?: ScenarioRef`. Order: `scenarioRef`, then the legacy four as today. Each legacy kind is turned into a `ScenarioRef` through its location (`scenarioId` → the character location's path for that id; project/group/general → `{ officialMountPointId | general, path }`), so after the first step every kind is the same thing.
- `bodySha256` is `createHash('sha256')` of the body **as resolved** (after frontmatter stripping, before `combineScenarioText`).
- `scenarioNotes` is the request's `scenario` free text, or null when empty. With no preset, `scenarioText = notes`, `scenarioSource = null`, `scenarioNotes = null` (a custom scene is wholly its text; nothing to reload).
- Both callers write all three columns together. Nothing else writes them. The chat create path writes them on the same `chats.create`; the scenario action writes them on the same `chats.update` it already does for `scenarioText`, and its no-op check compares all three.

### 5.3 Schema, migration, export

- **`ChatMetadataSchema`** (`lib/schemas/chat.types.ts`, beside `scenarioText` :892): `scenarioSource: ScenarioSourceSchema.nullable().optional()` (object `{ mountPointId: UUID, path: string.max(500), bodySha256: string.length(64) }`) and `scenarioNotes: z.string().nullable().optional()`. Mirror in `ChatMetadataBaseSchema` (:1201).
- **Columns:** `chats.scenarioSource TEXT DEFAULT NULL` (JSON), `chats.scenarioNotes TEXT DEFAULT NULL`. Migration `add-chat-scenario-source-v1` in `migrations/scripts/` + `index.ts`: two `ALTER TABLE ADD COLUMN`, no backfill (null source means "inferred", see §5.6), `PRETTY_LABELS` entry ("Noting where each chat's scene was found") and no loop, so no `reportProgress`. Update DDL.md.
- **Export:** both fields join the chat object in `public/schemas/qtap-export.schema.json` and the NDJSON writer; the importer reads them and **remaps `scenarioSource.mountPointId`** through the same table `uuid-remap.ts` uses for mount ids on import and restore. A source whose mount did not come across (e.g. a chat-only export) is dropped to null on import, with a debug log, never left dangling. Backup: whole-table dump, nothing to do. SillyTavern export: not represented.
- **Repository:** no patch-only treatment is needed — the three fields are always written together with `scenarioText`, which is already a plain metadata field.

### 5.4 The "everywhere" lister

`GET /api/v1/scenarios?action=everywhere[&includeArchived=true]` (the existing General collection route gains the action via `withCollectionActionDispatch`):

```ts
{
  sources: Array<{
    scope: ScenarioScope; id: string | null; name: string; mountPointId: string;
    scenarios: Array<{
      path: string; filename: string; name: string; description?: string;
      isDefault: boolean; archived: boolean; excerpt: string;   // first 240 chars of the body, whitespace-collapsed
      updatedAt: string;
    }>;
    warnings: string[];
  }>
}
```

- Sources are ordered General, projects (A–Z), groups (A–Z), characters (A–Z). Sources with no scenarios are **included** (the tree shows them greyed, so the user learns there is nothing there rather than wondering) — but only owners that *have* a store; a project without an official store is skipped, never provisioned.
- **Four queries, not four-hundred.** Collect every owner's mount id first, then call `repos.docMountDocuments.findManyByMountPointsInFolder(allMountIds, 'Scenarios', '.md')` **once** and bucket the rows by `mountPointId`; parse with `parseScenarioDoc` for the three store tiers and the vault parser for character mounts (the location knows which parser its scope needs — expose `location.parse(doc)` or a static `parseForScope(scope, doc)`). Characters are read through `findAllRaw` or the equivalent slim read, never a full hydration per character. Log the mount count and row count at debug.
- `GET /api/v1/scenarios?action=read&mountPointId=&path=` returns the full `ParsedScenario` (with body) for one ref, through `resolveScenarioRef`. The browser's preview pane uses it; so does anything else that needs a body from a ref.
- Query keys: `queryKeys.scenarios.everywhere(includeArchived)` and `queryKeys.scenarios.ref(mountPointId, path)`. Both prefix-invalidate under `scenarios.all`, which every scenario mutation already sweeps.

### 5.5 The browser dialog

`components/scenario/ScenarioBrowserDialog.tsx`, a `BaseModal` (portalled, as every workspace overlay must be), opened by the select's new **Browse all scenarios…** entry (`value = '__browse__'`; `scenarioValueToSelection` must treat it as "open the dialog", not as a selection — give `ScenarioSelect` an `onBrowse` prop and intercept it before `onChange`).

Layout (desktop: two columns; under 640 px they stack, sources above results):

- **Top bar:** a search box ("Search every shelf…"), a **Show archived** checkbox.
- **Left — sources:** four collapsible sections *General*, *Projects*, *Groups*, *Characters*, each row an owner with its scenario count; a row with zero is greyed. Clicking a row shows its scenarios on the right. Sources already in the chat's hierarchy carry a small chip "in this chat" so the user can tell plucking from browsing.
- **Right — results:** rows with name, description, *default* / *archived* chips, and the owner's name when the search spans all sources (searching ignores the selected source and matches name, description, excerpt, and owner name, case-insensitive). Arrow keys move the highlight; Enter uses.
- **Preview:** below the results (or beside, when wide), the highlighted scenario's full body rendered as Markdown, fetched with `scenarios.ref` on highlight and cached.
- **Footer:** Cancel, **Use this scenario** (primary, disabled until a row is highlighted).

On **Use**:

- If the pick's `mountPointId` + `path` is in the chat's hierarchy, `onPick` is called with the native kind (`project` / `group` / `general` / `character`), so the select shows it under its usual group.
- Otherwise `onPick({ kind: 'store', mountPointId, path, label: '<Owner> › <Name>' })`. `ScenarioSelection` gains that variant; `scenarioSelectionToValue` encodes it as `store:<mountPointId>:<path>`; `ScenarioSelect` renders an **Elsewhere** optgroup holding exactly the current store pick (the label travels in the selection so the select needs no second fetch). `scenarioSelectionToPayload` maps it to `{ scenarioRef: { mountPointId, path } }`.

Copy, in the house voice, sparingly: dialog title **"Every scene on every shelf"**; empty search **"Nothing on that shelf answers to the name."**; the greyed-source hint **"Nothing filed here yet."**

### 5.6 Provenance in the in-chat control

`ChatScenarioControl.tsx`:

- `GET /api/v1/chats/[id]?action=scenario-source` returns `{ source: ScenarioSource | null, owner: { scope, id, name } | null, exists: boolean, changed: boolean, notes: string | null }`. `changed` is `sha256(current file body) !== source.bodySha256`; `exists` false when `resolveScenarioRef` is null. Query key `queryKeys.chats.scenarioSource(chatId)`, invalidated whenever the chat's scenario changes (the `chats` realtime topic already invalidates chat detail; add this key to its row in `lib/realtime/topic-map.ts`).
- With a source: the control's current-selection derivation uses it (native kind when in the hierarchy, else the `store` variant with `label = owner.name › scenario.name`) and **stops body-matching**. Without a source (older chats, custom scenes): today's inference stays, byte for byte.
- A provenance line under the select: **"From: *Owner* › *Name*"**; when `changed`, append **"— the shelf copy has been revised"** and a **Reload from source** button that POSTs `?action=scenario` with `{ scenarioRef: source, scenario: notes }`. When `!exists`: **"— the shelf copy is gone"**, no button; the chat's text is unaffected.
- The custom text box now edits `scenarioNotes` when a preset is chosen (today it is hidden unless Custom). Show it beneath the preset preview as **"Notes beneath the scene"** — this is what `scenario-append-plan.md` always intended and it is what makes reload lossless.

### 5.7 New Chat form

- `NewChatFormState` drops `scenarioId`, `projectScenarioPath`, `generalScenarioPath`, `groupScenarioPath`, `groupScenarioGroupId` for `scenarioSelection: ScenarioSelection`. `useNewChat`'s submit calls `scenarioSelectionToPayload(state.scenarioSelection)` and spreads it; `scenario` (notes) is unchanged.
- Seeding (`useNewChat.ts:483–496, 591–623`) sets `scenarioSelection` once, in the order character default > project default > general default. Group defaults are not seeded (as today). Changing the cast or project re-seeds **only if** the user has not touched the picker (track a `scenarioTouched` flag, cleared on reset).
- `NewChatForm`'s display derivation (:229–264) is deleted; it renders `state.scenarioSelection`.
- Tier fetching in `useNewChat` stays as it is (plain `fetch`); migrating it to TanStack is out of scope. The browser dialog, mounted from `NewChatForm`, uses TanStack as every new component does.

### 5.8 Not in this version

- Scenarios from linked (non-official) stores or arbitrary Scriptorium stores.
- A `scenarios` realtime topic.
- Editing a scenario from inside the browser (the shelves already do that).
- Backfilling `scenarioSource` for existing chats.
- Moving `useNewChat`'s tier fetches to TanStack.

## 6. Work, in order

Each phase ends with `npx tsc`, `npm run lint`, the touched unit suites, and the walkthrough items named.

### Phase A — the location (server only, no behaviour change)

1. `lib/scenarios/location.ts` per §5.1, with `classifyScenarioMount`, `resolveScenarioRef`, the two new raw finders on the project and group repositories and one on characters.
2. Re-point the three collection routes, the item-route factory, the character scenarios route, the startup heals, the group-union route, and `resolveScenarioSelection` at the location. Delete `resolveStoreScenarioTier`. Reduce the per-tier modules to re-exports or delete them (grep for every importer first; the Almanack's `phase4-scriptorium.ts` and the path resolver's comment reference the folder constants).
3. Tests: `lib/scenarios/__tests__/location.test.ts` — each scope resolves, `ensure` provisions only on write, a read probe never provisions, an archived character classifies null, a linked store classifies null, a path outside `Scenarios/` is refused, character `idForPath` round-trips with the overlay's file naming.
4. Walkthrough on V4test: the three shelves and the character editor still list, create, rename, archive, default, and delete.

### Phase B — the source pointer

1. Schema fields, migration, DDL.md, export schema, NDJSON writer, importer with mount-id remap, restore remap (§5.3).
2. `resolveScenarioSelection` returns the recipe (§5.2); both callers write all three fields; the scenario action's no-op check compares all three.
3. `?action=scenario-source` and its query key; topic-map row.
4. Tests: resolver returns the source for each kind; a `scenarioRef` outside the four kinds is 400; export → import round-trips the source with a remapped mount id; a source whose mount is absent imports as null.

### Phase C — the lister and the browser

1. `?action=everywhere` and `?action=read` (§5.4), query keys.
2. `ScenarioSelection` `store` variant, encode/decode/payload, **Elsewhere** optgroup, `onBrowse` on `ScenarioSelect`.
3. `ScenarioBrowserDialog` (§5.5), mounted from both `NewChatForm` and `ChatScenarioControl`.
4. Tests: lister buckets one query's rows by mount and skips storeless owners; search spans sources; a hierarchy pick snaps to its native kind; a store pick encodes and decodes.

### Phase D — the two surfaces

1. New Chat: single `scenarioSelection` state, seed order, `scenarioTouched` (§5.7).
2. In-chat: provenance line, reload, notes-beneath-the-scene box, source-driven current selection (§5.6).
3. Tests: `NewChatForm` shows what `useNewChat` submits when a character default and a project default coexist (the regression for §4's disagreement); `ChatScenarioControl` prefers the source over body matching and falls back when the source is null.
4. Walkthrough on V4test: create a chat from a project with a browsed character scenario; confirm the Host's announcement, the provenance line, edit the file on its shelf, see "revised", reload, confirm notes survive; export the chat and import it into a scratch instance.

### Phase E — docs

- `help/scenario-browser.md` (new; `url: /salon/new`), updates to `help/general-scenarios.md`, `help/project-scenarios.md`, `help/groups.md`, `help/chats.md` (the provenance line and reload), `docs/CHANGELOG.md`, DDL.md, `docs/developer/API.md` (three new actions, one new field), and a CLAUDE.md chokepoint line: *"A scenario is addressed through `resolveScenarioLocation` / `resolveScenarioRef` (`lib/scenarios/location.ts`); the four tiers are scopes of one location, never separate code paths, and `chats.scenarioSource` / `scenarioNotes` are written only beside `scenarioText` by `resolveScenarioSelection`'s two callers."* Move this spec to `features/complete/` with an "As built" section.

## 7. As built

Built as specified, phases A–E. Where the build departs from or sharpens the text above:

- **Module layout.** `lib/scenarios/location.ts` (the location, `classifyScenarioMount`, `lookupScenarioRef`, `parseScenarioForScope`, `characterScenarioIdForPath`), `lib/scenarios/everywhere.ts` (the lister), `lib/scenarios/source-remap.ts` (client-safe import/restore remap). `general-scenarios.ts`, `project-scenarios.ts` and `group-scenarios.ts` are **deleted**; the group tier's `Knowledge/` folder helper moved to `lib/mount-index/group-knowledge.ts`. `resolveStoreScenarioTier` is gone.
- **`lookupScenarioRef`** replaces §5.1's `resolveScenarioRef` and returns `ok | missing | refused`, so callers can tell a 400 (bad path, or a mount that is no scenario owner) from a file that has merely gone. `resolveScenarioSelection` throws `ScenarioRefRefusedError` for the former (both routes map it to 400) and fails soft on the latter.
- **The character location is read-only** (review of PR 86). Nothing wrote through it — character scenarios are written by `/api/v1/characters/[id]/scenarios` through the characters repository — so its write methods, `resolveBody`, `resolveScenarioRef`, and the test-only `listScenariosInFolder` / `readScenarioByPath` / `resolveScenarioBody` in `scenarios-common.ts` were removed. Writes live on `StoreScenarioLocation` (General, project, group); `resolveScenarioLocation` is overloaded so a store scope returns one. `list` reads the vault's `Scenarios/` documents directly with the vault parser (`parseScenarioFile`), so paths are the files' real paths, and the default comes from the row's `defaultScenarioId`. Archived (and other users') characters resolve and classify as null.
- **An ordinary save keeps the scene** (review of PR 86). `?action=scenario` takes `reload?: boolean`. Without it, a request that resolves to the chat's own source file, revised since it was picked, keeps the stored preset body (`keepCurrentScene`, via `recoverPresetBody` and the source hash) with the new notes beneath. "Reload from source" sends `reload: true` and is the only way to pull in the revision.
- **Raw finders.** `characters.findByDocumentMountPointIdRaw`; `findByOfficialMountPointIdRaw` lives once on `AbstractStoreBackedRepository`, so projects and groups share it.
- **Routes.** `lib/mount-index/scenario-item-route-factory.ts` now serves General as well as projects and groups, and gained `createScenarioCollectionBodies` (list + create); all six route files are thin configs. The character scenarios route (`/api/v1/characters/[id]/scenarios`) is unchanged — it is id-addressed and already writes through the repository, which is exactly what the location's character tier delegates to.
- **Startup heals** call `resolveScenarioLocation(scope, id, repos, SINGLE_USER_ID, { ensure: true })`; their result is `{ total, provisioned, healed, failed }` — provisioned when no store was recorded, healed when a stale pointer was replaced, failed when no store resolved or a folder could not be created (an `ensure: true` folder failure is rethrown, not swallowed).
- **Item routes** repair folders on writes only: PUT, rename and DELETE resolve with `ensure: true` once the store is known to exist (plus the group's `Knowledge/` via `afterEnsure`); GET stays a probe, and an owner with no store is still a 404 rather than a freshly minted store.
- **One row read per character ref.** `lookupScenarioRef` builds a character's location from the row it read to classify the mount, and the location reads `defaultScenarioId` from that row.
- **`ScenarioRefSchema` / `ScenarioSourceSchema`** live in `lib/schemas/chat.types.ts` (client-safe); the location re-exports the ref schema.
- **No-op check.** `?action=scenario` compares text, source and notes (`sameResolvedScenario`). A change of provenance or notes that leaves the text byte-identical is written but neither recompiles nor announces — only the text reaches the prompt.
- **`?action=scenario-source`** also returns `scenarioName` (for the provenance line) and `scenarioId` (a character source's path-derived id, so the picker can show it under its native heading).
- **The lister** also returns `scenarioId` on character rows, which is how a browser pick of the chat's own character snaps to `{ kind: 'character' }`. Excerpts longer than 240 characters end in `…`.
- **Import.** Chats import before document stores, so the source's mount is remapped in `reconcileRelationships` (not the chat insert): mapped → new id; unmapped but already present in this instance → kept; otherwise → null. New-account restore remaps through the shared `UuidRemapper`.
- **New Chat seeding** is one effect in `useNewChat` over `seedScenarioSelection` (`components/new-chat/scenario-seed.ts`), re-run whenever the single LLM character's default or the project/general defaults change, until `scenarioTouched`. Continuation mode skips the character default. The project-default override note is shown only when the project default is the selection and the character has a default of its own.
- **Both pickers** now always render the dropdown (Browse is always worth offering). The in-chat control's text box is the notes under a preset and the whole scene under Custom; save always sends it as `scenario`.
