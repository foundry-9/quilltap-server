# RP Template Formatting Overhaul — Implementation Plan

**Status:** Proposed
**Audience:** Claude Code (and whoever reviews the handoff)
**Scope:** Roleplay-template markdown formatting — the schema, the Lexical-aware toolbar buttons, and the front-/back-end rendering pipelines. Charlie has approved changing built-in and user templates as needed (a migration is expected).

---

## 1. The problem, stated plainly

Roleplay-template formatting in Quilltap is built from three layers that were authored independently and have drifted apart:

1. **Schema** — `lib/schemas/template.types.ts` defines `TemplateDelimiter` (wrap-only: a single delimiter string or an `[open, close]` tuple), plus `renderingPatterns` (raw regex strings), `dialogueDetection`, and `narrationDelimiters`. Pattern auto-generation lives in `lib/chat/annotations.ts`.
2. **Insertion** — `components/chat/FormattingToolbar.tsx` wraps the current selection with `prefix`/`suffix`. It carries **two parallel implementations** (a Lexical path using `selection.insertRawText`, and a source-textarea path using `sourceToggleWrap`). `FormattingCommandPlugin.tsx` declares an `INSERT_DELIMITER_COMMAND` that nothing dispatches — it is dead code.
3. **Rendering** — the same regex-driven span-wrapping logic is **duplicated** in `components/chat/MessageContent.tsx` (client, ReactMarkdown) and `lib/services/markdown-renderer.service.ts` (server, unified/remark/rehype). Both hardcode an identical `DEFAULT_RENDERING_PATTERNS` array and an identical `escapeMarkdownInBrackets`.

Charlie's three asks map onto these layers:

- **Ask 1 — a consistent way to define a markdown post-render that ties into both Lexical and the chat renderers, including "line or partial-line preceded by" markers** (e.g. `[CAPTAIN] All hands on deck!` rendered specially). The schema today only models *wrap* delimiters (`open…close`) plus one special-cased line prefix (`// ` OOC, hand-built in `buildDelimiterPattern`). There is **no first-class "prefix" delimiter kind**, so the captain's-rank case cannot be expressed cleanly, and whatever you do express has to be hand-mirrored into two renderers.
- **Ask 2 — communicate the format to the prompt.** This already works: `RoleplayTemplate.systemPrompt` is free text injected by `lib/chat/context/system-prompt-builder.ts`. We keep it user-owned. (Minor optional nicety below.)
- **Ask 3 — make the Lexical-aware toolbar buttons actually work consistently across the different kinds of edit.** Today the buttons only know how to wrap. They don't understand line-prefix insertion, partial-line prefix, toggling, or multi-line selections in the Lexical path, and the Lexical and source-textarea paths can disagree.

The root cause of "none of this works well" is that **a delimiter is defined once but interpreted three times** (toolbar insert, client render, server render), each by separately-written code. The overhaul makes the delimiter definition the **single source of truth** and derives all three behaviors from it.

---

## 2. Design principles for the overhaul

Follow the repo's stated principles (single source of truth, DRY, SRP, KISS) — they are exactly what's missing here.

1. **One delimiter model, three derived behaviors.** A template's formatting rules are defined once. The toolbar's insert/toggle behavior, the client renderer, and the server renderer are all *derived* from that one definition — nobody hand-writes a parallel regex. (Auto-`renderingPatterns` generation already gestures at this; we finish the job and make it authoritative.)
2. **Add a `kind` discriminant to delimiters** so "wrap" and "line/partial-line prefix" are modeled explicitly, instead of inferring prefix-ness from `suffix === ''`.
3. **Collapse the two renderers into one shared core.** Extract the regex-matching + span-wrapping + bracket-escaping logic into a single module both `MessageContent.tsx` and `markdown-renderer.service.ts` import. They differ only in their final emit step (React nodes vs. HTML string).
4. **Unify the toolbar's two insertion paths** behind one set of pure string-transform helpers, so Lexical mode and source mode call the same wrap/toggle/line-prefix functions.
5. **Backwards compatibility via migration.** Existing templates (built-in + user) get migrated to the new shape. Charlie has OK'd changing them.

---

## 3. Proposed schema change

In `lib/schemas/template.types.ts`, evolve `TemplateDelimiterSchema` to a discriminated union on a new `kind` field. Sketch (Claude Code to finalize against the actual Zod conventions in the file):

