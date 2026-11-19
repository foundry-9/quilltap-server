# The research kit: instance-wide lookup tools and research discipline

Status: **implemented** 2026-11-18 in 4.14-dev, phases 1–6 (see §15, *As built*). First live evaluation on V4test 2026-11-19 (§16). No pre-kit baseline was run on V4test, and Friday-scale prompt sizes are untested.

Brahma and the three builders (Scenario Builder, New Entry from Lore, Import from Instructions) all answer the same kind of request: *find what this instance already knows, then answer or draft*. On a year-old instance they do it slowly and with a great deal of second-guessing, mostly on the cheaper models. This spec gives those surfaces tools shaped for looking everywhere, one shared set of research instructions written for the weakest model that will read them, and loop-side guards that end a search the prompt failed to end.

---

## 1. What the runs show

Measured on the Friday instance, 18 November 2026: 1,125 Salon conversations, 184,547 messages, 68,138 memories, 84 document stores holding 12,471 file links (10,031 distinct files, 9.5 million characters of document text).

### 1.1 The Brahma Console (13 chats, about 40 turns, 12–18 November)

| Run | Model | Time | Model calls | Tool calls | Thinking (chars) |
|---|---|---|---|---|---|
| "What would Amy wear for formal staff meetings?" | DeepSeek v4.1 flash thinking | 344 s | 48 | 71 | 87,791 |
| The same for Friday | DeepSeek v4.1 flash thinking | 157 s | 18 | 34 | 30,980 |
| "What day was Camille delivered to Marion?" | DeepSeek v4 flash | 74 s | 17 | 30 | 25,848 |
| "What jobs is the Staff group missing?" | DeepSeek v4 flash | 94 s | 16 | 27 | 22,962 |
| Winnower description | Opus 5.5 | 75 s | 8 | 14 | 2,202 |
| Resonator wardrobe search | Opus 5.5 | 33 s | 6 | 8 | 877 |

- **The answer is in hand long before the run ends.** In the Amy run every source the final answer uses had been read by about 120 s. The thinking says "I have plenty" at 117 s and the run continues for 227 s more. It says "I have enough" or "I have plenty" 22 times, each followed by "let me also" (29) or "one more" (11).
- **It ran to the budget.** Friday's turn limit is 50; the run used 48. The stuck-loop guard fires only on identical calls, so it never fired.
- **`doc_grep` and `doc_list_files` fail every time.** All 18 calls returned "requires a project context" (`lib/tools/handlers/doc-edit/text-handlers.ts:591`, `:916`): the guards accept a project or a mount pool and the console supplies neither, though it sets `operatorOverride`.
- **So documents are read with hand-written SQL.** `run_sql` is the most-used tool: 212 calls, about 1 MB of results. The same three-table join is retyped dozens of times. An exact-path query with a wrong filename returns nothing and no hint; the Amy run spent seven queries on one file that did not exist.
- **Orientation is paid for on every run.** The Staff run's first eight model calls listed tables, found where group membership lives and mapped characters to vault ids. It then read 23 `identity.md` files to learn each member's job.
- **"Which conversation?" has no direct tool.** The Camille run found the scene at 55 s of 74 s, after keyword searches that returned nothing or 20,000 characters, two hand-written title-and-date queries, and the closing lines of eight conversations read one by one.
- **Results are large.** Average characters per call: `doc_read_file` 18,946, `read_messages` 14,169, `lookup_memories` 12,207, `lookup_character` 10,498. The Amy turn sent 350,782 prompt tokens.
- **The answers hedge.** DeepSeek answers mostly end with a caveat section ("One honest caveat", a footnote, a 600-character source list). Opus answers hedge less and often end with an offer.

### 1.2 The builders

New Entry from Lore, six runs on 18 November: 8 to 23 model calls, 58 to 240 s, requests up to 344,188 characters. "Requires a project context" appears 11 times in their transcripts — the same two broken tools. The Scenario Builder (a mount pool, so the two tools work) ran 4 calls in 19–47 s on Opus. Import from Instructions has no logged runs on Friday yet; it has the Atlas wizard's slate and will meet the same failures.

### 1.3 Why

1. **The tools are shaped for a character in a project**, not for an operator looking across 84 stores. The two that search and list are broken there, and nothing answers "which store, which conversation, who is in this group" in one call.
2. **The prompts push the wrong way.** The `research` agent-mode text (`buildAgentModeInstructions`) says to "use tools iteratively", "verify your work" and "build a comprehensive answer". `BRAHMA_ACCURACY_RULE` says "never make anything up" and has no counterpart for a question that asks for judgment, so "what would she wear" is treated as a fact to locate. The Atlas prompt says "search more than once if the first search is thin". Nothing says when to stop.
3. **The loop has no opinion about progress.** Its only guard is the duplicate-call signature.
4. **The model.** Opus and Sonnet stop by themselves. The DeepSeek and GLM thinking profiles do not, and those are the ones worth running when iterating.

