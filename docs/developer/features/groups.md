# Feature Plan: Groups

> Handoff plan for Claude Code. A "Group" is a cross-section of **characters** (parallel
> to how a Project is a cross-section of files/chats). Each group owns a designated
> document store, may link zero-or-more additional document stores, and exposes
> **Description, Scenarios, and Knowledge** exactly the way Quilltap General, Projects, and
> Characters already do — for new chats, Commonplace Book data, and search-tool usage.

## 0. Decisions already made (do not re-litigate)

These were settled with the product owner. Build to them.

1. **Scope is per responding character, not per chat.** A character belongs to zero-or-more
   groups. In any turn, the stores in scope for that character are the **union of the stores
   of every group the *responding* character is a member of**. A character never gains access
   to another participant's group stores. This is the one place Groups diverge from the
   Projects model (which is chat-scoped via `chat.projectId`).
2. **Mirror Projects exactly for store layout.** A group has an *official* document store
   holding `description.md`, a `Scenarios/` folder, and a `Knowledge/` folder, plus
   zero-or-more *additional linked* stores. Reuse the project store-overlay, scenario, and
   knowledge-injector machinery.
3. **Membership is access-only.** Group membership grants the character read/write to the
   group's stores and pulls its Description/Scenarios/Knowledge into context. It does **not**
   gate who may be added to a chat. There is no group roster enforcement.
4. **Full read/write for all members.** Any member character may create/edit/delete files in
   the group's primary *and* linked stores. Group-tier mounts are writable — unlike the
   read-only peer-vault (`participant`) tier in the doc-edit path resolver.

## 1. Architecture summary (what already exists, and what to reuse)

Groups are a near-clone of Projects. The reference implementation to mirror:

| Concern | Project reference | Group equivalent to build |
|---|---|---|
| Slim DB row + store overlay | `lib/schemas/project.types.ts` (`ProjectRowSchema`, `ProjectSchema`, `PROJECT_STORE_MANAGED_FIELDS`) | `lib/schemas/group.types.ts` |
| Repository (create provisions official store) | `lib/database/repositories/projects.repository.ts` | `lib/database/repositories/groups.repository.ts` |
| Official store provisioning | `lib/mount-index/ensure-project-store.ts`, `project-store-naming.ts` | `lib/mount-index/ensure-group-store.ts`, `group-store-naming.ts` |
| Read overlay (re-assemble from store files) | `lib/projects/project-store/read-overlay.ts` | `lib/groups/group-store/read-overlay.ts` |
| Store→entity link join table | `project_doc_mount_links` + `lib/database/repositories/project-doc-mount-links.repository.ts` | `group_doc_mount_links` + `group-doc-mount-links.repository.ts` |
| Scenarios in the official store | `lib/mount-index/project-scenarios.ts`, `lib/startup/ensure-project-scenarios.ts` | `lib/mount-index/group-scenarios.ts`, `lib/startup/ensure-group-scenarios.ts` |
| API routes (action dispatch) | `app/api/v1/projects/` | `app/api/v1/groups/` |
| Tier resolution (THE keystone) | `lib/mount-index/tiered-mount-pool.ts` | add a `group` tier (see §4) |
| Knowledge injection | `lib/chat/context/knowledge-injector.ts` | add group tier |
| Search tool | `lib/tools/handlers/search-scriptorium-handler.ts` | add group tier |
| Doc-edit write path | `lib/doc-edit/path-resolver.ts` | admit group mounts as **writable** |
| List UI | Prospero project list (`useProjects` hook, `ProjectsGrid`, `ProjectCard`) | Groups section on Aurora page |

**Two databases are in play.** The slim group row lives in the **main** DB (alongside
`projects`). The `group_doc_mount_links` and `group_character_members` join tables live in the
**mount-index** DB (`quilltap-mount-index.db`), co-located with mount data — exactly as
`project_doc_mount_links` does. Follow the `ProjectDocMountLinksRepository` pattern: override
`getCollection()` to route to the mount-index DB.

