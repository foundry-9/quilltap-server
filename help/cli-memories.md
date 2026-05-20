---
url: /settings?tab=memory
---

# The Command Line and the Commonplace Book

Where the Scriptorium keeps your documents and the salon keeps your conversations, the Commonplace Book keeps your memories — the soft, sediment-like layer of impressions and conclusions that each of your characters has accumulated about you, about the world, and about themselves. By the time an instance has been in active use for a few months, a single character may carry several thousand of these; an instance with many characters and many chats may carry tens of thousands in total.

The `quilltap memories` subcommand is the rear entrance to all of them. It is read-only by design: it can survey, search, illustrate, and rank, but it does not write, merge, delete, or otherwise tamper with what the memory system has so carefully laid down.

## What This Tool Is For

Three things, principally:

- **Surveying.** To answer "what does this character actually remember about me?" without paging through the Commonplace Book settings tab one entry at a time, ranked the way the recall path itself ranks them.
- **Searching.** To find the memory or memories that contain a particular phrase, regardless of which character formed them or what chat produced them.
- **Illustrating the lattice.** Each new memory is linked to its near neighbours in vector space at the moment it is written; the result is a bidirectional graph of related memories that you can walk on the command line, root yourself at any node, and watch fan out.

The semantic search the LLM itself uses is *not* exposed here yet (it requires the embedding pipeline, which is a separate apparatus). What you get instead is the same data the LLM sees, sorted and filtered the way the LLM's recall pass would sort and filter it. For most casual surveying, that's the right level.

## A Word on the Existing `db memories` Verb

If you have already met `quilltap db memories --character <name>`, you should know that the new namespace is its richer successor. The legacy verb still works — it is, by design, undisturbed — but its default sort (newest first) is rarely what you actually want when surveying what a character considers important. `quilltap memories ls` defaults instead to `reinforcedImportance` descending, which is precisely the ordering the recall path itself uses.

You may continue to use the old verb. The new one is what we will recommend henceforth.

## The Subcommands

```text
quilltap memories ls       [filters] [--sort <field>] [-r] [--limit N]   # POSIX-flavoured listing
quilltap memories find     [filters] [--in summary|content|both] <pattern>  # Substring search
quilltap memories grep     [filters] [-i] [-l] [--max N] [--context N] <pattern>  # Pattern + snippets
quilltap memories show     <id|prefix> [--depth N] [--no-related]        # Full record + neighbours
quilltap memories tree     <id|prefix> [--depth N] [--max-nodes N]       # ASCII walk of the graph
quilltap memories status   [--character <name|id>]                       # Per-holder rollup
quilltap memories validate [--character <name|id>] [--list]              # Read-only health check
```

All verbs accept `--json` for piping, `--limit N` (default 50), and the shared filter vocabulary described below.

## Filters You May Apply Anywhere

The same filter flags apply to `ls`, `find`, `grep`, and (where they make sense) `status`:

| Flag | Meaning |
| --- | --- |
| `--character <name\|id\|all>` | The *holder* of the memory. Default: `all`. |
| `--about <name\|id\|self\|none>` | The *subject*. `self` shorthand for self-referential memories; `none` for legacy memories whose `aboutCharacterId` is null. |
| `--source AUTO\|MANUAL` | Auto-extracted vs. manually entered. |
| `--chat <id\|title\|none>` | The source chat. `none` restricts to manual memories. |
| `--project <id\|name>` | Project context. |
| `--since <date>` / `--until <date>` | ISO date floor / ceiling on `createdAt`. |
| `--min-importance <n>` | Floor on the *raw* importance score. |
| `--min-reinforced <n>` | Floor on the *reinforced* importance score. |
| `--has-embedding` / `--no-embedding` | Whether the embedding vector is present. |

Names are case-insensitive and accept aliases, exactly as elsewhere in the CLI. Ambiguous names print candidates and exit 2.

## Sorting

`ls`, `find`, and `grep` accept `--sort <field>` where `<field>` is one of:

- `reinforced` (default) — `reinforcedImportance` DESC. The recall path's own ranking.
- `importance` — raw `importance` DESC.
- `created` — `createdAt` DESC. Same as the legacy `db memories` verb.
- `accessed` — `lastAccessedAt` DESC, falling back to `createdAt`.
- `reinforcement-count` — by `reinforcementCount`.
- `links` — by the size of the `relatedMemoryIds` array.

Pass `-r` (or `--reverse`) to flip the order.

## `ls` — the POSIX-flavoured Listing

```text
holder         imp  rein   src    about           chat                              links  emb  summary
-------------  ---- ----  -----  --------------  --------------------------------  -----  ---  ------------------------------------
Ariadne        0.92    7   AUTO   Charles         Designing the CLI tier brief         4    Y   Charles wants Tier 1 specs to fan
Charlie        0.85    3   AUTO   Charles         Discussing memory architecture       6    Y   Charles prefers concrete examples
Ariadne        0.81    1   MANUAL self            (manual entry)                       0    -   Charles is a Calvinist Baptist
```

The `holder` column appears only when surveying across all characters (`--character all`, the default). Narrow to one holder with `--character <name>` and the column vanishes. The `imp` column reflects whichever sort is in force — `reinforcedImportance` for the default sort, raw `importance` when sorted that way.

The `chat` column shows the source chat's title, truncated to 32 characters. Pass `--full-titles` to disable truncation; pass `--json` for the resolved row in full.

## `find` and `grep` — Two Kinds of Search

`find` is the lighter tool: a substring match against the *summary* of each memory by default, or `--in content` to match against the full body, or `--in both` for the broadest sweep:

```bash
quilltap memories find "concrete examples"                       # default: --in summary
quilltap memories find --in both "five-point Calvinist"
quilltap memories find --character Ariadne --in content "rigor"
```

