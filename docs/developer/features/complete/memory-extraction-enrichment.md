# Memory Extraction Enrichment — Canon Reweighting, Orienting Context, and Targeting Tags

Status: **EXTRACTION SIDE IMPLEMENTED (4.7-dev)** — canon reweighting, orienting
context, targeting tags, and the `projectId` write-path prerequisite are done.
The recall-side scope enforcement (down-weighting `scope: narrow` memories whose
`projectId` differs from the current chat) remains the tracked follow-up below.

## Motivation

The per-turn memory extractor (`lib/memory/memory-processor.ts` →
`lib/memory/cheap-llm-tasks/memory-tasks.ts`) currently judges novelty against a
single character field — `identity` — and emits memories with no temporal,
scope, or topical structure. Two consequences:

1. **Weak canon.** `identity` is the shallowest vantage-point field (what
   strangers know on sight). For a character extracting memories *about
   themselves*, the load-bearing fields — `manifesto`, `personality`,
   `description` — never reach the prompt, so the extractor can't tell "already
   who they are" from "genuinely new."
2. **Untargetable output.** Stored memories carry free-form keywords only.
   There is no way to ask "what was true at this moment vs. now," "is this
   project-specific or always-true," or "what is this memory primarily about."

This change feeds richer per-vantage-point canon, supplies non-canonical
orienting context (project description + rolling chat summary), and has the
model tag every memory along three controlled axes that materialize into the
existing `keywords` array.

## Design decisions (confirmed)

- **Prompt-cache prefix stays byte-stable.** Project description and chat
  summary go in the per-call **footer** (the variable region), never the shared
  instruction body. Preserves cheap-LLM prefix-cache hits on long extraction
  runs.
- **Tags fold into `keywords`.** The model emits structured `temporal` /
  `scope` / `context` JSON fields; the parser validates them against closed
  vocabularies and materializes them into the existing `keywords: string[]`
  array. **No schema, migration, DDL, qtap-export, or backup changes.**
- **Vantage-point-correct canon:**
  - **SELF pass** (character about themselves): `manifesto` + `personality` +
    `description` + `identity`, rendered in that priority order so the
    manifesto reads as the axiomatic floor.
  - **OTHER pass** (observer about another participant): observer's vault
    `Others/<name>.md` first (unchanged); fallback is **`identity` only**, with
    `description` used **only when `identity` is empty**. Never `personality`
    or `manifesto` — no observer sees another character's interior or axiomatic
    core. This respects the vantage-point semantics in `CLAUDE.md`.
- **Context vocabulary (closed, 7 words):** `philosophy`, `relationships`,
  `history`, `banter`, `mannerisms`, `trivia`, `information`.

## The three targeting axes

Every extracted memory carries exactly one value from each axis. Emitted by the
model as JSON fields, normalized by the parser, appended to `keywords`.

| Axis | Field | Allowed values | Keyword form | Default if missing/invalid |
|---|---|---|---|---|
| Temporal hinge | `temporal` | `past` · `moment` · `present` · `future` | bare word | `present` |
| Scope hinge | `scope` | `narrow` · `wide` | `scope: narrow` / `scope: wide` | `wide` |
| Primary context | `context` | the 7 words above | bare word | `information` |

Semantics the prompt teaches the model:

- **temporal** — `past`: was true, no longer. `moment`: true only at this
  instant in the scene. `present`: true now and ongoing. `future`: a stated
  intent/commitment not yet realized.
- **scope** — `narrow`: true only inside this project/story. `wide`: true of the
  character regardless of project. The PROJECT line in ORIENTING CONTEXT is what
  lets the model judge this.
- **context** — single dominant topic of the memory.

## Data sources (all already reachable at extraction time)

The `MEMORY_EXTRACTION` handler already loads the full `chat` record and
hydrates every participant `Character`. No new background-job payload fields.

| Datum | Source | New query? |
|---|---|---|
| `manifesto`, `personality`, `description`, `identity` | hydrated `Character` in `participantCharacters` | none |
| `chat.contextSummary` (rolling Librarian summary) | column on the chat record the handler already fetched | none |
| project `description` | `repos.projects.findById(chat.projectId)` → store-resident `description.md` | one lookup, only when `chat.projectId` is set |

## Prompt structure (cache-safe)

```
<stable instruction body — WHAT TO PICK / SKIP / DEDUP / IMPORTANCE / TAGS>   ← cached prefix
                                                                              ← variable footer begins
ORIENTING CONTEXT — background only, never a source of memories
PROJECT: <project.description, truncated>
STORY SO FAR: <chat.contextSummary, truncated>

CONTEXT
SUBJECT / OBSERVER + SUBJECT canon block(s)
```

New WHAT-TO-SKIP line: *"Never extract a memory whose only source is the
ORIENTING CONTEXT block — use it solely to judge a memory's temporal frame,
scope, and context tag."*

New TAGS instruction block (both SELF and OTHER bodies): enumerate the three
axes, their allowed values, and require exactly one of each per memory object.

## Scope enforcement uses `Memory.projectId`, NOT a name keyword

