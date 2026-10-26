# Diagrams in the Salon — Spec

**Status:** Iteration 1 implemented (2026-10-25). Iteration 2 not started.
**Scope:** quilltap-server (client renderer, two new character properties + their Aurora controls, a per-character system-prompt note, help docs). v5 follows later through the usual differential port.
**Iteration:** 1 of 2. This iteration renders diagrams **live**. Saving a rendered diagram as an image (to the gallery, a store or a file) is iteration 2.

## Summary

Let characters draw diagrams. Drawing is a per-character ability: two new keys in the character vault's `properties.json` — `canDrawDiagrams` (absent means `false`) and `diagramStyle` (`handDrawn` / `clean`) — set from the Aurora character pages. Only a character with `canDrawDiagrams: true` is told the ability exists. A character writes a fenced code block in a diagram language, and the Salon renders it as an SVG in place of the code block. The message keeps the source text, so the diagram is stored, searched, exported and backed up as ordinary markdown. Nothing new goes into the database.

Three fence languages are supported, in priority order:

| Fence | Engine | Why |
|---|---|---|
| ` ```mermaid ` | [Mermaid](https://mermaid.js.org/) v11 | The diagram language LLMs write most reliably. Flowcharts, sequence, state, class, ER, timeline, mind map, Gantt, quadrant. Has a `handDrawn` look (rough.js underneath) that suits a character who *draws*. |
| ` ```dot ` / ` ```graphviz ` | Graphviz via [`@hpcc-js/wasm-graphviz`](https://www.npmjs.com/package/@hpcc-js/wasm-graphviz) | Models write DOT about as well as Mermaid, and it's better for irregular graphs (family trees, factions, maps of connections). Runs as WASM with no DOM, which makes iteration 2 (rendering on the server) easy. |
| ` ```svg ` | None — sanitized inline SVG | Frontier models can write freeform SVG by hand (a floor plan, an annotated object, a sketch). Weak for complex connected layouts, because the model has to do the layout math itself. This is the fallback for drawings that aren't diagrams. |

