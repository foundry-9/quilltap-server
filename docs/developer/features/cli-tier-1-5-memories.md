# Feature: CLI Tier 1.5 — `memories` Namespace

**Status:** Proposal / Not Implemented
**Owner:** CLI surface (`packages/quilltap/`)
**Relates to:** Tier 1 (`docs find` / `docs grep` / `docs status`, `db backup`, `db integrity`).
**Builds on:** existing `quilltap db memories` verb and the `memories` table schema in `docs/developer/DDL.md`.

## Why

Tier 1 gave us `docs find` and `docs grep` — search across document mounts by filename and by extracted text. The next obvious "thing the user can't currently find" is **memories**. The existing `quilltap db memories` verb lists a single character's memories sorted by `createdAt`, with no full-text search, no graph view, no chat-context display, and no aggregate `ls`-style listing. This Tier 1.5 work fills those gaps as a new top-level `memories` namespace, mirroring the shape of `docs`.

## What the data actually looks like

Before specifying CLI surface, the implementer should know what's in the schema. The `memories` table (in the main encrypted DB, `quilltap.db`):

| Field | Notes |
|-------|-------|
| `id` | UUID, primary key. |
| `characterId` | The **holder** of the memory. Required. |
| `aboutCharacterId` | Who the memory is *about*. Can equal `characterId` (self-knowledge), differ from it (inter-character memory), or be NULL (legacy). |
| `chatId` | The chat the memory was extracted from. NULL for `MANUAL` memories. |
| `projectId` | Project context. Nullable. |
| `sourceMessageId` | The specific message that produced the memory. Nullable. |
| `content` | Full body of the memory. |
| `summary` | Short version. |
| `keywords` | JSON array. |
| `tags` | JSON array. |
| `importance` | REAL 0.0–1.0. The extractor's initial estimate. |
| `reinforcedImportance` | REAL 0.0–1.0. Adjusted by reinforcement signals. **This is what the recall path actually ranks on.** |
| `reinforcementCount` | INTEGER. How many times this memory has been reinforced. |
| `lastReinforcedAt` / `lastAccessedAt` | Timestamps. |
| `source` | `'AUTO'` or `'MANUAL'`. |
| `embedding` | BLOB (Float32 vector) or NULL. |
| `relatedMemoryIds` | JSON array of other memory UUIDs. **Bidirectional graph edges**, populated by `linkRelatedMemories` in `lib/memory/memory-gate.ts`. |
| `createdAt` / `updatedAt` | Timestamps. |

The relationship to chats: `memories.chatId → chats.id`, with the chat's title in `chats.title`. Manual memories have `chatId IS NULL` and should display as "(manual entry)" rather than as an empty cell.

The related-memory graph is real and actively maintained: when a memory is created, `linkRelatedMemories` finds the top-K most-similar existing memories above a similarity threshold and writes bidirectional links. The graph is undirected and may contain cycles; any traversal needs a visited-set.

## CLI surface (overview)

```text
quilltap memories ls    [filters] [--sort <field>] [-r] [--limit N] [--json]
quilltap memories find  [filters] [--limit N] [--json] <pattern>
quilltap memories grep  [filters] [-i] [-l] [--max N] [--context N] [--json] <pattern>
quilltap memories show  <id> [--json] [--no-related] [--depth N]
quilltap memories tree  <id> [--depth N] [--max-nodes N] [--json]
quilltap memories status [--character <name|id>] [--json]
```

Shared filter flags (apply to `ls`, `find`, `grep`, and `status` where sensible):

- `--character <name|id|all>` — the **holder**. Default: `all`. The existing `db memories` verb requires a character; the new namespace defaults to all characters so the broad view is the cheap default, with per-character drill-down via the flag.
- `--about <name|id>` — the **subject**. Restricts to memories whose `aboutCharacterId` matches. `--about self` is a shorthand for "self-referential memories" (`aboutCharacterId === characterId`). `--about none` restricts to memories with `aboutCharacterId IS NULL` (legacy / ambiguous).
- `--source AUTO|MANUAL` — restrict by source.
- `--chat <id|title>` — restrict to memories extracted from a specific chat. Resolution uses the same name→UUID fuzzy match that `db chats` already does. `--chat none` restricts to manual memories (those with `chatId IS NULL`).
- `--project <id|name>` — restrict by project.
- `--since <date>` / `--until <date>` — ISO date filters on `createdAt`.
- `--min-importance <n>` / `--min-reinforced <n>` — REAL thresholds on the corresponding fields.
- `--has-embedding` / `--no-embedding` — filter by presence of the embedding BLOB.

