# Madman's Box — Full Icon Redesign

**Status:** COMPLETE (2026-06-10, theme 1.1.0). All canonical icons overridden — **80**, not 79: `tag` was added to the registry mid-project when the Aurora tab-bar migration surfaced a glyph with no canonical home. Implementation deviations from this spec, each approved by Charlie: `brand`'s forced-image-mode rule was removed app-side so the SVG quill masks/tints (with a `?v=<version>` cache-buster added to override URLs — the immutable assets route otherwise pins stale glyphs); `refresh` carries a half-barb arrowhead inside the arc; `wardrobe` became a collared shirt + bowtie (the spec'd dress form and an intermediate trenchcoat both failed the squint test); `paperclip` is a squared-wire Greek-key clip (the binder-clip construction never read); `layers` renders its lower rhombi as hairline chevron-bands for 16 px legibility. The standalone-repo port (§6 Phase 6.1 below) was **skipped** — `qtap-theme-madmans-box` is being retired; the bundled theme is canonical.
**Scope (as planned):** all 79 canonical icons, overridden at the theme level via the `.qtap-theme` `icons` map. No app-side code changes expected.
**Repos touched:** `quilltap-server` (`themes/bundled/madmans-box/`) and the standalone `qtap-theme-madmans-box` repo.
**Design authority:** this document is self-contained. It distills Charlie's *Madman's Box Aesthetic Reference* (Obsidian vault, `Quilltap/Estate Ideas/`); if anything here seems ambiguous, ask Charlie rather than improvising.

---

## 1. Why this is theme-only work

The themeable-icon system is already shipped and signed off (`docs/developer/features/themeable-icons.md`, `docs/developer/ICON_INVENTORY.md`):