```ts
// Wrap: open…close around a span (existing behavior)
const WrapDelimiter = z.object({
  kind: z.literal('wrap'),
  name: z.string().min(1).max(50),
  buttonName: z.string().min(1).max(10),
  delimiters: z.union([z.string(), z.tuple([z.string(), z.string()])]),
  style: z.string().min(1).max(50),
});

// Line prefix: marker at the START of a line styles the WHOLE line
//   e.g. "// OOC comment"  →  className applied to the line
const LinePrefixDelimiter = z.object({
  kind: z.literal('linePrefix'),
  name: z.string().min(1).max(50),
  buttonName: z.string().min(1).max(10),
  marker: z.string().min(1),            // e.g. "// "
  style: z.string().min(1).max(50),
});

// Tag prefix: a bracketed token at the START of a line, whose inner text must
//   match a user-configured token constraint, styles the WHOLE line.
//   This is a GENERAL, user-authored capability — NOT a hardcoded "rank" feature.
const TagPrefixDelimiter = z.object({
  kind: z.literal('tagPrefix'),
  name: z.string().min(1).max(50),
  buttonName: z.string().min(1).max(10),
  open: z.string().min(1),              // user-chosen, e.g. "["
  close: z.string().min(1),             // user-chosen, e.g. "]"
  // Token constraint: the regex (Unicode, no anchors) the inner token must
  // satisfy. Stored on the template, edited by the user. Default below is the
  // "uppercase / non-cased, never lowercase" rule (see note), but the user can
  // change it. Empty/omitted = any non-empty token.
  tokenPattern: z.string().optional(),
  style: z.string().min(1).max(50),     // ONE shared class applied to the whole line
});

export const TemplateDelimiterSchema = z.discriminatedUnion('kind', [
  WrapDelimiter, LinePrefixDelimiter, TagPrefixDelimiter,
]);
```

Notes:

- **`tagPrefix` is a general, user-authored capability — do NOT seed a "ranks" or "captain" built-in template.** Charlie's `[CAPTAIN] All hands on deck!` was just *his own user template* illustrating the shape he wants the power to build. The deliverable is the configurable `kind` + the editor UI to author it (§5 / §9), not a canned rank feature. The Standard and Quilltap-RP built-ins stay as they are (migrated to the new `kind` discriminant only).
- **Behavior (confirmed with Charlie):** the tag prefix must appear at the **start of a line**, and styles the **entire line** (tag + remainder) with **one shared class**. There is no separate tag-vs-rest styling.
- **Token constraint = "uppercase, including non-Latin-1 uppercase and non-cased scripts, but never lowercase" (confirmed).** Express as a Unicode regex with the `u` flag. The token is one-or-more characters where each character is *not a lowercase letter*: `^[^\p{Ll}]+$` over the inner text, equivalently the inner-match class `[^\p{Ll}]+`. This admits `\p{Lu}` (uppercase), digits, spaces, and `\p{Lo}` non-cased letters (CJK, Hebrew, etc.) while rejecting any `\p{Ll}`. Ship this as the **default** `tokenPattern`, exposed and editable in the template editor — the user can tighten it (e.g. `\p{Lu}` only) or loosen it. Apply with the `u` flag everywhere it's compiled (toolbar match-check, client renderer, server renderer).
- **Migration.** Existing entries have no `kind`. Write a migration (see §6) that classifies each: an `[open,close]` tuple or single-string → `wrap`; the `['// ', '']` OOC entry → `linePrefix` with `marker: '// '`. No existing built-in becomes a `tagPrefix` — that kind only ever appears in user-authored templates. Add a pretty-label entry in `lib/startup/prettify.ts` and `reportProgress` in any loop (per the migration rules in CLAUDE.md).
- **Migration.** Existing entries have no `kind`. Write a migration (see §6) that classifies each: an `[open,close]` tuple or single-string → `wrap`; the `['// ', '']` OOC entry → `linePrefix` with `marker: '// '`. Add a pretty-label entry in `lib/startup/prettify.ts` and `reportProgress` in any loop (per the migration rules in CLAUDE.md).
- **`renderingPatterns` becomes derived, not stored-by-hand.** Keep the column for back-compat, but make `generateRenderingPatterns` in `lib/chat/annotations.ts` the single authority that turns delimiters → patterns, and have the API regenerate on write (it already partially does). Long-term, prefer deriving patterns at read time so the delimiter list is the only thing humans edit.

---

## 4. Unify the renderers (the highest-value change)