## 2. Goals and non-goals

**Goals**

- A typical research question finishes in 8 model calls or fewer and under 60 s on a DeepSeek- or GLM-class profile.
- The shortcuts answer in names, titles, paths and dates. No tool the kit offers fails by construction on the surface it is offered to.
- A question about "everything" searches everything in one call; a question that names a subset stays inside it.
- One research instruction, shared by every surface that researches the instance, written for the weakest model.
- Final answers lead with the answer and carry a caveat only when the evidence earns one.

**Non-goals**

- No change to what a Salon character can reach, to the roster gate, or to per-document policy. The kit is not offered to characters.
- No model-specific prompt branches (decision in §3).
- No write tools. Every new tool is `read`.
- No change to memory recall, the Commonplace Book, or `search`'s ranking.
- No full-text index over documents yet (§5.3).

## 3. Decisions of record

| Question | Decision |
|---|---|
| New tools or repaired old ones | **Both.** The two guards are fixed (§4) because an offered tool must work. The research surfaces are then given purpose-built tools (§5) and no longer offered `doc_grep` / `doc_list_files`, so a weak model has one way to do each thing. |
| Who gets the kit | Surfaces that run for the operator: the Brahma Console (both modes), `@Brahma`, New Entry from Lore, Import from Instructions, and — the document half only, inside its mount pool — the Scenario Builder. Never a Salon character, never the Help chat. |
| How scope is expressed | One `ResearchScope` (§5.1): `everything` on the operator surface, `pool` under a mount pool. Tools take a `store` argument to narrow; omitted means the whole scope. |
| Per-model prompts | **No.** One discipline text (§7), written as explicit numbered procedure with stated budgets. Claude-class models are not harmed by it, and a model-id branch would need retuning with every new model. |
| Prompt or loop | **Both.** The prompt teaches; the loop enforces (§8). A weak model that ignores the prompt is still stopped. |
| The operator's turn budget | Stays the only hard ceiling (`resolveBrahmaMaxAgentTurns`). The guards in §8 are soft: they add a message, never end the run by themselves. |
| Instance-wide document search | A scan of `doc_mount_documents` / `extractedText` in SQL, then exact matching on the candidates. Friday's whole corpus is 9.5 MB and scans in milliseconds. FTS5 over documents is deferred with a stated trigger (§5.3). |
| Duplicated files | Hits are grouped by `fileId`. Conversation Summaries are 2,292 links to 704 files on Friday; one hit names the store it was found in and counts the others. |
| Addresses in results | Store **names** and `qtap://` URIs from the URI producers (`lib/doc-edit/uri-producers.ts`), never a bare mount id and never `self`. |
| `run_sql` | Stays, as the fallback for counts, aggregates, costs and settings. Its errors become self-correcting (§5.8). |

## 4. Repair first: the two guards

`handleGrep` and `handleListFiles` refuse unless `context.projectId || context.mountPool`. Both must also accept `context.operatorOverride === true`, as the path resolver already does (`lib/doc-edit/path-resolver.ts:314`, `:412`). With no project and no `mount_point`, an operator call searches or lists every store.

This is a bug fix independent of the rest and ships first. Regression tests sit beside `lib/doc-edit/__tests__/path-resolver.mountpool.test.ts`: an operator-surface call with a `mount_point`, and one without, both succeed.

## 5. The tools

All are defined per the `lib/tools/` rules: a Zod input schema as the single source, `parameters` from `zodToOpenAISchema`, a declared `xxxToolEffect` of `read`, an entry in `lib/tools/effects.ts` and in the tool-definition snapshot test, and a text-block description for profiles without native tool calling. Handlers extend `lib/tools/handlers/brahma-lookup-handler.ts` or sit beside it; the logic lives in a new `lib/research/` module so the builders' server-side briefs (§9) call the same functions the tools do.

### 5.1 Scope

```ts
// lib/research/scope.ts
export type ResearchScope =
  | { kind: 'everything' }                  // operator surface
  | { kind: 'pool'; pool: TieredMountPool } // Scenario Builder
```

`resolveResearchScope(toolContext)` is the one place a tool context becomes a scope: `operatorSurface` → `everything`; `mountPool` → `pool`, flattened with `includeParticipants: true`; anything else refuses. A `store` argument is resolved by name (case-insensitive, the document-store namespace is already unique) or by owner shorthand — `character:Amy`, `project:The Estate`, `group:Estate Staff`, `general` — through `resolveOwnerStore` and the tier resolvers in `lib/mount-index/reach.ts`. No tool walks a tier by hand. A store outside the scope is "not found", with the three nearest names offered.