The `memories` table **already has a `projectId` column** (and `chatId`).
Scope comparison must use it — a `project: <name>` keyword would be a
denormalization bug: keywords freeze at write time, so a project rename or a
duplicate display name silently breaks every `scope: narrow` comparison and
leaks/hides memories incorrectly. The ID is rename-proof and collision-proof
and is the single source of truth.

**Prerequisite — derived memories must actually carry `projectId`.**
`CreateMemoryOptions` has `chatId` but the extraction write path never sets
`projectId`, and the gate's insert passes only `chatId`. So every
auto-extracted memory currently has `projectId: null`. This must be fixed for
scope enforcement to have anything to compare:

- `CreateMemoryOptions` already could carry it; ensure `projectId` is plumbed
  through the gate's INSERT (currently only `chatId` is).
- `writeCandidate` / `processTurnForMemory` set `projectId` from the chat.
- The handler reads `chat.projectId` (already on the fetched chat record).

**Recall-side check (separate follow-up, recall path — not this doc's
extraction work):** when recalling for a chat, if a candidate memory is
`scope: narrow` AND `memory.projectId` is set AND
`memory.projectId !== currentChat.projectId`, down-weight or exclude it.

## Back-fill via regenerate-all is automatic

`regenerate-all` fans out to `regenerate-chat`, which **already wipes the
chat's memories before re-extracting** (`deleteMemoriesByChatIdWithVectors`
runs first). Once the prompts emit the three tags, a regenerate run deletes the
old untagged rows and rebuilds tagged ones — no clear-then-rebuild step to add,
no migration. The same run also back-fills `projectId` onto derived memories
once the write-path prerequisite above is in place.

## Touch list

| File | Change |
|---|---|
| `lib/memory/cheap-llm-tasks/canon.ts` | Multi-field canon assembly; SELF gets all four fields (manifesto-first), OTHER gets identity-only with description fallback when identity empty |
| `lib/memory/cheap-llm-tasks/types.ts` | Add optional `temporal` / `scope` / `context` to `MemoryCandidate` |
| `lib/memory/cheap-llm-tasks/memory-tasks.ts` | TAGS instruction block in both prompt bodies; ORIENTING CONTEXT footer; thread `projectDescription` + `chatContextSummary` params; parser validates + normalizes the three tags and appends to `keywords` (both `parseMemoryCandidateArray` and `parseOtherCandidatesBySubject`) |
| `lib/memory/memory-processor.ts` | Carry `projectDescription` / `chatContextSummary` / `projectId` on `TurnMemoryExtractionContext`; pass through to both extraction calls and into `writeCandidate` |
| `lib/memory/memory-service.ts` | Plumb `projectId` from `CreateMemoryOptions` through the gate INSERT (currently only `chatId` is written) |
| `lib/background-jobs/handlers/memory-extraction.ts` | Load project when `chat.projectId` set; read `chat.contextSummary`; read `chat.projectId`; populate the new context fields |
| `lib/memory/cheap-llm-tasks/__tests__/` | Tests: canon assembly per pass; tag normalization (valid passthrough, invalid→default, missing→default); keyword materialization; `projectId` written on derived memory |
| `docs/CHANGELOG.md` | Terse dev-facing entry (no steampunk voice) |
| `help/*.md` | If memory tagging is user-visible (it is, via memory search), document the new tag vocabularies in the relevant memory help file with correct `url` frontmatter + `help_navigate` |

No changes to: memory schema (projectId column already exists), DDL.md,
qtap-export schema, migrations, backups, tool-definition snapshot (keywords
already `string[]`).

## Debug logging

Every new branch fires `logger.debug` per project conventions: canon assembly
logs which fields were present per character per pass; the parser logs any tag
that was defaulted (invalid/missing) so silent model drift is visible in the
per-message debug memory logs.

## Implementation artifacts (literal — transcribe, do not invent)

These are the exact strings/shapes to use. Where a block says "append to the
existing body," keep all current wording and add only what is shown.

### A. JSON output shape (both passes)

Each candidate object gains three fields. SELF objects keep their existing keys;
OTHER objects also keep `subjectIndex`. Full shape:

SELF candidate:
```json
{
  "content": "...",
  "summary": "...",
  "keywords": ["...", "..."],
  "importance": 0.65,
  "temporal": "present",
  "scope": "wide",
  "context": "philosophy"
}
```

OTHER candidate (adds `subjectIndex`, already required today):
```json
{
  "subjectIndex": 1,
  "content": "...",
  "summary": "...",
  "keywords": ["...", "..."],
  "importance": 0.6,
  "temporal": "past",
  "scope": "narrow",
  "context": "history"
}
```

`temporal`, `scope`, `context` are model-emitted strings. The parser validates
them (Section D), drops them from the object, and materializes them into
`keywords`. They never persist as top-level memory fields.

### B. TAGS instruction block (append verbatim to BOTH `selfBodyForCap`
and `otherBodyForCap`, after the OUTPUT section, before the final
"Return JSON array only" line)

