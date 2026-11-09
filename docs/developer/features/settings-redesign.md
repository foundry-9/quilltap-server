# The Foundry, rebuilt — a logical settings page with search

**Status:** Proposed 2026-11-09 (4.13-dev); the §9 questions were answered the same day, so every decision in §5 is settled. Nothing implemented. Written to be run by an implementing model: §5 holds the decisions, the mechanics under each phase in §6 are the implementer's to work out. Where the code contradicts a decision in §5, stop and report rather than improvise around it.

**Scope:** the Settings page and everything that addresses it. Server: nothing — no setting changes meaning, no API route changes, no schema or migration. Client: `app/settings/SettingsView.tsx`, `components/settings/tabs/*` (the eight tab files and `useSettingsSection.ts`), `components/ui/CollapsibleCard.tsx`, `lib/foundry/subsystem-defaults.ts` (`SubsystemId` gains `brahma`; `CHILD_SUBSYSTEM_IDS` and the `href`s), two new art assets for Brahma (`public/images/brahma.webp`, `public/images/thumbnails/brahma.webp`), the `app/foundry/*` redirects, the Connections group's list surfaces (`components/settings/api-keys-tab.tsx`, `connection-profiles/`, `image-profiles-tab.tsx`, `embedding-profiles/` — regrouped by provider in Phase 5; their modals are reused as they are), `lib/workspace/tab-meta.ts` and the `settings` workspace-tab payload, `lib/help-guide/categories.ts` (the route patterns), the `help_settings` and `help_navigate` tools' understanding of settings URLs, and the `url:` frontmatter of the 58 help documents that point into `/settings`. The *contents* of every card — the forms, the modals, the plugins manager, the Almanack — are moved, not redesigned; the one exception is the Connections group, whose four list surfaces are recomposed around providers (D10).

**Related:** [complete/tabbed-workspace.md](complete/tabbed-workspace.md) (the `settings` tab kind carries `{ tab?, section? }`), [complete/tanstack-query-migration.md](complete/tanstack-query-migration.md), [complete/concierge-overhaul-phase-3-three-states.md](complete/concierge-overhaul-phase-3-three-states.md) (the one tab designed as a whole, and the model for a group), `help/settings.md` (the user-facing description that this spec replaces), the theme `subsystems` override in `lib/themes/types.ts` (themes rename and re-image subsystems by `SubsystemId`, which this spec keeps meaningful).

---

## 1. The problem

The Settings page was laid out when it had four tabs and perhaps a dozen cards. Every feature since has added a card to whichever tab was nearest, and the result is a page where related things are far apart, unrelated things are neighbours, and finding anything means remembering where it was put rather than reasoning about where it would be. All figures below are from the code as of 2026-11-09 (§4).

### 1.1 The tabs are personas, so the persona wins every fight

`SettingsView.tsx` maps eight tabs to eight subsystems (`TAB_SUBSYSTEM_MAP`): AI Providers is the Forge, Chat is the Salon, Templates & Prompts is Aurora, Data & System is Prospero, and so on. A card has to live in exactly one persona's tab. Two subsystems — Pascal and Saquel — are real entries in `DEFAULT_SUBSYSTEM_DEFINITIONS` with their own thumbnails and backgrounds, but `CHILD_SUBSYSTEM_IDS` drops them and their `href`s point at tabs where they own a card or two among many: `/foundry/pascal` redirects to `?tab=chat`, where Pascal's three cards (Automation, Custom Tools, General State) sit among 21; `/foundry/saquel` redirects to `?tab=system`, where Saquel's two (Encryption Passphrase, Auto-Lock) sit beside Plugins and the Tasks Queue. The Almanack is Prospero's by the glossary and lives under AI Providers. Image Description is the Lantern's and lives under Chat.

### 1.2 The Chat tab is a third of the page

| Tab | Cards |
|---|---|
| Chat | 21 |
| Data & System | 9 |
| Commonplace Book | 7 |
| The Concierge | 5 |
| AI Providers | 4 + the wizard panel |
| Images | 4 |
| Appearance | 3 |
| Templates & Prompts | 3 |

56 cards and the wizard panel. The Chat tab holds composer ergonomics (spellcheck, slash commands, smart typography, auto-scroll), display (token counts, thinking), context budgeting (compression, memory cascade, data retention), Pascal's three cards, Prospero's agent mode and answer confirmation, the Brahma Console's turn cap, Taboo, and both autonomous-room cards. `ChatTabContent.tsx` destructures 22 handlers from `useChatSettingsContext()` to render them, and they are a flat list of `CollapsibleCard`s with no sub-grouping.

