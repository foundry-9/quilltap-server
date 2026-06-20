# Feature Plan: Lantern & Aurora Default Aesthetics (+ the Ariel Clause)

**Status:** Complete (shipped in 4.7-dev)
**Author:** handed off from a planning session
**Audience:** Claude Code, implementing in `quilltap-server`

## Summary

Give image generation a set of **default aesthetics** — free-form Markdown guidance ("everything here looks like 1920s art-deco illustration", "anime", "swords-and-sorcery oil painting") that is woven into the *image-prompt-generation* step so every avatar, story background, and ad-hoc image in an instance (or a project) shares a consistent look. Plus a per-character depiction override (the **Ariel Clause**) that is a hard requirement, not mere styling.

There are **two domains** of aesthetic, stored as **two files** in each tier:

| File | Domain | Feeds |
|---|---|---|
| `lantern-aesthetics.md` | **General / scene / background** look | story backgrounds, ad-hoc images (the scene as a whole) |
| `aurora-aesthetics.md` | **How people and their outfits are depicted** | character avatars; also people-in-scene rendering in backgrounds/ad-hoc |

Each file lives in **two tiers**:

1. **Project tier** — the file in the active chat's project **official** document store (`project.officialMountPointId`). *Only* the official store; linked project stores are not consulted.
2. **Global tier** — the file in the **Quilltap General** singleton store.

**Resolution rule, per file, per generation:** if the chat is in a project and the project *official* store has the file, use it; otherwise fall back to the Quilltap General file; if neither exists, inject nothing. Project **overrides** global per file (no concatenation). The two files resolve **independently** — a project may override `aurora-aesthetics.md` while inheriting the global `lantern-aesthetics.md`.

### The Ariel Clause (per-character depiction override)

**Applies to story backgrounds and ad-hoc (`generate_image`) images only — NOT avatars.** In practice characters rarely care how their avatar looks, but they care about how they appear in story backgrounds and they care a great deal about ad-hoc images they generate with a tool.

For the background and ad-hoc pipelines, whenever a character will appear in the image, check that character's **own vault root** (`character.characterDocumentMountPointId`) for a file named **`depiction-guidelines.md`**. If present, it **MUST** be passed to the image-prompt generator alongside the aesthetic, scoped to that character. These are the character's own rules about how they may or may not be depicted — they are mandatory, additive (never replace the aesthetic), per-depicted-character, and must **never be silently dropped**. If multiple characters appear, each contributing character's guidelines are passed, each clearly attributed to its character by name.

Resolution for the Ariel Clause is **not** tiered — it reads only from the depicted character's own vault root. (It is unaffected by project/global aesthetic resolution; it fires whenever a character is in frame on a background or ad-hoc generation.)

The avatar pipeline does **not** consult `depiction-guidelines.md` at all.

### Editing surfaces

Lexical Markdown editors that read/write the underlying files directly:

- **Images settings tab** (`/settings?tab=images`): two fields — **"Default Image Aesthetic"** (writes Quilltap General `lantern-aesthetics.md`) and **"Default Character Aesthetic"** (writes Quilltap General `aurora-aesthetics.md`).
- **Project image settings**: the same two fields, writing that project's **official** store `lantern-aesthetics.md` / `aurora-aesthetics.md`.

`depiction-guidelines.md` is authored per character in the character's vault (Scriptorium / character file UI / by hand); no new dedicated settings editor is required in v1, though a convenience field on the character edit page is a reasonable stretch (out of scope below).

The source of truth is always the document-store file; the editors are convenience views over those files. Files dropped in by hand work automatically.

---

## Why doc-store files (not `properties.json` / settings columns)

- The tiered mount pool (`lib/mount-index/tiered-mount-pool.ts`) and the knowledge injector (`lib/chat/context/knowledge-injector.ts`) **already** implement "read a named file across project/global tiers" and "read a named file from a character vault." We reuse that machinery.
- Files participate in Scriptorium browsing, `npx quilltap docs` CLI verbs, `.qtap` export, embeddings/search, and manual editing — **no DB schema change, no migration, no `.qtap`/SillyTavern/DDL churn.**
- The editors "directly change" the files, so each field is a view over the canonical file and cannot drift from a parallel store.

---

## Background: how image prompts are generated today