Sort flags (apply to `ls`, `find`, `grep`):

- `--sort <field>` where `<field>` is one of `reinforced` (default), `importance`, `created`, `accessed`, `reinforcement-count`, `links` (graph degree). The default is `reinforced` because that is what the recall path uses; document this in `--help`.
- `-r` / `--reverse` — flip the order.

All verbs accept `--limit N` (default 50) and `--json`.

## Verbs in detail

### 1. `memories ls`

POSIX-flavoured listing, modelled on `docs ls`.

```text
quilltap memories ls [filters] [--sort <field>] [-r] [--limit N] [--json]
```

Default text output (column layout, header row, monospaced):

```text
  imp  rein   src    about           chat                              links  emb  summary
  ----  ----  ----   --------------  --------------------------------  -----  ---  ---------------------------------------
  0.92    7   AUTO   Ariadne         Designing the CLI tier brief         4    Y   Charlie wants Tier 1 specs to fan out to Haiku
  0.85    3   AUTO   Charlie         Discussing memory architecture       6    Y   Charlie prefers concrete examples over abstrac
  0.81    1   MANUAL self            (manual entry)                       0    -   Charlie is a Calvinist Baptist, Progressive D
  ...
```

Columns:

- `imp` — `reinforcedImportance` when `--sort reinforced` (default) or when `--sort` is unset; raw `importance` when `--sort importance`. The column header reflects which is shown.
- `rein` — `reinforcementCount`.
- `src` — `AUTO` or `MANUAL`.
- `about` — `self` when `aboutCharacterId === characterId`, else the about-character's name, else `(none)` for NULL. Truncate to 20 chars.
- `chat` — the chat title from `chats.title` when `chatId` is set; `(manual entry)` when NULL. Truncate to 32 chars.
- `links` — `relatedMemoryIds.length`. `0` is displayed as `0`, not `-`, because zero is meaningful (this memory has no semantic siblings).
- `emb` — `Y` if `embedding IS NOT NULL`, else `-`. Mirrors `docs ls`.
- `summary` — `memories.summary`, truncated to fit.

When `--character all` (the default), prepend a `holder` column to the front showing the holding character's name. When `--character <one>`, omit it.

JSON mode emits the full row plus resolved character names (`holder`, `aboutCharacter`) and the chat title (`chatTitle`), so consumers don't have to re-resolve UUIDs.

#### Sort defaults — important

The existing `db memories` verb sorts by `createdAt DESC`. **`memories ls` defaults to `reinforced` DESC** because that's the ranking the recall path uses, and it's what the user almost always wants when surveying what's prominent. The change in default is documented in `--help` so users coming from the legacy verb aren't surprised.

### 2. `memories find`

Substring match against `summary` and (optionally) `content`.

```text
quilltap memories find [filters] [--in summary|content|both] [--limit N] [--json] <pattern>
```

- `--in summary|content|both` — where to search. Default: `summary`. `content` is broader but slower; `both` is the safest.
- All shared filter flags apply (character, about, source, chat, project, since/until, importance thresholds).
- Output identical to `ls` (same columns), but rows are ranked by **match relevance** when no `--sort` is given:
  - Primary: matches in `summary` rank higher than matches in `content` alone.
  - Secondary: higher `reinforcedImportance`.
  - Tertiary: more recent `createdAt`.
- `--sort` overrides relevance ranking and applies the explicit sort instead.

### 3. `memories grep`

Pattern match with snippets, mirroring `docs grep`.

```text
quilltap memories grep [filters] [-i] [-l] [--max N] [--context N] [--json] <pattern>
```

- `<pattern>` is searched inside the `content` field. Default literal, case-sensitive; `-i` for case-insensitive.
- `-l` — list memory IDs only (no snippets). Useful for piping into `xargs quilltap memories show`.
- `--max N` — max matches per memory (default 5).
- `--context N` — lines of context around each match (default 0).

