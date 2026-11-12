# Feature: One Character Page — retiring Aurora's view/edit split

**Status:** Implemented (2026-11-06, 4.13-dev). Phases 0–5 done; see §9 for what was built and where it differs.
**Scope:** quilltap-server. The per-character page in Aurora (`/aurora/[id]/view` and `/aurora/[id]/edit`, workspace tab kinds `character-view` and `character-edit`), its header, its tabs, and its save model. The New Character form is touched only where it can reuse the new section components.
**Non-scope:** the Aurora list and group pages; the Wardrobe and Inventory dialogs themselves; the AI Wizard and Character Optimizer internals (only how the page hands off to them); the character API (every write the new page needs already exists — see §6.3).
**Related:** [tabbed-workspace.md](tabbed-workspace.md) (tab kinds, keep-alive, `tab-refetch.ts` roster), [character-progressions.md](character-progressions.md), [character-subprompts.md](character-subprompts.md), [character-kind-and-roleplay-defaults.md](character-kind-and-roleplay-defaults.md), [character-archive-spec.md](character-archive-spec.md), [prompt-person-consistency.md](prompt-person-consistency.md) (field hints), bug 154 (default-prompt star vs column).

---

## 1. The problem, concretely

The character page is two pages. Each grew a tab whenever a feature needed somewhere to live, and the choice of page was whatever the author was looking at that week. The result is that **the same entity has fourteen tabs across two surfaces, three different save models, and no rule a user could learn for predicting where a thing is.**

### 1.1 Inventory of what is where today

| Thing | View page (`/view`) | Edit page (`/edit`) | Save model |
|---|---|---|---|
| Name, title, aliases, pronouns, birthday | Header (read) | Details (form) | Deferred: "Save Character" |
| Identity / Description / Manifesto / Personality / First message / Example dialogues | Details (rendered, **empty fields hidden**) | Details (form) | Deferred |
| Scenarios | Details (rendered) | Details (inline list in the form) | Deferred |
| `systemPrompt` (single legacy field) | — | Details (form) | **Never saved** — the PUT schema has no such key; the value is stripped server-side |
| Tags | Tags tab | Details (bottom of the form) | Immediate (TagEditor) |
| Kind of character | Details (below the prose) | Details (below the form) | Immediate |
| Draw diagrams + style | Details | Details | Immediate |
| System transparency | — | Details (top of form) | Deferred |
| Carina (@-queries) | Header icon toggle | Details (checkbox, top of form) | Immediate on view, **deferred on edit** |
| Core whisper | — | Details (top of form) | Deferred |
| System prompts | System Prompts (read + "Edit Prompts" link) | System Prompts (CRUD) | Immediate, own modal |
| Subprompts | — | System Prompts (below prompts) | Immediate, own modal |
| Progressions | — | System Prompts (below subprompts) | Immediate, own modal |
| Default system prompt / default scenario | Default Settings (**only if more than one exists**) | star in the prompts list | Immediate |
| Connection profile, partner, image profile, timestamps | Default Settings | — | Immediate |
| Agent mode default, help tools | Default Settings | — | Immediate |
| Self-dressing, outfit creation, inventory management | Default Settings → "Wardrobe" card | — | Immediate |
| Choose own opening outfit | Wardrobe tab | Wardrobe tab | Immediate |
| Wardrobe instructions | Wardrobe tab | — | Own editor |
| Open the Wardrobe dialog | Wardrobe tab | Wardrobe tab | n/a |
| Physical description (+ humanoid) | Appearance (**full form with its own Save button**) | Appearance (same component) | Own Save button |
| Depiction guidelines | — | Appearance | Own save |
| Photo gallery, avatar | Photo Gallery | header pencil (avatar only) | Immediate |
| Conversations, memories | Conversations / Memories | — | Memories: own modal |
| `{{char}}` / `{{user}}` bulk replace | Details (buttons above the prose) | — | Immediate, bulk, **on the "view" page** |
| Search & Replace (chats + memories) | Header button → modal | — | Modal |
| Rename/Replace (fields + memories + chats) | — | Rename/Replace tab | Own preview/execute |
| Favorite, user-controlled, NPC | Header | — | Immediate |
| Archive / rehydrate | Header | — | Dialog |
| Non-Quilltap prompt, Refine from memories | Header | — | Modal |
| AI Wizard | — | Header | Modal, then stages into the form |
| LLM logs | — | Below the Save button | n/a |
| The character's vault (Core/, Knowledge/, Mail/, metadata.json) | counted in the header stats | — | **no link from either page** |