Three pipelines build the prompt three different ways. The aesthetics + Ariel Clause must reach **all three**:

### 1. Story backgrounds (the Lantern proper)
- Handler: `lib/background-jobs/handlers/story-background.ts` → `handleStoryBackgroundGeneration`.
- Crafted by cheap-LLM call `craftStoryBackgroundPrompt(context, selection, userId, chatId)` in `lib/memory/cheap-llm-tasks/image-scene-tasks.ts` (system prompt `STORY_BACKGROUND_PROMPT`; user msg = `context.sceneContext` + character section + length guidance).
- Context type: `StoryBackgroundPromptContext` in `lib/memory/cheap-llm-tasks/types.ts`.
- Already has `chat`, `chat.projectId`, `job.userId`; already computes `projectMountPointIds` via `resolveProjectMountPointIds(chat.projectId)` (~line 251). The character list (`payload.characterIds` → loaded `characters`) gives the depicted characters for the Ariel Clause.
- Both `lantern-aesthetics.md` (scene) **and** `aurora-aesthetics.md` (the figures rendered in the scene) apply here.

### 2. Character avatars
- Handler: `lib/background-jobs/handlers/character-avatar.ts`.
- Prompt is **not** a cheap-LLM call — assembled by `buildCharacterAvatarPrompt(repos, character, options)` in `lib/wardrobe/avatar-prompt.ts` (already accepts `projectMountPointIds`). Plain string assembly (physical description + outfit), no LLM rewrite step.
- Only **one** character is depicted (`character`). `aurora-aesthetics.md` applies (this is the people/outfit domain); `lantern-aesthetics.md` does **not** (no scene). The Ariel Clause does **not** apply to avatars.
- Because there's no LLM to compress, the aesthetic must be **prepended as a capped text preamble**.

### 3. Ad-hoc / inline images (`generate_image` tool)
- Handler: `lib/tools/handlers/image-generation-handler.ts` → `craftImagePrompt(expansionContext, ...)` (~line 608).
- Context type: `ImagePromptExpansionContext` in `types.ts` (system prompt `IMAGE_PROMPT_CRAFTING_PROMPT`).
- Placeholders resolve to character entities (`p.entityId`/`characterId`, ~lines 611/916/923), giving the depicted-character list for the Ariel Clause.
- Both `lantern-aesthetics.md` and `aurora-aesthetics.md` apply (scene + any people).

### Shared read primitives (reuse — do not reinvent)
- `getGeneralMountPointId()` — `lib/instance-settings/index.ts`. Quilltap General mount id (or `null`).
- A project's official store id — `project.officialMountPointId` (hydrated `ProjectSchema`; or read the slim row). **Use this, not `resolveProjectMountPointIds`,** since only the official store counts now.
- A character's vault — `character.characterDocumentMountPointId`.
- `repos.docMountDocuments.findByMountPointAndPath(mountId, relativePath)` → `{ content, ... } | null`, **case-insensitive** on path (so `Aurora-Aesthetics.md`, `Depiction-Guidelines.md` match). This is the one read call used for all three file kinds, mirroring `knowledge-injector.ts` ~lines 233–255.
- `writeDatabaseDocument(mountId, relativePath, content, expectedMtime?)` / `deleteDatabaseDocument(mountId, relativePath)` — `lib/mount-index/database-store.ts`. Create/update/delete with mtime guard; emits the document-written event for reindex/embeddings.

---

## Design decisions (settled with developer)