## 2. Data model

### 2.1 `lib/schemas/group.types.ts`

Mirror `project.types.ts`. Keep the row slim; route substantive content to the official store.

```ts
// GroupPropertiesSchema → persisted as properties.json in the official store.
// Start minimal; add fields only as the UI needs them.
export const GroupPropertiesSchema = z.object({
  color: HexColorSchema.nullable().optional(),
  icon: z.string().max(50).nullable().optional(),
});

// Slim DB row (main DB). Mirrors ProjectRowSchema.
export const GroupRowSchema = z.object({
  id: UUIDSchema,
  name: z.string().min(1).max(100),
  officialMountPointId: UUIDSchema.nullable().optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});

// Hydrated, app-facing shape (row + store files).
export const GroupSchema = GroupRowSchema.extend({
  description: z.string().max(2000).nullable().optional(), // description.md
  instructions: z.string().max(10000).nullable().optional(), // instructions.md (optional — see note)
  state: JsonSchema.default({}),                            // state.json
  ...GroupPropertiesSchema.shape,                            // properties.json
});

export const GROUP_STORE_MANAGED_FIELDS: ReadonlySet<keyof Group> = new Set([
  'description', 'instructions', 'state', 'color', 'icon',
]);
```

> **Note on `instructions`/`state`:** include them if you want full Project parity (cheap, and
> the overlay handles them for free). If the product owner only asked for Description +
> Scenarios + Knowledge, `instructions` and `state` can be omitted from the schema — but
> keeping them costs nothing and avoids a later migration. Recommend keeping them.

### 2.2 Membership: `group_character_members` (mount-index DB)

Characters↔groups is many-to-many. Use a join table, mirroring the `*_doc_mount_links`
convention rather than an array column on the character (keeps the character row untouched and
the M:N symmetric).

```ts
export const GroupCharacterMemberSchema = z.object({
  id: UUIDSchema,
  groupId: UUIDSchema,       // → groups.id in MAIN db (cross-db ref, like project_doc_mount_links)
  characterId: UUIDSchema,   // → characters.id in MAIN db
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
```

Repository `GroupCharacterMembersRepository` (mount-index-routed, copy
`ProjectDocMountLinksRepository`) with: `findByGroupId`, `findByCharacterId`,
`addMember(groupId, characterId)` (dedup-checked, like `.link()`), `removeMember(...)`.
`findByCharacterId` is the hot path for tier resolution — index `(characterId)`.

### 2.3 Store links: `group_doc_mount_links` (mount-index DB)

Direct copy of `ProjectDocMountLinkSchema` / `ProjectDocMountLinksRepository`, s/project/group/.
Methods: `findByGroupId`, `findByMountPointId`, `link`, `unlink`. The group's **official**
store is *not* recorded here — it lives on the group row as `officialMountPointId`, exactly as
Projects do. This table holds only the *additional linked* stores.

## 3. Migrations

Add to `migrations/scripts/` and register in `migrations/scripts/index.ts`. Each needs a
`PRETTY_LABELS` entry in `lib/startup/prettify.ts` (steampunk-Wodehouse voice), and any loop
over a collection needs `reportProgress(...)`.

1. **`create-groups-table-v1`** (main DB): create the slim `groups` table
   (`id`, `name`, `officialMountPointId`, `createdAt`, `updatedAt`) + index on `name`. Pure
   DDL; `shouldRun` checks `!sqliteTableExists('groups')`.
2. **`create-group-join-tables-v1`** (mount-index DB): create `group_doc_mount_links` and
   `group_character_members` with their indexes. Model the DB-open/ensure-table boilerplate on
   `provision-general-mount.ts` (`openMountIndexDb`, pragma key from
   `ENCRYPTION_MASTER_PEPPER`). Note: the join-table repos also self-create their tables on
   first `getCollection()` (as `ProjectDocMountLinksRepository` does), so this migration is
   belt-and-suspenders — still add it so a fresh instance has the tables before first use.

