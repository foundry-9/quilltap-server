# Icon inventory & canonical name contract

**Status:** Phase 1 (the `<Icon>` system) and the Phase 2 **sidebar pilot** are implemented. This document is the **gate**: the proposed canonical icon-name list below is the permanent public contract that `.qtap-theme` bundles target. **It needs Charlie's sign-off before the remaining ~120-file migration (Phase 2b) locks the names in** — renaming an icon after themes ship overrides for it is a breaking change.

Source of truth for the *implemented* set: [`components/ui/icons/icon-registry.ts`](../../components/ui/icons/icon-registry.ts). Adding/renaming an icon = edit that file, drop the default SVG in `public/images/icons/`, and run `npm run generate:icon-css`.

---

## 1. What the scan found

- **123 component files** still contain an inline `<svg>` (down from 127 — the 4 sidebar pilot files are migrated). Across them, ~**290 icon instances** collapse to ~**55 distinct canonical glyphs**.
- Nearly every icon is `stroke="currentColor"` or `fill="currentColor"` — both render correctly as a CSS mask tinted by `currentColor`, so the default set keeps today's theme-color inheritance.
- The heaviest duplicates (each currently redefined inline in many files): **close/X (~40)**, **check (~22)**, **chevron-down (~10)**, **trash (~8)**, **copy (~6)**, **search (~6)**, **external-link (~6)**, **upload/download (~10)**, **alert-triangle (~6)**. Each collapses to ONE canonical icon.

---

## 2. Canonical icon-name list (the contract)

`✓` = already implemented in the registry (Phase 1). `NEW` = proposed, to be added during the sweep. Names lean toward **function** a theme author would recognize. Several pairs intentionally **share a default glyph** but stay distinct names so a theme can diverge them later (noted).

### General UI & actions
| Name | Status | Glyph | Consolidates (examples) |
|---|---|---|---|
| `close` | ✓ | X | ~40 inline X's (all dialog closes, tag/chip removes, clears) |
| `check` | ✓ | checkmark | optimizer/wizard/import success ticks, selection ticks |
| `check-circle` | NEW | tick in circle | success states (optimizer, plugins up-to-date, tasks empty) |
| `pencil` | ✓ | pencil | edit buttons (prompts, profile, suggestions) |
| `trash` | NEW | bin | delete actions (chat card, prompts, tasks, gallery) |
| `copy` | NEW | clipboard | copy request/response/image, copy path |
| `plus` | NEW | + | add replacement, new chat, restore upload |
| `refresh` | ✓ | circular arrows | reload (LLM logs, tasks, archive, plugins) |
| `search` | NEW | magnifier | search bars/dialogs, plugin search, conversations |
| `download` | NEW | down-arrow to tray | export, restore, report download |
| `upload` | NEW | up-arrow from tray | import, backup, drop zones |
| `cloud-upload` | NEW | cloud + arrow | import-wizard drop zone (distinct from `upload`) |
| `external-link` | NEW | box + NE arrow | repo/changelog/npm links, memory source, data dir |
| `link` | NEW | chain | chat→project link indicator |
| `send` | NEW | paper plane | help-chat composer send |
| `paperclip` | NEW | paperclip | attach file (composer) |
| `eye` | NEW | eye | preview/view, quick-hide "visible" |
| `eye-off` | NEW | eye + slash | quick-hide "hidden", hidden placeholder |
| `star` | NEW | star | set-as-default prompt |
| `bookmark` | NEW | ribbon | save image to gallery |
| `expand` | NEW | outward arrows | nav content-width → wide |
| `compress` | NEW | inward arrows | nav content-width → narrow |

### Navigation: chevrons & arrows
| Name | Status | Glyph | Notes |
|---|---|---|---|
| `chevron-down` | ✓ | ⌄ | disclosure default; **rotate via `className` (`rotate-180`)** — covers chevron-up/expand toggles. No separate `chevron-up`. |
| `chevron-right` | NEW | › | collapsed disclosure, list nav |
| `chevron-left` | NEW | ‹ | gallery prev |
| `arrow-left` | NEW | ← | optimizer/apply "back" |
| `arrow-right` | NEW | → | optimizer "next", plugin upgrade |

### Status & feedback
| Name | Status | Glyph | Notes |
|---|---|---|---|
| `info` | ✓ | i in circle | tips, notes, estimate warnings |
| `alert-triangle` | NEW | ⚠ triangle | warnings (delete-data, breaking changes, vision required) |
| `alert-circle` | NEW | ! in circle | errors (display options, LLM inspector) |
| `shield` | NEW | shield+tick | optimizer "analysis complete" |
| `clock` | NEW | clock | pending task, autonomous/scheduled |
| `calendar` | NEW | calendar grid | LLM logs, memory-dedup, card headers |