1. **Project tier = official store only.** `project.officialMountPointId`. No scanning of other linked project stores.
2. **Two aesthetic domains, two files, resolved independently.** `lantern-aesthetics.md` (general/scene), `aurora-aesthetics.md` (people/outfits). Each does its own project-overrides-global resolution.
3. **Which files feed which pipeline:** backgrounds → both aesthetics + Ariel Clause; avatars → `aurora-aesthetics.md` only (no scene file, no Ariel Clause); ad-hoc → both aesthetics + Ariel Clause. (Backgrounds/ad-hoc render people, so they get the Aurora file too.)
4. **Ariel Clause is mandatory and additive — backgrounds + ad-hoc only.** Per depicted character, read `depiction-guidelines.md` from that character's vault root and pass it to the prompt generator, attributed by character name. Never dropped; never replaces the aesthetic; not tiered. Avatars are exempt.
5. **Avatar weaving.** No LLM step, so prepend a capped preamble of just the character aesthetic (`aurora-aesthetics.md`). Cap it (e.g. ~600 chars) so a long doc can't blow the provider budget. No depiction guidelines on this path.
6. **Cheap-LLM weaving (backgrounds/ad-hoc).** Add labelled blocks to the crafting call's user message: a scene-aesthetic block, a character-aesthetic block, and a per-character depiction-guidelines block. The cheap LLM folds them into the final prompt (which is still length-truncated downstream). Cap each block's read length (e.g. 2–4 KB) and log when capped.
7. **No caching in v1.** Reads are single indexed lookups on already-async paths. Revisit only if profiling demands; the document-written event would support invalidation later.
8. **Filename constants in one place.** `lib/image-gen/aesthetic.ts`: `LANTERN_AESTHETICS_FILENAME = 'lantern-aesthetics.md'`, `AURORA_AESTHETICS_FILENAME = 'aurora-aesthetics.md'`, `DEPICTION_GUIDELINES_FILENAME = 'depiction-guidelines.md'`.
9. **Empty editor field ⇒ delete the file**, so clearing a project override restores the global fallback rather than leaving an empty file that suppresses it.

---

## Implementation plan

### Step 1 — Shared resolver module: `lib/image-gen/aesthetic.ts`

Single source of truth for finding/reading all three file kinds and for writing the editor-managed ones.

```ts
export const LANTERN_AESTHETICS_FILENAME = 'lantern-aesthetics.md';
export const AURORA_AESTHETICS_FILENAME  = 'aurora-aesthetics.md';
export const DEPICTION_GUIDELINES_FILENAME = 'depiction-guidelines.md';

export type AestheticKind = 'lantern' | 'aurora';

interface ResolveAestheticArgs {
  kind: AestheticKind;                 // which file
  projectOfficialMountPointId?: string | null; // project tier (official store)
  maxChars?: number;                   // cap (default e.g. 4000)
}

/** Project official store overrides Quilltap General. Null when neither has it. Fails soft (never throws). */
export async function resolveAesthetic(args: ResolveAestheticArgs): Promise<string | null>;

/** Single-tier read for the editors (show exactly this tier's file, empty if absent). */
export async function readAestheticForMount(mountId: string, kind: AestheticKind): Promise<string | null>;

/** Editor writer: empty/whitespace ⇒ delete; else write. */
export async function writeAestheticForMount(mountId: string, kind: AestheticKind, content: string): Promise<void>;

/** The Ariel Clause. For each depicted character, read depiction-guidelines.md from its vault root. */
export interface DepictionGuideline { characterId: string; characterName: string; content: string; }
export async function resolveDepictionGuidelines(
  characters: Array<{ id: string; name: string; characterDocumentMountPointId?: string | null }>,
  maxCharsEach?: number,
): Promise<DepictionGuideline[]>;
```

Behaviour notes:
- All reads via `repos.docMountDocuments.findByMountPointAndPath`. Everything wrapped try/catch → `logger.warn` + soft fallback. **Image generation must never break because a guidance file couldn't be read.**
- `resolveAesthetic`: try project official store (if id given) → else Quilltap General → trim/cap → return or `null`. Debug-log which tier hit, mount id, length, capped?.
- `resolveDepictionGuidelines`: per character with a vault, read the file; skip characters without one; cap each. Debug-log which characters contributed. **Important:** the *presence* of a guideline must be observable in logs at `info` level when applied, since it's a mandatory clause.
- A small helper to get a chat's project official mount id from `chat.projectId` (load project, read `officialMountPointId`), used by all three handlers.

### Step 2 — Extend cheap-LLM context types (`lib/memory/cheap-llm-tasks/types.ts`)

Add to **both** `StoryBackgroundPromptContext` and `ImagePromptExpansionContext`:

```ts
sceneAesthetic?: string | null;      // from lantern-aesthetics.md
characterAesthetic?: string | null;  // from aurora-aesthetics.md
depictionGuidelines?: Array<{ characterName: string; content: string }> | null; // Ariel Clause
```

### Step 3 — Inject in the crafting functions (`image-scene-tasks.ts`)