### 1.3 Three kinds of profile, one place for the key they share

A connection profile, an image profile and an embedding profile each name an API key. The keys are one card under AI Providers; connection profiles are beside them; image profiles are under Images; embedding profiles are under Commonplace Book. "Set up a new provider" is therefore three tabs, and the natural question — *which profiles use this key?* — has no screen that answers it. The AI Stack Setup Wizard exists partly to paper over this.

### 1.4 Deep links drift because nothing holds the list

Cards are addressed as `/settings?tab=<tab>&section=<sectionId>`; `useSettingsSection` reads `section` and each tab file passes `forceOpen` to the matching card. The `sectionId`s are already unique across all eight tabs (verified, §4), but nothing records which tab a section lives in except the JSX that renders it. Consequences, all present today:

- `help/the-courier.md` deep-links to `?tab=providers&section=the-courier`. No tab renders a card with that id; the Courier's settings live inside the connection-profile modal. The link opens the Providers tab and scrolls nowhere.
- The Cheap LLM card is linked as `?tab=providers&section=cheap-llm` (where it is) and `?tab=chat&section=cheap-llm` (where it is not).
- `lib/help-guide/categories.ts` holds its own eight `pattern: '/settings?tab=…'` rows mapping tabs to help categories; `lib/foundry/subsystem-defaults.ts` holds the eight `href`s; `app/foundry/*/page.tsx` hold ten redirects; `SettingsView.tsx` holds `TAB_SUBSYSTEM_MAP` and `SETTINGS_TABS`. Four hand-kept copies of one fact, none checked against the JSX.

`npm run lint` validates `qt-*` classes and CSS variables because a wrong one is invisible to every other check; a wrong settings URL is in exactly the same position and has no gate.

### 1.5 There is no search

Fifty-six cards, eight tabs, and the only way to find "where do I change the passphrase" is to guess a tab and scan. The help chat can answer it (`help_settings`, `help_navigate`), which is a fine fallback and a poor primary. The global search (`/api/v1/ui/search`) indexes entities, not settings.

### 1.6 Eight top tabs is already the limit

`EntityTabs` renders a horizontal strip. Eight labelled tabs with icons wrap at a modest window width; a ninth or tenth group cannot be added without the strip breaking, which is part of why new cards go into existing tabs (§1.2). Any regrouping that produces a sane number of groups needs a different container.

## 2. Goal

A Settings page where:

1. **Placement is predictable.** A card is in the group a person would guess from what it does, not from which member of staff runs it. Related knobs are adjacent; the three profile kinds and the keys they use are one group.
2. **Personas are visible everywhere and own nothing exclusively.** Every card wears the badge of the staff member responsible for it; the Foundry hub's persona cards become a *lens* that filters the whole page to one persona's cards wherever they live; the backdrop still follows the persona.
3. **Search narrows the page.** A search field at the top filters groups and cards as you type, opens the matches, and highlights the matched words. A persona's name is a valid query. Plain-speech synonyms work ("password", "dice", "censor").
4. **There is one list of what is on the page**, and everything that addresses the page — the renderer, the deep links, the Foundry hub, the workspace tab payload, the help-guide categories, the help tools, the help docs' frontmatter — reads it or is checked against it.
5. **Every existing link still lands.** Old `?tab=&section=` URLs, help docs, bookmarks and `help_navigate` targets resolve to the card's new home.

## 3. Non-goals — examined and deliberately left alone

- **No setting changes meaning, default, storage or API.** This is a navigation and layout change. The forms and modals inside the cards are moved as components, not rewritten; the provider view (D10) is a read-time regrouping of lists the page already loads, and the three profile modals open from it unchanged.
- **The Foundry's persona identity is kept**, including the theme `subsystems` override and the per-subsystem background images. Pascal and Saquel become more visible, not less, and Brahma joins them.
- **The Setup Wizard** (`/settings/wizard`, the `settings-wizard` workspace tab) is untouched; it gains a card in Connections that opens it, as the panel does today.
- **The Host is not a persona of his own on this page.** He is the Salon's voice; his cards wear the Salon's badge.
- **Per-project, per-chat and per-character settings** stay where they are. This spec is the instance-wide page only.
- **The help chat's tools** keep their names and shapes; they learn the new URL form, nothing more.
- **Not a visual redesign.** The `qt-*` vocabulary, `CollapsibleCard`, and theme behaviour are reused. New classes are added for the rail, the search field, the persona chips, the attention strip and the provider cards only.
- **The `/foundry` route stays a redirect.** The persona row on `/settings` is the hub; a thumbnail page is not restored.