Other languages considered and left out of v1: D2 (models know it less well, and it's a Go binary), PlantUML (needs Java), Pikchr (niche), Vega-Lite (charts only; a good candidate later if characters start plotting data).

## Goals

- A fenced `mermaid`, `dot`/`graphviz` or `svg` block in any Salon message renders as a diagram.
- The diagram follows the active theme (light/dark, theme colors) through `qt-*` tokens / CSS variables.
- If a block fails to parse, it degrades gracefully to the ordinary code block plus a short in-voice note. It never shows a blank space or a raw stack trace.
- A diagram does not render while it is still streaming (an unterminated fence). The code block shows until the fence closes, then the diagram swaps in.
- A small toolbar on each diagram: **View source** (toggle), **Copy source**, **Copy SVG**, **Download SVG**. All four run client-side. Download is a convenience, not iteration 2's "save".
- A character with `canDrawDiagrams: true` is told the fences exist, in the same way the math note tells everyone about `$$…$$`. **No other character hears anything about diagrams.**
- Each drawing character's Mermaid diagrams use that character's `diagramStyle`.
- Quick-hide "Salon Images" does **not** hide diagrams.

## Non-goals (v1)

- Saving rendered diagrams anywhere (gallery, Scriptorium, Lantern). → Iteration 2.
- An automatic LLM repair loop for broken diagrams. It costs a model call and pairs naturally with iteration 2's server-side render/validate. → Iteration 2.
- Diagrams in Document Mode, the Lexical composer preview, the Scriptorium file preview (`FilePreviewText.tsx`), help topics, or prompt previews. All of them use react-markdown, so the shared component should make these trivial follow-ons. But v1 is the Salon only.
- A diagram tool (`draw_diagram`). Fenced blocks in prose are what models do naturally, and a tool adds nothing until there is something to save.
- Editing a diagram in the UI.

## Known State (verified 2026-10-25)

- **No diagram rendering exists.** `package.json` has no `mermaid`, `graphviz`, `viz.js`, `@hpcc-js/*` or `roughjs` dependency, and nothing in `lib/`, `components/` or `app/` mentions mermaid.
- **No HTML/SVG sanitizer dependency.** No `dompurify` / `isomorphic-dompurify` in `package.json`. One has to be added for the `svg` fence and the Graphviz output.
- **Client renderer:** `components/chat/MessageContent.tsx` (react-markdown + remark-gfm/math/breaks/smartypants + rehype-katex). Fenced blocks go through the `pre` component override (~line 418), which pulls the language with `/language-(\w+)/` and hands it to `CodeBlockWithCopy`. **This is the integration point:** branch on the language there.
- **Server pre-render — the trap.** `lib/chat/transcript-projection.ts` (~line 197) pre-renders "simple" messages to HTML with `renderMarkdownToHtml` (`lib/services/markdown-renderer.service.ts`, unified + rehype-highlight + rehype-katex). `components/chat/LazyMessageContent.tsx` (~line 61) then puts that HTML in with `dangerouslySetInnerHTML` and **skips `MessageContent` entirely**, unless the message has a `qtap://` URI, mentions, or a hidden image. A diagram fence on that fast path would show as a highlighted code block and never reach the React renderer. See [Rendering path](#rendering-path) for the fix.
- **Character property precedent: `canChooseOutfit`.** It is exactly the shape needed — a boolean in `properties.json`, absent means `false`, no DB column (post-4.6 the vault is the only home of `properties.json` fields). Every place it touches is a place the new keys touch:
  - `lib/database/repositories/vault-overlay/schema.ts` — `CharacterVaultPropertiesSchema` (~line 41, `z.boolean().optional().default(false)` with the "absent means false" comment) and the managed-field key list (~line 227).
  - `lib/database/repositories/vault-overlay/managed-fields.ts` — the read snapshot (~94), the full write (~230), the patch path (~418–452, `propsKeys` and the `'canChooseOutfit' in patch` merge).
  - `lib/database/repositories/vault-overlay/read-overlay.ts` (~166–177) and the field list in the `character-properties-overlay.ts` / `vault-readers.ts` doc comments.
  - `lib/schemas/character.types.ts` (~248), `lib/mount-index/character-scaffold.ts` (~48, the new-vault default).
  - API: `app/api/v1/characters/[id]/handlers/put.ts` (~73, the PUT body schema) and `app/api/v1/characters/handlers/get.ts` (~79).
  - `public/schemas/qtap-export.schema.json` (~483).
  - `lib/services/character-field-semantics.ts` (~153) — the description of `properties.json` that generators/optimizer read; decide whether the new keys belong in it (they are operator settings, not character facts — probably leave the optimizer out of them, as with `canChooseOutfit`).
  - UI: `components/wardrobe/CanChooseOutfitToggle.tsx`, used on **both** `app/aurora/[id]/edit/CharacterEditView.tsx` (~272, Wardrobe tab) and `app/aurora/[id]/view/CharacterDetailView.tsx` (~272), saved through `useCharacterEdit.ts` (~244) / `useCharacterView.ts` (~555) with an optimistic local update.
- **System prompt shape.** `MATH_FORMATTING_INSTRUCTION` is pushed in the per-turn part of `buildSystemPrompt` (~line 434), **after** the identity stack — it is *not* part of `buildIdentityStack`, so it does not touch `IDENTITY_STACK_BUILDER_VERSION` or the identity-stack goldens. `character` is in scope there.
- **Precedent to copy:** math. `lib/markdown/math.ts` keeps the client and server pipelines in agreement, `MATH_FORMATTING_INSTRUCTION` in `lib/chat/context/system-prompt-builder.ts` (~line 25, pushed universally at ~line 432) steers the model, and `help/math-notation.md` documents it for users. Diagrams follow the same three-part shape.

## Design

### Character properties

Two new keys in the character vault's `properties.json`, following `canChooseOutfit` everywhere it goes (see Known State for the list):

| Key | Type | Absent means | Purpose |
|---|---|---|---|
| `canDrawDiagrams` | boolean | `false` | Gates the diagram note in this character's system prompt. |
| `diagramStyle` | `'handDrawn'` \| `'clean'` | `'handDrawn'` | How this character's Mermaid and Graphviz diagrams look. Mermaid: `handDrawn` → `look: 'handDrawn'`, `clean` → `look: 'classic'`. Graphviz: `handDrawn` → the SVG is re-sketched with svg2roughjs (see the Graphviz renderer), `clean` → as Graphviz drew it. |

- Schema: both `.optional().default(…)`, for the reason the `canChooseOutfit` comment gives — an older `properties.json` without the keys must still parse, or the strict parse falls back and hollows every managed field. Make `diagramStyle` lenient the way `physical-prompts.json`'s `humanoid` is: an unrecognized value reads as the default rather than failing the parse.
- `diagramStyle` is stored even when `canDrawDiagrams` is false (it just has no effect); turning the ability off and on again keeps the choice.
- Scaffold: new vaults write `canDrawDiagrams: false` and `diagramStyle: 'handDrawn'`.
- PUT: `canDrawDiagrams: z.boolean().optional()`, `diagramStyle: z.enum(['handDrawn','clean']).optional()`; GET returns both with defaults applied.
- Exports: add both to `qtap-export.schema.json`; confirm `.qtap` export/import and backup/restore carry them (they should, riding `properties.json`, but test the round trip). SillyTavern export has no equivalent — drop them.
- **v5:** this is a v4 data-shape change the v5 vault reader must follow at its next drift catch-up. Note it in the CHANGELOG plainly so the drift check classifies it.

**Aurora UI.** A `CanDrawDiagramsToggle` component (new, beside `CanChooseOutfitToggle` — put it under `components/characters/` rather than `components/wardrobe/`), with the style control directly beneath it: a two-option segmented control or radio pair, "Hand-drawn" / "Clean", disabled (not hidden) while the toggle is off. Place it on both the edit page and the detail view, as `canChooseOutfit` is. The Details tab is the natural home; if that tab is crowded, a small "Abilities" group there is fine. Saves are immediate PUTs with optimistic update and rollback, exactly as `handleSaveCanChooseOutfit` does. User-facing copy in the house voice, e.g. *"Draws diagrams — this character may sketch flowcharts, maps and the like right into the conversation."*

### Module layout

```
lib/markdown/diagrams.ts            # shared, client-safe, pure: fence detection + language table
components/chat/diagrams/
  DiagramBlock.tsx                  # dispatcher: language → renderer, toolbar, error fallback
  MermaidDiagram.tsx                # lazy-loads mermaid, renders via the queue
  GraphvizDiagram.tsx               # lazy-loads @hpcc-js/wasm-graphviz
  SvgDiagram.tsx                    # sanitizes and inlines model-written SVG
  render-queue.ts                   # serializes mermaid.render calls
  sanitize-svg.ts                   # the one DOMPurify call site for diagram SVG
```

`lib/markdown/diagrams.ts` is the single source of truth for which fence languages count as diagrams:

```ts
export const DIAGRAM_LANGUAGES = {
  mermaid: 'mermaid',
  dot: 'graphviz',
  graphviz: 'graphviz',
  svg: 'svg',
} as const;
export type DiagramEngine = (typeof DIAGRAM_LANGUAGES)[keyof typeof DIAGRAM_LANGUAGES];

export function diagramEngineFor(language: string): DiagramEngine | null;
/** True if the markdown contains at least one *closed* diagram fence. */
export function hasDiagramFence(markdown: string): boolean;
```

`hasDiagramFence` must ignore an unterminated fence, so a message still streaming isn't routed oddly. It should share the fence-matching approach `math.ts` uses in `MATH_SKIP_PATTERN` (` ``` ` and `~~~` fences).

### Rendering path

1. **Keep diagram messages off the pre-rendered fast path.** In `LazyMessageContent.tsx`, add `hasDiagramFence(content)` to the conditions that force the full render, next to `hasQtapUri` / `hasMentions`. This is the smallest correct change, and it's the same pattern the qtap-URI and mention cases already use.
   - *Alternative, not recommended for v1:* teach `canPreRenderMessage` to refuse these messages, so the server doesn't spend effort pre-rendering HTML the client will ignore. That's cleaner in the long run, but it touches the transcript projection and the `renderedHtml` cache (`collapse-stale-chat-caches.ts`), and the client check is needed anyway for rows cached before this change. Do the client check now. Revisit the server one only if profiling says to.
2. **Branch in the `pre` override.** In `MessageContent.tsx`, if `diagramEngineFor(language)` is non-null, render `<DiagramBlock engine=… source=… />` instead of `CodeBlockWithCopy`. Leave everything else alone.
   - Note: the language regex is `/language-(\w+)/`, which is fine for `mermaid`, `dot`, `graphviz` and `svg`.
3. **Streaming.** react-markdown closes an unterminated fence when it parses, so the `pre` override *will* see a half-received block. `DiagramBlock` therefore needs to know whether its fence is complete. Options, in order of preference:
   - (a) Pass a `streaming` flag down from the row (the Salon knows which message is streaming), and render the plain code block while it's true.
   - (b) Debounce: wait until the source has been stable for ~400 ms before trying a render.
   Do (a) if the flag is easy to thread through, (b) otherwise. Either way, a failed parse during streaming must **not** show the error state.

### Renderers

**Mermaid** (`MermaidDiagram.tsx`)
- `await import('mermaid')` on first use only. The bundle is large, and most chats will never load it.
- Initialize once with `startOnLoad: false`, `securityLevel: 'strict'` (no click handlers, no HTML labels, labels sanitized), and `theme: 'base'`, with `themeVariables` read from the computed `qt-*` CSS variables of the current theme. Re-initialize when the theme changes. Calliope's theme-change signal can be used for this.
- `look`: from the **authoring character's** `diagramStyle` (see [Which style applies](#which-style-applies)). Because `look` is an initialize-time option, pass it per render via the diagram's front-matter/`%%{init}%%` config, or re-`initialize` inside the queue before each render — the queue makes either safe.
- **Serialize renders** through `render-queue.ts`. `mermaid.render` uses shared global state, and concurrent renders (a chat with several diagrams scrolling into view) are a known source of garbled output. Give each render a unique id.
- Call `mermaid.parse(source)` first, so a syntax error goes to the error fallback with mermaid's message, not a thrown render.

**Graphviz** (`GraphvizDiagram.tsx`)
- `await import('@hpcc-js/wasm-graphviz')`, then `Graphviz.load()` once (cache the instance), then `graphviz.dot(source, 'svg')`.
- Pass the output through `sanitize-svg.ts`. DOT's `URL`/`href` attributes become `<a xlink:href>` in the SVG.
- **Hand-drawn style:** when the authoring character's `diagramStyle` is `handDrawn`, pass the sanitized SVG through [svg2roughjs](https://github.com/fskpf/svg2roughjs) (`await import('svg2roughjs')`), which redraws its paths, polygons, ellipses and text with rough.js and outputs SVG:
  ```ts
  const sketcher = new Svg2Roughjs(container, OutputType.SVG, { roughness: 1 });
  sketcher.svg = sanitizedSvgElement;
  sketcher.seed = hashToInt(source);   // stable: same source → same wobble
  sketcher.fontFamily = /* the hand font the Mermaid handDrawn look uses, via a CSS variable */;
  const sketched = await sketcher.sketch();
  ```
  - **Seed from the source text.** Without a seed the sketch is re-randomized on every render, so a diagram would visibly jitter whenever its row re-mounts (virtualized scrolling, theme change). A hash of the DOT source keeps it steady and still varies from diagram to diagram.
  - Match the font to Mermaid's hand-drawn look so a drawing character's two kinds of diagram look like the same hand. Its default (`'Comic Sans MS, cursive'`) is not what we want.
  - Run it on the **sanitized** SVG, and treat its output as trusted (it builds new elements from geometry; it does not copy through attributes like `href`). Still render it through the same container, never as `<img>`, so quick-hide stays out of it.
  - svg2roughjs may need the source SVG attached to the DOM to measure text (`getBBox`). If so, attach it offscreen inside the container, sketch, then remove it. Measure this during implementation.
  - If sketching throws, show the clean Graphviz SVG (log at `debug`); never fall all the way back to the error state for a style failure.
- Theming: Graphviz has no theme system. Apply theme colors by post-processing (CSS on the container that targets `.node`, `.edge` and `text`, plus `currentColor` where possible), so default black-on-white DOT reads correctly on dark themes. The model's own explicit `color=`/`fillcolor=` attributes stay as written.

**Raw SVG** (`SvgDiagram.tsx`)
- Sanitize with DOMPurify's SVG profile (`USE_PROFILES: { svg: true, svgFilters: true }`). Strip `<script>`, `on*` handlers, `<foreignObject>` and external `href`s.
- Require the root element to be `<svg>`. Anything else goes to the error fallback.
- Scale to fit: make sure there is a `viewBox`, drop fixed `width`/`height` in favor of `max-width: 100%`.

### Which style applies

Rendering is **not** gated by `canDrawDiagrams`: any diagram fence in any message renders (an operator can paste one; a character without the flag might produce one anyway). Only the prompt note is gated. The style comes from the message's author:

- An ASSISTANT message, or a USER message spoken through a user-controlled character → that character's `diagramStyle`.
- An operator message with no character, or a staff/system sender → `clean`.

`MessageRow` already knows the speaking participant and has the chat's characters loaded; pass `diagramStyle` down through `LazyMessageContent` → `MessageContent` → `DiagramBlock` as a prop. The style applies to Mermaid and Graphviz. Raw SVG ignores it: a freeform drawing is already in whatever hand the model drew it.

### Quick-hide

"Salon Images" quick-hide does **not** hide diagrams. The renderers insert SVG markup into a container, not `<img>` elements, so `MessageContent`'s image-placeholder swap never sees them — keep it that way (no rendering diagrams to `<img src="data:…">`). The `svg` sanitizer also strips SVG `<image>` elements and external `href`s, so a freeform SVG cannot smuggle a photo past the quick-hide. Add a test that a diagram stays visible with quick-hide on.

### `DiagramBlock` behavior

- Container: a new `qt-diagram` component class (and `qt-diagram-toolbar`, `qt-diagram-error`), defined in `app/styles/qt-components/` and **mirrored into `packages/theme-storybook/src/css/qt-components.css`** per the standing rule. Bumping the theme-storybook version means stopping for a human `npm publish`. Check the new classes against `scripts/check-qt-classes.mjs`.
- Wide diagrams scroll horizontally inside the container. They must not widen the message bubble.
- While loading: a short fixed-height placeholder, so the row height doesn't jump and break the virtualized transcript. Measure this against the Salon's height-stability expectations (the pre-render path exists partly for height stability).
- On error: the ordinary `CodeBlockWithCopy` with the source, plus a one-line note above it in the user-facing voice ("The draughtsman's pen has blotted — the diagram below could not be drawn."), with the engine's error message available on hover/expand. Log at `debug` with the engine and the error.
- Toolbar: View source (toggles the code block under the diagram), Copy source, Copy SVG, Download SVG (`<engine>-diagram.svg`). Download is a Blob URL. No server involvement.

### Model steering

Add a `DIAGRAM_FORMATTING_INSTRUCTION` next to `MATH_FORMATTING_INSTRUCTION` in `lib/chat/context/system-prompt-builder.ts`, in the same bracketed all-caps-tag shape, and push it immediately after the math note **only when `character.canDrawDiagrams` is true**. Characters without the flag get nothing — no mention of diagrams at all. Roughly:

```
[FORMATTING: DIAGRAMS]
You can draw diagrams. Write one in a fenced code block and it renders as a picture: ```mermaid for flowcharts, sequences, timelines, mind maps and the like; ```dot for graphs of connections (Graphviz DOT); ```svg for freeform drawings. Put only the diagram source inside the fence.
```

Notes:
- The note is about the *format*; it does not tell the character to draw often. An operator who wants a prolific sketcher says so in the character's own prompt or manifesto.
- It does not mention `diagramStyle` — the style is a rendering choice the model never needs to know.
- Because it sits in the per-turn half of `buildSystemPrompt`, not in `buildIdentityStack`, `IDENTITY_STACK_BUILDER_VERSION` and the identity goldens are untouched. Confirm against that file's own comments before landing, and add/adjust whatever tests cover the per-turn sections (with the flag: note present, right after math; without: absent, prompt byte-identical to today).
- Flipping the flag mid-chat takes effect on the character's next turn, since this half of the prompt is rebuilt per turn.

### Dependencies

- `mermaid` (^11)
- `@hpcc-js/wasm-graphviz`
- `dompurify` (+ `@types/dompurify` if needed)
- `svg2roughjs` (brings `roughjs`, which Mermaid already depends on — check for a version conflict)

All four are client-only, dynamically imported, and none are native. No `next.config.js` `serverExternalPackages` changes are expected. Confirm that the WASM asset loads in both `npm run dev` and the standalone tarball the Electron shell consumes (Playwright against a production build).

## Testing

- **Unit (Jest):** `lib/markdown/diagrams.ts`, including fence detection with closed, unclosed, tilde and nested-in-other-fence cases, and that `hasDiagramFence` ignores `mermaid` mentioned in prose or in an inline code span. `sanitize-svg.ts` against a hostile corpus (`<script>`, `onload=`, `javascript:` hrefs, `<foreignObject>`, external `<use href>`).
- **Component (Jest + jsdom):** Mermaid doesn't lay out in jsdom (no `getBBox`), so mock the renderer modules and test `DiagramBlock`'s routing, streaming behavior, error fallback and toolbar. Test that `LazyMessageContent` takes the full render when a diagram fence is present, and the fast path otherwise.
- **Properties (Jest):** a `properties.json` without the two keys parses with `false` / `'handDrawn'` and hollows nothing; an unknown `diagramStyle` reads as `'handDrawn'`; a PUT of either key writes only that key (the patch path); scaffold writes both; `.qtap` and backup round trips keep them.
- **Prompt (Jest):** the diagram note appears only for a `canDrawDiagrams` character, directly after the math note; otherwise the prompt is unchanged.
- **Playwright:** the Aurora toggle and style control on both edit and view pages save and survive a reload; the style control is disabled while the toggle is off. A Salon message with one block of each engine renders an `<svg>`. A broken Mermaid block shows the fallback. Several diagrams in one chat render correctly (this exercises the render queue). A theme switch re-colors a Mermaid diagram. A streamed diagram reply shows code first, then the diagram. Two characters with different `diagramStyle`s render the same Mermaid source differently, and the same for DOT. A hand-drawn DOT diagram looks identical across a reload (the seed). With "Salon Images" quick-hide on, diagrams stay visible.

## Documentation

- `help/diagrams.md`: user-facing, steampunk-Wodehouse voice, modeled on `help/math-notation.md`. It needs a `url` frontmatter field and an "In-Chat Navigation" section whose `help_navigate(url: "...")` matches it. Explain the Aurora toggle and style, include a short example of each fence, note that quick-hide leaves diagrams alone, and give the tip for operators: the toggle only *lets* a character draw — add "you often sketch diagrams to explain things" to their prompt to make them draw often.
- Update the Aurora help page that documents the character Details tab (`help/character-editing.md` and/or `help/character-management.md` — wherever `canChooseOutfit` is described) for the new toggle and style control.
- `docs/CHANGELOG.md` entry (plain voice).
- Link from `docs/developer/features/ROADMAP.md`. When done, move this file to `features/complete/`.
- `docs/FEATURES.md` mention.

## Decisions (2026-10-25)

1. **The ability is per character**, a `canDrawDiagrams` flag in `properties.json`, absent = `false`, set on the Aurora pages.
2. **The style is per character**, `diagramStyle` in `properties.json` (`handDrawn` / `clean`), set next to the flag.
3. **Only a character with the flag gets the diagram note.** Nobody else hears about it.
4. **Quick-hide does not hide diagrams.**
5. **Default `diagramStyle` is `handDrawn`** when the key is absent.
6. **Hand-drawn applies to Graphviz too**, via svg2roughjs, seeded from the source so it doesn't jitter. Raw SVG is left as drawn.

## As built (iteration 1, 2026-10-25)

Implemented as specified, with these differences:

- **Mermaid 12**, not 11. 12.2 was current; the options used (`look`, `handDrawnSeed`, `securityLevel`, `parse`/`render`) are unchanged.
- **Renderer modules are functions, not components.** `render-mermaid.ts`, `render-graphviz.ts` and `render-svg.ts` each export a `render*(source, { style, host })` returning `{ svg }`; `DiagramBlock` owns all React state. Shared pieces: `types.ts`, `diagram-theme.ts` (theme tokens resolved to `#rrggbb` through a 1×1 canvas, so any CSS colour syntax works).
- **Salon-only by prop.** `MessageContent` draws diagrams only when given `diagrams={{ style, streaming? }}`; `LazyMessageContent` (Salon-only) always passes it, and the streaming message / in-progress regeneration pass `streaming: true` (option (a) in [Rendering path](#rendering-path)). Every other `MessageContent` caller is untouched.
- **Mermaid runs with `htmlLabels: false`** (labels as SVG text, not `<foreignObject>`), so a copied or downloaded SVG reads outside a browser. Mermaid's hand-drawn diagrams are also seeded from the source hash (`handDrawnSeed`), not only Graphviz's.
- **Hand font** is the `--qt-diagram-hand-font` variable (a cursive system stack, not Comic Sans), used by both Mermaid's hand-drawn look and svg2roughjs.
- **Render cache.** `DiagramBlock` keeps the last 64 drawings by engine + style + theme + source, so a virtualized row that remounts shows its drawing on first paint; a theme change keeps the old drawing up until the new one is ready.
- **Sanitizer additions:** `<style>` and `<image>` are stripped, every `href` must be a `#fragment`, any attribute with a non-fragment `url(...)` is dropped, and `<use>` (which DOMPurify's SVG profile omits) is allowed since its href is confined to fragments.
- **`character-field-semantics.ts` left alone.** Its `properties.json` summary is read by the character itself (`self_inventory`), and the decision is that characters without the flag hear nothing about diagrams.
- **Style resolution** is `resolveMessageDiagramStyle` (`app/salon/[id]/components/message-row/helpers.ts`); the chat participant enrichment and `useParticipants` carry `diagramStyle`.
- **Playwright** coverage was not added; the same scenarios were checked by hand against the V4test instance (all three engines, code-then-diagram while streaming, per-character style switch, light/dark re-colour, quick-hide, broken-fence fallback for each engine, identical hand-drawn Graphviz across a reload, prompt note present only in the drawing character's requests). The standalone-tarball WASM check was not run.

## Iteration 2 (sketch, not in scope)

- Render on the server, for Graphviz with the same WASM in Node, and for Mermaid with a headless Chromium/Playwright page (or a Mermaid build that works without a DOM, if one is mature by then).
- "Save diagram" goes to the gallery / a store through the existing image and file chokepoints (and the LLM image budget if a diagram is ever sent back to a vision model).
- An automatic repair loop: on a parse failure, one cheap-LLM call with the error asks for a corrected source, which is shown as a suggestion, not silently rewritten into the transcript.
- Diagrams in Document Mode, the Scriptorium preview and help topics.