No data backfill is required (new feature, no legacy rows). Official stores are provisioned
lazily at group-create time and re-ensured on startup (§5).

## 4. The keystone: tier resolution (`lib/mount-index/tiered-mount-pool.ts`)

This is the only subtle part. Read `tiered-mount-pool.ts` fully before editing.

Today the pool has four tiers: `character` → `participant` → `project` → `global`, deduped by
`dedupeTierTriple` (precedence character > project > global) plus a participant tier. Groups add
a **`group` tier** that is **keyed on the responding character's memberships**, not on the chat.

### 4.1 Changes

- Extend `MountTier` to include `'group'`.
- Add `groupMountPointIds: string[]` to `TieredMountPool`.
- In `TierContext`, the responding `characterId` already exists — that's the key. Add nothing
  new to the context for the basic case.
- New resolver step inside `resolveTieredMountPool`, after the character vault and before/around
  the project tier:
  1. `const memberships = await repos.groupCharacterMembers.findByCharacterId(ctx.characterId)`
  2. For each `groupId`: collect the group's `officialMountPointId` (from
     `repos.groups.findByIdRaw`) **and** its linked stores
     (`repos.groupDocMountLinks.findByGroupId`).
  3. Union + dedup those mount ids → `groupMountPointIds`.
- Extend dedup precedence to: **character > participant > group > project > global**. A mount
  appearing in a closer tier is removed from `group`. Update `dedupeTierTriple` (or add a
  sibling `dedupeTiers` that handles the full set — prefer extending in place so the one-true
  dedup rule stays single-sourced, per the module's own doctrine).
- `flattenTierPool`: fold the group tier into `scope === 'all'`, and into a new
  `scope === 'group'` selection if/when search exposes it (see §6). For `scope === 'character'`
  and `scope === 'project'`, leave group out (group is its own scope).
- `classifyMountTier`: add the `group` branch in precedence order.
- Add a cheap helper `resolveGroupMountPointIdsForCharacter(characterId)` (parallels
  `resolveProjectMountPointIds`) for callers that only need the group tier.

### 4.2 Why per-character and not per-chat

`resolveTieredMountPool` is already called **once per responding character per turn** (the
search handler and knowledge injector pass `context.characterId`). So keying the group tier on
`ctx.characterId` requires **no new call-site plumbing** — the function already has what it
needs. This is why "responding character's own groups only" is the cheap, correct choice: it
falls out of the existing per-character invocation. Do **not** try to resolve groups from the
chat's participant set; that would leak group A's stores to a non-member in the same chat.

### 4.3 Degradation

Every group lookup must fail soft (catch → empty), exactly like the project lookup. A missing
group, an unprovisioned official store, or a degraded mount-index DB drops the tier rather than
throwing. Fire `logger.debug` for the resolved counts and `logger.warn` on lookup failure
(match the existing logging in this module — CLAUDE.md requires debug logging on touched backend
paths).

## 5. Official store provisioning & overlay

- **`lib/mount-index/ensure-group-store.ts`** — copy `ensure-project-store.ts`. Creates the
  group's official `documents`/`database` mount, sets `officialMountPointId` on the group row,
  ensures top-level `Scenarios/` and `Knowledge/` folders. Naming helper
  `group-store-naming.ts` (e.g. `Group Files: <name>`), mirroring `project-store-naming.ts`.
- **`GroupsRepository.create()`** — copy `ProjectsRepository.create()`: provision the official
  store first, then write the slim row with `officialMountPointId`, then populate
  `description.md` / `properties.json` via the store bridge. Strip `GROUP_STORE_MANAGED_FIELDS`
  before the row INSERT (copy `_create`/`_update` column-stripping).
- **Read overlay** `lib/groups/group-store/read-overlay.ts` — copy
  `lib/projects/project-store/read-overlay.ts`: re-hydrate `GroupSchema` from the slim row +
  store files. `findById` returns hydrated; `findByIdRaw` returns the slim row (the tier
  resolver uses `findByIdRaw` to avoid store reads on the hot path).
- **Startup re-ensure** `lib/startup/ensure-group-stores.ts` + `ensure-group-scenarios.ts` —
  copy the project equivalents; wire into the same startup sequence that calls
  `backfill-project-stores` / `ensure-project-scenarios`.

## 6. Context surfaces (Description / Scenarios / Knowledge)

Wire groups into each surface the same way projects are wired. In every case the entry key is
the **responding character's** group memberships (via the new group tier), never the chat.

- **Scenarios (New Chat dialog).** Groups contribute chat-starter scenarios from their official
  store's `Scenarios/` folder, the way General and Project scenarios are offered. Find where the
  New Chat dialog aggregates scenario sources and add the group source. The New Chat dialog
  **has the prospective participant list available** at scenario-fetch time — use it. **Decided
  behavior:** for every group that **any** selected participant belongs to, surface that group's
  scenarios, grouped under a heading **`Group Scenarios: {groupName}`**. A group's scenarios
  appear as long as *at least one* chat participant is a member — it does **not** matter that
  other participants aren't in the group. (This is a deliberate exception to the otherwise
  strict per-responding-character isolation: scenarios are a chat-creation-time menu, not a
  per-turn access grant, so a group's scenarios are offered to the whole New Chat dialog when a
  member is present. Per-turn Knowledge/search/write access remains responding-character-only
  per §4 — do not let this scenario rule leak into the tier resolver.) De-dup group headings if
  multiple participants share a group. Order: after General and Project scenarios, one
  `Group Scenarios: {groupName}` block per distinct group.