## 4. Known state (verified 2026-11-09)

- Tabs and their cards, in order, with `sectionId`s:
  - **providers**: *(wizard panel, no card)*, `api-keys`, `connection-profiles`, `cheap-llm`, `capabilities-report` (The Almanack).
  - **chat**: `composition-mode`, `composer-spellcheck` (titled "Composer"), `composer-slash-commands`, `auto-scroll`, `text-replacements`, `smart-typography`, `token-display`, `context-compression`, `memory-cascade`, `image-description`, `automation`, `custom-tools`, `general-state`, `agent-mode`, `thinking-display`, `answer-confirmation`, `taboo`, `data-retention`, `brahma-console`, `autonomous-rooms`, `autonomous-room-schedules`.
  - **concierge**: `on-duty`, `uncensored-desk`, `refusals`, `display`, `pre-screening`.
  - **appearance**: `appearance`, `avatar-settings`, `tags`.
  - **memory**: `embedding-profiles`, `memory-backfill`, `memory-maintenance`, `memory-extraction-grain`, `memory-recall`, `memory-regenerate`, `conversation-summaries-regenerate`.
  - **images**: `image-profiles`, `story-backgrounds`, `wardrobe-images`, `default-aesthetics`.
  - **templates**: `roleplay-templates`, `prompts`, `core-whisper`.
  - **system**: `encryption-passphrase`, `auto-lock`, `plugins`, `backup-restore`, `import-export`, `llm-logging`, `tasks-queue`, `llm-logs`, `delete-all-data`.
- All 56 `sectionId`s are distinct across tabs. (`appearance` is both a tab id and a section id, which is harmless today and must stay unambiguous in the new URL scheme — D4.)
- `CollapsibleCard` already supports `sectionId`, `forceOpen` (one-shot scroll-into-view), and a controlled `isOpen` / `onOpenChange` mode for single-open accordions. The search behaviour in D5 needs nothing new from it except a `highlight` prop.
- `EntityTabs` persists the active tab to `?tab=` via `router.replace`; the workspace's `settings` tab kind carries `{ tab?, section? }` and `SettingsView` accepts both as props so a workspace tab can deep-link without the URL.
- `ChatSettingsProvider` wraps all eight tabs; it loads the single `chat_settings` row and the profile lists once. It stays the provider for every card that reads them.
- 58 help documents carry a `url:` frontmatter under `/settings`; two of them point at targets that do not exist (§1.4). `help/settings.md` describes "The Eight Tabs" and names each card.
- `lib/help-guide/categories.ts` maps eight `/settings?tab=` patterns to help categories; `help_settings` (`lib/tools/help-settings-tool.ts`) and `help_navigate` consume URLs from the help docs.
- Ten `app/foundry/<subsystem>/page.tsx` files redirect to the subsystem's `href`; `app/foundry/page.tsx` and `app/tools/page.tsx` redirect to `/settings`.
- Existing tests touching the page: `__tests__/unit/components/settings/ConciergeTabContent.test.tsx` renders one tab; the rest test individual cards' forms and must keep passing untouched.

## 5. Decisions of record

### D1 — The spine is logical; the persona is a badge; the page is The Foundry

Groups are organised by *what kind of thing is being set*, named in plain words (no persona names in the rail). Every card declares a `persona` (§5.1) and renders a small avatar chip in its header, with the persona's one-line description as the tooltip. The group's background image is the image of the persona that owns the most cards in it. The persona row (§D6) is the persona-first view; the page itself is thing-first. The page's `h1` becomes **The Foundry** — matching the workspace tab's title and the glossary — with "Settings" as the subtitle so the plain word is still on the page; the sidebar's wrench keeps its "Settings" label.

### D2 — A left rail of groups, each group a column of collapsible cards

Replace `EntityTabs` on this page with a vertical rail (`<nav aria-label="Settings sections">`) listing the groups with their icons; the selected group's cards render on the right as `CollapsibleCard`s, as today. Below the `md` breakpoint the rail collapses to a labelled `<select>`. A group may mark some cards **advanced**; those render below a divider labelled "Advanced", collapsed. Nested accordions (a group as an accordion containing card accordions, in one scrolling column) were considered and rejected: 56 cards in one column is a long scroll, and two levels of disclosure hide the scrollbar's meaning. The rail scales to the ten groups below and to more.

### D3 — One registry is the source of truth for the page

A new client-safe module, `lib/settings/registry.ts`, exports:

```ts
export interface SettingsGroup {
  id: SettingsGroupId
  title: string
  description: string
  icon: IconName
  /** Persona whose backdrop the group wears when none of its cards is focused. */
  persona: SettingsPersona
}

export interface SettingsCard {
  id: string                      // the existing sectionId, unchanged
  group: SettingsGroupId
  title: string
  description: string
  persona: SettingsPersona
  /** Plain-speech synonyms for search ("password", "dice", "censor"). */
  keywords: readonly string[]
  advanced?: true
  /** A card rendered inside another card's body (D10); still a deep-link and search target. */
  hostedBy?: string
  /** Help document slug this card is documented in. */
  help?: string
}

export const SETTINGS_GROUPS: readonly SettingsGroup[]
export const SETTINGS_CARDS: readonly SettingsCard[]
export function resolveSettingsLink(params: URLSearchParams): { group: SettingsGroupId; card?: string } | null
export const LEGACY_TAB_TO_GROUP: Record<LegacyTabId, SettingsGroupId>
```

The registry carries **no React**. `components/settings/cards.tsx` maps `card.id` to a lazily imported component; `SettingsView` renders the rail from `SETTINGS_GROUPS`, the column from `SETTINGS_CARDS.filter(c => c.group === active)`, and wraps each in `CollapsibleCard` with the registry's title and description. The eight `*TabContent.tsx` files are deleted once their cards are registered. Everything that addresses the page reads the registry or is tested against it:

- `SettingsView` (render, backdrop, search).
- `resolveSettingsLink` (§D4) for the URL, the workspace `settings` payload, and `help_navigate`.
- `lib/foundry/subsystem-defaults.ts` `href`s are derived (`/settings?group=…` or `/settings?persona=…`) rather than spelled.
- `lib/help-guide/categories.ts` route patterns derive from groups.
- A test (§7) asserts every `url:` frontmatter under `help/` resolves to a group or card, and every card has a `help` slug that exists. This is the gate §1.4 lacks.

### D4 — New URL scheme, old URLs bridged forever

- `/settings?group=<groupId>` opens a group. `/settings?section=<cardId>` opens the card's group, opens the card and scrolls to it (group is derived; a `group=` beside it is ignored if they disagree). `/settings?persona=<SubsystemId>` opens the page in persona-lens mode (§D6). `/settings?q=<text>` opens with the search pre-filled (so the help chat can hand the user a narrowed page).
- `resolveSettingsLink` accepts the old `tab` and `section` parameters: `section` alone resolves by card id (they are unique); `tab` alone resolves through `LEGACY_TAB_TO_GROUP`; `tab` + a `section` that no longer exists (the Courier) resolves through a small `LEGACY_SECTION_ALIASES` map to the card that now holds it. The old form is never removed — it costs one small table and keeps every bookmark, every published help doc, every `help_navigate` call and every Electron shell of any age working.
- The `settings` workspace-tab payload gains `group?` and `persona?` beside `tab?` / `section?`; `tab-meta.ts` titles the tab by the group when one is set.
- Help docs' `url:` frontmatter is rewritten to the new form in Phase 1 (one `gsed` pass, verified by the §7 test), and `help/settings.md` is rewritten.
- **Default group.** `/settings` with no parameters opens the group holding the first lit attention chip (D8), in strip order; with no chip lit it opens **Connections**, as AI Providers is today. Until Phase 4 ships the strip, it is always Connections.

### D5 — Search filters the page in place

A search field at the top of the page (`<input type="search" aria-label="Search settings">`, `/` focuses it when no input has focus, Escape clears it). Matching is client-side over the registry — card title, description, keywords, group title, and persona display name (the theme-overridden one, so a theme that renames Saquel still matches) — with a simple folded-case substring match per term and all terms required. While a query is active:

- The rail shows only groups with a match and a count per group; the first matching group is selected unless the current one matches.
- Only matching cards render in the column; they render **open**, with the matched terms highlighted in title and description (`CollapsibleCard` gains an optional `highlight: string[]` prop that wraps matches in `<mark>`).
- An `aria-live="polite"` region announces "N settings match".
- Clearing the query restores the previous group and card states.

A field-level index (matching the labels *inside* a card) is deliberately **not** in the first version: keywords on the card are cheaper to maintain and catch the same queries. If a card's body is large enough that its own labels need indexing, it is too large and should be split. (Settled: §9 Q7.)

### D6 — The Foundry hub is a persona row, and a persona is a lens over the same page