In `craftStoryBackgroundPrompt` and `craftImagePrompt`, when the new fields are set, append clearly-labelled blocks to the **user message** (mirror the existing `styleTriggerSection` pattern in `craftImagePrompt`):

```
Overall image aesthetic (apply this style to the whole image):
<sceneAesthetic>

Character depiction aesthetic (how people and clothing should look):
<characterAesthetic>

Per-character depiction guidelines (MANDATORY — follow exactly for the named character):
- <characterName>: <content>
- ...
```

Add one line to each system prompt instructing the model to **treat per-character depiction guidelines as binding constraints** that override the general aesthetic where they conflict. Keep all additions null-guarded so existing behaviour is unchanged when nothing resolves. The style **trigger phrase** (LoRA) is independent and coexists with all of this.

### Step 4 — Wire the three handlers

- **`story-background.ts`**: resolve project official mount id from `chat.projectId`; call `resolveAesthetic({kind:'lantern', ...})` and `resolveAesthetic({kind:'aurora', ...})`; call `resolveDepictionGuidelines(characters)` from the already-loaded character list. Pass all three into **both** `craftStoryBackgroundPrompt` calls (primary ~line 480 and uncensored-retry ~line 517) via the new context fields.
- **`image-generation-handler.ts`**: resolve scene + character aesthetics from the tool's chat/project context; resolve depiction guidelines from the placeholder-resolved character entities; pass into the `craftImagePrompt` `expansionContext`.
- **`character-avatar.ts` + `buildCharacterAvatarPrompt`**: resolve only `aurora-aesthetics.md` (no depiction guidelines on this path). Add `characterAesthetic?: string` to `BuildPromptOptions`; in `buildCharacterAvatarPrompt`, prepend a **capped** character-aesthetic preamble ahead of the assembled physical/outfit prompt.

Every handler: `info`-level log when a depiction guideline is applied (mandatory-clause auditability) and `debug` for aesthetic tiers.

### Step 5 — Images settings UI (`components/settings/tabs/ImagesTabContent.tsx`)

Add a `CollapsibleCard` (e.g. sectionId `default-aesthetics`) containing **two** Lexical Markdown fields: "Default Image Aesthetic" → Quilltap General `lantern-aesthetics.md`; "Default Character Aesthetic" → Quilltap General `aurora-aesthetics.md`. **Reuse the existing Lexical editor** used by `app/aurora/[id]/edit/components/CharacterBasicInfo.tsx` / `components/wardrobe/wardrobe-item-editor.tsx`; if there's no shared wrapper, factor a small `MarkdownLexicalField` (DRY) rather than a third copy. Load via GET on mount; save (button consistent with the tab) via PUT; empty ⇒ delete.

### Step 6 — Project image settings UI

Add the same two fields to the project image-settings surface (where `defaultImageProfileId` / `storyBackgroundsEnabled` / `backgroundDisplayMode` are edited), writing the project **official** store's two files. Reuse `MarkdownLexicalField`. **Do not** add aesthetic fields to `ProjectPropertiesSchema` — these are store files, read/written through the new API (Step 7), sitting beside the properties fields in the UI only.

### Step 7 — API routes (`/api/v1/`, action-dispatch, `@/lib/api/responses`)

- **Global:** `GET/PUT /api/v1/system/lantern-aesthetic?kind=lantern|aurora` (or two actions) — reads/writes the Quilltap General file for the given kind; empty PUT body ⇒ delete.
- **Project:** `GET/PUT /api/v1/projects/[id]?action=aesthetic&kind=lantern|aurora` — project official store file.
- Both delegate to `readAestheticForMount` (single-tier — show *this* tier, not the fallback) and `writeAestheticForMount`. `info`-log writes (user, mount, kind, length).
- (No route needed for `depiction-guidelines.md` in v1 — authored via the existing character vault/Scriptorium paths.)

### Step 8 — Docs & housekeeping (project conventions)

