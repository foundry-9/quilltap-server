# Feature Plan: Collapse Projects into their Document Store

**Status:** Planned — design handoff for Claude Code
**Author:** Charlie (designed with Ariadne)
**Precedent:** `cutover-characters-to-vault-v1` (the 4.6 character-vault cutover) — this plan deliberately mirrors that mechanism. Read it first: `migrations/scripts/cutover-characters-to-vault.ts`, `lib/database/repositories/vault-overlay/`, and `lib/mount-index/character-vault.ts`.

---

## 1. Goal

Reduce a Project to almost nothing in the database. After this change a `projects` row holds only:

- `id` (UUID PK)
- `name` (TEXT, the one field that stays a real column)
- `officialMountPointId` (TEXT, pointer to the project's official document store)
- `createdAt`, `updatedAt` (timestamps — kept; sorting, sync, and import rely on them)

**Everything else moves into the project's official document store**, at the top level:

| Source field(s) | New home | Format |
| --- | --- | --- |
| `description` | `description.md` | Markdown body (no frontmatter) |
| `instructions` | `instructions.md` | Markdown body (no frontmatter) |
| `state` | `state.json` | the JSON object verbatim |
| `allowAnyCharacter`, `characterRoster`, `color`, `icon`, `defaultDisabledTools`, `defaultDisabledToolGroups`, `defaultAgentModeEnabled`, `defaultAvatarGenerationEnabled`, `defaultImageProfileId`, `defaultAlertCharactersOfLanternImages`, `storyBackgroundsEnabled`, `staticBackgroundImageId`, `storyBackgroundImageId`, `backgroundDisplayMode` | `properties.json` | one flat JSON object, keys = field names |

`userId` is **dropped entirely**. Projects become global to the instance (single-user-per-instance is the operating assumption). `ProjectsRepository` stops extending `UserOwnedBaseRepository`.

### Confirmed design decisions

1. **DB columns:** keep `id`, `name`, `officialMountPointId`, `createdAt`, `updatedAt`. Drop all others.
2. **Ownership:** dropped entirely. No `userId`. Remove user-scoping from the projects repo and every project API handler.
3. **Cutover style:** **hard cutover**, like characters. One migration writes the files, verifies them, and `DROP`s the columns in the same run behind a blocking gate. The store becomes the sole source of truth immediately.
4. **No-store fallback:** **hard error**. A read against a project with a null/unreadable `officialMountPointId` throws. This is treated as a broken invariant, not a routine state.

> ⚠️ **Tension to manage (decisions 3 + 4 vs. the character precedent).** The character overlay falls back *gracefully* to empty values when a vault file is missing. We are choosing the opposite: block. That is only safe if a project **always** has a usable store. Therefore the ensure-store path must be airtight — see §4. The migration must also guarantee every existing project has a populated store *before* it drops any column, or the instance bricks its own projects. The blocking gate in §6 enforces this.

---

## 2. Target schema

`lib/schemas/project.types.ts` — replace `ProjectSchema` with the slim DB shape plus separate schemas for the store-resident data. Follow the character-vault file split (`vault-overlay/schema.ts`) exactly.

```ts
// The DB row — the ONLY thing persisted as columns.
export const ProjectRowSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1).max(100),
  officialMountPointId: UUIDSchema.nullable().optional(), // null only mid-transition; reads block if unusable
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

// properties.json — the "everything else" bag. All optional, all defaulted.
export const ProjectPropertiesSchema = z.object({
  allowAnyCharacter: z.boolean().default(false),
  characterRoster: z.array(UUIDSchema).default([]),
  color: HexColorSchema.nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
  defaultDisabledTools: z.array(z.string()).default([]),
  defaultDisabledToolGroups: z.array(z.string()).default([]),
  defaultAgentModeEnabled: z.boolean().nullable().optional(),
  defaultAvatarGenerationEnabled: z.boolean().nullable().optional(),
  defaultImageProfileId: UUIDSchema.nullable().optional(),
  defaultAlertCharactersOfLanternImages: z.boolean().nullable().optional(),
  storyBackgroundsEnabled: z.boolean().nullable().optional(),
  staticBackgroundImageId: UUIDSchema.nullable().optional(),
  storyBackgroundImageId: UUIDSchema.nullable().optional(),
  backgroundDisplayMode: z.enum(['latest_chat', 'project', 'static', 'theme']).default('theme'),
});

// The hydrated, app-facing Project = row + description + instructions + state + properties.
// Keep the SHAPE identical to today's Project so most call sites don't change.
export const ProjectSchema = ProjectRowSchema.extend({
  description: z.string().max(2000).nullable().optional(),   // from description.md
  instructions: z.string().max(10000).nullable().optional(), // from instructions.md
  state: JsonSchema.default({}),                              // from state.json
}).merge(ProjectPropertiesSchema);

export type Project = z.infer<typeof ProjectSchema>;
export type ProjectRow = z.infer<typeof ProjectRowSchema>;
export type ProjectProperties = z.infer<typeof ProjectPropertiesSchema>;
```

Keeping the hydrated `Project` shape **field-identical** to today's is the single most important decision for limiting blast radius: the overlay re-assembles the old object so resolvers (agent-mode, image-profile, lantern, background), UI components, and tools keep reading `project.defaultImageProfileId` etc. unchanged. Only the *persistence* layer changes.

### Canonical path constants

Add a `lib/projects/project-store/schema.ts` (mirroring `vault-overlay/schema.ts`) exporting the canonical relative paths and the list used for batched reads:

```ts
export const PROJECT_DESCRIPTION_MD_PATH = 'description.md';
export const PROJECT_INSTRUCTIONS_MD_PATH = 'instructions.md';
export const PROJECT_STATE_JSON_PATH = 'state.json';
export const PROJECT_PROPERTIES_JSON_PATH = 'properties.json';

export const PROJECT_SINGLE_FILE_OVERLAY_PATHS = [
  PROJECT_DESCRIPTION_MD_PATH,
  PROJECT_INSTRUCTIONS_MD_PATH,
  PROJECT_STATE_JSON_PATH,
  PROJECT_PROPERTIES_JSON_PATH,
] as const;
```

Path lookups must be **case-insensitive** (reuse `docMountDocuments.findManyByMountPointsAndPath`, which already lowercases — see `doc-mount-documents.repository.ts`). So `Description.md` resolves too, matching the character `Manifesto.md` behavior.

---

## 3. The overlay (read + write) — the heart of the change

Create `lib/projects/project-store/` parallel to `lib/database/repositories/vault-overlay/`. It has three responsibilities, lifted directly from the character overlay:

### 3a. Read overlay — `read-overlay.ts`

`applyProjectStoreOverlay(rows: ProjectRow[]): Promise<Project[]>`

- Collect distinct `officialMountPointId`s.
- **One `IN(...)` query per path** via `docMountDocuments.findManyByMountPointsAndPath(mountPointIds, path)` for the four files in `PROJECT_SINGLE_FILE_OVERLAY_PATHS`. (Copy the batched pattern in `vault-overlay/read-overlay.ts` lines 48–130 — do **not** read files one project at a time.)
- For each row, assemble the hydrated `Project`:
  - `description` = `markdownToNullable(description.md)`
  - `instructions` = `markdownToNullable(instructions.md)`
  - `state` = `JSON.parse(state.json)` (default `{}` on absent file — but see the invariant below)
  - properties = `ProjectPropertiesSchema.parse(JSON.parse(properties.json))`, spread onto the object
- **Hard-error invariant (decision 4):** if a row's `officialMountPointId` is null, or the store read throws, or `properties.json` is missing/unparseable, **throw** a typed `ProjectStoreUnavailableError` rather than falling back to defaults. Log at `error`. (Contrast: the character overlay logs `warn` and returns DB values; we have no DB values to fall back to, so the empty-project silent failure is the thing we are refusing.)
- Wire `applyProjectStoreOverlay` into **every** repository read path (`findById`, `findAll`, `findByCharacterId`, etc.), exactly as `characters.repository.ts` calls `applyDocumentStoreOverlayOne` after `_findById`.

Add debug logs for: candidate count, mount-point count, per-path hit/miss counts, and every thrown invariant (`projectId`, `officialMountPointId`). The project requires debug logs on all touched backend paths.

### 3b. Write overlay — `write-overlay.ts`

`applyProjectStoreWriteOverlay(projectId, patch: Partial<Project>)`

When `repos.projects.update()` receives a patch:

- Split the patch into (a) `name` → still a column; (b) `description`/`instructions` → markdown files; (c) `state` → `state.json`; (d) any property key → merge into `properties.json` (read-modify-write the whole object).
- Write via `writeDatabaseDocument(officialMountPointId, relPath, content)` (`lib/mount-index/database-store.ts`).
- `properties.json` writes are **read-modify-write**: load current, merge patched keys, `ProjectPropertiesSchema.parse`, write back. Serialize concurrent writes per project with a promise chain (copy `wardrobe-sync.ts`'s `wardrobeSyncChains` map keyed by mountPointId) so two concurrent property updates can't clobber each other.
- If `officialMountPointId` is null at write time → throw `ProjectStoreUnavailableError` (same invariant).
- Background-jobs note: writes inside a forked job buffer through `getRepositories()`; document-store writes are already on the buffered write path (the doc-store partition in `write-partition.ts`). Confirm property writes flow through the buffer and land in the doc-store partition, not main, so a doc-store failure can't roll back unrelated writes. Add debug logs per write (`projectId`, path, byte length).

### 3c. Repository changes — `projects.repository.ts`

- Stop extending `UserOwnedBaseRepository`; extend the plain `BaseRepository` (or whatever the non-user-owned base is — check `base.repository.ts`). Remove `findByUserId` reliance.
- `_create`/`_update`/`_findById` operate only on the slim row. After every read, apply the read overlay; before/after every write, route through the write overlay.
- The roster helpers (`addToRoster`, `removeFromRoster`, `addManyToRoster`, `canCharacterParticipate`, `setAllowAnyCharacter`, `findByCharacterId`) currently read/write `characterRoster`/`allowAnyCharacter` as columns. Re-point them at the overlay: read the hydrated project, mutate the property, write it back through `applyProjectStoreWriteOverlay`. `findByCharacterId` can no longer use a SQL `$in` on the column — it must list projects and filter on the hydrated `characterRoster` (acceptable: project counts are small). Add a debug log noting the in-memory filter.
- Remove `userId` from all log lines and the `create` signature.

---

## 4. Store provisioning must be airtight (because of decision 4)

A project with no usable store now throws on read. So the store must exist for **every** project at **all** times outside a momentary creation window. There are already hooks for this — reuse them, don't reinvent:

- `ensureProjectOfficialStore()` (called from `app/api/v1/projects/route.ts` POST today) — must run **inside** project creation, before the project is returned, so a freshly created project is never storeless.
- A **startup backfill** (mirror `backfillCharacterVaults()`): on boot, for every project with a null `officialMountPointId`, create + populate the store. This is the self-heal for imports and any row that slipped through.
- **Import path** (`lib/import/quilltap-import/import-entities.ts`): after creating the project row, immediately ensure + populate the store from the imported file payloads (see §7). Do not leave a window where an imported project is readable but storeless.

Document in code comments that the null window is "creation-internal only" and any *read* observing null is a bug.

---

## 5. Schema/migration of the new file format

Two pieces of work:

1. **`add-project-official-mount-point-v1` already exists** (`migrations/scripts/add-project-official-mount-point.ts`, 4.10) and backfills `officialMountPointId` from `project_doc_mount_links`. The new cutover migration **depends on it** — declare the dependency so it runs after. Every project should already have a pointer by the time we cut over; the cutover handles any stragglers by ensuring a store.

2. **The cutover migration** (next section).

---

## 6. The cutover migration — `cutover-projects-to-store-v1`

Model it line-for-line on `cutover-characters-to-vault.ts`. ID: `cutover-projects-to-store-v1`.

Steps:

1. **Safety backup.** Call `ensureBackupsExist(ctx)` (same helper the character cutover uses). Refuse if no recent encrypted snapshot exists.
2. **Load raw project rows by direct SQL** (`SELECT * FROM projects`) — not through the schema-validating `findAll`, which would now reject the legacy wide rows. Map legacy rows by hand.
3. **Count guard.** Assert `rowCount === readCount`; abort before any destructive work on mismatch (the silent-no-op guard the character migration added).
4. **Per project, in a loop with `reportProgress(i + 1, total, 'projects')`:**
   - Ensure the store exists (`ensureProjectOfficialStore` equivalent); if it had to create one, that's fine.
   - Write `description.md` (from `description`, skip/blank if null), `instructions.md`, `state.json` (`JSON.stringify(state ?? {})`), and `properties.json` (assemble from the 14 property columns, `ProjectPropertiesSchema.parse`).
   - Re-list the store and **verify** all four files are present and `properties.json` parses. If any required file is missing → mark the project `blocked`.
5. **Blocking gate.** If *any* project is `blocked`, **do not drop columns.** Return failure with the offending project ids. Operator fixes and re-runs. (Identical to the character cutover's gate.)
6. **Drop columns in one transaction**, only after every project verified:
   ```
   COLUMNS_TO_DROP = [
     'userId', 'description', 'instructions', 'state',
     'allowAnyCharacter', 'characterRoster', 'color', 'icon',
     'defaultDisabledTools', 'defaultDisabledToolGroups',
     'defaultAgentModeEnabled', 'defaultAvatarGenerationEnabled',
     'defaultImageProfileId', 'defaultAlertCharactersOfLanternImages',
     'storyBackgroundsEnabled', 'staticBackgroundImageId',
     'storyBackgroundImageId', 'backgroundDisplayMode',
   ]
   ```
   Wrap in `db.transaction(() => { for (col of...) db.exec('ALTER TABLE projects DROP COLUMN ...') })`.
7. **Prettify label.** Add to `lib/startup/prettify.ts` in the project voice, e.g.:
   ```
   'cutover-projects-to-store-v1': 'Folding each project into its own document store for good',
   ```
8. **Register** in `migrations/scripts/index.ts`. Idempotent: a re-run on already-slim rows should detect the columns are gone and no-op cleanly.

---

## 7. Export / import / qtap schema / backups

Per the project rule that any data-shape change be reflected in exports.

- **`public/schemas/qtap-export.schema.json`** — `ExportedProject` currently lists all the wide fields. Decide the export shape:
  - Recommended: keep the **flat, hydrated** `ExportedProject` (all fields present) for human-readable, tool-compatible exports, and have export *read* from the store and import *write* to the store. This keeps `.qtap` files stable and portable even though the internal storage changed. Drop `userId` from the exported shape.
  - Update the JSON Schema accordingly and regenerate any derived types.
- **Export code** — read the hydrated project (overlay already does this) and serialize as today. Additionally include the store files if the export bundles document stores (`ExportedProjectDocMountLink` already exists).
- **Import code** (`import-entities.ts`) — after creating the slim row and ensuring the store (per §4), write `description.md`/`instructions.md`/`state.json`/`properties.json` from the imported fields. Remove the `userId` strip (no longer a field). Preserve conflict strategy (skip/overwrite/duplicate).
- **SillyTavern** import/export — projects aren't a first-class ST concept; confirm there's nothing to change, but check.
- **Backups** — `db backup` snapshots the encrypted DB, which now carries less; the store lives in the mount-index DB, which backups already cover. Verify the backup set still includes the mount-index DB (it does per CLAUDE.md). No code change expected; note it in the migration's verification.
- **DDL.md** — rewrite the `projects` table section to the slim 5-column form and note the moved data lives in the official document store. Required by project rules.

---

## 8. API surface (`app/api/v1/projects/`)

The hydrated `Project` shape is unchanged, so handler request/response *bodies* can stay the same. Changes:

- **Remove all `userId` / ownership checks** (`checkOwnership`, `project.userId !== context.userId` in `lib/tools/handlers/project-info-handler.ts`, etc.). Projects are global now.
- **POST create** — ensure store synchronously before returning (§4).
- **PUT/PATCH update** — unchanged body; persistence now flows through the write overlay automatically via `repos.projects.update`.
- **`actions/state.ts`** — `get/set/reset-state` now read/write `state.json` via the overlay. Should require no handler change if the overlay makes `project.state` behave as before.
- **`actions/tools.ts`, `actions/roster.ts`, `actions/background.ts`** — read/write properties via the overlay; verify each still works against the hydrated shape.
- The `?action=` dispatch structure stays.

---

## 9. Consumers to leave untouched (verify, don't edit)

Because the hydrated `Project` keeps its shape, these should keep working unchanged — but each must be smoke-tested:

- `lib/services/chat-message/agent-mode-resolver.service.ts` (`defaultAgentModeEnabled`)
- `lib/image-gen/profile-resolution.ts` (`defaultImageProfileId`)
- `lib/services/lantern-notifications/resolver.ts` (`defaultAlertCharactersOfLanternImages`)
- `app/api/v1/projects/[id]/actions/background.ts` and `ImageGenerationCard.tsx` (background fields)
- `lib/chat/first-message-context.ts` / `ProjectContextSchema` (description, instructions)
- `lib/tools/project-info-tool.ts` + `handlers/project-info-handler.ts` (description, instructions — but strip the `userId` ownership check)
- UI: `ProjectItem.tsx`, `ProjectDetailHeader.tsx`, `SettingsTab.tsx`, `CharactersTab.tsx`

---

## 10. Help docs & changelog

- **Help files** (`help/*.md`): any user-visible behavior change must be documented, in the steampunk/Wodehouse voice, with correct `url` frontmatter and a matching `help_navigate` call. The user-facing change here is mostly invisible (projects work the same), but the fact that a project's description/instructions/state now live as editable files in its document store *is* user-visible and worth a help note — users can now edit `description.md` directly in the Scriptorium.
- **CHANGELOG.md** (terse, plain American English — the documented exception to the house voice): record the schema collapse, the dropped `userId`, and the new file layout.

---

## 11. Build / verify checklist (for Claude Code)

1. `npx tsc` clean (not `npm run build`).
2. Jest: update/extend `projects.repository` tests; add overlay round-trip tests (write field → read hydrated project → values match); add the migration test; if a tool-definition snapshot touches projects, `npx jest -u`.
3. Migration dry-run: `npx quilltap migrations status` and `... run --dry-run`.
4. On a **backup copy** of an instance, run the migration and verify with `npx quilltap docs ls --mount <project store>` that the four files exist and `npx quilltap db schema projects` shows the slim 5-column table.
5. Round-trip an export → import on a scratch instance; confirm description/instructions/state/properties survive.
6. Tail `logs/combined.log` while exercising project create, edit, roster change, state set, and background change in the running dev server; confirm the new debug logs fire and no `ProjectStoreUnavailableError` appears in normal use.
7. Verify the startup backfill provisions a store for a deliberately storeless project row.

---

## 12. Suggested commit sequencing (Opus-plan / Haiku-agent friendly)

1. Schema + path constants + `ProjectStoreUnavailableError` (no behavior change yet).
2. Read overlay + repository read wiring.
3. Write overlay + repository write wiring + roster helper rework.
4. Store-provisioning hardening (create-time + startup backfill + import).
5. API ownership removal.
6. Export/import + qtap schema + DDL.md.
7. The cutover migration + prettify entry + index registration + migration test.
8. Help docs + CHANGELOG.

Each step should `npx tsc` clean and keep tests green before the next. The migration (step 7) lands last so the read/write overlay is proven against still-wide rows in dev before the columns are dropped.