Output without `-l`:

```text
abc12345  (holder: Ariadne, imp 0.92, chat: "Designing the CLI tier brief"):
  line 14:  ... Charlie prefers concrete examples over abstractions, especially ...
  line 22:  ... when reviewing technical specs, Charlie corrects bad assumptions ...
```

When `--character all` (default), prefix each block with the holder so cross-character grep results are readable.

### 4. `memories show`

Full body plus the related-memory graph for a single memory.

```text
quilltap memories show <id> [--json] [--no-related] [--depth N]
```

- `<id>` — full memory UUID, or a unique prefix (8+ chars). Ambiguous prefixes print candidates, exit 2.
- `--no-related` — skip the related-memory section (fast path for piping content).
- `--depth N` — how many graph hops to render in the related section. Default 1 (direct neighbours). `--depth 0` is equivalent to `--no-related`. Caps at 4 to prevent runaway traversal.

Default text output:

```text
Memory abc12345
─────────────────────────────────────────────────────────────────────────────
  Holder:        Ariadne          (chr_8f9a...)
  About:         Charlie          (chr_2b1c...)
  Source:        AUTO
  Importance:    0.85 (reinforced from 0.72, count: 3)
  Created:       2026-05-12 14:23 UTC
  Last access:   2026-05-19 09:14 UTC
  Last reinf.:   2026-05-18 16:02 UTC
  Embedding:     present (1024 dims)
  Chat:          "Designing the CLI tier brief"   (cht_3d4e...)
  Source msg:    msg_a1b2...   (in chat above)
  Project:       (none)
  Keywords:      [concrete-examples, communication, charlie-preferences]
  Tags:          [preference, communication-style]

Summary:
  Charlie prefers concrete examples over abstractions, especially when ...

Content:
  Charlie has repeatedly emphasized, across multiple sessions, that ...
  [full content, wrapped to terminal width]

Related (4 direct, --depth 1):
  ▸ abc23456  (imp 0.72)  "Charlie values rigor over speed"
  ▸ abc34567  (imp 0.68)  "Charlie's writing style: precise, structured"
  ▸ abc45678  (imp 0.61)  "Charlie corrects bullshit immediately"
  ▸ abc56789  (imp 0.55)  "Charlie prefers Wodehouse flourishes in user docs"
```

Manual memories show `Chat: (manual entry)` and omit the `Source msg` line.

`--json` returns the row verbatim with `holder`, `aboutCharacter`, `chat` (id + title), and `related` (array of resolved-name + importance + summary, recursively up to `--depth`).

### 5. `memories tree`

Walk the related-memory graph rooted at one memory, render as ASCII.

```text
quilltap memories tree <id> [--depth N] [--max-nodes N] [--json]
```

- `<id>` — root memory (full UUID or unique prefix).
- `--depth N` — traversal depth. Default 2. Hard cap 4.
- `--max-nodes N` — abort the traversal after rendering N nodes. Default 100. Hard cap 1000. This is the safety net for densely-connected memories.

Output:

```text
abc12345  (imp 0.85)  "Charlie prefers concrete examples over abstractions..."
├─ abc23456  (imp 0.72)  "Charlie values rigor over speed"
│  ├─ def34567  (imp 0.66)  "Charlie pushes back on weak arguments"
│  └─ def45678  (imp 0.59)  "Charlie expects assumptions to be flagged"
├─ abc34567  (imp 0.68)  "Charlie's writing style: precise, structured"
│  ↺ abc23456  (already shown)
└─ abc45678  (imp 0.61)  "Charlie corrects bullshit immediately"

20 nodes visited, 4 cycles detected, depth 2 reached.
```

Cycle handling: the graph is undirected and bidirectional. The traversal maintains a visited-set; when a node would be re-rendered, replace its subtree with `↺ <id>  (already shown)`. The trailing summary line reports node count, cycles detected, and whether the depth cap was hit.

`--json` returns a nested-object tree with `cycles` and `truncated` flags at the top level.

### 6. `memories status`

Per-character rollup of memory counts and queue / health signals. Mirrors `docs status`.

```text
quilltap memories status [--character <name|id>] [--json]
```