- All call sites use `<Icon name="...">` backed by `components/ui/icons/icon-registry.ts` — 79 canonical kebab-case names, a permanent public contract.
- Default glyphs are monochrome SVGs at `public/images/icons/<name>.svg`, painted as CSS `mask-image` tinted by `currentColor`. The lone `image`-mode default is `brand` (`/quill.svg`).
- A theme bundle overrides any icon by name via the manifest:
  ```json
  "icons": { "settings": "icons/settings.svg", "brand": "icons/brand.svg" }
  ```
  An `.svg` override renders in **mask mode** (currentColor tint — only the SVG's *alpha/geometry* matters, never its colors). A `.webp` override is image mode (pre-baked color). **This redesign uses SVG/mask for all 79 icons**, including `brand` — icons must inherit whatever tint the UI gives them (muted, destructive red on delete affordances, etc.).
- The injector (`generateIconOverridesCSS` in `lib/themes/utils.ts`, applied by `components/providers/theme-style-injector.tsx`) handles everything at runtime. Live theme switch, no reload.

The bundled Madman's Box (v1.0.1) already pilots 5 overrides (`brand`, `settings`, `themes`, `wardrobe`, `help`). Those pilots use round linecaps and will be **redrawn** to conform to the language below.

### Preflight: repo divergence (do this first)

`qtap-theme-madmans-box` (standalone) and `themes/bundled/madmans-box` have diverged:

- Bundled is v1.0.1 and has `icons/` (5 pilots); standalone is v1.0.0 without them.
- Standalone has Cormorant Garamond fonts + `OFL.txt` that bundled lacks; READMEs differ.

Treat **`themes/bundled/madmans-box` as canonical for icon work**. Do not silently resolve the font divergence — flag it to Charlie at the start and let him decide which direction the fonts sync. At the end of the project, port the finished `icons/` + `theme.json` changes to the standalone repo.

---

## 2. The visual language (distilled design bible)

One line: **sacred clockwork in a Gatsby cabinet** — Art Deco frames around Gallifreyan orbits, burnished gold geometry lit from within against warm umber dark.

Two parent vocabularies with assigned roles — **the Estate frames; Gallifrey fills**:

- **The Frame (Deco / Estate):** hairline and double rules, stepped/ziggurat profiles, sunburst fans, chevrons, long confident verticals, bilateral symmetry, sharp corners. No floral ornament, ever. Richness is always *geometric* richness.
- **The Orbit (Gallifreyan):** circles, concentric rings, arc-segments with **flat (butt) caps**, dots at mathematically exact positions on ring paths, radial spokes and tangent chords. Radial symmetry that rewards rotation. Every mark must look like it *means* something — a diagram, never doodling.

### The two icon registers (from the reference, verbatim in spirit)

- **Utility icons** (toolbar verbs, chevrons, affordances): simple uniform-stroke line icons, geometric, sharp-cornered, Frame vocabulary. A dot may serve as accent; nothing else may.
- **Emblematic icons** (feature marks, brand moments): Orbit vocabulary — seal-like, ring-bearing, radially composed.
- **The registers never mix in one glyph.** A save button does not get a mandala; the Commonplace Book's emblem does not get a floppy disk. At 24 px the emblem register is *restrained*: at most one hairline ring + one break + one dot. Full seals belong to loaders and empty states, not toolbar icons.

### Hard rules for every glyph

1. **Sharp everywhere.** `stroke-linecap="butt"`, `stroke-linejoin="miter"`. No `rx` above 1. The only true curves are actual circles and circular arcs.
2. **Uniform strokes, two weights.** Primary 2.0; secondary/hairline 1.25 (never below — it vanishes at 16 px render). "Hairline" contrast comes from pairing 1.25 against 2.0, optionally with `stroke-opacity` 0.5–0.7 on the secondary line (partial alpha masks to a lighter tint — the engraved-detail trick; the default `projects.svg` already does this). No tapering, no calligraphy.
3. **Dots are deliberate.** Filled circles r 0.9–1.25, placed at exact positions (on ring paths, at grid intersections), never "to fill space."
4. **Straight lines in circular compositions are radial or tangent** — spokes and chords expressing relationships, never flourishes.
5. **No baked color.** Geometry/alpha only; the theme's tokens supply the gold. Never design assuming gold — the same glyph renders in Faded Brass, Sealing Wax, Parchment.
6. **One curated wrongness, rationed.** At utility scale, almost never. Where dosed (see `clock`), it must survive a squint and never cost legibility.
7. **Semantic anchor is non-negotiable.** Every redesigned icon keeps a recognizable connection to what users already understand — the silhouette or central motif of the conventional glyph, *translated* into Box vocabulary, not replaced by private symbolism. Test: a user who knows the default icon should identify the new one without being told.

### Litmus tests (run on every finished glyph)

1. Is it opulent — confident, precise, expensive-looking? (Else it lost the Estate.)
2. Is the mechanism visible and precise — geometry you can watch meaning something? (Else it lost the clockwork.)
3. If it carries a ring/arc/dot, does it read as a diagram rather than decoration? (Else it lost Gallifrey.)
4. Does it still read as its verb/noun at 16 px? (Else it lost the user — failure mode worse than all the others.)

Named failure modes to avoid: *merely pretty deco* (no engine), *rings as wallpaper* (orbits on everything), *grimy gearpunk*, *cold sci-fi*, and — the icon-specific one — *rebus puzzles* (clever symbols nobody can decode).

---

## 3. SVG technical contract

Every override file:

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2"
     stroke-linecap="butt" stroke-linejoin="miter">
  <!-- geometry -->
</svg>
```

- `viewBox="0 0 24 24"`, live area 2..22 (20×20), optically centered.
- Filled elements (dots, solid arrowheads) use `fill="currentColor" stroke="none"` per element.
- No `<text>`, no gradients, no filters, no embedded images, no `transform` on the root.
- Files live at `themes/bundled/madmans-box/icons/<name>.svg`, named exactly per the registry contract.
- Run each file through SVGO or hand-minify; keep them human-readable (one element per line).

Worked example — `chevron-down` (Frame register, tightened to a 75° deco chevron, mitred apex, butt ends):

```xml
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width="2" stroke-linecap="butt" stroke-linejoin="miter">
  <polyline points="5.5 8.5 12 15.5 18.5 8.5"/>
</svg>
```

---

## 4. Detailed specs — the icons that matter most

These are prescriptive. Coordinates are guidance (±0.5 ok); the *construction* is not negotiable.

### `brand` — the quill, sealed *(emblem; per Charlie's explicit decision)*
Keep the feather as the central glyph — **the one organic form in the entire system**, deliberately framed: the one thing in the Box that grew rather than was machined. Quill set diagonally, nib to SW, drawn from two long sweeping curves plus 2–3 barb chords (rework of the existing pilot's geometry, weight 1.75). Around it, a hairline ring (r ≈ 10, w 1.25) broken into two arcs with precise asymmetric gaps — wide gap at NE where the plume escapes the ring, narrow gap at SW. One filled dot (r 1) sitting exactly on the ring path at the edge of the wide gap. Note: as an SVG this becomes mask-mode monochrome (it is full-color image-mode by default) — intended.

### `settings` — the jeweler's gear *(Foundry feature mark)*
A gear cut by a jeweler, not a machinist: outer ring r 6.5 (w 2) carrying 8 **square ziggurat teeth** (straight-sided stubs ~2 wide × 2 tall, butt ends, evenly at 45° intervals); inner hairline ring r 3.5 (w 1.25); filled center dot r 1.25. Replaces the current wrench-glyph default *and* the round-capped pilot. Reads "gear = settings" instantly; the teeth are deco, the rings are orbit — this is a feature mark, so the mix is earned.

### `themes` — the palette, made orbital *(Calliope feature mark)*
Keep the painter's-palette anchor, re-cut as a diagram: main circle r 8.5 (w 2) **broken by one precise arc gap at SE** (~35°, where the thumb hole was); four filled dots (r 1) placed exactly on an invisible inner ring path r 5 at deliberately uneven angles (e.g. 100°, 160°, 215°, 290°). Users still see a palette; the Box sees a setting-circle with stations.

### `chat` — the calling card *(Salon)*
Speech bubble as engraved calling card: sharp-cornered rect (4,5)–(20,16) at w 2; inner hairline border inset 1.5 (the double rule); tail as a sharp triangle of two straight chords from (8,16) to (6.5,20) back to (11.5,16), mitred. No curves at all.

### `characters` — the museum bust *(Aurora)*
The default is already a bust on a plinth; sharpen it: head circle r 2.5 at (12,6.5); shoulder line as a single arc (butt caps) from (7.5,13) to (16.5,13); pedestal as **three stepped rects** (ziggurat: widths 8, 10, 12; heights ~1.6 each, sharp corners), top step carrying a hairline rule. A bust in the Estate's gallery.

### `projects` — the pigeonhole cabinet *(Prospero)*
Keep the default's shelf-grid anchor: outer rect (3.5,4.5)–(20.5,20.5) at w 2, sharp; internal hairlines (w 1.25, opacity 0.6) making a 3×2 grid of pigeonholes; **one filled dot (r 1.1) centered in the upper-right hole** — one drawer holds something. That dot is this glyph's entire allowance of wrongness.

### `scriptorium` — the scroll, rolled on true circles
Keep the scroll: page as two horizontal chords (top y 7, bottom y 17, w 2) spanning x 7..17; each end rolled into a **true circle** r 2 (w 1.25) at (5,12) and (19,12) — the roll seen end-on, circles as structure; two hairline text rules (w 1.25, opacity 0.6) inside the page.

### `book` — the sealed tome *(Commonplace Book feature mark)*
Closed book, spine left: cover rect (5,3.5)–(19,20.5) at w 2, sharp; spine as a vertical hairline at x 7.5 plus two short stepped spine-band chords; centered on the cover, a **miniature seal**: hairline ring r 3 (w 1.25) with one small arc-gap at NE and a filled center dot r 0.9. The one closed book in the house you may not browse — and it remembers you asked.

### `dice` — the croupier's die *(Pascal)*
Sharp square (4,4)–(20,20), `rx 0`, w 2, with an inset hairline border (double rule, inset 1.75, w 1.25, opacity 0.6); five filled pips r 1.1 at exact face-5 positions. A die from a very good table.

### `wardrobe` — the dress form
Keep the mannequin anchor: neck circle r 1.5 at (12,5); gown as a sharp triangle from (12,8) flaring to chords at (5.5,18)–(18.5,18), mitred; **two interior vertical hairlines** (w 1.25, opacity 0.6) as deco fluting; base = center post chord (12,18)–(12,20.5) plus a short foot rule.

### `search` — lens and tangent
Lens circle r 7 centered (10.5,10.5) at w 2; handle as a **true tangent chord** to the circle, running to (21,21), butt cap. The handle visibly *touches* the circle tangentially rather than poking it — a relationship, not a collision.

### `trash` — the fluted dustbin
Can body as a slightly tapering sharp trapezoid (top x 6..18, bottom x 7..17, y 8..20.5) at w 2; **three interior vertical hairline flutes** (Chrysler verticals, w 1.25, opacity 0.6); lid as **two stacked rects** (ziggurat: (5.5,5.5)–(18.5,7.2) and (8,3.8)–(16,5.5)), sharp. Unmistakably a bin; unmistakably deco.

### `clock` — stopped at an odd minute
Ring r 8.5 at w 2; four tick dots (r 0.9, filled) at exactly 12/3/6/9 on an inner ring path r 6.5; hands as two **radial spokes** (hour w 2 to r 4, minute w 1.5 to r 6.25), butt caps, center dot r 1.1 — and the hands read **11:07**. Not 10:10 like every catalog clock. The single fullest dose of curated wrongness in the set.

### `refresh` — the escapement
One arc, r 7.5, sweeping ~270° (from 120° to 30°), w 2, **butt caps**, with a small solid triangular arrowhead (filled, sharp) at the arc's end, plus a filled center dot r 1.25. Rotation is the Box's signature motion; this is its icon.

### `star` — the sheriff's star, doubled
Keep five points (the anchor is too strong to change): sharp 5-point polygon, mitred, w 2 — plus a concentric **hairline inner outline** (same polygon scaled ~62%, w 1.25, opacity 0.6): the double rule applied radially. NOT four-pointed (that's `sparkles`' shape; keep them distinct).

### `help` — the desk bell ring
Question mark redrawn with butt caps and a separate filled dot (r 1.1), set inside a **broken hairline ring** r 9 (w 1.25) with one gap at SW. Help is the front desk of the house — slightly emblematic, so it earns its ring.

### `eye` / `eye-off`
Vesica from two circular arcs meeting at sharp points (x 3..21), w 2; iris circle r 2.75; filled pupil dot r 1. `eye-off`: identical, plus one precise diagonal **chord** (4,20)→(20,4), w 1.75, butt — a strikethrough, not a scribble.

### `send` — the deco dart
Keep the paper-plane silhouette as a sharp mitred polygon (nose at (21.5,2.5)), with one interior **fold chord** w 1.25. All points, no curves.

### `shield` — the escutcheon
Straight top chord, straight sides, bottom converging in **two chords meeting at a sharp point** (chevron bottom, mitred); center vertical hairline (w 1.25, opacity 0.6) splitting the field; one filled dot r 1 at the optical center.

### `zap` — the Jacob's ladder
The theme's README literally features one. Sharp angular bolt polygon, mitred, no curves — crackling between two implied posts.

### `link` — interlocked rings
Replace the chain-oval default with **two interlocked true circles** r 4.25 centered (8.5,12) and (15.5,12), w 2, with the overlap gaps cut precisely so they read as woven. The most literal orbit icon in the set, and still instantly "link."

### `calendar`
Sharp rect (3.5,5)–(20.5,20.5) w 2; top band as a double rule (chords at y 8.5 w 2 and y 10 hairline); **two filled binding-post dots** r 1 sitting exactly on the top edge at x 8 and x 16 (replacing the dangling ring-binder strokes); interior hairline grid (w 1.25, opacity 0.5).

---

## 5. One-line directions — the remaining icons

Frame register unless marked Ⓞ (restrained-orbit allowed). Every entry names its semantic anchor — keep it.

| Icon | Anchor | Box treatment |
|---|---|---|
| `close` | × | Two crossing chords, w 2, butt; span 6..18. |
| `check` | tick | Two chords, sharp miter at the turn; butt ends. |
| `check-circle` | tick in circle | Ring r 9 w 1.5 + the same mitred tick. Ⓞ |
| `plus` | + | Two chords, butt; span 5..19. |
| `pencil` | pencil | Drafting pencil at 45°: two parallel chords (hex body), sharp triangular nib, flat butt end; one hairline ferrule chord. |
| `copy` | two pages | Two offset sharp rects; rear one hairline (1.25, opacity 0.6) — double rule in depth. |
| `info` | i in circle | Ring r 9 w 1.5; filled dot r 1.1 + vertical stub chord w 2. Ⓞ |
| `download` | arrow to tray | Arrow chord + sharp open V head, descending onto a shelf chord with small stepped end-stops. |
| `upload` | arrow from tray | Mirror of `download`. |
| `cloud-upload` | cloud + arrow | Cloud assembled from three precise circular arcs (flat base chord) + the upload arrow. Arcs, not puff. |
| `external-link` | box + out-arrow | Sharp rect missing its NE corner; arrow chord exiting through the gap at exactly 45°, open V head. |
| `paperclip` | attach | Binder-clip silhouette: sharp triangle body + two straight handle chords. (A wire paperclip is irredeemably round.) |
| `star` → §4 | | |
| `bookmark` | ribbon | Sharp ribbon rect with chevron-notch bottom (two chords to a point), mitred. |
| `expand` | corners out | Four L-shaped corner chord-pairs pointing outward, butt, w 2. |
| `compress` | corners in | Same, pointing inward. |
| `chevron-down/right/left` | chevron | 75° mitred chevrons, butt ends (worked example §3). |
| `arrow-left/right/up/down` | arrow | Shaft chord + open sharp V head (mitred), butt tail. |
| `alert-triangle` | warning | Sharp mitred triangle w 2; exclamation = stub chord w 2 + filled dot r 1.1. |
| `alert-circle` | warning | Ring r 9 w 2 + same exclamation. Ⓞ |
| `ban` | prohibition | Ring r 8.5 w 2 + one diagonal chord cut exactly between circumference points. Ⓞ |
| `image` | framed picture | Sharp rect + double-rule inner frame (hairline); mountain as two mitred chords; sun as filled dot r 1.1 placed deliberately off-center. |
| `camera` | camera | Sharp body rect, stepped top plate (ziggurat), lens as ring r 3 w 2 + hairline inner ring r 1.75 + center dot — a lens is an orbit by trade. |
| `play` | ▶ | Sharp mitred triangle, w 2, optically centered. |
| `pause` | ‖ | Two sharp vertical bars (rects or thick chords), butt. |
| `stop` | ■ | Sharp square, w 2, `rx 0`. |
| `zoom-in/out` | lens ± | §4 `search` construction + plus/minus chords inside the lens. |
| `files` | documents | Two fanned sharp docs; rear hairline. Diverge from `file` (registry allows it). |
| `file` | document | Single sharp doc; corner fold as a true triangle (two chords), not a curl. |
| `file-plus` | new doc | `file` + small plus of two chords. |
| `folder` | folder | Sharp body; tab as a **two-step ziggurat** instead of a slope. |
| `folder-plus` | new folder | `folder` + plus. |
| `photos` | photo stack | `image` construction with a second hairline rect offset behind. |
| `scenarios` | playbill | Sharp rect; top clip as small centered rect; double rule under the clip; three hairline text rules, the last short. (Drop the default's checkmark.) |
| `profile` | portrait | The cameo: hairline ring r 9 frame + bust inside (head dot r 2, shoulders arc), butt. Ⓞ |
| `user` | person | Head circle r 3 + shoulders as one arc (butt caps). No ring — keep distinct from `profile`. |
| `user-plus` | add person | `user` shifted left + plus chords. |
| `users` | people | Two `user` constructions, rear one hairline. |
| `megaphone` | announce | Sharp cone of mitred chords; mouth as one short arc; handle chord. |
| `dice` → §4 | | |
| `sparkles` | sparkle | Three **4-point diamond stars** (sharp, mitred) of descending size, placed like a constellation — exact positions, not scatter. |
| `wand` | magic wand | Diagonal baton chord w 2 with butt ends + one 4-point diamond spark at the tip + one dot r 0.9 placed on an implied arc. |
| `wrench` | tool | Keep silhouette; jaw redrawn as a hexagonal open-end (straight chords), straight shaft, flat butt. |
| `code` | brackets | Two 75° mitred chevrons + one diagonal chord between, butt. |
| `cpu` | chip | Sharp square + inner hairline square (double rule) + radial pin stubs (butt) — already half deco; finish the job. Ⓞ |
| `database` | data store | The card catalog: three stacked sharp drawer rects, each with a centered filled pull-dot r 1. (A cylinder needs ellipses; ellipses are not circles; the Box does not bend that rule.) |
| `layers` | stack | Three sharp mitred rhombi; lower two hairline. |
| `swap` | exchange | Two opposing arrow chords with open V heads, offset rails. |
| `log-out` | exit | Door frame as sharp open rect + arrow chord exiting, open V head. |
| `themes` → §4 | | |
| `sun` | light mode | Circle r 4 w 2 + 8 **radial spokes** (butt, w 2, r 6.5→9) at exact 45° stations. Practically orbit already. Ⓞ |
| `moon` | dark mode | Crescent from two circular arcs meeting at sharp points. |
| `monitor` | system mode | Sharp screen rect + hairline inner bezel (double rule) + stepped pedestal (ziggurat). |
| `brand`, `settings`, `wardrobe`, `help`, `chat`, `characters`, `projects`, `scriptorium`, `book`, `search`, `trash`, `clock`, `refresh`, `eye`, `eye-off`, `send`, `shield`, `zap`, `link`, `calendar` → §4 | | |

---

## 6. Execution plan

### Phase 0 — Preflight
1. Read `docs/developer/features/themeable-icons.md`, `docs/developer/ICON_INVENTORY.md`, and this document end to end.
2. Flag the standalone-repo divergence (fonts/OFL/README) to Charlie; confirm bundled-as-canonical for icons.
3. Confirm the dev instance + `npm run dev` is available for live testing.

### Phase 1 — Contact-sheet harness
Build `themes/bundled/madmans-box/icons/preview.html` (excluded from the packed bundle, or kept in a sibling `tools/` dir if the validator objects): a static page that renders every icon **mask-style** (`mask-image` + `background-color`) at 16/20/24/48 px, in Old Gold `hsl(40 72% 52%)` on Vault Black `hsl(28 32% 7%)`, plus a Faded Brass row and a Sealing Wax row (tint-robustness check), with the app default SVG beside each redesign for the squint test. This harness is the review surface for every phase gate.

### Phase 2 — Wave 1: the emblems and §4 set (~20 icons)
Draw every icon specified in §4. **Stop and present the contact sheet to Charlie for approval before proceeding** — this wave sets the dialect for the remaining 59. Expect revisions; the per-icon constructions above are the brief, Charlie's eye is the acceptance test.

### Phase 3 — Wave 2: high-frequency verbs (~25)
Chevrons, arrows, close/check/plus, copy, info, download/upload/cloud-upload, external-link, pencil, eye pair already done, expand/compress, folder/file family, play/pause/stop, zoom pair, bookmark, paperclip. Quick checkpoint render; proceed unless something looks off.

### Phase 4 — Wave 3: the remainder (~34)
Everything else in §5. Full contact-sheet review with Charlie at the end.

### Phase 5 — Wire-up and live test
1. Add all 79 entries to the `icons` map in `themes/bundled/madmans-box/theme.json`.
2. Bump theme `version` to **1.1.0** (minor — new capability surface, no breaking change).
3. Validate: pack and run `npx quilltap themes validate <bundle>`.
4. Install/activate on the dev instance; walk the Salon, Aurora, Prospero, Scriptorium, and every `/settings` tab. Screenshot key views. Check: icons inherit tint correctly everywhere (destructive buttons go Sealing Wax, muted toolbars go Faded Brass); nothing renders as a blob at 16 px; `brand` looks right in the places that previously showed the full-color quill.
5. Check `logs/combined.log` for any theme-injector or asset-route warnings while switching themes back and forth.

### Phase 6 — Sync, docs, release hygiene
1. Port `icons/` + `theme.json` (+ README updates) to the standalone `qtap-theme-madmans-box` repo; bump its version to match.
2. `docs/CHANGELOG.md` entry (plain, terse American English — the changelog is exempt from the house voice).
3. Touch the themes help file (`help/*.md`) only if user-facing behavior beyond appearance changed (likely a one-line note that Madman's Box now ships a full icon set); keep frontmatter `url` + In-Chat Navigation intact.
4. No `packages/` are touched, so no npm publish pause. No `qt-*` class changes, so no theme-storybook or create-quilltap-theme changes — but verify `packages/theme-storybook/src/stories/components/Icons.tsx` still describes the override mechanism accurately.
5. Commit via the `/commit` flow per repo convention.

### QA checklist (every icon, before its wave closes)
- [ ] Reads as its meaning at 16 px without being told (semantic anchor, rule 7).
- [ ] Butt caps, mitred joins, no `rx` > 1, only circular curves.
- [ ] Two stroke weights max; hairlines ≥ 1.25.
- [ ] Survives recolor: legible in gold, brass, parchment, and red.
- [ ] Register purity: no orbit elements on plain verbs; no literal-object clutter on emblems.
- [ ] Passes the four litmus tests (§2).
- [ ] Valid mask: no reliance on internal color; partial opacity only as deliberate engraving.

---

## 7. Out of scope (explicitly)

- Personified-feature avatars (`public/images/avatars/*-avatar.webp`), feature hero/thumbnail bitmaps, the favicon, empty-state illustrations, and loading-state mandalas. Several of those *should* eventually get the full Orbit-seal treatment per the aesthetic reference — separate project.
- Any change to `icon-registry.ts`, default SVGs in `public/images/icons/`, or icon names. The 79 names are a permanent contract; this project only ships overrides.
- Other bundled themes.