- **Knowledge injection** (`lib/chat/context/knowledge-injector.ts`). The injector runs scoped
  searches per tier for the responding character. Add a group tier that searches the
  `Knowledge/` folders of the responding character's group stores. It already receives
  `characterId`; resolve the group tier from the updated `resolveTieredMountPool`.
- **Search tool** (`lib/tools/handlers/search-scriptorium-handler.ts`). Already calls
  `resolveTieredMountPool({ characterId, projectId })` and flattens by `scope`. Once the pool
  carries `groupMountPointIds`, `scope: 'all'` includes them automatically. Optionally add an
  explicit `scope: 'group'` to the tool's input enum (`lib/tools/search-scriptorium-tool.ts`)
  so a character can search just its group knowledge. If you add the enum value: update the Zod
  input schema (single source of truth — never hand-edit the derived JSON), register/update the
  snapshot test (`lib/tools/__tests__/tool-definitions-snapshot.test.ts`,
  `npx jest -u ...`).
- **Commonplace Book (memory).** Memories are held by a character (`characterId`) and optionally
  `about` another. The Commonplace recall path already runs per responding character. The
  group's `Knowledge`/store content reaches memory via the same recall/search the injector uses,
  so no schema change is required for the base feature. **Do not** add a `groupId` column to
  memories unless the owner later wants group-scoped memory partitioning — that's out of scope
  here (YAGNI). If recall needs the group stores explicitly, route it through the new group tier
  rather than a new memory field.

## 7. Write access (`lib/doc-edit/path-resolver.ts`)

The resolver builds the accessible-mount set via `resolveTieredMountPool(..., { includeParticipants: true })`
then `flattenTierPool(..., { includeParticipants: true })`. Once the pool carries the group
tier, group mounts enter the accessible set automatically.

**Critical:** group-tier mounts must be **writable**. The resolver currently marks the
`participant` tier read-only (peer vaults). Find where read-only-ness is decided for the
doc-edit write helpers and ensure `group`-tier mounts (and the group official store) are treated
like the character's own tier — full read/write — **not** like `participant`. Add a test that a
member character can write to both the group official store and a linked group store, and that a
non-member cannot.