Record tools (conversations, messages, memories, characters, groups, projects) require `everything` and join `OPERATOR_SURFACE_ONLY_TOOLS`. Document tools work under either scope.

### 5.2 The slate

| Tool | Scope | Replaces |
|---|---|---|
| `find_documents` (new) | either | `doc_grep`, path-`LIKE` SQL, content-`LIKE` SQL |
| `list_documents` (new) | either | `doc_list_files`, listing SQL |
| `lookup_conversations` (new) | everything | title/date SQL, reading conversation endings to identify them |
| `lookup_group`, `lookup_project` (new) | everything | membership SQL, per-member vault reads, store-id mapping |
| `lookup_wardrobe`, `lookup_atlas` (new) | everything | wardrobe and Atlas SQL over `Wardrobe/` and `Atlas/` files |
| `lookup_character` (changed) | everything | — |
| `lookup_messages`, `read_messages`, `lookup_memories` (changed) | everything | — |
| `doc_read_file` and the other `doc_*` readers (kept) | either | — |
| `search` (kept) | either | — |
| `run_sql` (changed) | everything | — |

`buildTools` gains `researchKit: 'off' | 'documents' | 'full'`. `'documents'` offers `find_documents` and `list_documents`; `'full'` adds the record tools. When the kit is on, `doc_grep` and `doc_list_files` are withheld. The lookup shortcuts move off the `sqlAccess` switch onto this one; `sqlAccess` governs `run_sql` alone.

### 5.3 `find_documents`

Finds files by what they say, what they are called, or both, across the scope.