```
TAGS — every memory object MUST carry exactly one value from each axis.
These describe the memory's frame; they do not change its content.

  temporal  one of: past | moment | present | future
            past    — was true once, no longer true
            moment  — true only at this instant in the scene
            present — true now and expected to stay true
            future  — a stated intent or commitment not yet acted on

  scope     one of: narrow | wide
            narrow  — true only inside this project / story
            wide    — true of the subject regardless of project
            Use the PROJECT line in ORIENTING CONTEXT to decide. When in
            doubt, prefer wide.

  context   one of: philosophy | relationships | history | banter |
            mannerisms | trivia | information
            The single dominant subject of this memory. Pick one.
```

### C. WHAT TO SKIP — append this bullet to the existing skip list in
BOTH bodies

```
- Never extract a memory whose only source is the ORIENTING CONTEXT block.
  That block is background for judging temporal frame, scope, and context
  only — it is not itself a source of memories.
```

### D. ORIENTING CONTEXT footer (assembled in the prompt builders,
placed AFTER the stable body, BEFORE the existing CONTEXT block)

Builder logic: include each line only when its source is non-empty. Omit the
whole block when both are empty. Truncate each value to **1500 characters**
(simple `value.slice(0, 1500)`, append `…` when truncated — character count,
not tokens, to avoid pulling in a tokenizer on the cheap path).

Rendered form:
```
ORIENTING CONTEXT — background only, never a source of memories
PROJECT: <project.description, ≤1500 chars>
STORY SO FAR: <chat.contextSummary, ≤1500 chars>
```

### E. Canon render format

Replace the single shared `renderCanonBlock` body with a field-labelled
assembly. Each field appears only when non-empty; if none are present, emit the
existing `NO_CANON_FALLBACK` line. Header line unchanged
(`ALREADY ESTABLISHED about <name>`).

SELF pass (all four, this order):
```
ALREADY ESTABLISHED about <name>
[MANIFESTO] <manifesto>
[PERSONALITY] <personality>
[DESCRIPTION] <description>
[IDENTITY] <identity>
```

OTHER pass (identity only; description ONLY when identity is empty):
```
ALREADY ESTABLISHED about <name>
[IDENTITY] <identity>
```
or, when identity is empty but description exists:
```
ALREADY ESTABLISHED about <name>
[DESCRIPTION] <description>
```

Implement as two builder paths (e.g. `renderSelfCanonBlock` /
`renderOtherCanonBlock`) rather than a boolean flag on one function, so each
pass's field policy is explicit and independently testable. `loadCanonForSelf`
gains `manifesto` / `personality` / `description` inputs (already on the
hydrated `Character`); `loadCanonForObserverAboutSubject`'s identity-fallback
gains the description-when-identity-empty rule (vault `Others/<name>.md`
remains the top source, unchanged).

### F. Parser normalization (Section D vocab → keywords)

In BOTH `parseMemoryCandidateArray` and `parseOtherCandidatesBySubject`, after
building each candidate's free `keywords`:

```
const TEMPORAL = new Set(['past','moment','present','future'])
const SCOPE    = new Set(['narrow','wide'])
const CONTEXT  = new Set(['philosophy','relationships','history','banter',
                          'mannerisms','trivia','information'])

const temporal = TEMPORAL.has(item.temporal) ? item.temporal : 'present'   // default
const scope    = SCOPE.has(item.scope)       ? item.scope    : 'wide'      // default
const context  = CONTEXT.has(item.context)   ? item.context  : 'information' // default

// log.debug when a value was defaulted (invalid/missing) for drift visibility
candidate.keywords = [
  ...freeKeywords,
  temporal,                 // bare word: 'past' | 'moment' | 'present' | 'future'
  `scope: ${scope}`,        // 'scope: narrow' | 'scope: wide'
  context,                  // bare word from CONTEXT
]
```

`temporal`/`scope`/`context` are NOT written as separate memory fields — they
exist only on the transient `MemoryCandidate` and are consumed here.

### G. Worked end-to-end example (acceptance check)

Given a SELF extraction where Ariadne commits, this turn only and for this
project, to a summarizer refactor, the model emits:
```json
{
  "content": "I committed to restructuring the summarization pipeline around a shared-base-plus-witness-set design after Charlie agreed it was the highest-leverage fix.",
  "summary": "committed to summarizer refactor",
  "keywords": ["summarizer", "commitment", "architecture"],
  "importance": 0.85,
  "temporal": "future",
  "scope": "narrow",
  "context": "philosophy"
}
```
After the parser, the persisted memory has:
```
keywords = ["summarizer","commitment","architecture","future","scope: narrow","philosophy"]
projectId = <the chat's projectId>     // from the write-path prerequisite
```
A later recall in a DIFFERENT project sees `scope: narrow` +
`projectId !== currentChat.projectId` and down-weights/excludes it.

## Follow-up: recall-side scope enforcement (separate change)

Down-weighting/excluding `scope: narrow` memories whose `projectId` differs
from the current chat's `projectId` is a **recall-path** change, in a different
set of files from this extraction work. Tracked as a distinct follow-up so this
doc's change stays a clean extraction-side unit. The extraction-side
prerequisite (writing `projectId` onto derived memories) is included here
because without it the recall check has nothing to compare against.