Create `lib/chat/roleplay-rendering.ts` (a shared, framework-agnostic core) that owns:

- `escapeMarkdownInBrackets(content, delimiters)` — moved verbatim from the two copies, generalized to read from the new delimiter model (including `tagPrefix`/`linePrefix`).
- `compileDelimiters(delimiters): CompiledRule[]` — turns the delimiter model into an ordered match list (replacing the two `compilePatterns` + the regex hand-authoring).
- `tokenize(text, rules): Segment[]` — the single "walk the string, find earliest match, emit segments" loop that currently exists **twice** (`processRoleplayText` in MessageContent and the inline loop in `applyRoleplayPatterns`). Returns a neutral `Segment[]` (`{ text, className? }`), not React or HTML.

Then:

- `MessageContent.tsx` imports `tokenize` and maps `Segment[]` → React nodes (its existing `processChildren` shrinks to a thin adapter).
- `markdown-renderer.service.ts` imports the same `tokenize` and maps `Segment[]` → HTML spans.

This guarantees client and server render identically (today they can diverge because the loops are separately maintained) and means **a new delimiter kind is implemented once.**

Add tests that feed the same input through both adapters and assert the styled output matches (there's a precedent: the two files already claim to "mirror" each other — make that a tested invariant, ideally a shared fixture table).

---

## 5. Unify and fix the toolbar (Ask 3)

In `components/chat/FormattingToolbar.tsx`:

1. **Extract pure string transforms** into a small helper module (e.g. `lib/chat/text-transforms.ts`): `toggleWrap(text, sel, open, close)`, `toggleLinePrefix(text, sel, marker)`, `insertTagPrefix(text, sel, open, close)`. Pure functions over `{ value, start, end }` → `{ value, cursor }`.
2. **Route both the Lexical path and the source-textarea path through those same helpers.** Source mode applies the result to the textarea; Lexical mode applies it via a single command. This removes the divergence between `sourceToggleWrap`/`sourcePrefixLines` and the Lexical `insertRawText` branch.
3. **Make the dead `INSERT_DELIMITER_COMMAND` real, or delete it.** Recommended: generalize it to `APPLY_DELIMITER_COMMAND` taking the full delimiter object, and have it dispatch the correct transform by `kind` (wrap/linePrefix/tagPrefix). Then the toolbar's Lexical branch is one dispatch, not an inline `editor.update` block. This is where "buttons work consistently for the different kinds of edit" actually lands.
4. **Handle the cases that currently misbehave:** empty selection (insert + place cursor), multi-line selection for wrap (wrap whole span vs. per-line — decide and test), toggling off when already wrapped, and line-prefix on a partial-line selection (expand to line start). Each gets a unit test.
5. **Render the new `tagPrefix`/`linePrefix` buttons** from the active template's delimiters — the toolbar already fetches the template; extend the button map to the new kinds with appropriate `buttonName`s. For `tagPrefix`, the button inserts `open` + caret + `close` at the **start of the current line** (expanding a partial-line selection to line-start), so the user types the token (e.g. `CAPTAIN`) between the brackets. It does not validate the token at insert time — the renderer's `tokenPattern` decides whether a given line actually matches and gets styled.

Keep the asterisk/underscore-italic constraint intact: `COMPOSER_TRANSFORMERS` in `MarkdownBridgePlugin.tsx` must keep excluding `ITALIC_STAR`, and any new transform must not re-introduce `*` as a formatting tag.

---

## 6. Migration

- New migration under `migrations/scripts/` (registered in `index.ts`).
- Backfill `kind` on every delimiter in every `roleplay_templates` row (built-in seeds + user rows). Update `BUILT_IN_TEMPLATES` in `lib/database/repositories/roleplay-templates.repository.ts` to the new shape so fresh installs and re-seeds match.
- Regenerate `renderingPatterns` from the migrated delimiters using `generateRenderingPatterns`.
- Add a steampunk-voice pretty-label to `PRETTY_LABELS` in `lib/startup/prettify.ts`; call `reportProgress` in the row loop.
- Check whether the schema change must propagate to `.qtap`/SillyTavern exports, `public/schemas/qtap-export.schema.json`, and backups (per CLAUDE.md "Data/schema changes"). Update `docs/developer/DDL.md` if the stored shape changes.

---

## 7. Optional nicety for Ask 2

Templates already carry a free-text `systemPrompt`, which is correct to leave user-owned. Optionally, offer a **"describe formatting for the model" helper** in the template editor that generates a starter prompt paragraph from the delimiter list (kind-aware: "Ranks are written as `[RANK]` at the start of a line…"), which the user can edit. Purely additive; the prompt string stays the source of truth sent to the LLM.

---

## 8. Suggested work order

1. Shared rendering core (`lib/chat/roleplay-rendering.ts`) + point both renderers at it; add the cross-renderer equivalence test. *(No behavior change yet — pure refactor; lands the safety net first.)*
2. Schema: add the `kind` discriminated union; update `annotations.ts` derivation; update built-in seeds.
3. Migration + DDL/export-schema review.
4. Toolbar: extract pure transforms, unify the two paths, wire `APPLY_DELIMITER_COMMAND`, add the new button kinds.
5. Implement `tagPrefix` end-to-end (the `[CAPTAIN]` case) through the now-single render core + the toolbar.
6. Tests: transforms (unit), tokenizer (unit), cross-renderer equivalence (fixture table), toolbar interaction cases. Then `npx tsc`, jest, and the snapshot/`-u` updates the changed files require.
7. Docs: `help/*.md` for the template editor's new formatting kinds (steampunk voice, with `url` frontmatter + In-Chat Navigation block), `docs/CHANGELOG.md` (plain voice), and the docs listed in `/.claude/commands/update-documentation.md`.

---

## 9. Files this touches (inventory)

**Schema / derivation**
- `lib/schemas/template.types.ts` — delimiter discriminated union, narration handling
- `lib/chat/annotations.ts` — `MARKDOWN_FORMATS`, `delimiterToPrefixSuffix`, `generateRenderingPatterns`, `buildDelimiterPattern` (becomes kind-aware)

**Rendering (collapse to one core)**
- NEW `lib/chat/roleplay-rendering.ts` — shared escape + tokenize
- `components/chat/MessageContent.tsx` — adapter to React nodes
- `lib/services/markdown-renderer.service.ts` — adapter to HTML

**Toolbar / Lexical**
- `components/chat/FormattingToolbar.tsx` — unified insertion, new button kinds
- `components/chat/lexical/plugins/FormattingCommandPlugin.tsx` — `APPLY_DELIMITER_COMMAND`
- NEW `lib/chat/text-transforms.ts` — pure wrap/linePrefix/tagPrefix transforms
- `components/chat/lexical/plugins/MarkdownBridgePlugin.tsx` — keep asterisk/underscore invariant

**Templates / data**
- `lib/database/repositories/roleplay-templates.repository.ts` — `BUILT_IN_TEMPLATES` new shape
- `app/api/v1/roleplay-templates/route.ts` + `[id]/route.ts` — regenerate patterns on write
- `components/settings/roleplay-templates/*` — **editor UI for the new delimiter kinds (this is a primary deliverable, not an afterthought)** (`index.tsx`, `types.ts`, `hooks/useRoleplayTemplates.ts`, `TemplateCard.tsx`). The user must be able to add a `tagPrefix` rule and set its `open`/`close`, its `style`, and its `tokenPattern` (pre-filled with the uppercase/non-cased default, editable). Likewise add/edit `wrap` and `linePrefix` rules. Charlie authors these himself — the app ships the *capability*, not specific rank/tag templates.

**Migration / docs**
- NEW `migrations/scripts/NNN-rp-delimiter-kinds.ts` (+ `index.ts`)
- `lib/startup/prettify.ts` — pretty label
- `docs/developer/DDL.md`, `public/schemas/qtap-export.schema.json` (if export-affecting)
- `help/*.md`, `docs/CHANGELOG.md`

---

## 10. Decisions (confirmed with Charlie)

These were open questions; Charlie has answered them, and the plan above reflects the answers:

1. **A `tagPrefix` styles the whole line, not just the tag.** The bracketed token must sit at the start of the line; the entire line (tag + remainder) takes one shared class.
2. **Tokens are free-form, constrained by a rule, not an enumerated roster.** Any token may appear in the brackets as long as it matches the configured `tokenPattern`. Default rule: uppercase including non-Latin-1 uppercase and non-cased scripts, never lowercase — `[^\p{Ll}]+` with the `u` flag. The user can edit this per rule.
3. **One shared CSS class for all matching lines.** No per-token theming.
4. **The app ships the capability, not the content.** Do **not** create or seed any "ranks"/"captain" template. Charlie authors his own templates; the work is the configurable `tagPrefix` kind plus the editor UI to build and customize it.
