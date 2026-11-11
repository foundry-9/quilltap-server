# Refactor 4.13 — Specs from the whole-tree audit

**Status:** Proposed (2026-11-10). Written against `HEAD` = 167d06503, after the 4.13 release-checklist passes. Each spec is self-contained; this page is the inventory, the ranking, the bug list, and what was examined and left alone. It follows the shape of the [4.12 set](refactor-4-12.md).

The brief: sweep the tree for refactors (encapsulation, single source of truth, SRP, DRY, KISS, YAGNI; data backend first, then the API, then the front end; plus API conformance, `qt-*` classes, dead code, security and stubs) and for bugs. Bugs that were verified against the code are filed as issues #164–#196. Refactors are the specs below, sized to be run one at a time.

## How to run a spec

Each spec is written to be handed to a model as-is, with CLAUDE.md. Three things hold for all of them:

1. **Line numbers are from the audit and will drift.** Find each site by name.
2. **Each spec separates what was verified by reading from what was only traced.** A traced item gets a failing test before it gets a fix; if the test passes on `HEAD`, strike the item and say so in the spec.
3. **Each spec ends with decisions for the human.** Settle those before the phases that depend on them. A newly confirmed bug is filed (`gh issue create --label bug`, with the human's go-ahead) before it is fixed.

## The specs

| # | Spec | What it removes or settles | Size | Risk | Fixes |
|---|---|---|---|---|---|
| 1 | [One substitute call in provider failover](refactor-4-13-failover-substitute-call.md) | Three call sites thread a bag of values built for the primary profile to whichever profile is being tried. Cross-provider failover with native tools fails; a tool-only answer is thrown away. One `callSubstitute` owns everything that depends on the profile. | Medium | Medium (turn path) | #181, #182 |
| 2 | [One insert policy and one id-remap table for restore and import](refactor-4-13-import-restore-insert-and-remap.md) | Backup restore and `.qtap` import each answer "what if it exists" and "which fields hold ids" per entity kind, by hand; they disagree on ten points. One helper and one declarative table, with a schema-driven guard test. 900–1,200 lines. | Large | Medium | #188, #190, #193, #195 |
| 3 | [One delete path and one projection in the mount-index repositories](refactor-4-13-mount-index-delete-path.md) | Five functions delete beside `deleteWithGC`, each knowing fewer of the rules; chunks rely on a foreign key fresh installs lack. One `removeLinkTx`; eight copies of a joined SELECT and three spellings of path equality become one each. | Medium | Low–Medium | #189, #191 |
| 4 | [The job queue's dedupe rule and the query translator's quiet failures](refactor-4-13-queue-and-query-translator.md) | Fifteen hand-rolled enqueue-with-dedupe bodies that disagree on absorbing into a running job; a translator that mistranslates `$regex`, `$eq: null` and sort fields into empty results; about 40 `as any` casts that hid it. | Medium | Low (queue), Medium (translator) | #192, #194, #196 |
| 5 | [API inputs: schemas instead of hand validation](refactor-4-13-api-input-schemas.md) | About 1,300 lines of field-by-field validation whose create and update halves disagree; a 36-argument settings writer; an 890-line GET that hand-copies the tool registry and has drifted; seven pagination parsers. Includes the full table of 38 route files that depart from the API standard. | Large | Medium (profiles), Low elsewhere | #165–#168 |
| 6 | [One stream lifecycle in the Salon, then the SalonView split](refactor-4-13-salon-stream-lifecycles.md) | Four stream lifecycles in an 1,846-line hook, each with its own abort controller and `finally`; the split the 4.12 set deferred, now unblocked. | Large | Medium | #172, #173 |
| 7 | [Client server-state: the remaining hand-rolled reads and writes](refactor-4-13-client-server-state.md) | 67 effect-and-state loaders outside the query cache, 32 near-identical settings setters, five chat PUTs beside the helper that does it correctly. Refetches overwrite drafts; other views go stale. | Large | Medium, spread thin | #170, #176 |
| 8 | [One modal shell](refactor-4-13-modal-shell.md) | 52 files hand-build a dialog overlay and disagree on portal, Escape stacking, backdrop and z-index; 32 paint under the workspace toolbar. Everything onto `BaseModal`, with a lint gate. | Large | Low per dialog | #171 |
| 9 | [An item-store kernel for the Wardrobe, the Inventory and the Atlas](refactor-4-13-item-family-kernel.md) | The Atlas was built by copying the Inventory's storage layer; 550–750 lines are verbatim across the three. The copies disagree on tracking unread tiers, within-tier order and name folding. | Large | Medium | #186 |
| 10 | [Consolidation writes as deltas; one date stamp and transcript renderer](refactor-4-13-memory-consolidation-deltas.md) | Consolidation is the last memory path writing absolute counts and links from a stale snapshot. Five UTC-day date slices and seven role-labelled transcript formatters in prompt-building code. Mostly traced, not reproduced: its first phase decides its scope. | Medium | Medium–High (memory data) | #187 |
| 11 | [Dead code knip cannot see, legacy shims, raw token colours](refactor-4-13-dead-code-and-leftovers.md) | About 5,100 unimported lines under `migrations/lib`, some sixty exports kept alive only by their tests, three no-op shims, 689 raw token-colour utilities, existing `qt-*` component classes not being used. Behaviour-neutral. | Medium | Low | #179, #180 |

A twelfth spec covers security hardening. It is deliberately **not in a tracked file**: this repository is public and its findings are unfixed. It is at `.claude/plans/refactor-4-13-security-hardening.md` (gitignored), and none of its findings were filed as issues. How to disclose them is the first decision it asks for. Until that is settled, keep its details out of commits, the CHANGELOG and issue text.

## Suggested order

1. **The security spec's first phase** (the request-origin gate). It changes what every other finding in that spec is reachable from.
2. **Spec 11**, phases 1–3: deletions and shims. A warm-up that shrinks the tree the other specs read.
3. **Spec 1**: a High bug in the turn path, contained to one service.
4. **Spec 3**, then **spec 4**: both start with real-SQLite tests and both fix data that is going quietly wrong (orphaned chunks in search, unreaped jobs, memory search).
5. **Spec 2**: import first, restore second.
6. **Spec 5**: the four bugs in place, then the schemas, then the conformance table.
7. **Spec 7**, then **spec 6**, then **spec 8**. Spec 7's mutation helpers make spec 6's sidebar work smaller; spec 8 is mechanical and can be interleaved in batches.
8. **Spec 9**: #186 in place at once; the kernel when the three families are quiet.
9. **Spec 10**: after its Phase 1 tests say how much of it is real.

Bugs with no spec, each a small fix in place: #164 (bulk re-attribute), #169 (Scriptorium edit dialog), #174 and #175 (Document Mode saves), #177 (New Chat image profile), #178 (memory-analysis route), #183 (empty re-roll), #184 (archived composite components), #185 (send before the opening). #164 and #169 are High and should not wait for anything.

## Bugs filed

All verified by reading the cited code; none was reproduced in a running instance unless its issue says so.

| # | Severity | Bug | Spec |
|---|---|---|---|
| #164 | High | Bulk re-attribute deletes the whole transcript and replays it through `addMessage` | none |
| #169 | High | Scriptorium list "Edit" opens with defaults and saves them over the store | none |
| #170 | High | Project instructions typed before a tab switch are discarded behind a success toast | 7 |
| #181 | High | Failover hands the substitute the primary provider's tool array | 1 |
| #188 | High | `.qtap` import Overwrite deletes the row and recreates it under a new id | 2 |
| #189 | High | Deleting a document can leave its chunks and embeddings in semantic search | 3 |
| #165 | Medium | SillyTavern export returns 500 for a non-Latin-1 character name | 5 |
| #171 | Medium | Summon from Lore inside Add Character closes the dialog on the first click | 8 |
| #172 | Medium | Enter in the composer during a run starts a second turn stream | 6 |
| #173 | Medium | One failed chat fetch leaves the Salon on its error screen | 6 |
| #174 | Medium | Document Mode marks an edit made during a save as saved | none |
| #175 | Medium | Closing a Document Mode pane after a failed save discards the edits | none |
| #176 | Medium | "Announce Generated Images" never saves | 7 |
| #177 | Medium | New Chat "No image generation" is ignored when a default exists | none |
| #178 | Medium | "Analyze for Memories" posts to a route that does not exist | none |
| #182 | Medium | A tool-call-only failover substitute is discarded as empty | 1 |
| #183 | Medium | An empty re-roll is saved as a blank swipe and retires the original's memories | none |
| #184 | Medium | Wearing a composite puts its archived components on | none |
| #185 | Medium | A send to a chat still pending its opening runs without the opening | none |
| #186 | Medium | An unread Inventory tier makes the next equip drop carried objects | 9 |
| #190 | Medium | Restore gives templates new ids; restored chats lose their template | 2 |
| #191 | Medium | Deleting a store's documents destroys content shared with other stores | 3 |
| #192 | Medium | Memory text search finds nothing when the query has a regex metacharacter | 4 |
| #193 | Medium | Re-import with Skip duplicates informs, annotations and chat documents | 2 |
| #194 | Medium | DEAD background jobs are never reaped | 4 |
| #195 | Medium | Import Duplicate records an id no row receives | 2 |
| #166 | Low | Validation failures return 500 in four routes | 5 |
| #167 | Low | `llm-logs` offset never pages; a negative limit is unbounded | 5 |
| #168 | Low | An invalid `swipeIndex` generates a new swipe | 5 |
| #179 | Low | Re-attaching the same file does nothing | 11 |
| #180 | Low | Memory editor opens importance 0 as 0.5 | 11 |
| #187 | Low | Dates shown to models are UTC days, not the instance calendar | 10 |
| #196 | Low | `llm-logs?standalone=true` always returns an empty list | 4 |

**Traced but not filed.** About forty further findings were traced by the audit and not independently verified. They are listed in the "traced, not re-verified" section of the spec that owns them, to be confirmed by a test and filed then. The largest by consequence: a failed stream in the native tool loop losing prose and TOOL rows (spec 1); backup and "delete all my data" skipping characters whose vault is unreadable, and LLM logs capped at 10,000 in both (spec 2); a stale embedding committed by a deduped job, and the job applier's transaction spanning an await (spec 4); consolidation overwriting concurrent admission writes, and a restated fact absorbed into the digest that contradicts it (spec 10).

## Stubs

The tree is nearly free of them. No `throw new Error('Not implemented')`, no `@ts-ignore`, no commented-out code blocks of five lines or more. Two `TODO`s:

- `plugins/dist/qtap-plugin-google/provider.ts:108`: per-character prompt caching is specified (`docs/developer/features/per-character-prompt-caching.md`) and not wired; the plugin reads `cachedContentTokenCount` and never creates cached content. Real unfinished work, and a feature of its own rather than a refactor.
- `app/salon/[id]/components/system-message-labels.ts:382`: a label waiting on a writer that does not exist. A note.

Four provider plugins report non-image attachments as "not yet implemented" and fail them per attachment (Grok PDFs, OpenRouter, Ollama, the OpenAI-compatible default). Those are honest capability limits that fail gracefully. `lib/stubs/empty.js` is a Turbopack browser alias, not a stub.

## Examined and left alone

So the next reader does not redo the survey:

- **The API's main rule.** No route reads `?action=` by hand; unknown actions are 400; the non-v1 routes are exactly the sanctioned ones; no `.partial()`; no synchronous `params`. `lib/api/middleware/actions.ts` is sound.
- **Chokepoints that hold in the routes.** Memory create / edit / delete (`admitCandidate`, `updateMemory`, `retireMemories`); auto-title (`applyAutoTitle`); Concierge state (`applyConciergeFlip`); message ownership checks on `chats/[id]/messages/[messageId]`.
- **4.13 data in backup, restore, export, import and the schema**: avatar timeline, wardrobe history, informs, equipped inventory and outfit, `turnMode`, `isEstablishedFact`. The opening-state columns and the refusal ledger are excluded on purpose.
- **Compressed columns and message search**: no raw SQL reads a compressed column without `qt_text()`; global search decodes after `ORDER BY … LIMIT`; the FTS triggers and rebuild are sound.
- **The twelve most recent migrations**: labels, progress, idempotence.
- **The inform block, `buildContext`'s ordering, the stall watchdog** (one raw `provider.streamMessage` consumer, watched), **the fallback engine** (no recursion, vision required on both steps), **the Concierge** (state read at refusal time, the ledger, the compare-and-set switch).
- **The Atlas** as built this cycle: matcher, pool shadowing, scan, transfers, `ensure` only for writers. The **opening**: one in flight per chat, the stop check between phases, the stale reconciler. **Inventory equip**: serialisation, cap checks before instantiation.
- **Polling**: every `setInterval` and `refetchInterval` is a local clock, realtime-gated, or the realtime machinery. **Query keys**: one hand-extended key (`MergeConversationModal.tsx:111`). **Variant-prefixed `qt-*` classes**: all defined. **Character autosave**: drafts survive refetch.
- **`ItemRowShell` and a shared transfer service**: rejected by the 4.12 browser-family spec; still rejected.
- **The child proxy's read-your-writes overlays** (`child-repositories-proxy.ts`, about 600 lines in four hand-written overlays, each re-implementing its repository's write semantics). A real structural debt, with two possible designs (a shared reducer per repository, or moving the remaining read-back writers to host-RPC as admission did). Not specified here: the choice needs a decision about the job child's direction first.
- **`_update` rebuilding the whole row**, which is why `patchOnlyFields()` and the out-of-schema columns exist. Noted as a decision in spec 4 §8, not proposed.
- **Small duplicates not worth a spec**: the three chat image-prompt dialogs (`GenerateImageDialog`, `StandaloneGenerateImageDialog`, `GenerateImageView`, about 300 lines shared, disagreeing on count and trimming); two lightbox copies beside `FullScreenImageViewer`; the default-connection-profile rule spelled three ways (`AddCharacterDialog.tsx:134-151`, `CharacterPickerPanel.tsx:94` and `useNewChat.ts:239`, `CreateNPCDialog.tsx:63-69`); four copies of a token-sum loop in `llm-logs.repository.ts:443-635` that `USAGE_AGGREGATE_COLUMNS` already does in SQL; `addMessage` re-reading the whole transcript to count visible messages. Fix each when its file is next open.

**Sized but not read**, so neither cleared nor proposed: `lib/pascal/tool-draft.ts` (2,484 lines), `custom-tools.ts` (2,449), `custom-tool.types.ts` (2,182); `lib/services/host-notifications/writer.ts` (1,298); `lib/tools/handlers/image-generation-handler.ts` (1,427); `lib/services/chat-message/context-builder.service.ts` (1,418); `lib/characters/vault/**`; `lib/chat/opening/cast.ts` and `defaults.ts`; the AI import wizard, the theme browser and the Proving Bench on the client.