### 1.2 What this does to a user

1. **"View" is not a view and "Edit" is not the editor.** Seven of the view page's nine tabs write. Four of the edit page's five tabs save immediately, outside the form the page says it is. The one thing only the edit page can do — change the prose — is the thing the view page shows most prominently, with an "Edit Character" button as the only route, and that button opens a second tab.
2. **Three save models with no visual difference.** A select saves on change. The Appearance card has its own Save. The Details form saves on "Save Character" at the foot of a five-tab page, and that button also *navigates away*, so every save ends the editing session. Cancel offers to discard "unsaved changes" and then discards only the form's half of them; the Kind picker, tags, prompts and the Appearance card inside the same `<form>` were already written.
3. **Settings are grouped by when they were added, not by what they answer.** "What may this character do?" is answered in five places: the header (Carina, user-controlled), the Details form (transparency, Core whisper), the Details tail (diagrams), Default Settings (agent mode, help tools, self-dressing, outfit creation, inventory) and the Wardrobe tab (opening outfit). The Wardrobe *tab* holds one toggle and a button; the wardrobe *permissions* are on Default Settings.
4. **Things are hidden until they exist.** The read-only Details hides empty prose fields, so a new user cannot discover that a Manifesto exists. The default prompt and default scenario pickers appear only once there are two, and the prompt default is also set by a star on a different page.
5. **Two bulk text tools in two places**, both destructive across chats and memories: Search & Replace is a modal off the view header, Rename/Replace is a tab on the edit page.
6. **A dead control.** The edit form's "System Prompt" field accepts text and loses it (§1.1). It predates named system prompts and nothing reads it.
7. **The header spends its most visible real estate on the rarest actions.** Six equal buttons stacked vertically: Start Chat, Convert to NPC, Non-Quilltap Prompt, Refine, Search & Replace, Archive. The three icon toggles (⭐, a *monitor* glyph for Carina, a person for user-controlled) are unlabeled and two are settings, not actions.
8. **Nothing on the page reaches the vault.** The stats line counts Core and Knowledge documents and reports `N/total character files`, and there is no way to get from that number to the folder.
9. **No tests.** One unit test in the repository mentions any of these components, and it is about connection profiles. Every refactor here has been unguarded.

---

## 2. Design principles

1. **One page.** A character has one page, and what it shows is the thing itself, editable where it sits. There is no edit mode to enter or leave and no second tab kind.
2. **One save model, visible once.** Every control saves itself. The page shows one status (`Saved` / `Saving…` / `Could not save — Retry`) in the sticky header, and a modal is the only place a Save button appears.
3. **Group by the question the user is asking**, not by the subsystem that owns the column. The sections are the questions: *Who are they? What do they say? What do they look like? What may they do? How does a chat with them start? What has happened?*
4. **Empty is a prompt, not a gap.** Every field renders, with its hint as the placeholder, so the shape of a character is discoverable from a blank one.
5. **One control per fact.** A default is set where the list is. A toggle lives in exactly one section.
6. **Bulk edits are tools and look like tools.** Anything that rewrites many rows sits together, previews before it writes, and never shares a card with ordinary fields.

---

## 3. The page

```
┌─ sticky header ────────────────────────────────────────────────────────────┐
│ [avatar]  Name                        [Start Chat] [Generate ▾] [⋯]   ⭐ │
│           Title · she/her · 34 · Roleplay · NPC            ● All changes saved │
│           alias · alias · alias     [Group] [Group]                        │
│           12 memories | 4 conversations | 9 wardrobe items | 3 photos | …  │
├─ section tabs ─────────────────────────────────────────────────────────────┤
│  Details · Prompts · Appearance · Abilities · Chat Defaults · History      │
├────────────────────────────────────────────────────────────────────────────┤
│  (section body: cards)                                                     │
└────────────────────────────────────────────────────────────────────────────┘
```