A row of persona chips (thumbnail, name) sits above the rail, one per `CHILD_SUBSYSTEM_IDS` entry. Choosing one — or arriving at `/settings?persona=pascal` — renders the same rail and column with every card not owned by that persona filtered out, the persona's backdrop, and a banner naming the persona with its description and a "Show everything" link. The lens composes with search (both filters apply). `CHILD_SUBSYSTEM_IDS` regains `pascal` and `saquel` and gains `brahma`; every subsystem's `href` becomes its persona-lens URL; `app/foundry/<subsystem>` redirects follow, and `app/foundry/brahma` is added. `/foundry` itself keeps redirecting to `/settings`; no thumbnail page is restored (§9 Q4).

### D7 — The groups and the moves

Ten groups. Each card keeps its `sectionId`. Persona vocabulary is §5.1.

#### 5.1 Persona vocabulary

`SettingsPersona` **is** `SubsystemId`, nothing more, so the theme override and the subsystem images apply to every badge and one lookup (`useSubsystemInfo`) serves them all. Two consequences, both settled (§9 Q3):

- **The Host is the Salon.** The autonomous-room cards wear the Salon's badge. No `host` persona exists on this page.
- **Brahma becomes a subsystem.** `SubsystemId` gains `'brahma'`; `DEFAULT_SUBSYSTEM_DEFINITIONS.brahma` is `{ name: 'Brahma', description: 'The Console — a plain model surface with no character and no memory', href: '/settings?persona=brahma', thumbnail: '/images/thumbnails/brahma.webp', backgroundImage: '/images/brahma.webp' }`. The two images are **new art** in the style of the other subsystems' thumbnails and backdrops (only `avatars/brahma-avatar.webp` exists today); they are a Phase 3 asset task, WebP via `cwebp -q 82 -m 6 -mt`. Themes may override Brahma like any other subsystem through the existing `subsystems` record. The glossary row for Brahma in `CLAUDE.md` gains the lens URL.

#### 5.2 The layout