Default output (without `--character`, all holders shown):

```text
Holder: Ariadne   (chr_8f9a...)
  Total memories:        148
    AUTO:                127
    MANUAL:               21
  About-distribution:
    self-referential:     34
    about-others:         98
    legacy (NULL):        16   ⚠ run alignment migration?
  Embeddings:
    present:             142
    missing:               6   ⚠ may not be recallable
  Graph:
    nodes with links:    102
    isolated (0 links):   46
    avg degree:          3.2
    max degree:           14
    dangling edges:        0   (links pointing to nonexistent memories)
  Top by reinforcedImportance:
    abc12345  (imp 0.92)  "Charlie wants Tier 1 specs to fan out to Haiku..."
    abc34567  (imp 0.85)  "Charlie prefers concrete examples over abstractions..."
    ...
```

Read-only. Open the main encrypted DB directly.

The "dangling edges" check is worth its weight: `relatedMemoryIds` is a JSON array of UUIDs, not a foreign key, so a deleted memory can leave stale pointers. If this verb finds any, it logs the offending source memory IDs to stderr in a follow-up section.

## Implementation notes

### Code layout

- Create `packages/quilltap/lib/memories-commands.js` modelled on `docs-commands.js`. Export `memoriesCommand(args)`.
- Wire it into `packages/quilltap/bin/quilltap.js` alongside the existing `db` / `themes` / `docs` / `instances` / `memory-diff` dispatchers:

  ```js
  } else if (process.argv[2] === 'memories') {
    const { memoriesCommand } = require('../lib/memories-commands');
    memoriesCommand(process.argv.slice(3)).catch(err => {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    });
  }
  ```

- Shared helpers (mount-resolution-style fuzzy lookups for character / chat) already exist in `lib/db-commands.js` as `resolveCharacter` and friends; factor what's needed into `lib/db-helpers.js` rather than copy-pasting. If a refactor is needed, do it in a separate commit so the diffs are reviewable.
- Add global-flag pre-parsing (`--instance` / `--data-dir` / `--passphrase` / `--json`) to the dispatcher, matching how `docs` does it (see the 4.5-dev fix that lets flags precede the verb).

### Database access

All verbs are **read-only**. Open the main DB via the existing `openMainDb(dataDir, pepper)` helper in `db-helpers.js` with `readonly: true`. The mount-index DB is not needed.

The chat title comes from `chats.title`. The character names come from `characters.name` (and `aliases` for resolution input, but never for display). Compose the lookup queries server-side in SQL via `LEFT JOIN` — do not do N+1 lookups in JS.

### Graph traversal (for `show --depth` and `tree`)

Pseudocode:

```js
function traverse(rootId, maxDepth, maxNodes) {
  const visited = new Set();
  const cycles = [];
  let truncated = false;

  function walk(id, depth) {
    if (visited.size >= maxNodes) { truncated = true; return null; }
    if (visited.has(id)) { cycles.push(id); return { id, cycle: true }; }
    visited.add(id);
    const row = db.prepare('SELECT id, summary, reinforcedImportance, relatedMemoryIds FROM memories WHERE id = ?').get(id);
    if (!row) return { id, missing: true };
    if (depth >= maxDepth) return { ...row, children: [] };
    const children = JSON.parse(row.relatedMemoryIds || '[]').map(child => walk(child, depth + 1));
    return { ...row, children };
  }

  return { root: walk(rootId, 0), visited: visited.size, cycles: cycles.length, truncated };
}
```

The `missing: true` branch produces the dangling-edge signal that `memories status` summarizes. Render it inline in the tree as `✗ <id>  (deleted or missing)`.

### What about the existing `db memories` verb?

Keep it. Add a one-line deprecation hint to its help text pointing users at `quilltap memories ls --character <name>`, but don't remove it. The two verbs can coexist indefinitely; the new namespace doesn't require the old one to die.

### Output ergonomics

- The chat-title column truncates at 32 chars by default. Add `--full-titles` to `ls` / `find` / `grep` to disable truncation, mirroring `docs ls`'s `--full` analogue if there is one.
- The `summary` column's truncation length scales with terminal width (use `process.stdout.columns`), same as `docs ls` does.
- The importance columns display two decimal places.
- Color: green for `imp >= 0.7`, yellow for `0.4–0.7`, red dim for `< 0.4`. Suppress when stdout is not a TTY (same convention as `docs ls`).