Six sections replace fourteen tabs. `EntityTabs` stays (it is what Settings uses too), with the header sticky above it. `EntityTabs` has no narrow-width behaviour today; a horizontal-scroll strip is enough at six tabs, and a select fallback, if wanted, is a small addition that Settings would share.

### 3.1 Header

- **Avatar.** Click opens a menu: *Choose from photos* (the existing `AvatarSelector`), *Upload*, *Generate portrait* (the Wardrobe dialog's existing `AvatarGenerationPane`, which today is reachable only through the Wardrobe and the Salon participant card). Replaces the pencil on the edit page and the "set as avatar" buried in the gallery, though the gallery keeps its own set-as-avatar for browsing.
- **Line 1:** name. **Line 2:** title · pronouns · age (from birthday) · kind badge · *NPC* / *User-controlled* / *Archived* badges when true. **Line 3:** alias chips, group chips (link to the group page; membership is edited there, so each chip carries "Manage ↗" on hover). **Line 4:** the stats line, every figure a link: memories → History/Memories, conversations → History, wardrobe → opens the Wardrobe, photos → Appearance/Photos, scenarios → Prompts/Scenarios, knowledge / core → the vault folder in the Scriptorium, character files → the Details/Vault card.
- **Actions.** One primary button, **Start Chat**. One **Generate ▾** menu for the three things that write *into* the character with an LLM: *AI Wizard*, *Refine from memories & instructions* (the Optimizer), *Non-Quilltap prompt* (export-shaped; grouped here because it is a generation, and it is the odd one out everywhere else). One **⋯** overflow for lifecycle: *Export…*, *Convert to NPC / to character*, *Archive…*, *Delete…* (today Delete is only on the list; a character page that cannot delete its character is a gap). **⭐ Favorite** stays a toggle in the header: it is the one header control that is about *the list*, not the character.
- **Carina and user-controlled leave the header.** They are settings and move to Abilities (§3.5). The header shows their state as badges, never as a toggle.
- **Save status.** A chip at the right of line 2, `aria-live="polite"`: *All changes saved* · *Saving…* · *Could not save Personality — Retry*. The only place save state is reported.

### 3.2 Details — *Who are they?*

| Card | Contents | Notes |
|---|---|---|
| **Facts** | Name, Title, Aliases, Pronouns (preset + custom), Birthday (+ live age), Kind of character, Tags | Name is required: an empty name is not saved and the field shows an inline error until it has one. Kind and Tags move here from their present homes. |
| **Dossier** | Identity, Description, Manifesto, Personality, First message, Example dialogues — six `MarkdownLexicalEditor`s, each with its `PromptFieldLabel` hint, each rendering its hint as placeholder when empty | Order follows the glossary's vantage points. The editor is the view: Lexical renders rich text, so a filled field reads as prose and an empty one invites. |
| **Template tools** | A small toolbar on the Dossier card: `Name → {{char}} (n)`, `Partner → {{user}} (n)`, and the reverses, with counts | Same four operations as today, same `applyCharacterFieldUpdates` fan-out; they stay beside the fields they rewrite. Token highlighting inside the editors: see §7, open question 3. |
| **Progressions** | The existing `ProgressionsSection`, unchanged | Moved from *Prompts*. A progression is a time-reckoned fact about the character, the same genus as a birthday; it is not a prompt. |
| **Vault** | Store name as a link into the Scriptorium; folder counts for Core, Knowledge, Scenarios, Subprompts, Mail; the `N/total` managed-file figure with the missing files named; `metadata.json` noted as the home of reserved keys | New. The first path from the page to the vault. Read-only card; nothing here writes. |

**Removed:** the dead `systemPrompt` field (§1.1). **Moved out:** scenarios (to Prompts), system transparency / Carina / Core whisper / diagrams (to Abilities).

### 3.3 Prompts — *What are they told, and what stage are they on?*

| Card | Contents | Notes |
|---|---|---|
| **System prompts** | `SystemPromptsEditor`'s list, create / import / edit / preview / delete modals | The **star is the one default control**, reading and writing through `setDefaultSystemPrompt` (column first, flag second — bug 154). The *Default System Prompt* select on Default Settings is deleted. |
| **Subprompts** | `SubpromptsSection`, unchanged | |
| **Scenarios** | A card in the same shape as Subprompts: list of rows (title, archived badge, default star, pencil, bin), *Add scenario* opens a modal with title + Markdown body | Replaces the inline list in the edit form. The **default star** replaces the *Default Scenario* select (one control per fact). Archive / restore stay as row actions. The list is saved through the existing `scenarios` route per row rather than round-tripping the whole array through the character PUT. |

The read-only "System Prompts" tab of the view page, and its "Active System Prompt" box on Details, are gone: the list itself is the view.

### 3.4 Appearance — *What do they look like, and what do they wear?*

| Card | Contents | Notes |
|---|---|---|
| **Photos** | `EmbeddedPhotoGallery` (upload, set as avatar, delete) | Was its own tab. Photos are appearance. |
| **Physical description** | The existing `DescriptionsTab` form: name, usage context, Humanoid, the five prompt variants, full description | **Its Save button goes.** The six text fields autosave like the Dossier (§4); Humanoid saves on change (it already triggers a seat recompile server-side). The single-record shape is kept. |
| **Depiction guidelines** | `AestheticEditorField`, as on the edit page today | Moves off the edit-only page. Disabled with its existing hint until the vault exists. |
| **Wardrobe** | *Open wardrobe* (dialog), *Wardrobe instructions* (`WardrobeInstructionsSection`), and a one-line summary: items in each tier the character can reach | *Choose own opening outfit* moves to Abilities with the other wardrobe permissions. The instructions editor stops being view-page-only. |
| **Inventory** | *Open inventory* (the existing `inventory` tab/dialog with `characterId`) and what they are carrying by default | New entry point. Today the Inventory is reachable from the rail and the chat but not from the character. |

### 3.5 Abilities — *What may they do, see and be?*

Every boolean and tri-state about the character's powers, in one place, as three cards of toggles / selects, each saving on change. Each tri-state shows the resolved value live (*Inherit — currently enabled by the global setting*), not a hard-coded "(enabled)" in the option label.

| Card | Controls | From |
|---|---|---|
| **Trust & perception** | System transparency; Aurora's Core whisper (inherit / always / never) | Details form |
| **Tools & talents** | Can answer @-queries (Carina); Draws diagrams (+ style) | header / Details |
| **Wardrobe & inventory** | Dresses themselves; Creates outfits; Chooses own opening outfit; Manages inventory | Default Settings, Wardrobe tab |
| **Control** | *You play this character* (user-controlled); *Non-player character* (NPC) | header |

Setting *user-controlled* here greys the partner picker in Chat Defaults with the same note it shows today.

### 3.6 Chat Defaults — *How does a new chat with them begin?*

The per-chat defaults, exactly the controls that the New Chat dialog pre-fills from the character: Connection profile (with *User acts as character* kept as the sentinel it is), Default conversation partner, Image generation profile, Timestamp settings, Agent mode default, Help tools default. All immediate, as today. The two pickers that duplicated the stars are gone (§3.3).

### 3.7 History — *What has happened to them?*

| Card | Contents |
|---|---|
| **Conversations** | `CharacterConversationsTab` |
| **Memories** | `MemoryList` (its own editor modal, as now) |
| **Bulk edits** | *Search & Replace* (today a header modal) and *Rename / Replace* (today an edit tab), side by side as two buttons that open their existing surfaces. They are the two tools that rewrite history, and they belong together, behind a preview, away from the fields. |
| **LLM logs** | `LLMLogsSection`, collapsed by default, at the foot |

---

## 4. The save model

**Rule:** a control saves itself; a modal has a Save button; nothing else does.

| Control type | When it saves | What it sends |
|---|---|---|
| Select, toggle, picker, star, tag chip | On change, optimistically; failure reverts and toasts | A one-field partial `PUT /api/v1/characters/[id]` (or the dedicated route the control already uses) |
| Short text (name, title, alias entry, pronoun parts, birthday) | On blur, on Enter, and on tab hide / page unload (flush) | One-field partial PUT |
| Prose (`MarkdownLexicalEditor` fields in Dossier and Physical description) | On blur, and after **1.5 s idle** while focused; flush on tab hide / unload | One-field partial PUT per changed field. Never per keystroke. |
| List rows with a modal (system prompts, subprompts, scenarios, progressions, memories) | Modal Save | The row's own route, as now |

- **Dirty tracking is per field**, held in one hook (`useCharacterAutosave(characterId)`) that owns the queue, the debounce, the flush-on-hide, the status chip, and the retry. Components register a field and get `{ value, onChange, status }`. The hook coalesces: two fields dirtied within the window go in one PUT.
- **Failure** keeps the user's text on screen, outlines the field, and puts *Could not save Personality — Retry* in the chip; Retry resends. The page never silently reverts prose.
- **Refresh without clobbering.** On tab re-activation the page re-reads (it joins the silently-refreshed roster in `tab-refetch.ts`; the `character-edit` "holds unsaved state" exemption disappears because nothing is unsaved for longer than a blur). A focused field is **not** overwritten by the refetch; its value is reconciled on the next save. The existing `externalUpdateCount` remount dance applies only to generator applies (next bullet).
- **Generators.** AI Wizard and the Optimizer stay modal and keep their own review step. On Apply the page first flushes pending saves, the modal writes through the API as it does now, then the page reloads and remounts the editors. While a generator modal is open the page is inert, so there is no race.
- **Archived characters** render the whole page inside a disabled `fieldset` with editors `readOnly`, the banner, and *Rehydrate* in the header. There is no longer an edit route to deep-link past the guard; the repository tombstone remains the real lock.

**Why autosave rather than one big Save bar.** Everything but the prose already saves immediately; the page has eight immediate controls for every deferred one. Unifying on immediate means removing the exception, not teaching every other control to defer. Per-field PUT is the API's existing shape, and the one expensive side effect (seat recompile) fires only on the Humanoid flag, not on prose. Reviewed and rejected: a sticky Save bar with page-wide dirty state (has to track modals, immediate controls and generators; the current page shows how that goes wrong), and a per-section Save (re-creates the Appearance card's inconsistency six times).