## 8. API (`app/api/v1/groups/`)

Follow `/api/v1/` action-dispatch conventions (`createContextHandler`, `withActionDispatch`,
response helpers from `@/lib/api/responses`). Mirror `app/api/v1/projects/`.

- `GET /api/v1/groups` — list (hydrated or slim per query).
- `POST /api/v1/groups` — create (provisions official store).
- `GET /api/v1/groups/[id]` — fetch hydrated.
- `PUT /api/v1/groups/[id]` — update name/description/properties (routes to store + row).
- `DELETE /api/v1/groups/[id]` — delete row, unlink stores, drop memberships. Decide official-
  store fate: match the project delete behavior (check whether projects delete or orphan the
  official store and do the same).
- Action dispatch on `POST /api/v1/groups/[id]`:
  - `?action=addMember` / `removeMember` (body: `characterId`).
  - `?action=linkStore` / `unlinkStore` (body: `mountPointId`).
- `GET /api/v1/groups/[id]?action=members`, `?action=stores`.

Add corresponding methods to the repositories. Every backend route gets debug logging.

## 9. UI: Groups on the Aurora page

Insert a **Groups** section *above* the character grid in `app/aurora/page.tsx` (between the
header toolbar and the `character-card-grid`). Model it on the Prospero project list.

- Data fetching: SWR against `GET /api/v1/groups`, mirroring the existing `/api/v1/characters`
  fetch on Aurora and the `useProjects` hook in Prospero. Add a `useGroups` hook.
- Render group cards with `qt-entity-card` (same class the character grid uses) in their own
  grid, with a "Create Group" affordance mirroring "Create Character".