- **Help file** (user-visible ⇒ mandatory): document both Default Aesthetic fields **and** the per-character `depiction-guidelines.md` convention, in the steampunk/Roaring-20s/Wodehouse/Lemony-Snicket voice. Set `url` frontmatter to `/settings?tab=images&section=default-aesthetics` and include the matching `help_navigate(url: "...")` in "In-Chat Navigation".
- **CHANGELOG** (`docs/CHANGELOG.md`) — terse, plain American English (the documented exception to house style). Note this entry **resolves the "Ariel Clause."** Example:
  > Added Lantern/Aurora default aesthetics and resolved the Ariel Clause. `lantern-aesthetics.md` (general/scene) and `aurora-aesthetics.md` (people and outfits) in the project official store or Quilltap General store are woven into image-prompt generation for avatars, story backgrounds, and ad-hoc images; project overrides global per file. Ariel Clause (story backgrounds and ad-hoc images only): when a character appears, a `depiction-guidelines.md` in that character's vault root is passed to the image-prompt generator as a mandatory per-character constraint. Avatars use the character aesthetic but not depiction guidelines. New Lexical editors on the Images settings tab and project image settings.
- **update-documentation**: update whatever `/.claude/commands/update-documentation.md` lists (e.g. `SYSTEM_FLOWCHARTS.md` for the image pipeline).
- **No schema/migration churn** — all three are doc-store files. Confirm no `.qtap`/DDL changes are needed (they shouldn't be).

### Step 9 — Tests & verification

- **Unit — `resolveAesthetic`:** per kind, project-overrides-global, global fallback, neither (null), independent resolution of the two files, error → soft null, cap/truncation.
- **Unit — `resolveDepictionGuidelines`:** single character, multiple characters (each attributed), character without a vault/file (skipped), error → soft, cap.
- **Unit — crafting injection:** blocks present when set / absent when null in both `craftStoryBackgroundPrompt` and `craftImagePrompt` (substring/snapshot). Assert the mandatory-clause label text appears when guidelines are passed.
- **Unit — avatar preamble:** aurora aesthetic prepended and capped; assert depiction guidelines are **not** consulted on this path.
- **Integration (optional):** story-background job with project files + a character `depiction-guidelines.md` yields a crafted prompt reflecting all three (mock the cheap LLM to echo input).
- **Type-check:** `npx tsc`.
- **Manual:** with `npm run dev`, set global image + character aesthetics, drop a `depiction-guidelines.md` in a character vault, generate avatar + background + ad-hoc, and confirm via `npx quilltap logs --grep aesthetic` / `--grep depiction` that the right tier resolved and the mandatory clause fired; repeat inside a project to confirm per-file override.

---

## Files to touch (checklist)

**New**
- `lib/image-gen/aesthetic.ts` — resolvers (aesthetic + Ariel Clause), writer, filename constants.
- `components/settings/.../MarkdownLexicalField.tsx` — only if no reusable wrapper exists.
- API route(s) for global + project aesthetic read/write.
- Help doc under `help/`.
- Tests mirroring existing layout.

**Modified**
- `lib/memory/cheap-llm-tasks/types.ts` — add `sceneAesthetic` / `characterAesthetic` / `depictionGuidelines` to the two context types.
- `lib/memory/cheap-llm-tasks/image-scene-tasks.ts` — inject blocks in `craftStoryBackgroundPrompt` and `craftImagePrompt` (+ system-prompt constraint line).
- `lib/background-jobs/handlers/story-background.ts` — resolve both aesthetics + guidelines, pass to both craft calls.
- `lib/tools/handlers/image-generation-handler.ts` — resolve + pass.
- `lib/background-jobs/handlers/character-avatar.ts` + `lib/wardrobe/avatar-prompt.ts` — resolve aurora aesthetic only, capped preamble (no Ariel Clause).
- `components/settings/tabs/ImagesTabContent.tsx` — two Default Aesthetic fields.
- Project image-settings component — two Default Aesthetic fields.
- `app/api/v1/projects/[id]/route.ts` — `aesthetic` action.
- `docs/CHANGELOG.md` (note: resolves the Ariel Clause), and whatever `update-documentation` lists.

## Out of scope (v1)
- Caching layer (Decision 7).
- Merging aesthetics across tiers (override only).
- A dedicated settings editor for `depiction-guidelines.md` (authored via vault/Scriptorium); a convenience field on the character edit page is a reasonable later add.
- Surfacing these files in `.qtap` export beyond their being ordinary store files.
- Tiering the Ariel Clause (it reads only the depicted character's own vault, by design).