---

## 5. Routing and the workspace

- **One tab kind**, `character`, payload `{ characterId, section?, action? }`, replaces `character-view` and `character-edit`. `tab-meta`: title *Character*, icon `characters`. `TAB_KINDS`, the persistence enum, `route-to-intent.ts`, `WorkspaceIntent.tsx`, `TabView.tsx`, `workspace-reducer.ts` and `tab-refetch.ts` each lose a case.
- **Route:** `/aurora/[id]` renders the page directly (today it redirects to `/view`). `?section=` deep-links a section; `?action=chat` keeps opening the New Chat modal.
- **Redirects, preserved forever:** `/aurora/[id]/view`, `/aurora/[id]/edit`, `/characters/[id]`, `/characters/[id]/view`, `/characters/[id]/edit` → `/aurora/[id]`, with the old `?tab=` mapped: `details`→`details`, `system-prompts`→`prompts`, `conversations`/`memories`→`history`, `tags`→`details`, `wardrobe`/`gallery`/`descriptions`→`appearance`, `defaults`→`chat-defaults`, `rename`→`history`. Persisted workspace layouts holding a `character-view` / `character-edit` tab are migrated the same way when the layout loads.
- **In-place drill-down** from the Aurora list stays: `AuroraView` renders the new page in place, and *Back* returns to the list. Nothing on the page opens a second character tab for the same character.
- **Every internal link** to `/characters/${id}/edit` (two in `SystemPromptsTab`, one in `CharacterDetails`, the help-chat entity picker template) is updated or deleted with the components that held it.

