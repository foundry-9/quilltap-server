---
url: /settings?tab=memory
---

# The Command Line and the Commonplace Book

Where the Scriptorium keeps your documents and the salon keeps your conversations, the Commonplace Book keeps your memories — the soft, sediment-like layer of impressions and conclusions that each of your characters has accumulated about you, about the world, and about themselves. By the time an instance has been in active use for a few months, a single character may carry several thousand of these; an instance with many characters and many chats may carry tens of thousands in total.

The `quilltap memories` subcommand is the rear entrance to all of them. It is read-only by design: it can survey, search, illustrate, and rank, but it does not itself write, merge, delete, or otherwise tamper with what the memory system has so carefully laid down. When something genuinely wants doing — a round of maintenance, a mending of the lattice — it rings for the running server and lets the household staff do it properly.

## What This Tool Is For

Three things, principally:

- **Surveying.** To answer "what does this character actually remember about me?" without paging through the Commonplace Book settings tab one entry at a time, ranked the way the recall path itself ranks them.
- **Searching.** To find the memory or memories that contain a particular phrase, regardless of which character formed them or what chat produced them.
- **Illustrating the lattice.** Each new memory is linked to its near neighbours in vector space at the moment it is written; the result is a bidirectional graph of related memories that you can walk on the command line, root yourself at any node, and watch fan out.

The semantic search the LLM itself uses is *not* exposed here yet (it requires the embedding pipeline, which is a separate apparatus). What you get instead is the same data the LLM sees, sorted and filtered the way the LLM's recall pass would sort and filter it. For most casual surveying, that's the right level.

## A Word on the Existing `db memories` Verb

If you have already met `quilltap db memories --character <name>`, you should know that the new namespace is its richer successor. The legacy verb still works — it is, by design, undisturbed — but its default sort (newest first) is rarely what you actually want when surveying what a character considers important. `quilltap memories ls` defaults instead to `reinforcedImportance` descending, which is precisely the ordering the recall path itself uses.

You may continue to use the old verb, and it has lately learned one new trick: `--tier hot` or `--tier cold` narrows the list to active or archived memories (a row from before tiers existed counts as hot, as it always has).

```bash
quilltap db memories --character Ariadne --tier cold --limit 20
```

The new namespace is still what we will recommend henceforth.

## The Subcommands

```text
quilltap memories ls       [filters] [--sort <field>] [-r] [--limit N]   # POSIX-flavoured listing
quilltap memories find     [filters] [--in summary|content|both] <pattern>  # Substring search
quilltap memories grep     [filters] [-i] [-l] [--max N] [--context N] <pattern>  # Pattern + snippets
quilltap memories show     <id|prefix> [--depth N] [--no-related]        # Full record + neighbours
quilltap memories tree     <id|prefix> [--depth N] [--max-nodes N]       # ASCII walk of the graph
quilltap memories status   [--character <name|id>] [--port <n>]          # Per-holder rollup + maintenance ledger
quilltap memories validate [--character <name|id>] [--list]              # Read-only health check
quilltap memories validate --repair [--write]                            # Ask the running server to mend the lattice
quilltap memories maintain --character <name|id|all> [--phases a,b] [--dry-run] [--max N] [--threshold X] [--cap N]  # Ask the running server for a round of maintenance
```

All verbs accept `--json` for piping, `--limit N` (default 50), and the shared filter vocabulary described below.

## Filters You May Apply Anywhere

The same filter flags apply to `ls`, `find`, `grep`, and (where they make sense) `status`:

| Flag | Meaning |
| --- | --- |
| `--character <name\|id\|all>` | The *holder* of the memory. Default: `all`. |
| `--about <name\|id\|self\|none>` | The *subject*. `self` shorthand for self-referential memories; `none` for legacy memories whose `aboutCharacterId` is null. |
| `--source AUTO\|MANUAL\|CONSOLIDATED` | Auto-extracted, manually entered, or a digest written by [Memory Maintenance](memory-maintenance.md). |
| `--tier hot\|cold` | Active (`hot`) memories only, or archived (`cold`) ones. Without it, both. Archived rows are marked with `*` in the `src` column. |
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

### Semantic Search with `grep --semantic`

When the precise wording escapes you but the *idea* is clear, `memories grep` accepts a `--semantic` flag and proceeds quite differently:

```bash
quilltap memories grep --semantic --character Ariadne "Charlie's preferences for writing style"
quilltap memories grep --semantic --character Ariadne --top 5 --threshold 0.65 "theological commitments"
```

In this mode the CLI hands the query to the running Quilltap server, which embeds the text and conducts a cosine-similarity walk against the per-memory `embedding` BLOB — the same machinery the chat-path recall already uses, exposed here for diagnostic browsing.

