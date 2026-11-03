# Refactor 4.12 — Deep-refactor specs for what the 4.12-dev cycle touched

**Status:** Proposed (2026-11-02). Written against `HEAD` = 94f04176, the cycle running from 236c04e3 ("started 4.12.0 development") through the release-checklist passes. Each spec is self-contained; this page is the inventory, the ranking, and the list of things examined and deliberately left alone.

The brief: look over everything the 4.12-dev cycle touched and specify deep refactors where they pay, aiming at less code or a plainly simpler process. The specs below are ordered by expected return.

## The specs

| # | Spec | What it removes or simplifies | Size | Risk |
|---|---|---|---|---|
| 1 | [The theme-storybook mirror is generated](refactor-4-12-storybook-css-generated.md) (**done**, Phases 1–2) | A 7,436-line hand-written de-Tailwinded copy of 12,439 lines of app CSS (334 of 894 `qt-*` classes missing, 7 orphaned, 8 package bumps this cycle) becomes a build output with a lint gate. The CLAUDE.md "mirror faithfully, the whole family" rule disappears. | Medium | Low |
| 2 | [One document core](refactor-4-12-document-core.md) | The operator's Document Mode routes and the `doc_*` tools each implement read / write / rename / delete / open; they have already diverged (two blob readers; operator saves in `project` scope skip re-index). One core, both callers, two bugs fixed. | Medium | Medium |
| 3 | [One image transport budget](refactor-4-12-image-transport-budget.md) | Five sites decide which images reach a provider; the byte budget covers one of three sources, the count cap is enforced twice with opposite tie-breaks, over-budget images vanish silently, understudies get count but not bytes. One ranked pass on the final array, run per profile tried. | Medium | Medium |
| 4 | [One tier walk](refactor-4-12-tier-walk.md) | Seven questions about "what can this character reach" with two to four answers each; six families of copied tier code (~1,200 lines, ~300 collapsible); two GET routes that provision stores. One reach module and settled rules. | Large | Medium–High (within-tier order changes a winner) |
| 5 | [Salon stream frames as a tagged union](refactor-4-12-salon-stream-frames.md) (**done**, Phases 1–2) | A fifty-optional-field SSE bag, nineteen encoders, a hand-ordered client dispatch chain that this cycle had to reorder, and a byte-level re-encoder for Storyteller tagging become one Zod discriminated union with one encoder and one parser. | Medium | Low–Medium |
| 6 | [The browser family, finished](refactor-4-12-browser-family.md) | After six folder-browser phases: ~950–1,350 lines of remaining Wardrobe / Inventory pairs (control dialogs, pickers, overlays, viewers, providers, route-factory preamble, images routes), dead folder wrappers, three hand-rolled menus; and the decision list for retiring `FileBrowser` (~1,900 client + ~850 server lines). | Large | Low for the pairs; the `FileBrowser` retirement is a product decision |
| 7 | [One recursive watcher core](refactor-4-12-native-watcher-core.md) | Two `fs.watch` watchers copied from each other (~100 lines each) that diverged: the `files/` watcher has no polling fallback, no cloud-placeholder guard, and scans every record on a plain delete. One core; the gaps close by construction. | Small | Low |

Specs 2, 3, 4 and 6 each name bugs to file first (CLAUDE.md: filing is outward-facing, confirm with the human). Spec 1 touches `packages/` and so meets the publish rule. Every spec ends with the decisions it needs from the human.

## Suggested order

1. **Spec 1** first: it is self-contained, removes a standing process cost from every later UI change in this list, and its Phase 1 produces a report before anything changes.
2. **Spec 7** and the dead-code half of **spec 6** (Phase 1): small, behaviour-neutral, good warm-ups.
3. **Spec 2** and **spec 3**: both start by fixing a bug in place, then move code.
4. **Spec 5**: Phase 1 (server-side, legacy shape preserved) can land any time; Phase 2 waits for a quiet moment in the Salon.
5. **Spec 4**: needs the §5.1 decisions first; then its families in order; the order and project-tier rules last.
6. **Spec 6** Phases 2–5 after spec 4's project-tier decision, and `FileBrowser` only after its four questions are answered.

## Examined and left alone

So the next reader does not redo the survey:

- **Dependency upgrades** (SQLCipher driver 13, TypeScript 6, ESLint 10, Lexical 0.53, croner 11, Anthropic SDK 1.x, `@google/genai` 2): version moves with their own notes. The only code they left behind worth a spec is the chokidar removal (spec 7).
- **`lib/chat/established-fact.ts`** (Deus Ex Machina): one module, frames applied at read time, a chokepoint test for the name. Already the shape a refactor would aim for.
- **Prompt trust, part two**: prompt text and extraction rules; nothing structural.
- **Global search and message reveal** (`conversation-search.ts`, `message-navigation.ts`, `useSearchHighlight`, the FTS eligibility fix): small modules with one job each; the sessionStorage + window-event handoff is justified by the mounting-Salon case and documented.
- **Raised-hand chip and yield inference**: the hand-event ordering problem is spec 5's; the gesture rule is a pure function with tests.
- **Custom-tool presets** (`tool-preset-pool.ts`): already uses the shared walk; the model for spec 4.
- **Connection-profile sampling parameters** (`withoutSamplingParameters`, `acceptsSamplingParameters`, the migration): three small functions and a frozen-list migration, as the pattern requires.
- **`check-qt-classes.mjs` / `check-css-vars.mjs`**: two lint gates that could share a CSS tokenizer. Not worth a spec; spec 1 adds a third gate of the same shape and the three can share a helper when any of them is next touched.
- **`useSSEStreaming` at 1,831 lines and `SalonView` at 2,343**: splitting them is desirable, but the bag protocol is what prevents it; spec 5 is the prerequisite and names the split as its follow-up.
- **Scan runner two-pass boot, cloud-placeholder module, `emptyScanResult`**: fine.
- **`operator-doc-http.ts`**: this cycle's own good move; spec 2 builds on it rather than replacing it.
- **Avatar carried-items column, Green Room multi-slot spread, breadcrumb compaction, popover tokens, WCAG pass**: UI work already on the `qt-*` layer; spec 1 is what makes the next such pass cheaper.