---

## 6. Implementation notes

### 6.1 What is reused as-is

`SystemPromptsEditor` (with `SubpromptsSection` and `ProgressionsSection` lifted out of it and mounted by the page), `MemoryList`, `CharacterConversationsTab`, `EmbeddedPhotoGallery`, `TagEditor`, `CanDrawDiagramsToggle`, `CharacterKindPicker`, `CanChooseOutfitToggle`, `WardrobeInstructionsSection`, `AestheticEditorField`, `ImageProfilePicker`, `TimestampConfigCard`, `RenameReplaceTab` (as a modal body), `SearchReplaceModal`, `ArchiveCharacterDialog`, `RehydrateBundleDialog`, `ExternalPromptDialog`, `AIWizardModal`, `CharacterOptimizerModal`, `AvatarSelector`, `ImageUploadDialog`, `LLMLogsSection`, the four template-transform helpers.

### 6.2 What is rewritten

- `app/aurora/[id]/` becomes one `CharacterPage.tsx` with `sections/{Details,Prompts,Appearance,Abilities,ChatDefaults,History}.tsx`, `CharacterHeader.tsx` (new header), and `hooks/useCharacter.ts` (TanStack Query read keyed `queryKeys.characters.detail(id)`, replacing the two hand-rolled fetch hooks) plus `hooks/useCharacterAutosave.ts` (§4).
- `useCharacterView.ts` (898 lines of per-field `handleSaveX` / `savingX` pairs) and `useCharacterEdit.ts` (the deferred form) are deleted. Each immediate save becomes a call to one `saveCharacterFields(id, patch)` with one spinner state per control, driven by the autosave hook.
- `CharacterBasicInfo.tsx`, `CharacterDetails.tsx`, `ProfilesTab.tsx`, `SystemPromptsTab.tsx`, `TagsTab.tsx`, `ConversationsTab.tsx`, `MemoriesTab.tsx`, `CharacterGallery.tsx`, the two route `page.tsx` files, `ViewCharacterPageClient.tsx`, `constants.ts`, `tabIcons.tsx` go. `DescriptionsTab.tsx` loses its Save button and is renamed `PhysicalDescriptionCard.tsx`.
- Scenarios get a `ScenariosSection` modelled on `SubpromptsSection` and a `ScenarioEditorModal` (title + Markdown + archived), writing through `/api/v1/characters/[id]/scenarios`.
- `NewCharacterView` keeps its single form (there is no id to autosave against until Create), but its field blocks are the same `FactsCard` / `DossierCard` components in a `mode="create"` that collects instead of saving. After Create it lands on the new page.