### Logging

- Debug-log every CLI invocation with the verb, resolved character UUIDs, and resulting row count via the project's logger pattern.
- `memories status`'s dangling-edge check writes a `warn`-level log per dangling edge so the server log captures the inconsistency for later investigation.

## Project hygiene checklist

For each landed verb (or the batch, Charlie's call):

1. **Version bump:** `packages/quilltap/package.json` patch number is incremented.
2. **Type check:** `npx tsc` is clean.
3. **Help text:**
   - `quilltap memories --help` is comprehensive and matches the verb-by-verb shape used by `quilltap docs --help`.
   - A new help file `help/cli-memories.md` is created in the steampunk-Wodehouse voice, with a `url` frontmatter and an "In-Chat Navigation" block carrying a `help_navigate` call. Cross-link from `help/cli-docs.md` and `help/cli-db.md` (or the "Database Protection" help page, whichever houses the existing CLI overview).
4. **CHANGELOG:** one entry under `4.5-dev` (or the current dev tag), terse American English, matching the style of the Tier 1 `docs find` / `docs grep` / `docs status` entries.
5. **README:** `packages/quilltap/README.md` gains a "Memories" subsection alongside the existing "Database Tool", "Themes", "Document Mounts", and "Instances" sections.
6. **DDL doc:** `docs/developer/DDL.md` only updates if new indexes are added. Consider whether `idx_memories_reinforcedImportance` is worth adding for the new default sort — if `ORDER BY reinforcedImportance DESC` shows up as slow on a populated Friday-sized instance, add the index. Otherwise leave the schema alone.
7. **CLAUDE.md:** add the `memories` namespace to the "Quilltap conventions" section so future sessions know it exists, including the default-sort change relative to `db memories`.
8. **Tests:**
   - Unit tests on the verb dispatcher and the filter-flag parsing.
   - Unit test for the graph-traversal helper covering: linear chains, cycles, dangling edges, depth cap, max-nodes cap.
   - Smoke test against a real instance — Friday is the obvious target. Manually verify `memories status` produces a clean dangling-edges count of zero (and if not, the discrepancy itself is a useful finding to feed back to the memory-gate maintainers).

## Suggested rollout order

1. **`memories ls`** — biggest single jump in usability; everything else builds on its filter/sort vocabulary.
2. **`memories show`** — single-record viewer; trivial after `ls`.
3. **`memories status`** — read-only rollup; useful for catching schema drift introduced by the other verbs.
4. **`memories find`** — substring search.
5. **`memories grep`** — pattern search with snippets.
6. **`memories tree`** — graph viewer. Last because it's the most complex (cycle handling, depth control) and the lowest daily-use frequency.

Items 1–5 share most of the filter / sort / JSON-output code and should land as a single coordinated PR. Item 6 can land separately.

## Out of scope (Tier 2 candidates)

These are tempting but explicitly **not** part of this work:

- Semantic search (`memories find --semantic` against the embeddings). The data is there; cost/benefit is higher; do it as a follow-up once the literal versions are exercised.
- Memory mutation verbs (`memories rm <id>`, `memories merge <a> <b>`, `memories reinforce <id>`). Manual housekeeping has value, but it crosses into write-territory and wants its own design pass — at minimum, mutation needs the server's job system since the memory write path goes through the gate.
- Export / import of memories as a portable file format. Adjacent to the `.qtap` export work; should align with that rather than diverge.
- Visualizing the related-memory graph in the UI rather than the CLI. A web-side concern.
- A `memories validate` verb that repairs dangling `relatedMemoryIds` entries. Surface them in `status` first; if the count is consistently nonzero in real instances, then write the repair migration.

## A note on the existing `db memories` verb

The existing `quilltap db memories --character <name>` verb stays as-is. It is now the legacy access point for the same data; `memories ls --character <name>` is the recommended replacement. Add a single line to the legacy verb's help output:

> Tip: `quilltap memories ls --character <name>` offers richer filtering, sorting, and graph display.

That's the entirety of the deprecation. No removal, no migration, no warning on every invocation.