- `--character <name|id>` is **required**. The semantic-search endpoint scopes to one holder at a time; `all` is not accepted in this mode.
- `--top N` — top *N* matches (default 20).
- `--threshold <0..1>` — minimum cosine similarity (default 0.5).
- `--source AUTO|MANUAL` and `--min-importance` are passed through to the server-side filter.
- `--json` — the structured object.

The literal `grep` (no `--semantic`) is undisturbed. If the embedding provider has drifted from what the corpus was embedded with, the server returns a clear dimension-mismatch error and the CLI relays it verbatim.

## A Note on Targeting Tags

As of version 4.7, every freshly-extracted memory arrives wearing three small lapel-pins, folded quietly into its `keywords` array alongside the free-form terms the extractor already chose. They describe the *frame* of the memory rather than its substance, and you will see them in the `keywords` line of any `show` output and in the Commonplace Book settings tab:

- **A temporal hinge** — one of `past`, `moment`, `present`, or `future`, set down as a bare word. `past` was true once and is no longer; `moment` was true only at that instant in the scene; `present` is true now and expected to remain so; `future` is a stated intent not yet acted upon.
- **A scope hinge** — either `scope: narrow` or `scope: wide`. A narrow memory is true only inside the project or story that produced it; a wide one holds regardless of which project a character finds themselves in. (The character's recall pass uses the memory's stored `projectId`, not the keyword, to make this judgement rigorous — the keyword is merely the visible badge.)
- **A primary context** — the single dominant subject of the memory, drawn from a closed list of seven: `philosophy`, `relationships`, `history`, `banter`, `mannerisms`, `trivia`, or `information`.