### 6.3 API

No new endpoints. The page needs: the partial character PUT (every field it autosaves is already in `updateCharacterSchema`); `?action=avatar`, `?action=favorite`, `?action=toggle-controlled-by`, `?action=set-default-partner`, `?action=archive` / `rehydrate` / `export`, `?action=depiction-guidelines`, `?action=stats`; the `prompts`, `subprompts`, `scenarios`, `photos` sub-routes; `setDefaultSystemPrompt` through the character PUT as today. The one server-side change worth making alongside: widen `?action=stats` (which already returns memories, conversations, wardrobe, photos, scenarios, knowledge, core, the `N/total` managed-file figure and the group badges) to also name the **missing** managed files and count Subprompts and Mail, so the header and the Vault card share one read.

### 6.4 Help, docs, tests

- Help pages whose `url:` is `/aurora/:id/edit` (`character-editing`, `character-progressions`, `character-system-prompts`, `character-system-transparency`, `character-subprompts`, `diagrams`) move to `/aurora/:id?section=…`; `character-editing.md` is rewritten around the six sections and the save model; `character-management.md`'s "Profiles tab" references and `character-subprompts.md`'s "System Prompts tab" directions are corrected. The In-Chat Navigation blocks follow.
- `docs/CHANGELOG.md` (plain voice), `docs/developer/API.md` only if §6.3's stats action lands, `tabbed-workspace.md` tab-kind table.
- Tests, which do not exist today: a render test per section asserting every field appears when empty (principle 4); `useCharacterAutosave` unit tests for debounce, blur, flush-on-hide, coalescing, failure-keeps-text and retry; a redirect-mapping test for §5; a test that no component under `app/aurora/[id]/` renders a `<form onSubmit>` or a button labelled *Save* outside a modal (the rule in §4, as a grep-test in the house style).

---

## 7. Open questions

1. **Autosave for prose — confirm.** §4 recommends blur + 1.5 s idle. The alternative is a sticky Save bar; the reasons against are in §4.
2. **Scenarios to Prompts.** §3.3 moves them beside subprompts as a list-with-modal. The alternative is leaving them in Details as inline editors; they are the one list that would then not match the others.
3. **Template-token highlighting inside the editors.** The rendered view highlights `{{char}}` / `{{user}}` through `TemplateDisplay`; inside `MarkdownLexicalEditor` that needs a node transform or decorator. If that is expensive, the fallback is a per-card *Preview* toggle, which re-introduces a small view mode. Recommendation: do the decorator; it is the only thing standing between this page and principle 1.
4. **`Generate ▾` membership.** *Non-Quilltap prompt* is a generation but reads as an export. If it sits better under ⋯ with Export, move it; nothing else depends on the choice.
5. **The dead `systemPrompt` field** (§1.1) is filed as #146, independent of this spec. The create form and the AI Wizard's generated System Prompt lose the text the same way; fixing it does not wait for the unification.