### Media & gallery
| Name | Status | Glyph | Notes |
|---|---|---|---|
| `image` | NEW | framed mountain | image placeholders/empty states, generate-image |
| `play` | NEW | ▷ | run queue, continue, autonomous run |
| `pause` | NEW | ❚❚ | pause queue/task |
| `stop` | NEW | ◻ | stop queue |
| `zoom-in` | NEW | magnifier + | gallery zoom in |
| `zoom-out` | NEW | magnifier − | gallery zoom out |

### Domain objects
| Name | Status | Glyph | Notes |
|---|---|---|---|
| `files` | ✓ | document (folded corner) | **Files** nav |
| `file` | NEW | document | generic single-doc empty states — *shares `files`' default glyph* |
| `folder` | NEW | folder | project/folder indicators |
| `folder-plus` | NEW | folder + | create project |
| `book` | NEW | open book | "Refine from Memories" |
| `profile` | ✓ | person (head+shoulders) | sidebar account |
| `user` | NEW | person | generic person (NPC, gallery avatar) — *shares `profile`'s default glyph* |
| `user-plus` | NEW | person + | create NPC |
| `megaphone` | NEW | megaphone | insert announcement (composer) |
| `dice` | NEW | die w/ pips | RNG dropdown (Pascal) |
| `sparkles` | NEW | sparkles | inline "generate" / AI-flavored actions |
| `wand` | NEW | magic wand | the AI Wizard (distinct from inline `sparkles`) |

### Appearance / domain nav (already mostly in registry)
| Name | Status | Glyph |
|---|---|---|
| `projects` `characters` `scriptorium` `photos` `scenarios` `settings` `themes` `wardrobe` `help` `chat` | ✓ | sidebar set (Phase 1) |
| `sun` | NEW | sun — light mode |
| `moon` | NEW | crescent — dark mode |
| `monitor` | NEW | display — system mode |
| `brand` | ✓ | the quill (image mode, full colour) |

---

## 3. Decisions — SIGNED OFF (2026-06-09)

1. **`profile`/`user` and `file`/`files`** — ✅ **keep distinct**, each pair sharing one default SVG so a theme can diverge the two surfaces later.
2. **AI / magic** — ✅ **`sparkles`** for inline "generate"/AI-flavored actions; **distinct `wand`** for the AI Wizard.
3. **Naming taste** — ✅ recommendations adopted: `megaphone`, `expand`/`compress`, `dice`. (Flag in review if any should change before themes ship.)
4. **Drag handle** (six-dot grip, `ProfileCard.tsx`) — ✅ **excluded** (carries drag listeners; UI chrome, not a themeable glyph).
5. **Codename → function renames** (applied in the pilot, for the record): `FoundryIcon`→`settings`, `PaletteIcon`→`themes`, `ProsperoIcon`→`projects`, `ScenariosNavIcon`/`ScenariosIcon`→`scenarios`. The contract name is the function; codename noted only here.

---

## 4. NOT migrated (genuine non-icon graphics)

These stay as inline SVG/components — they are not reusable themeable glyphs:

- **Loading spinners** (`animate-spin`) — ~30 instances incl. the shared `components/tools/import-export/components/LoadingSpinner.tsx` and `qt-spinner-*`. (A separate shared spinner is a possible future cleanup, out of scope here.)
- **Charts / bar graphs** — `capabilities-report-card.tsx` data-viz.
- **Provider badges** — `image-profiles/ProviderIcon.tsx` (plugin-supplied dynamic SVGs + abbreviation badges).
- **Progress dividers / pending-state circles** — wizard step connectors, generation "pending" rings.
- **The animated quill** — `components/chat/QuillAnimation.tsx` stays `<Image src="/quill.svg">` (bespoke `animate-quill-rock`); a `brand` theme override could later apply, but it is out of scope for the core migration.
- **Drag handle** — see decision 5.

The end-state audit (`grep -rn '<svg' components/`) should return only the above categories; they'll be listed here so the "all icons centralized" claim stays verifiable.

---

## 5. Migration batching (Phase 2b, after sign-off)

Done first as the pilot: **left sidebar** (`collapsed-nav`, `sidebar-footer`, `sidebar-header`, `profile-menu`). Remaining batches, each `npx tsc` + visual check + delete orphaned local icon defs:

1. `components/ui/*` shells (BaseModal, FloatingDialog, SlideOverPanel, CollapsibleCard) + `dashboard/*` — high reuse, low risk.
2. `components/chat/*` (24 files) — heaviest; split into composer/messages/dialogs.
3. `components/tools/*` (23) + `components/settings/*` (11).
4. `components/characters/*` + `character/*` + `wardrobe/*` + `memory/*` + `scenarios/*` + `setup-wizard/*`.
5. `components/images/*` + `help-chat/*` + `profile/*` + `search/*` + `tags/*` + `homepage/*` + `terminal/*` + `state/*` + `import/*` + `quick-hide/*` + `layout/autonomous-room-badges.tsx`.

Each new canonical icon: add a registry entry, author `public/images/icons/<name>.svg` (24×24, monochrome `currentColor`), run `npm run generate:icon-css`. Record any further old→new consolidations here as they surface.