Because these tags live in the keyword field, the character's own keyword-based recall can match on them exactly as it matches any other keyword, and they survive into a `--json` dump untouched. Should the extractor ever fail to supply a clean value, the system quietly substitutes the sensible defaults — `present`, `scope: wide`, and `information` — so no memory is ever left un-badged. Memories formed before 4.7 carry no such pins until the chat that produced them is regenerated.

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
quilltap memories status --port 3001              # ask a server on another port for the ledger
```

Each holder block reports total counts, the AUTO/MANUAL split, the active / archived / digest split, the about-distribution (self-referential vs. inter-character vs. legacy-null), embedding presence, several graph statistics (nodes with links, isolated nodes, average and maximum degree), a *Maintenance* section, and a top-five list ranked by reinforced importance.

The *Maintenance* section comes from two places. The running server keeps a ledger of each character's maintenance rounds — when each step (fold, consolidate, demote, retire, mirror) last ran and why, and whether the last demotion actually made a dent in the excess — and `status` asks it for that ledger (on `--port`; see *Which Server?* below) for a second and a half before giving up politely. Whether or not the server answers, the section also lists the character's three most recent `MEMORY_MAINTENANCE` jobs from the database, with their state, reason, steps and any error.

The `dangling edges` count is worth its weight. Since `relatedMemoryIds` is a JSON array of UUIDs rather than a foreign key constraint, a deleted memory could once leave stale pointers in its former neighbours. The deletion chokepoint introduced in version 4.5 scrubs neighbours' arrays whenever a memory is removed, and the `repair-dangling-related-memory-edges` migration swept up the historical drift. The `dangling edges` value should now sit at zero forever; if it climbs, run `validate` (see below) for the offending IDs, and `validate --repair` to set them right.

## `validate` — Memory-Graph Health Check

```bash
quilltap memories validate                            # all holders
quilltap memories validate --character Ariadne        # one holder
quilltap memories validate --list                     # print offending IDs
quilltap memories validate --json                     # structured output
quilltap memories validate --repair                   # rehearse the repair on the running server
quilltap memories validate --repair --write           # carry it out
```

`validate` is the read-only sibling of `status`, dedicated to one question: is anything in the Commonplace Book pointing at a memory that is no longer there? It inspects four things:

- **Dangling related edges** — a UUID in `relatedMemoryIds` that no longer resolves to a row in the `memories` table: the spectral footprint of a memory deleted before the chokepoint was in place.
- **Dangling digest members** — a digest whose `consolidatedFrom` list names notes that have since been retired.
- **Dangling `supersededById`** — a note that still believes it was folded into a digest which has itself departed.
- **Missing embeddings** — memories with no embedding at all, which cannot be recalled by meaning until one is computed.

The verb exits with code `0` if the lattice is clean, or `1` if any dangling link of the first three kinds remains. A missing embedding earns a warning, not a failing grade — it is a gap in the card index rather than a broken thread. `--list` prints the offending memories and their missing targets in short-ID form, so you can pipe through `quilltap memories show` for closer inspection.

### `--repair` and `--write`

`validate --repair` hands the matter to the **running** server, which is the only party permitted to write to the database. Without `--write` it is a dress rehearsal: the server counts what it *would* mend and the CLI prints the tally along with a gentle reminder to add `--write`. Nothing is changed.

With `--write`, the server scrubs every dangling related link, digest member and `supersededById` pointer (by the same careful route a retirement uses, so no count or link is left askew) and queues embedding jobs for the memories that lack one — up to two thousand per run, so a very large backlog may want a second application. If no default embedding profile is configured, the scrubbing still happens and the CLI tells you why no embedding jobs were queued.

As with `quilltap db characters archive`, the write runs *inside* the server — which already holds the instance lock — rather than in the CLI, so the server must be up. `--write` is still required as the explicit opt-in; the CLI will not mend anything on a mere `--repair`. After a successful `--repair --write`, `validate` exits `0`.

## `maintain` — A Round of Maintenance

```bash
quilltap memories maintain --instance Friday --character Friday --dry-run                        # what every step would do
quilltap memories maintain --instance Friday --character Friday --phases consolidate --dry-run --max 20 --threshold 0.75
quilltap memories maintain --instance Friday --character Friday --phases consolidate             # consolidate (background job)
quilltap memories maintain --character all --phases demote,retire --dry-run                      # every character, LLM-free steps
quilltap memories maintain --character all                                                       # the full round, for everyone
```

The Commonplace Book keeps itself tidy in rounds, and each round has five steps, always taken in this order:

| Phase | What it does |
| --- | --- |
| `fold-near-duplicates` | Folds memories that say very nearly the same thing into a single survivor. |
| `consolidate` | Gathers clusters of related notes and writes a denser digest in their stead, sending the originals to the cold tier. See [Memory Maintenance](memory-maintenance.md). |
| `demote` | Moves the least-protected active memories to the cold tier when a character carries more than the cap. |
| `retire` | Removes superseded cold memories older than the retention window, if one is set. |
| `mirror` | Refreshes the character's Commonplace files to match. |

`maintain` runs some or all of them by hand. `--character` is required: a name or id for one character, or `all` for every character you own. `--phases` takes a comma-separated selection (misspellings are caught before anything is sent); naming `consolidate` brings `mirror` along with it, since the Commonplace files must follow a consolidation as surely as the butler follows the soup.

Like `validate --repair`, `maintain` does no writing itself: it asks the **running** Quilltap server to do it, exactly as the maintenance buttons in **Settings → Memory** do. A `--dry-run` writes nothing and prints, for each step, whether it ran or was skipped (and why), followed by the particulars: the near-duplicate groups it would fold; each proposed consolidation cluster with the notes it would fold, the digest it would write, the notes kept standalone, and any contradictions; the demotion arithmetic (the cap, how many active memories are counted, how many are exempt (hand-written notes and digests), how many over the cap, how many would go); the number it would retire; and the subjects whose Commonplace files would change. A dry run across `all` prints one line per character instead, and may not include `consolidate` — rehearsing a model call for every character in the house would be an extravagance the server politely declines.

Without `--dry-run`, the server queues one maintenance job per character and the CLI prints their ids; watch `quilltap memories status` or the logs to see them land. A run by hand ignores the master *enabled* switches — you asked, after all.

Three knobs tune a single run without touching your settings:

| Flag | Purpose |
| --- | --- |
| `--max N` | Caps the clusters consolidated (1–1000; a dry run defaults to 10, at most 40). |
| `--threshold 0..1` | Overrides the similarity a note needs to join a cluster (neural embedding profiles), dry or real — so the real run gathers what its rehearsal showed. |
| `--cap N` | Overrides the active-memory cap for demotion (100–100000). |

There is no longer a separate `consolidate` verb; `maintain --phases consolidate` is its successor.

## Which Server?

The verbs that call the running server — `grep --semantic`, `status` (for its ledger), `maintain`, and `validate --repair` — find it the same way. `--port` wins if you give it; otherwise, if you named an instance with `--instance` or `--data-dir`, the CLI reads the port that instance's server recorded in its lock; failing both, it knocks on port 3000.

## Common Flags

| Flag | Purpose |
| --- | --- |
| `-d, --data-dir <path>` | Use a non-default data directory |
| `-i, --instance <name>` | Use a registered instance (see `quilltap instances`) |
| `--passphrase <pass>` | Decrypt a peppered `.dbkey` file |
| `-p, --port <n>` | Server port for the verbs that call the running server |
| `--json` | Machine-readable output |
| `--limit N` | Cap result count (default 50) |
| `--full-titles` | Don't truncate chat titles in column output |
| `-h, --help` | Per-subcommand help text |

All `memories` verbs are read-only. They open the main encrypted database (`quilltap.db`) directly and never write to it; `maintain` and `validate --repair` go through the running server instead, and `validate --repair` changes nothing without `--write`.

## See Also

- `quilltap docs --help` — the same shape, applied to documents instead of memories ([CLI: The Command Line and the Document Stores](cli-docs.md)).
- `quilltap db --help` — the lower-level interface for arbitrary SQL ([Database Protection](database-protection.md)).
- The legacy `quilltap db memories --character <name> [--tier hot|cold]` verb, which remains largely undisturbed.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=memory")`