- Group editor (new route, e.g. `app/aurora/groups/[id]/page.tsx`, or a dialog): edit name,
  description, color/icon; manage **members** (character add/remove picker) and **linked stores**
  (mirror Prospero's `DocumentStoresCard` link/unlink UI). Reuse `qt-*` classes; do not
  introduce raw Tailwind where a `qt-*` class exists (per CLAUDE.md — and if a new shared style
  is needed, add a `qt-*` utility, update the stylebook/theme-storybook, and the bundled themes).

## 10. Tests

- `group.types` schema round-trips; managed-field stripping.
- `GroupsRepository.create` provisions an official store and sets `officialMountPointId`.
- Join-table repos: link/unlink, addMember/removeMember dedup, `findByCharacterId`.
- **Tier resolution** (the important one): a character in groups G1+G2 resolves the union of
  G1/G2 stores; a co-participant *not* in G1/G2 does **not** see them in the same chat; dedup
  precedence character > participant > group > project > global holds.
- Doc-edit: member can write group official + linked stores; non-member is denied.
- Search/knowledge: group `Knowledge/` chunks surface for a member under `scope: 'all'` (and
  `scope: 'group'` if added) and not for a non-member.
- Snapshot test updated if the search-tool enum changed.
- Use `require('better-sqlite3')` in tests (per CLAUDE.md native-module note), with the
  `better-sqlite3-multiple-ciphers` → `better-sqlite3` fallback if a test opens a ciphered DB.

## 11. Docs & housekeeping (required before commit)

- **`docs/developer/DDL.md`** — document the `groups` table (main DB) and the
  `group_doc_mount_links` / `group_character_members` tables (mount-index DB), with columns and
  indexes. DDL.md must stay current.
- **`.qtap` export/backup — REQUIRED. Groups participate in export and backup.** Mirror the
  `projects` export path:
  - Add `"groups"` to the `exportType` enum in `public/schemas/qtap-export.schema.json` (the
    enum currently lists `characters … projects, document-stores`), add a `groups` integer to
    `ExportCounts`, and add an `ExportedGroup` `$def` modeled on `ExportedProject`. Like
    `ExportedProject`, serialize the **hydrated** group inline (description/state/properties read
    out of the official store) for portability, plus the **member character ids** and the
    **linked-store mount references** (and informational `_memberNames`, mirroring
    `ExportedProject`'s informational `_` roster-name fields). The official store and any
    group-owned linked stores ride along through the existing `document-stores` export type
    (`mountPoints` + `documents` + `blobs`) — confirm the export bundles referenced stores the
    way it does for projects.
  - Extend `lib/export/quilltap-export-service.ts` with a `case 'groups':` that mirrors
    `case 'projects':` (line ~205): `repos.groups.findAll()` (or by-id), serialize each group +
    its members + linked stores. Update `lib/export/types.ts` and the ndjson writer accordingly.
  - **Import:** add the inverse — recreate groups, re-provision/relink official + linked stores,
    re-establish `group_character_members` (skip members whose character id isn't present in the
    import set; log a warning rather than failing the whole import). Match how project import
    handles roster characters that may or may not be present.
  - Add the `groups` count to backup verification if backups assert per-type counts.
- **Help files** (`help/*.md`) — all user-visible changes need a help file with `url`
  frontmatter and a matching `help_navigate` In-Chat Navigation block. Add a Groups help page
  (steampunk / Roaring-20s / Wodehouse / Lemony Snicket voice for user-facing prose).
- **`docs/CHANGELOG.md`** — terse, plain American English (the changelog is the exception to
  the house voice). Reverse-chronological.
- **`lib/startup/prettify.ts`** — `PRETTY_LABELS` entries for the two migrations.
- **`.claude/commands/update-documentation.md`** — if you add new docs, register them there.
- Type-check with `npx tsc` (not `npm run build`). Add debug logs on every new/touched backend
  path. No stubs / TODOs left behind.

## 12. Suggested build order (agentizable)

Per CLAUDE.md, plan in Opus and delegate to Haiku agents with specific instructions; no git
stash/worktrees with agents.

1. Schemas + DDL.md entries (`group.types.ts`, join-table schemas).
2. Migrations + prettify labels.
3. Repositories (groups + two join tables) with mount-index routing.
4. Official store provisioning + read overlay + startup re-ensure + scenarios.
5. **Tier resolution** in `tiered-mount-pool.ts` (the keystone — do this carefully, with tests,
   before wiring consumers).
6. Wire consumers: knowledge injector, search handler, doc-edit path resolver (writable group
   tier), New Chat scenario source.
7. API routes.
8. Aurora UI (list + editor, `useGroups` hook).
9. `.qtap` export + import (groups exportType, `ExportedGroup` def, service/import wiring) —
   groups are a required part of export/backup.
10. Tests across the stack (include an export→import round-trip that preserves a group, its
    members, and its linked stores).
11. Help docs, changelog, DDL.md, final `npx tsc`.

## 13. The one risk to watch

The per-character group tier means a single chat can have **different accessible-store sets for
different responding characters**. Anything that assumes "one pool per chat" — caching keyed on
`chatId`, a context block computed once per chat rather than per character — will be subtly
wrong for Groups. The existing project tier is chat-uniform, so such an assumption may exist
somewhere downstream. When wiring each consumer, verify it keys on `characterId` (it should —
the search handler and knowledge injector already do). Grep for any pool/context memoization
keyed on chat id before declaring done.

There is exactly **one** sanctioned exception to per-responding-character isolation: the New
Chat **scenario menu** (§6), which offers a group's scenarios when *any* participant is a
member. That is a chat-creation-time menu, not a per-turn access grant. Keep it confined to the
scenario-aggregation code; it must never widen the tier resolver, the knowledge injector, the
search pool, or the doc-edit write set. If you find yourself reaching into participant
memberships anywhere in `tiered-mount-pool.ts`, stop — that's the bug this note exists to
prevent.