Without an explicit `--sort`, results are ranked by relevance: memories whose `summary` matches outrank those whose body alone matches; remaining ties are broken by `reinforcedImportance` and then by `createdAt`.

`grep` is the heavier tool: a literal substring search across the *content* of every in-scope memory, returning numbered line excerpts:

```bash
quilltap memories grep "concrete examples"                       # literal, case-sensitive
quilltap memories grep -i "concrete examples"                    # case-insensitive
quilltap memories grep -l "five-point Calvinist"                 # paths-only (UUIDs)
quilltap memories grep --max 3 --context 1 "rigor"               # at most 3 hits per memory, with one line of context
```

Pass `-l` (or `--paths-only`) to get just the memory UUIDs — convenient for piping into `xargs quilltap memories show`.

## `show` — One Memory in Full

```text
quilltap memories show abc12345
quilltap memories show abc12345 --depth 2
quilltap memories show abc12345 --no-related --json
```

The `<id>` argument accepts a full UUID or a unique prefix of at least eight characters. An ambiguous prefix prints the candidates and exits 2.

The default output shows the holder, the subject, the source, the (raw and reinforced) importance scores, every relevant timestamp, the source chat (or `(manual entry)` if there isn't one), the keywords and tags, the summary, the full content, and — at depth 1 by default — the direct related memories.

Pass `--depth N` to walk further out (caps at 4). Pass `--no-related` (or `--depth 0`) to skip the related section entirely, which is appreciably faster for piping content into another tool.

## `tree` — The Lattice as ASCII

The related-memory graph is bidirectional and frequently cyclic. `memories tree` walks it from a chosen root, drawing the structure as a tree and replacing any re-encountered node with `↺ <id>  (already shown)` so the rendering remains finite:

```text
abc12345  (imp 0.85)  "Charles prefers concrete examples over abstractions..."
├─ abc23456  (imp 0.72)  "Charles values rigor over speed"
│  ├─ def34567  (imp 0.66)  "Charles pushes back on weak arguments"
│  └─ def45678  (imp 0.59)  "Charles expects assumptions to be flagged"
├─ abc34567  (imp 0.68)  "Charles' writing style: precise, structured"
│  ↺ abc23456  (already shown)
└─ abc45678  (imp 0.61)  "Charles corrects bullshit immediately"

20 nodes visited, 4 cycles detected, depth 2 reached.
```

`--depth N` (default 2, cap 4) governs how far out the traversal proceeds; `--max-nodes N` (default 100, cap 1000) is the hard ceiling on rendered nodes, which exists because a densely-connected memory can otherwise produce an unhelpfully large picture. Edges that point at memories which no longer exist render as `✗ <id>  (deleted or missing)`.

## `status` — the Rollup View

```bash
quilltap memories status                          # every holder with memories
quilltap memories status --character Ariadne      # one holder
quilltap memories status --json                   # structured
```

Each holder block reports total counts, the AUTO/MANUAL split, the about-distribution (self-referential vs. inter-character vs. legacy-null), embedding presence, several graph statistics (nodes with links, isolated nodes, average and maximum degree), and a top-five list ranked by reinforced importance.

The `dangling edges` count is worth its weight. Since `relatedMemoryIds` is a JSON array of UUIDs rather than a foreign key constraint, a deleted memory could once leave stale pointers in its former neighbours. The deletion chokepoint introduced in version 4.5 scrubs neighbours' arrays whenever a memory is removed, and the `repair-dangling-related-memory-edges` migration swept up the historical drift. The `dangling edges` value should now sit at zero forever; if it climbs, run `validate` (see below) for the offending IDs.

## `validate` — Memory-Graph Health Check

```bash
quilltap memories validate                            # all holders
quilltap memories validate --character Ariadne        # one holder
quilltap memories validate --list                     # print offending IDs
quilltap memories validate --json                     # structured output
```

`validate` is the read-only sibling of `status`, dedicated to one question: are there any dangling `relatedMemoryIds` entries left in the Commonplace Book? The verb scans the same way `status` does and exits with code `0` if the graph is clean, or code `1` if anything is amiss.

A dangling edge is a UUID in `relatedMemoryIds` that no longer resolves to a row in the `memories` table — the spectral footprint of a memory that was deleted before the chokepoint was in place, or (much more rarely) of a deletion path that escaped the chokepoint. `--list` prints the source memories and their dangling targets in short-ID form, so you can pipe through `quilltap memories show` for closer inspection.

The verb intentionally does not offer a `--fix` flag. Repair runs through the migration system so it is recorded, idempotent, and ordered with the rest of the schema evolution. If `validate` ever surfaces a non-zero count after the v4.5 chokepoint shipped, the right response is to identify the new leaking deletion path, plug it at the source, and write a new repair migration — not to bolt another knob onto the CLI.

## Common Flags

| Flag | Purpose |
| --- | --- |
| `-d, --data-dir <path>` | Use a non-default data directory |
| `-i, --instance <name>` | Use a registered instance (see `quilltap instances`) |
| `--passphrase <pass>` | Decrypt a peppered `.dbkey` file |
| `--json` | Machine-readable output |
| `--limit N` | Cap result count (default 50) |
| `--full-titles` | Don't truncate chat titles in column output |
| `-h, --help` | Per-subcommand help text |

All `memories` verbs are read-only. They open the main encrypted database (`quilltap.db`) directly and never write to it.

## See Also

- `quilltap docs --help` — the same shape, applied to documents instead of memories ([CLI: The Command Line and the Document Stores](cli-docs.md)).
- `quilltap db --help` — the lower-level interface for arbitrary SQL ([Database Protection](database-protection.md)).
- The legacy `quilltap db memories --character <name>` verb, which remains undisturbed.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory")`