---

### 7a. Decisions (Phase 0, 2026-11-06)

1. **Autosave for prose — yes**, blur + 1.5 s idle, as §4 recommends.
2. **Scenarios go to Prompts** as a list with a modal, with a default star.
3. **Highlighting — the decorator.** Done without a Lexical node transform: `TemplateTokenHighlightPlugin` paints ranges with the CSS Custom Highlight API, so the document is untouched and there is no Preview toggle.
4. **Non-Quilltap prompt stays under Generate ▾.**
5. **#146** is fixed alongside: edit field removed; create form folds the text into `systemPrompts` (and its likewise-dropped Scenario into `scenarios`); the wizard's prompt goes through the prompts route.

## 8. Phases

| Phase | Work | Done when |
|---|---|---|
| 0 | Agree §7. (#146 is filed.) | Decisions recorded here. |
| 1 | `useCharacter` (TanStack) + `useCharacterAutosave`; the Details and Abilities sections on the existing `character-view` tab, behind a dev flag; delete the dead field | Prose and facts edit in place with the status chip; old edit page still reachable. |
| 2 | Prompts (with scenarios as a list-with-modal and the stars as the one default), Appearance (gallery, description without its Save, guidelines, wardrobe, inventory), Chat Defaults, History | Every row of §1.1 has exactly one home on the new page. |
| 3 | New header (menus, linked stats, save chip, avatar menu); Vault card and the stats read (§6.3) | The header holds one primary action and no settings. |
| 4 | Tab kind `character`; redirects and `?tab=` mapping; layout migration; delete the view/edit trees, the two hooks and the old tab kinds; help, changelog, tests (§6.4) | `/aurora/[id]/edit` is a redirect and nothing in the repository links to it. |
| 5 | New Character reuses the section cards in create mode | One set of field components for create and edit. |

---

## 9. As built

- **Files.** `app/aurora/[id]/CharacterPage.tsx` (page + dialogs + AI Wizard apply), `CharacterHeader.tsx`, `CharacterPageContext.tsx`, `sections/*`, `cards/{PhysicalDescriptionCard,ScenariosCard,TemplateTools,VaultCard}.tsx`, `components/{SaveStatusChip,SectionCard,TriStateSelect,autosave-bindings}.ts(x)`, `hooks/useCharacter.ts`, `hooks/useCharacterAutosave.ts`. The engine is framework-free in `lib/autosave/autosave-engine.ts`. Field blocks shared with the create form live in `components/characters/fields/`.
- **Status chip** has a fourth state, *Editing — saved when you leave the field*, for a short-text draft waiting for its blur; reporting it as "saved" would be untrue.
- **Draft keys** are the PUT's field names; the physical description's are `physicalDescription.<field>` and the record is sent whole (its schema requires a name; a blank one saves as "Base Appearance").
- **Lexical editors** ignore change events until focused (a mount-time Markdown normalisation never writes) and remount when the stored value changes underneath them, but never while focused or holding a draft.
- **Generate portrait** opens the Wardrobe dialog, where `AvatarGenerationPane` lives (it needs an outfit composition). **Upload** lands in the gallery and opens *Choose from photos*.
- **Wardrobe summary** counts the character, group and General tiers; the project tier exists only inside a project's chats.
- **`?action=chat`** is not stored in the tab payload (a persisted tab would re-open the modal on every reload); the intent handler and the link interceptor open the modal beside the tab.
- **Help chat** pattern matching now prefers the doc whose query matches, since several help pages share `/aurora/:id?section=…`.
- **Tests:** `__tests__/unit/lib/autosave/autosave-engine.test.ts`, `__tests__/unit/lib/characters/page-sections.test.ts`, `__tests__/unit/app/aurora/character-page-sections.test.tsx`, `character-autosave-patch.test.ts`, `character-page-save-model.test.ts` (the §4 grep-test), and legacy-layout cases in `workspace-persistence.test.ts`.