| Argument | Meaning |
|---|---|
| `text` | Words or a quoted phrase to find in the content. Case-, accent- and typography-insensitive (the same folding as `doc_grep`'s literal search, `findAllMatches`). |
| `name` | Words that must appear in the path or filename. |
| `store` | Narrow to one store (§5.1). Omit to search everything in scope. |
| `folder` | Narrow to a folder, e.g. `Wardrobe`, `Conversation Summaries`. |
| `modified_since` | Only files changed on or after this date. |
| `limit` | Files to return, default 10, max 30. |

At least one of `text` and `name` is required. Each hit is one distinct file: store name, path, URI, modified date, size, the number of matches, up to three matching lines with one line of context each, and "also in N other stores" when the same file is linked elsewhere. Files are ranked by match count, then recency. The tail reports the total ("10 of 37 files; narrow with `store`, `folder` or more words").

A miss says what was searched and suggests a next step: "No file in 84 stores contains 'shoulder drop'. Nearest by name: …". When `name` matches nothing exactly, the nearest paths by edit distance are offered, which is the hint the exact-path SQL never gave.

Implementation: candidates come from one SQL scan (`doc_mount_file_links` ⟕ `doc_mount_documents`, `COALESCE(content, extractedText)`), filtered to the scope's mount ids; matching and snippets run in JavaScript on the candidates only. Reads of document text for snippets go through `readDocument` (`lib/documents/core/`) where the file is not database-backed. Under a `pool` scope the same per-document policy guards `doc_grep` applies today are applied (`lib/tools/handlers/doc-edit/shared.ts`); under `everything` the operator is unrestricted, as now.

**FTS5 is deferred.** Add a document full-text index (its own DDL module and triggers, on the model of `chat-message-fts.ts`) when either holds on a real instance: document text passes 200 MB, or the scan's p95 passes 300 ms. The tool's contract (whole words and phrases, folded) is written so the index can replace the scan without changing a result.

### 5.4 `list_documents`

Shows what a store or folder holds without flooding the context. Arguments: `store` (omit for the list of stores in scope: name, owner, kind, file count, last modified), `folder`, `depth` (default 2).

A folder with more than 25 files is collapsed to one line — `Conversation Summaries/ (412 files, newest 2026-11-18: "Rules in Type for the Man at the Gate.md")` — and expanded by listing that folder. Binary folders (`images/`, `photos/`, `character-avatars/`, `story-backgrounds/`) are always collapsed. The Amy run's first listing was 21,891 characters; this returns the same orientation in under 2,000.

### 5.5 `lookup_conversations`

Finds conversations, not lines. Arguments: `query` (words in the title or the conversation's summary), `character` (took part), `since` / `until`, `conversation` (an id or exact title: return that one in full), `limit` (default 10, max 30).

Each hit: id, title, first and last message dates, participants by name, line count, and the first 300 characters of `contextSummary`. With `conversation`, the whole summary and an outline (the first line of every tenth message). Titles on this instance are descriptive ("The Milk of Consent", "The Stillbirth of Camille"), so a date window plus a participant usually identifies the scene in one call. Participant names come from `resolveSpeakerNames`.

### 5.6 `lookup_group` and `lookup_project`

`lookup_group(group)`: the group's name and instructions, its document store with a two-level outline, and every member as one line — name, title, and the first sentence of `identity`. That line is what the Staff run read 23 vault files to get.

`lookup_project(project)`: description and instructions, the roster, every linked store (official first, `resolveProjectMountPointIds`) with an outline, the conversation count and the ten most recent conversations.

Both read raw rows and tolerate a broken vault (a member whose vault is unreadable is listed as such, not dropped).

### 5.7 `lookup_wardrobe` and `lookup_atlas`

`lookup_wardrobe(owner, query?, include_archived?)`: for a character, the dressing instructions and every piece they can reach through `loadWearablePool`, as title, slots, appropriateness and tier; for `project:`, `group:` or `general`, that tier's rail through `resolveWardrobeLocation`. `query` filters by words in title or description. Full descriptions come from `doc_read_file` on the URI each line carries.

`lookup_atlas(name?, owner?)`: with a name, the entry (aliases, graphic prompt, knowledge) and which tier holds it, resolved through `resolveAtlasLocation` per tier; without, the names in a tier. A name is matched through `lib/atlas/match.ts`' folding.

These two exist because the questions recur (the resonator wardrobe audit, the Mercury and Winnower entries). A further `lookup_*` is added only when a recurring question shows up in the logs the way these did.

### 5.8 Changes to existing tools

- **`lookup_character`** — adds the vault's store name and a two-level outline, the wardrobe piece count, group memberships and projects. New optional `fields` (any of `identity`, `description`, `personality`, `manifesto`, `physical`, `conversations`, `stores`) to return part of it; the default stays everything.
- **`lookup_messages`** — new `conversation` (search inside one conversation, by id or title) and `group_by: 'conversation'` (one line per conversation: title, dates, hit count, the best snippet). A plain search with more than 30 hits says how many there are and suggests grouping, instead of returning the newest 30 silently.
- **`read_messages`** — each line is capped at 1,500 characters with a `[+N characters]` marker; new `full: true` lifts the cap for the slice. Average result today is 14,169 characters.
- **`lookup_memories`** — default `limit` 8. Each hit is the summary, the first 300 characters, the date and the source conversation; `full: true` returns whole memories.
- **`run_sql`** — a `no such column` error is answered with the table's real columns, and `no such table` with that database's table names and, where the table exists in another database, which one. This retires the inspect-then-retry round trip the prompt currently has to teach. The read-only connection also registers a temporary view, `qt_documents(store, storeId, path, text, modifiedAt, fileId)`, so the fallback path no longer needs the three-table join. (Verify first that the handler's read-only connection accepts a `TEMP VIEW`; if not, drop the view and keep the error hints.)
- **Every kit result** has a soft ceiling of about 6,000 characters. A result that would exceed it is cut at a record boundary and ends with one line saying what was left out and which argument fetches it.

## 6. What "everywhere unless told otherwise" means

The kit's default is the whole scope. The instruction text (§7) tells the model to narrow only when the question does: a named character → `character`, a named project or group → `store`, "recently" / a date → `since`. The tools make the wide search cheap (ranked, deduplicated, capped) so a wide first call is the right first call, and they make narrowing one argument, never a second tool.

## 7. The research discipline

One module, `lib/research/discipline.ts`, exports the instruction text. Every surface in §9 includes it; none paraphrases it. It is plain English for a model and follows the house rule for model-facing text.

### 7.1 The shared text

Two variants differ only in the last section: `inquiry` (the answer is an answer) and `drafting` (the answer is a piece). Proposed wording for the shared part, to be tuned in live evaluation:

> ## How to research
>
> **1. Decide what kind of request this is before you call anything.** Say it to yourself in one line, then follow that route.
>
> - **A fact** ("how old is X", "what did Y say when…"): look it up. Budget: 4 tool calls.
> - **A when or where** ("what day did…", "which conversation…"): `lookup_conversations` with the people and a date window, or `lookup_messages` with `group_by: "conversation"`; then `read_messages` on the one conversation that fits. Budget: 6.
> - **A survey** ("everything that…", "who in the group…"): one wide call per source (`find_documents`, `lookup_group`, `lookup_wardrobe`), then answer from the lists. Do not open every item. Budget: 8.
> - **A judgment or a design** ("what would she…", "what are we missing", "design…", "draft…"): read who or what it concerns (`lookup_character` or `lookup_group`), make at most two searches for the specific subject, then decide. The record will not contain the answer, because the answer is your reasoning. Budget: 8.
>
> **2. Search wide first, then narrow.** Leave `store` and `character` out unless the request names one. One wide call that returns ranked results beats five narrow guesses.
>
> **3. Ask for several things at once.** When two lookups do not depend on each other, make both calls in the same step.
>
> **4. Stop when you can answer.**
> - For a fact, the first direct evidence is enough. Do not search again to confirm what you have read.
> - When you notice yourself thinking "I have enough", you do. The next thing you write is the answer.
> - If two searches for the same thing find nothing, it is not there. Say so in one sentence and move on. Do not try a third spelling.
> - Never read a whole conversation to check for a detail. Search inside it (`lookup_messages` with `conversation`).
> - Do not restate the request to yourself, and do not plan the answer more than once.
>
> **5. Truth and inference.** Facts about the operator's world come from what you read; never invent one. Reasoning from those facts is expected whenever the request asks what someone would do, what is missing, or what something should be. An inference is not an invention, and it needs no apology.

`inquiry` ends:

> **6. The answer.** Start with the answer. Name where a fact came from in a few words beside it (a conversation title and date, a file name). Add a caveat only if the sources disagree, the request rests on something untrue, or you could not find something the answer depends on, and then in one or two sentences, not a section. No list of everything you read. No closing offer unless the next step is a decision only the operator can make.

`drafting` ends:

> **6. The piece.** Research is for you; none of it appears in the piece unless the output format has a place for it. Where the sources are silent, follow the surface's own rule for gaps. Deliver the piece once you can write it with confidence; a better piece comes from a revision request, not from a tenth search.

### 7.2 What it replaces

- `BRAHMA_ACCURACY_RULE` and `BRAHMA_WRITING_ACCURACY_RULE` are rewritten to point at section 5 above (never invent a fact; inference on request is the job). `BRAHMA_ACCURACY_RULE` keeps "say so plainly and say where you looked" for the case where nothing is found, and loses it as a standing instruction.
- `BRAHMA_SQL_PROMPT`'s "Reach for the lookup shortcuts first" section is rewritten around the new slate and shortened; the "vault trap" section shrinks to two sentences, since `lookup_character`, `find_documents` and `qt_documents` cover it. "Trial and error is expected" goes. The "Typical routes" paragraph is superseded by section 1 above.
- `buildAgentModeInstructions` gains two kinds, `inquiry` and `drafting`, which state the budget and how to finish and nothing else. They do not say "use tools iteratively", "verify your work" or "comprehensive". The existing `research` text is unchanged and stays with assistant characters in the Salon and the Help chat. `runOneShotToolLoop` takes an `agentKind` (it hard-codes `'research'` today, lines 125 and 220); the console's `ConsoleTurnPlan` already has one.

### 7.3 Tool descriptions carry their own stopping hint

Weak models read tool descriptions more reliably than a long system prompt. Each kit tool's description ends with one sentence on when not to call it again: `find_documents` — "If it finds nothing, the text is not in any store; do not retry with small spelling changes." `read_messages` — "Read the slice around a hit. To look for a detail, search the conversation instead."

## 8. Loop guards

`lib/services/console-engine/loop-guard.ts` is already shared by the console engine and the one-shot loop. It grows from one rule to four. Each guard appends one user-role message to the next model call and is logged at `debug` with the run's surface; none ends the run, and each fires at most once per run except the checkpoint.

| Guard | Fires when | Message |
|---|---|---|
| **Checkpoint** | After model call 6, and again at 60% of the turn budget if that is later. | "Checkpoint: you have made N tool calls. If you can answer, answer now. If not, name in one line the single thing still missing and make only the call that fetches it." |
| **Declared sufficiency** | The model's reasoning or text matches the sufficiency list ("I have enough", "I have plenty", "that's enough", "enough to answer") and the same step still calls a tool, for the second time. | "You have said twice that you have enough. Do not call any more tools. Write the answer now." |
| **Repeated miss** | The same tool returns an empty or not-found result twice for near-identical targets (normalised arguments, edit distance on the search words). | "That has been searched for twice and is not there. Treat it as absent; do not search for it again." |
| **Repeated error** | The same tool returns the same error text twice. | "`<tool>` has failed twice with the same error. Do not call it again in this run; use `<alternative>` or answer from what you have." |

The sufficiency list is a small exported constant with a test; it is English-only by design, since the reasoning it reads is the model's own in the language of the prompt. The existing duplicate-call guard and the forced final turn are unchanged. In Writing Assistant and builder runs the messages use the `drafting` wording ("deliver the piece").

`DEFAULT_BRAHMA_MAX_AGENT_TURNS` stays 10. With the checkpoint in place the help text can recommend 20–25 for a large instance in place of the 50 Friday needed.

## 9. Surface by surface

| Surface | Scope | Kit | Discipline | Agent kind | Other changes |
|---|---|---|---|---|---|
| Brahma Console | everything | `full` | `inquiry` | `inquiry` | Prompt rewritten per §7.2. `docToolsMode: 'full'` keeps the write tools. |
| Brahma Writing Assistant | everything | `full` | `drafting` | `writing` (budget text aligned with `drafting`) | Read ceiling unchanged. |
| `@Brahma` (Carina answerer) | everything | `full` | `inquiry` | `inquiry` | Inherits the calling turn's `effectCeiling` as now. |
| New Entry from Lore | everything, when *search the stores* is on | `full` | `drafting` | `drafting` | Brief (below). "Search more than once if the first search is thin" is removed. |
| Import from Instructions | everything, when *search the stores* is on | `full` | `drafting` | `drafting` | Its "stop once you can design with confidence" line is superseded by the shared text. Its brief already exists. |
| Scenario Builder | pool | `documents` | `drafting` | `drafting` | Brief (below). Still documents only: no record tools, no SQL. |
| Salon characters, Help chat, Calliope | — | off | — | unchanged | Nothing changes. |

**Briefs.** Import from Instructions already hands the model what the server knows before the loop starts. The other two builders get the same treatment, built from the `lib/research/` functions the tools call:

- *New Entry from Lore*: `find_documents(text: subject)` (top 8 files with snippets) and `lookup_messages(query: subject, group_by: 'conversation')` (top 8 conversations), placed in the user message under "What the stores and conversations already show". Most runs then need only to open two or three documents.
- *Scenario Builder*: `find_documents(text: location)` inside the pool, top 8.

A brief is evidence, not instruction: it is delimited and labelled as search results, and a brief that finds nothing says so in one line, which tells the model not to repeat the search.

All four builders keep their own output contracts, parsers and ceilings. A new one-shot surface still calls `runOneShotToolLoop`; none copies the loop or the discipline.

## 10. Chokepoints this must respect

- Tool definitions, effects and the snapshot test (`lib/tools/`); every call through `resolveToolPermit`; record tools in `OPERATOR_SURFACE_ONLY_TOOLS`.
- A tool context never carries both `operatorSurface` and `mountPool`.
- Reach through `lib/mount-index/reach.ts`; document reads through `lib/documents/core/`; wardrobe through `loadWearablePool` / `resolveWardrobeLocation`; Atlas through `resolveAtlasLocation`.
- Message text through `qt_text()`, decoded after `ORDER BY … LIMIT`; message search through the FTS index and `fts-query.ts`, never `LIKE`.
- Speaker and participant names through `resolveSpeakerNames`.
- Published addresses name the store; no result says `self`.
- Brahma never invents; no console imports the story-latitude section.
- Debug logging on every new path.

## 11. Schema, export and documentation

- **No schema change, no migration, no export or backup change.** Nothing is stored. (A document FTS index, if its trigger is ever met, would be a derived index with its own DDL entry and no export.)
- `help/brahma-console.md`: what the Console can look up, the turn-budget advice. `help/atlas.md`, `help/scenario-builder.md`, `help/wardrobe.md`: one line each where behaviour visibly changes (faster drafts, the same toggles).
- `docs/developer/API.md` is unaffected (no route changes). `CLAUDE.md` gains one chokepoint entry for `lib/research/` (scope, the kit, the discipline text, the guards).
- `docs/CHANGELOG.md` per phase.

## 12. Phases

1. **Repair.** The two guards (§4) with tests. Ships alone.
2. **Discipline and guards.** `lib/research/discipline.ts`, the two new agent kinds, `agentKind` on the one-shot loop, the four guards, the rewritten accuracy rules and SQL prompt, applied to all surfaces in §9. No new tools yet; this phase alone should remove most of the post-"I have enough" time.
3. **Document tools.** `ResearchScope`, `find_documents`, `list_documents`, the `researchKit` switch, withdrawal of `doc_grep` / `doc_list_files` from kit surfaces. Scenario Builder joins here.
4. **Record tools.** `lookup_conversations`, `lookup_group`, `lookup_project`, `lookup_wardrobe`, `lookup_atlas`, and the changes to the four existing lookups.
5. **Economy and fallback.** Result ceilings, `run_sql` error hints, the `qt_documents` view.
6. **Briefs** for New Entry from Lore and the Scenario Builder.

Each phase is separately shippable and separately measurable.

## 13. Verification

**A fixed question set**, run on V4test (never Friday) against one DeepSeek-class, one GLM-class and one Claude profile, before phase 2 and after each phase. The set is the questions in §1.1 restated against V4test's fixtures, one of each kind in §7.1, plus one New Entry from Lore subject and one Scenario Builder location.

Recorded per run from `chat_messages` and `llm_logs`: model calls, tool calls, failed tool calls, seconds, prompt tokens, characters of reasoning, which guards fired, and — read by a person — whether the answer is correct and whether it carries an unearned caveat.

Targets, on the DeepSeek-class profile:

| Measure | Now (Friday) | Target |
|---|---|---|
| Model calls, judgment question | 48 | ≤ 8 |
| Seconds, judgment question | 344 | ≤ 60 |
| Model calls, when/where question | 17 | ≤ 6 |
| Tool calls failing by construction | 18 of 18 for two tools | 0 |
| Prompt tokens per turn | 350,782 | ≤ 80,000 |
| Calls after first declared sufficiency | up to 30 | ≤ 1 |
| New Entry from Lore, model calls | 8–23 | ≤ 6 |

Correctness must not fall: every fact in an answer is traced to a source by the reviewer, as now.

**Tests.** Unit tests for scope resolution (including a store outside the pool), `find_documents` folding, deduplication and the miss message, `list_documents` collapsing, each guard's trigger and its fire-once rule, the snapshot and effect entries, and a grep-test that no surface in §9 spells its own research instructions or offers `doc_grep` beside the kit.

## 14. Open questions

1. **Tool results carried across turns.** The second turn of the Amy chat sent 222,090 prompt tokens. If the engine re-sends earlier turns' tool results in full, eliding them (keeping the call and a one-line digest) would cut follow-up turns sharply. Needs a read of how `runConsoleTurn` rebuilds history before it is specified.
2. **Does `lookup_character` default to everything?** At 10,000–15,000 characters it is the largest routine result. A brief default with `fields` for the rest would save tokens and risks a second call on most character questions. Decide from the phase-2 measurements.
3. **Declared sufficiency on models that hide reasoning.** The guard reads reasoning text. For a profile that returns none, only the checkpoint applies. Acceptable, since those are mostly the models that do not need it.
4. **A per-profile research budget.** If one profile keeps needing the guards, a per-profile checkpoint position may be worth a setting. Not proposed now.

## 15. As built

Built as specified, with these notes. The code is in `lib/research/`; the guards are in `lib/services/console-engine/loop-guard.ts`.

- **Files.** `scope.ts` (scope, store arguments, owners), `documents.ts` (`find_documents`, `list_documents`), `outline.ts` (folder outlines, split out so the Brahma lookup handler does not import the document core), `conversations.ts` (conversation resolution, split out for the same reason), `characters.ts` (`resolveCharacterRef`, moved from the Brahma lookup handler), `records.ts` (the five record tools), `text.ts` (folding, nearest names, the 6,000-character ceiling), `discipline.ts`, `brief.ts`, `sql-view.ts`, `result.ts`. Tool handlers are `lib/tools/handlers/research-kit-handler.ts`.
- **Results are text.** A kit tool returns prose-shaped text, wrapped as `{ kitText }` by the executor and handed to the model as is (`tool-execution.service.ts`), so paths and snippets are not JSON-escaped. The changed Brahma lookups still return JSON, cut at a record boundary by `capRecords`.
- **`isResearchKitKind` and `researchGuardFor` live in `loop-guard.ts`**, not the agent-mode resolver, because several suites mock the resolver.
- **Wardrobe lines carry a URI** from `wardrobeItemOwnPath`; full descriptions are inlined when three or fewer pieces match. **Atlas results carry no URI**; the entry's knowledge comes back inline.
- **`lookup_group` lists no conversations** (a group has no chats of its own); `lookup_project` does.
- **`lookup_messages.totalHits` is a label** ("12", or "at least 200" when the over-fetch was full), not a number.
- **Text-block tools.** The text-block prompt documents the new tools, and the parser no longer turns `text`, `name`, `store`, `folder`, `since` and the like into numbers (`TEXT_ONLY_PARAMS`).
- **Open question 2** is left as written: `lookup_character` still returns everything by default, with `fields` to narrow it. Decide from the §13 measurements.
- **Tests.** `lib/services/console-engine/__tests__/research-loop-guard.test.ts`, `lib/research/__tests__/documents.test.ts`, `lib/research/__tests__/surfaces.test.ts` (the §13 grep-test), `lib/doc-edit/__tests__/doc-tools.operator-surface.test.ts`, additions to `run-sql-handler.test.ts` and `plugin-tool-builder.scenario.test.ts`, and the tool snapshots and picker entries.

## 16. Live evaluation, V4test, 2026-11-19

V4test is small (72 characters, 99 Salon conversations, 77 stores), so this checks behavior and correctness, not Friday-scale cost. Turn budget set to 25 for the runs, then restored to 10. Profiles: `deepseek-v4-flash` (thinking, profile `max_tokens` 1000), `glm-5.3-flash`, `claude-sonnet-4-6`. Prompt tokens include cached reads. No pre-kit baseline was run here; the one earlier V4test Console run of the Packard question (3 November, before the kit, on gpt-5) made a single `lookup_memories` call and answered from Riya's memory of the date, so it is not a comparable baseline.

**Questions** (one per §7.1 kind): fact — "What does the Wandering Needle do, and who has it?"; when/where — "When did Tester decide to sell the Packard for a dirigible share, and in which conversation (ID, title, date)?"; survey — "Who belongs to the Aeronauts Club, and what does each member do there?"; judgment — "What would Lorian wear to a formal dinner at the Aeronauts Club?". Builders: New Entry from Lore for "the Skyhook Aerodrome"; the Scenario Builder, in-world, for the Aerodrome at Vey's Crossing in festival week, Lorian cast, project *Scenario Builder Test*.

**Console** — model calls / seconds / tool calls (failed) / prompt tokens, and whether the answer was right:

| Question | DeepSeek | GLM | Sonnet |
|---|---|---|---|
| Fact | 5 / 7 s / 5 (0) / 60k — right | 6 / 26 s / 6 (0) / 74k — right | 4 / 8 s / 3 (0) / 48k — right |
| When/where, first round | 6 / 14 s / 9 (1) / 89k — right | 5 / 28 s / 5 (0) / 61k — right | 4 / 6 s / 3 (0) / 47k — **wrong** ("no record") |
| When/where, after fix 2 | 5 / 10 s / 5 (0) / 75k — right | 4 / 19 s / 3 (0) / 49k — right | 4 / 9 s / 3 (0) / 50k — right |
| Survey, first round | 5 / 8 s / 5 (0) / 62k — right | 5 / 22 s / 4 (0) / 60k — right | 6 / 19 s / 7 (1) / 80k — partial (missed the lore file) |
| Survey, after fix 3 | 6 / 10 s / 7 (0) / 76k — right | — | — |
| Judgment | 7 / 15 s / 9 (0) / 95k — right | 5 / 29 s / 6 (0) / 62k — right | 5 / 19 s / 6 (0) / 64k — right |

Against §13 (DeepSeek): judgment 7 calls (≤ 8) and 15 s (≤ 60); when/where 5–6 calls (≤ 6); no tool failing by construction once fix 1 was in; no run continued after declaring sufficiency (the sufficiency guard never fired). Prompt tokens per turn 60k–95k against ≤ 80k: over on two of four. The checkpoint fired once (a 9-call survey run before fix 3); the repeated-miss guard once (Sonnet's wrong answer, below). Answers lead with the answer; DeepSeek and GLM still add a short caveat paragraph to judgment answers.

**Builders** — model calls / seconds:

| | DeepSeek | GLM | Sonnet |
|---|---|---|---|
| New Entry from Lore | 5 / 13 s — **no draft** | 2 / 28 s — good draft | 2 / 21 s — good draft |
| Scenario Builder | 4 / 15 s — **no scenario** | 4 / 37 s — good scenario | 2 / 9 s — good scenario |

Both DeepSeek failures, run twice: the last call ended `finish_reason: length` at exactly 1,000 completion tokens, the profile's `max_tokens`, spent on thinking. A profile setting, not the kit. GLM and Sonnet built from the brief in two calls where they could.

**Fixed during the evaluation:**

1. *A store's address.* DeepSeek and Sonnet each built a URI from the store shorthand (`qtap://character:Tester/…`, `qtap://group:Aeronauts Club/…`), which `doc_read_file` cannot resolve. `storeAddress` (`lib/research/outline.ts`) now gives every place that names a store its real address — `lookup_character`'s vault (`address`), the group and project store lines, and the `list_documents` outline head — and the `store` argument's description says the shorthand is not an address.
2. *`lookup_messages` matched a phrase, not words.* The message index matches a query as one phrase, in order (the search bar's contract, `help/search.md`), but the tool said "every word must appear". Sonnet searched "Packard dirigible", found nothing twice, and reported no record. When a query of several words finds nothing as a phrase, `lookup_messages` now searches its longest word and keeps messages holding every word in any order (`matchedAs` says so), and the description says what it does.
3. *Group members before the store.* `lookup_group` listed the members after the whole store outline; DeepSeek went to `run_sql` to find them. Members now come first, closed by "That is every member.", and the store follows.
4. *The one-shot loop's salvage named the wrong cause.* An early empty answer was reported as "I reached my 25-turn budget" after 4 turns. It now says the turn count, and names the output-token limit when the provider reports a cut-off (`isTruncatedFinishReason`).

**Not fixed:** the console engine re-sends the whole reasoning-so-far on each reasoning chunk (a DeepSeek run streamed 1.4 MB). It predates the kit; display only.