| Group | Card (`sectionId`) | From | Persona | Note |
|---|---|---|---|---|
| **Connections** | *Setup Wizard* (new card wrapping today's panel) | providers | forge | |
| | `api-keys` | providers | saquel | Phase 3: a card; Phase 5: a view inside `providers` (D10) |
| | `connection-profiles` | providers | forge | the Courier lives in this card's modal; `LEGACY_SECTION_ALIASES['the-courier']` → here. Phase 5: a view inside `providers` |
| | `image-profiles` | images | lantern | Phase 5: a view inside `providers` |
| | `embedding-profiles` | memory | commonplace-book | Phase 5: a view inside `providers` |
| | `providers` (new, Phase 5) | — | forge | one collapsible card per configured provider (D10) |
| | `cheap-llm` | providers | forge | |
| **Composer & Display** | `composition-mode` | chat | salon | |
| | `composer-spellcheck` | chat | salon | title stays "Composer" |
| | `composer-slash-commands` | chat | salon | |
| | `text-replacements` | chat | salon | |
| | `smart-typography` | chat | salon | |
| | `auto-scroll` | chat | salon | |
| | `token-display` | chat | salon | |
| | `thinking-display` | chat | salon | |
| **Context & Memory** | `context-compression` | chat | salon | |
| | `memory-cascade` | chat | commonplace-book | |
| | `data-retention` | chat | salon | |
| | `memory-extraction-grain` | memory | commonplace-book | |
| | `memory-recall` | memory | commonplace-book | |
| | `memory-maintenance` | memory | commonplace-book | |
| | `memory-backfill` | memory | commonplace-book | advanced |
| | `memory-regenerate` | memory | commonplace-book | advanced |
| | `conversation-summaries-regenerate` | memory | commonplace-book | advanced |
| **Characters & Prompts** | `roleplay-templates` | templates | aurora | |
| | `prompts` | templates | aurora | |
| | `core-whisper` | templates | aurora | |
| | `taboo` | chat | salon | settled: a constraint on what characters say (§9 Q2) |
| **Images** | `story-backgrounds` | images | lantern | |
| | `wardrobe-images` | images | lantern | |
| | `default-aesthetics` | images | lantern | |
| | `image-description` | chat | lantern | |
| **Games & Tools** | `automation` | chat | pascal | title stays; the registry's description says "dice and detection" |
| | `custom-tools` | chat | pascal | |
| | `general-state` | chat | pascal | advanced |
| | `agent-mode` | chat | prospero | |
| | `answer-confirmation` | chat | prospero | |
| | `brahma-console` | chat | brahma | new subsystem (§5.1) |
| | `autonomous-rooms` | chat | salon | the Host is the Salon (§5.1) |
| | `autonomous-room-schedules` | chat | salon | |
| **Moderation** | `on-duty` | concierge | concierge | |
| | `uncensored-desk` | concierge | concierge | |
| | `refusals` | concierge | concierge | |
| | `display` | concierge | concierge | |
| | `pre-screening` | concierge | concierge | advanced (already titled so) |
| **Appearance** | `appearance` | appearance | calliope | |
| | `avatar-settings` | appearance | aurora | |
| | `tags` | appearance | calliope | |
| **Security** | `encryption-passphrase` | system | saquel | |
| | `auto-lock` | system | saquel | |
| | `delete-all-data` | system | saquel | advanced |
| **Data & Maintenance** | `plugins` | system | forge | |
| | `backup-restore` | system | prospero | |
| | `import-export` | system | prospero | |
| | `llm-logging` | system | prospero | |
| | `llm-logs` | system | prospero | |
| | `tasks-queue` | system | prospero | |
| | `capabilities-report` | providers | prospero | The Almanack |

Counts after Phase 3: Connections 6, Composer & Display 8, Context & Memory 9 (one group, two personas — settled, §9 Q2), Characters & Prompts 4, Images 4, Games & Tools 8, Moderation 5, Appearance 3, Security 3, Data & Maintenance 7 — 57 with the wizard card. After Phase 5 the Connections column shows three cards (Setup Wizard, Providers, Cheap LLM) and the four kind cards live inside Providers (D10). The default group is decided by D4.

#### 5.3 Legacy tab → group

| Old `?tab=` | New group |
|---|---|
| `providers` | Connections |
| `chat` | Composer & Display |
| `concierge` | Moderation |
| `appearance` | Appearance |
| `memory` | Context & Memory |
| `images` | Images |
| `templates` | Characters & Prompts |
| `system` | Data & Maintenance |

A `tab` with a `section` resolves by the section, so `?tab=chat&section=taboo` lands in Characters & Prompts, not Composer & Display.

### D8 — The attention strip (required, Phase 4)

A row above the rail of chips, each a condition the page can already know from queries the cards run anyway, in this fixed order: a connection, image or embedding profile whose key is missing or whose provider plugin is absent; the Concierge off duty (today an inline warning inside his tab, which the chip replaces); memories awaiting backfill; a failed background task; a plugin needing attention. Each chip names the condition and links to its card (after Phase 5, a missing-key chip opens the provider's card). The strip renders nothing when nothing is lit. Conditions are **not** hooks in the registry (it is React-free); the strip is `components/settings/AttentionStrip.tsx`, which imports the registry for link targets and runs its own TanStack queries through `queryKeys`, sharing the profile-list and chat-settings queries the cards already use so it adds no requests. The strip is what makes D4's default-group rule possible, and it is required (§9 Q8).

### D9 — Accessibility and theming

- The rail is a `nav` of `button`s with `aria-current="page"` on the selected group; cards keep their `button` headers and `aria-expanded`. The search field has a visible label or `aria-label`, an `aria-live` result count, and `/` as its shortcut (ignored when focus is in any editable element).
- Persona chips are decorative images with the persona name as `alt`; the tooltip is `title`.
- New classes: `qt-settings-rail`, `qt-settings-rail-item`, `qt-settings-search`, `qt-settings-persona-row`, `qt-settings-persona-chip`, `qt-settings-attention`, `qt-settings-provider-card`, each defined in `app/styles/qt-components/` with every state form written out (the `check-qt-classes` rule), then `npm run generate:storybook-css` and a `theme-storybook` patch bump.
- The backdrop (`--story-background-url`) follows the selected group's persona, or the lens persona.

### D10 — Connections is organised by provider

Every connection, image and embedding profile already carries an `apiKeyId` (`lib/schemas/profile.types.ts`), and every key names a provider, so "which profiles use this provider" is a read-time derivation over lists the page already loads — no API or schema change. The Connections group gets a `providers` card whose body is **one collapsible card per configured provider**, where a provider is configured if it has a key *or* any profile names it (so keyless local providers such as Ollama appear). Each provider card shows:

- its key(s) at the top — the rows the API Keys table shows for that provider, with the same actions;
- then one list of every profile that uses it, each row carrying a **kind badge** (connection / image / embedding), its name and model, and opening the existing modal for its kind (`ProfileModal`, the image-profile modal, the embedding-profile modal) unchanged;
- an **Add** menu: key, connection profile, image profile, embedding profile — each opening its existing modal with the provider preselected;
- a persona badge per row: Saquel on keys, Forge on connection profiles, Lantern on image profiles, Commonplace Book on embedding profiles — the mixing D1 asks for, inside one card.

An **Add a provider** card at the end of the list opens the provider picker the key modal uses today, or the Setup Wizard. A **view toggle** on the `providers` card — *By provider* (default) / *By kind* — switches the body to the four kind cards exactly as they are today (`api-keys`, `connection-profiles`, `image-profiles`, `embedding-profiles`), so "all my image profiles" is one click and nothing a user knows is lost. The toggle is remembered per browser (`localStorage`, a per-viewer convenience).

The four kind cards stay **registered** (D3) so deep links, search and the help docs keep their targets: resolving `?section=image-profiles` opens Connections, opens the `providers` card in *By kind* view, and scrolls to the Image Profiles card. The registry models this as a card that is *hosted* by another (`hostedBy?: cardId`), and the renderer, not the registry, decides what hosting looks like. Search matches on the `providers` card's keywords (the bundled provider names plus "key", "model", "endpoint"); matching installed plugin providers by name is not promised. The Courier alias (D4) continues to resolve to `connection-profiles`, which after Phase 5 means Connections → Providers → By kind → Connection Profiles. The Setup Wizard is unchanged; its card sits above Providers. Settled: §9 Q6.

## 6. Phases

Six phases, 0 to 5. Each ships on its own and leaves the page working. Phases 0 and 1 change nothing a user would call a redesign; they are the plumbing that makes the rest safe.

### Phase 0 — The registry, rendering the page as it is today

Create `lib/settings/registry.ts` with the **current eight tabs as groups** and every card registered in its current tab, so that `SettingsView` can be rewritten to render from the registry with zero visible change. Delete the eight `*TabContent.tsx` files; move each card's wrapper logic (the loading/error branches that read `useChatSettingsContext`) into the card component itself under `components/settings/cards/`. Add `resolveSettingsLink` supporting both old and new parameters. Add the §7 help-frontmatter test (it will fail on `the-courier` and the Chat-tab `cheap-llm` link; fix those two help docs in this phase). `ConciergeTabContent.test.tsx` becomes a test of the Moderation group rendered through the registry.

### Phase 1 — The rail, the new URLs, and the help docs

Replace `EntityTabs` with the rail (D2) and the `<select>` fallback. Switch the URL to `?group=` / `?section=` (D4) with the legacy bridge. Rewrite `help/settings.md`; rewrite every `url:` frontmatter to the new form; update `lib/help-guide/categories.ts` to derive its patterns; update the workspace payload and `tab-meta.ts`; update `subsystem-defaults.ts` `href`s and the `app/foundry/*` redirects to the new form. Still eight groups.

### Phase 2 — Search

The search field, the filtering, the highlight prop, the `?q=` parameter, the live region (D5). Keywords are written for every card in this phase — a card without at least two keywords fails the §7 test.

### Phase 3 — The regrouping, the badges, the persona row and the lens

Replace the eight groups with the ten in §5.2, moving cards by editing the registry only. Retitle the page (D1). Add `brahma` to `SubsystemId` with its definition and the two new images (§5.1); add `app/foundry/brahma`. Add persona chips to cards and the persona row above the rail; add the lens (D6); restore `pascal` and `saquel` to `CHILD_SUBSYSTEM_IDS` and add `brahma`; point every subsystem `href` at its lens URL. Update `help/settings.md` and the per-card help docs' prose where they say "under the Chat tab". Mark the advanced cards. Update the `CLAUDE.md` glossary rows for Pascal, Saquel and Brahma.

### Phase 4 — The attention strip (D8) and the default-group rule (D4)

`AttentionStrip.tsx`, the five conditions, the Concierge's inline off-duty warning replaced by its chip, and `/settings` with no parameters opening the first lit chip's group. Ships before Phase 5 because the default-group rule should be in place before the Connections column changes shape.

### Phase 5 — Connections by provider (D10)

The `providers` card, the per-provider cards, the Add menu with provider preselection, the Add-a-provider card, the By provider / By kind toggle, `hostedBy` in the registry and the resolver's handling of a hosted card, the Setup Wizard card above it. The missing-key attention chip retargets to the provider card. Help docs for keys and the three profile kinds (`api-keys-settings.md`, `connection-profiles.md`, `image-generation-profiles.md`, the embedding-profile doc, `the-courier.md`) are rewritten around the provider view with the By kind view described as the alternative.

## 7. Verification

- **Registry integrity test** (`__tests__/unit/lib/settings/registry.test.ts`): card ids unique; every card's `group` exists; every card has ≥ 2 keywords and a `help` slug that exists under `help/`; every group has ≥ 1 card; every `SubsystemId` in `CHILD_SUBSYSTEM_IDS` owns ≥ 1 card.
- **Help link test** (`__tests__/unit/help/settings-links.test.ts`): every `url:` frontmatter and every `help_navigate(url: …)` call under `help/*.md` that begins `/settings` resolves through `resolveSettingsLink` to a real group or card. This is the gate for §1.4 and must be in `npm run test:unit`, not only in the commit skill.
- **Legacy bridge test**: every (tab, section) pair that exists in the Phase 0 registry resolves to the same card after Phase 3; every old `tab` alone resolves to a group; `the-courier` resolves to `connection-profiles`.
- **Render tests**: the rail lists the groups in order; `?section=` opens the right group and card; a search for "password" shows Security with Encryption Passphrase open and the term marked; a search for "Pascal" shows exactly his cards; `?persona=saquel` shows exactly Saquel's cards and `?persona=brahma` exactly the Console card; the autonomous-room cards wear the Salon's badge; clearing a search restores state.
- **Subsystem assets test**: every `SubsystemId`'s `thumbnail` and `backgroundImage` exist under `public/` (catches a missing Brahma image).
- **Attention and default-group tests**: with a profile whose key is missing, `/settings` opens Connections with the chip lit and linking to the right card; with the Concierge off duty and nothing else, it opens Moderation; with nothing lit, Connections and no strip.
- **Provider view tests**: a provider with a key and three profile kinds renders one card with the key rows, three badged profile rows and an Add menu that preselects the provider; a keyless provider named by a profile still appears; *By kind* renders the four existing cards; `?section=image-profiles` opens Providers in *By kind* with Image Profiles open; the toggle persists across a remount.
- **Existing card tests** pass untouched (they import the card components, which only move).
- `npx tsc`, `npm run lint` (spelling sweep over the rewritten help docs, `qt-*` gate, CSS-var gate, storybook-css gate), `/release-checklist-13-ui` for the rail and the search field in light and dark across the six bundled themes.
- Live: in V4test, every help document's "Open this page in Quilltap" link from the help dialog lands on an open card.

## 8. Documentation

- `help/settings.md` — rewritten around groups, the search field, persona badges and the lens; the "Eight Tabs" section goes.
- Every help document with a `url:` under `/settings` — frontmatter and the `help_navigate` call updated to the new form (the two must match: existing rule).
- `docs/developer/features/ROADMAP.md` — entry under The Foundry.
- `docs/CHANGELOG.md` — per phase, plain voice.
- `CLAUDE.md` — a chokepoint line: *a settings card is registered in `lib/settings/registry.ts` and nowhere else; a settings URL is resolved by `resolveSettingsLink`; the help-link test holds both.* The glossary's route column for Pascal and Saquel changes from `/settings?tab=…` to their lens URLs, and Brahma's row gains `/settings?persona=brahma`.
- `help/api-keys-settings.md`, `help/connection-profiles.md`, `help/image-generation-profiles.md`, the embedding-profile help, `help/the-courier.md` — rewritten for the provider view (Phase 5).
- `help/the-concierge.md` — the off-duty warning is now a chip in the attention strip.
- `docs/developer/SYSTEM_FLOWCHARTS.md` — no new section needed; note the registry under the existing client-navigation map if one exists.
- This document moves to `complete/` with an "As built" section.

## 9. Decisions taken by the human (2026-11-09)

1. **Group names:** plain names (Connections, Composer & Display, …); the persona is a badge, never a group title. → D1.
2. **The judgment-call moves:** Taboo goes to Characters & Prompts; Context & Memory stays one group of nine with two personas; "Automation" keeps its title. → §5.2.
3. **Persona vocabulary:** `SettingsPersona` is `SubsystemId` only. *The Host is the Salon* — the autonomous-room cards wear the Salon's badge. *Brahma gets his own subsystem* — `SubsystemId` gains `brahma` with new thumbnail and background art. → §5.1.
4. **The hub:** a persona row on `/settings` is the hub; `/foundry` keeps redirecting; no thumbnail page. → D6.
5. **Page title:** The Foundry, with "Settings" as the subtitle. → D1.
6. **Connections:** the provider-centric view is **in this spec**, as D10 and Phase 5 — one card per provider with its key and every profile that uses it, kind badges, an Add menu that preselects the provider, and a By kind toggle that keeps today's four cards reachable.
7. **Search depth:** card titles, descriptions and keywords only. → D5.
8. **The attention strip:** in, and **required**. → D8, Phase 4.
9. **Default group:** the first lit attention chip's group, else Connections. → D4.

Follow-ups settled with them: Brahma's two images are new art in the house style (not the avatar reused); the provider view is "provider cards with the kind cards inside", not a summary card over the existing four.
