# Concierge Overhaul — Phase 4: The Concierge's Own Tab

**Status:** Proposed (4.10-dev, 2026-09-25)
**Scope:** quilltap-server. A new Settings tab (`/settings?tab=concierge`); a new `conciergeSettings` object replacing `dangerousContentSettings` and absorbing two settings that live elsewhere; the global mode retired; the summary classifier and scheduled scan made opt-in; every Concierge control removed from the Chat tab; help rewritten. One `chat_settings` migration. No plugin or package change.
**Prerequisites:** [Phase 3](concierge-overhaul-phase-3-three-states.md) landed (three states, `mayFailOver`). Phases 1 and 2 are implied by phase 3. If phase 3 has not landed, the resolver in §4 cannot be written as specified; stop.
**Part of:** [concierge-overhaul.md](concierge-overhaul.md) (phase 4 of 5).

## Summary

Give the Concierge one home. Today his controls are split across the Chat tab's "Dangerous Content" card, the Chat tab's "Image Description" card (the uncensored vision fallback), and a cheap-LLM field (the image prompt crafter) that is rendered inside the Dangerous Content card but stored under `cheapLLMSettings`. His global mode (`OFF` / `DETECT_ONLY` / `AUTO_ROUTE`) predates refusal-driven failover and no longer describes anything a user wants to choose.

After this phase the Settings page has an eighth tab, **The Concierge**, with five cards:

1. **On duty** — one switch. Off means the Concierge does nothing at all: no failover, no announcements, no auto-switch, no pre-screen.
2. **The uncensored desk** — the text profile, the image profile, the vision (image-description) profile, and the image-prompt crafter, each with auto-detect.
3. **When a provider refuses** — "switch a chat to Unmoderated after N refusals" and "new chats start as".
4. **Display** — how flagged or Unmoderated content looks: show / blur / collapse, and warning badges.
5. **Pre-screening (advanced)** — collapsed by default: the classifier, its threshold and custom prompt, the three scan toggles, and "read each chat's summary and switch it when it looks dangerous" (the summary classifier and its 10-minute sweep). All off by default for new installs.

## Goals

- A user looking for anything Concierge finds it under one tab, with the Concierge's own artwork and description.
- The settings model says what the Concierge does, not how it used to work: no mode, no scan toggles at the top level.
- Existing users keep their behaviour through the migration, with one deliberate exception called out in §4 and the changelog.
- The classifier and the sweep cost nothing unless asked for.

## Non-goals

- Per-project or per-character Concierge defaults.
- The "Uncensored-compatible" tick on connection and image profiles. It stays on the profile forms (`ProfileModal.tsx:839-845`, `ImageProfileForm.tsx:575-577`); the Concierge tab links to them.
- Salon controls (phase 5).
- Removing the old `dangerousContentSettings` column. It stops being read; a later housekeeping migration drops it.

## Carried over from phase 3

Phase 3 ([concierge-overhaul-phase-3-three-states.md](concierge-overhaul-phase-3-three-states.md))
deliberately left two leftovers in place for one release so nothing was removed in the same change
that stopped using it. Do them in this phase — this phase already ships a migration and already
rewrites the Concierge's docs — and tick them here when done. Neither may be skipped: each is dead
weight that a later reader would otherwise take for live behaviour.

- [ ] **Drop `chats.conciergeOverride`.** Phase 3 stopped writing it; nothing reads it but the
  legacy derivation. Remove it in a new `chats` migration (`drop-chat-concierge-override-v1`,
  `dependsOn: ['add-chat-concierge-mode-v1']`, with its `PRETTY_LABELS` entry). SQLite's
  `ALTER TABLE chats DROP COLUMN "conciergeOverride"` is enough — no index or trigger names it —
  and `migrations/scripts/drop-api-key-encryption-columns.ts` is the pattern. Then:
  - remove the field from `ChatMetadataSchema` and `ChatMetadataBaseSchema`
    (`lib/schemas/chat.types.ts`) and its row from `docs/developer/DDL.md`;
  - **keep** `deriveConciergeModeFromLegacy` / `withConciergeModeFromLegacy`
    (`lib/services/dangerous-content/chat-override.ts`) and their calls in the `.qtap` importer
    (`lib/import/quilltap-import/import-entities.ts`) and the backup restore
    (`lib/backup/restore/restore.ts`). Old bundles and backups still carry the field, and both
    paths read raw JSON and derive *before* `repos.chats.create` strips undeclared keys, so
    removing the schema field does not lose it — add a test that proves this for each path;
  - **keep** `conciergeOverride` in `public/schemas/qtap-export.schema.json`, marked deprecated, so
    old bundles still validate;
  - `add-chat-concierge-mode-v1` already tolerates the column being absent
    (`legacyRowFilter`), so the ordering between the two migrations is safe either way.
- [ ] **Remove the orphaned `-info` tone.** Since phase 3 no state uses `tone: 'info'`, so
  `.qt-danger-badge-info` and `.qt-concierge-mark-info` (`app/styles/qt-components/_chat.css`) have
  no user in the app. Check the bundled themes (`themes/bundled/`) and `create-quilltap-theme` for
  hooks on them first; if none, remove both rules, the `'info'` member of `ConciergeTone`, and its
  branches in `conciergeToneSuffix` / `conciergeToneTextClass`
  (`lib/services/dangerous-content/concierge-state-presentation.ts`) and their tests. The same
  removal must be mirrored in `packages/theme-storybook/src/css/qt-components.css` (the
  `.qt-danger-badge-info` and `.qt-concierge-mark-info` rules), which means a patch bump of
  `@quilltap/theme-storybook` and **stopping for a manual `npm publish`** before committing — the
  standing `qt-*` mirroring rule. If a theme does hook either class, keep the rules and record why
  here instead.

## Known State (verified 2026-09-25)

### Tabs

- `app/settings/SettingsView.tsx` is the registry: `TAB_SUBSYSTEM_MAP` (:21-29), `SETTINGS_TABS` (:31-39, seven entries), `SettingsTabContent` switch (:41-60), all inside `<ChatSettingsProvider>` (:93). `components/tabs/entity-tabs.tsx:29` honours `?tab=` only for ids in the array. Section deep-links: `components/settings/tabs/useSettingsSection.ts:11-14` reads `?section=`; each card is `<CollapsibleCard sectionId="x" forceOpen={activeSection === 'x'}>` (`components/ui/CollapsibleCard.tsx:97-118` scrolls it into view). Every tab opens with `useSubsystemInfo('<id>')` and renders `info.description`.
- `lib/foundry/subsystem-defaults.ts`: `concierge` is already a `SubsystemId` (:26) with name "The Concierge", description, **`href: '/settings?tab=chat'`** (:114), and images `/images/concierge.webp` + `/images/thumbnails/concierge.webp` (both present). `CHILD_SUBSYSTEM_IDS` (:160-173) omits it with a comment that it is "merged into other tabs". `app/foundry/concierge/page.tsx:4` redirects to `/settings?tab=chat`.
- Help plumbing: `lib/help-guide/categories.ts:133-141` maps URL patterns to categories (a `content-routing` category "Content Routing (The Concierge)" exists at :127-129; no `?tab=concierge` pattern). `lib/tools/help-navigate-tool.ts:16-24` allows any `/settings` path; its example at :43 and `lib/tools/legacy/text-block-prompt.ts:142` cite `?tab=chat&section=dangerous-content`. `lib/tools/help-settings-tool.ts:30` has a category enum without `concierge`; `help-settings-handler.ts:100-117` returns `dangerousContentSettings` under `chat`. Help `url` frontmatter is parsed by `scripts/build-help-index.ts:73` and `lib/help/help-doc-sync.ts:80`.

### Controls today

- `components/settings/chat-settings/DangerousContentSettings.tsx` (mounted `ChatTabContent.tsx:218-229`, card `dangerous-content`): mode (:93-110), threshold (:115-130), `scanTextChat` (:145), `scanImagePrompts` (:159), `scanImageGeneration` (:173), `uncensoredTextProfileId` (:198, `AUTO_ROUTE` only), `uncensoredImageProfileId` (:227, `AUTO_ROUTE` only), `displayMode` (:263), `showWarningBadges` (:282), `customClassificationPrompt` (:300), and "Image Prompt Expansion LLM" (:311-340) which writes **`cheapLLMSettings.imagePromptProfileId`** through `ChatTabContent.tsx:226-227`. Phase 2 added `autoSwitchAfterRefusals`.
- `components/settings/chat-settings/ImageDescriptionSettings.tsx:70-95` (card `image-description`): "Uncensored fallback profile" writes the **top-level** `ChatSettings.uncensoredImageDescriptionProfileId` (`settings.types.ts:566`), consumed by `lib/chat/file-attachment-fallback.ts:174-189`.
- Saving: `useChatSettings.ts` `patchChatSettings` (:163) PUTs a partial body to `/api/v1/settings/chat`; `handleDangerousContentUpdate` (:664-675), `handleCheapLLMUpdate` (:236-247), `handleUncensoredImageDescriptionProfileChange` (:266-272). The route parses `dangerousContentSettings` with its Zod schema (:181-183) and passes `uncensoredImageDescriptionProfileId` through unvalidated (:102-103).
- Consumers of `cheapLLMSettings.imagePromptProfileId`: `story-background.ts:271`, `scene-state-tracking.ts:87`, `image-generation-handler.ts:590`, `lib/tools/almanack/phase2-machinery.ts:357`.
- Backup restore remaps `uncensoredTextProfileId` / `uncensoredImageProfileId` (`lib/backup/restore/uuid-remap.ts:305-311`) and `uncensoredImageDescriptionProfileId` (:293).

### The mode and the classifier

- `DangerousContentSettings.mode` gates: the per-message scan and reroute (`danger-orchestrator.service.ts:65,109`), every pre-flight image scan, phase 1's failover (`mode === 'AUTO_ROUTE'`), the classifier job (`chat-danger-classification.ts:131-137`), the scheduled sweep (`scheduled-danger-scan.ts:41-53,118-121`, started from `instrumentation.ts:812-813`), the per-turn trigger (`memory-trigger.service.ts:178`), the context-summary chain (`context-summary.ts:75-86`), the cheap-LLM uncensored pick (`cheap-llm.ts:307`) and the Lantern's candour (phase 1).
- `DETECT_ONLY` today means: classify, flag, badge, but never reroute.

## Design

### 1. The settings object — `ConciergeSettingsSchema`

Replace `DangerousContentSettingsSchema` with, in `lib/schemas/settings.types.ts`:

```ts
export const ConciergeSettingsSchema = z.object({
  /** Master switch. Off: no failover, no announcements, no auto-switch, no pre-screen. */
  enabled: z.boolean().default(true),

  /** The uncensored desk. Null = auto-detect (first isDangerousCompatible profile). */
  uncensoredTextProfileId: UUIDSchema.nullable().optional(),
  uncensoredImageProfileId: UUIDSchema.nullable().optional(),
  /** Was ChatSettings.uncensoredImageDescriptionProfileId. */
  uncensoredVisionProfileId: UUIDSchema.nullable().optional(),
  /** Was cheapLLMSettings.imagePromptProfileId. Any connection profile; used to craft image prompts for the uncensored desk. */
  imagePromptProfileId: UUIDSchema.nullable().optional(),

  /** After this many stated refusals on a Moderated chat the Concierge switches it. 0 = never. */
  autoSwitchAfterRefusals: z.number().int().min(0).max(10).default(2),
  newChatsStartAs: z.enum(['moderated', 'unmoderated']).default('moderated'),

  display: z.object({
    mode: DangerousContentDisplayModeEnum.default('SHOW'),
    showWarningBadges: z.boolean().default(true),
  }).default({}),

  preScreen: z.object({
    /** Run the classifier on messages and image prompts before sending. */
    enabled: z.boolean().default(false),
    threshold: z.number().min(0).max(1).default(0.7),
    scanTextChat: z.boolean().default(true),
    scanImagePrompts: z.boolean().default(true),
    scanImageGeneration: z.boolean().default(false),
    customClassificationPrompt: z.string().nullable().optional(),
    /** Read each chat's summary in the background and switch it when it reads as dangerous (the 10-minute sweep). */
    summaryClassification: z.boolean().default(false),
  }).default({}),
})
```

`ChatSettingsSchema` gains `conciergeSettings: ConciergeSettingsSchema.default({})` and **drops** `dangerousContentSettings`, `uncensoredImageDescriptionProfileId`, and `cheapLLMSettings.imagePromptProfileId` from the Zod schema (unknown keys are stripped on read, so the old columns become inert). The client mirror `components/settings/chat-settings/types.ts` follows; `DEFAULT_DANGEROUS_CONTENT_SETTINGS` (server :28-36, client :535) becomes `DEFAULT_CONCIERGE_SETTINGS`.

### 2. Migration `add-concierge-settings-v1`

Adds a `conciergeSettings TEXT` column to `chat_settings` (the table is column-per-field; `dangerousContentSettings` is a JSON TEXT column at `DDL.md:928`) and backfills each row in a `reportProgress` loop from the three old sources:

| Old | New |
|---|---|
| `mode: 'OFF'` | `enabled: false`, `preScreen.enabled: false`, `preScreen.summaryClassification: false` |
| `mode: 'DETECT_ONLY'` | `enabled: true`, `preScreen.enabled: true`, `summaryClassification: true` |
| `mode: 'AUTO_ROUTE'` | `enabled: true`, `preScreen.enabled: true`, `summaryClassification: true` |
| `threshold`, three scans, `customClassificationPrompt` | → `preScreen.*` |
| `uncensoredTextProfileId`, `uncensoredImageProfileId`, `autoSwitchAfterRefusals` | same names |
| `displayMode`, `showWarningBadges` | → `display.*` |
| `ChatSettings.uncensoredImageDescriptionProfileId` | `uncensoredVisionProfileId` |
| `cheapLLMSettings.imagePromptProfileId` | `imagePromptProfileId` |
| (none) | `newChatsStartAs: 'moderated'` |

**The deliberate behaviour change:** a `DETECT_ONLY` user gets failover. `DETECT_ONLY` meant "flag but never reroute"; the closest honest translation is "pre-screen on, Concierge on duty", and on duty now means failover. The changelog and the help say so plainly. A user who wants "badges but never an uncensored model" sets every chat Locked, or sets no uncensored profile and unticks every compatible one; the tab's help text explains this.

`introducedInVersion: '4.10.0'`, `dependsOn: ['add-dangerous-content-fields-v1']`. `PRETTY_LABELS`: *"Moving the Concierge's papers into his own office"*. Backup restore (`uuid-remap.ts`) remaps the four profile ids under `conciergeSettings`. The old columns stay until a later housekeeping migration; `DDL.md` marks them deprecated.

### 3. The API

- `GET`/`PUT /api/v1/settings/chat` (`app/api/v1/settings/chat/route.ts`): accept and validate `conciergeSettings` with `ConciergeSettingsSchema.parse`; reject `dangerousContentSettings`, `uncensoredImageDescriptionProfileId` and `cheapLLMSettings.imagePromptProfileId` in a PUT with 400 so a stale client fails loudly rather than writing a dead column.
- `useChatSettings.ts`: one `handleConciergeUpdate(partial)` deep-merging into `settingsRef.current.conciergeSettings`; delete `handleDangerousContentUpdate`, `handleUncensoredImageDescriptionProfileChange`, and the `imagePromptProfileId` use of `handleCheapLLMUpdate`.
- `help_settings` tool (`lib/tools/help-settings-tool.ts:30`, handler :100-117): add a `concierge` category returning `conciergeSettings`; remove it from `chat`. Update the tool-definitions snapshot (`npx jest -u lib/tools/__tests__/tool-definitions-snapshot.test.ts`).

### 4. The resolver — `resolveConciergeSettings(global, chat)`

Replaces `resolveDangerousContentSettings`. It returns the effective policy, not a bag of flags with a mode:

```ts
export interface ResolvedConciergePolicy {
  onDuty: boolean                 // global enabled && chat not exempt
  state: ConciergeState           // from getConciergeState
  failoverAllowed: boolean        // onDuty && state === 'moderated'
  routeDirect: boolean            // onDuty && state === 'unmoderated'
  preScreen: { enabled; threshold; scanTextChat; scanImagePrompts; scanImageGeneration; customClassificationPrompt } // all false/1.0 unless onDuty && state === 'moderated' && preScreen.enabled
  summaryClassification: boolean  // onDuty && state === 'moderated' && preScreen.summaryClassification
  autoSwitchAfterRefusals: number // 0 unless onDuty && state === 'moderated'
  desk: { textProfileId; imageProfileId; visionProfileId; imagePromptProfileId }
  display: { mode; showWarningBadges }
  source: 'global' | 'default' | 'chat-locked' | 'chat-unmoderated' | 'chat-type-exempt' | 'off-duty'
}
```

Every `mode` read is replaced by the question it was asking:

| Old check | New field |
|---|---|
| `mode !== 'OFF'` before a scan | `preScreen.enabled` (and the specific scan flag) |
| `mode === 'AUTO_ROUTE'` before a reroute / failover | `failoverAllowed` (phase 1 chokepoints, `attemptUncensoredRetry`), or `routeDirect` (branch 1 of the danger orchestrator, the Lantern's candour, the cheap-LLM uncensored pick, the greeting's "Attempt 0") |
| `mode === 'DETECT_ONLY'` | gone; `preScreen.enabled && !failoverAllowed` is only true on a Locked chat |
| classifier job / sweep / per-turn trigger / context-summary chain "mode is OFF" | `summaryClassification` |

`scheduleDangerScan` (`scheduled-danger-scan.ts:36`) starts only if some user has `summaryClassification` on, and the per-user loop skips those who do not. The `'off-duty'` source covers `enabled: false`: nothing fires, nothing is announced, and the per-chat select in the sidebar and New Chat form renders disabled with the hint "The Concierge is off duty — turn him on in Settings → The Concierge."

`newChatsStartAs` is read by `POST /api/v1/chats` when the request carries no `conciergeState`, and by `useNewChat.ts` to preselect the form.

### 5. The tab

- `SettingsView.tsx`: `concierge: 'concierge'` in `TAB_SUBSYSTEM_MAP`; `{ id: 'concierge', label: 'The Concierge', icon: <Icon name="shield" /> }` inserted after `chat` in `SETTINGS_TABS`; a switch case rendering `ConciergeTabContent`.
- New `components/settings/tabs/ConciergeTabContent.tsx`, following `ImagesTabContent`: `useSubsystemInfo('concierge')` description line, `useSettingsSection()`, `useChatSettingsContext()`, five `CollapsibleCard`s with `sectionId`s `on-duty`, `uncensored-desk`, `refusals`, `display`, `pre-screening` (the last `defaultCollapsed`). New leaf components under `components/settings/concierge-settings/`: `OnDutyCard.tsx`, `UncensoredDeskCard.tsx`, `RefusalsCard.tsx`, `DisplayCard.tsx`, `PreScreeningCard.tsx`, each taking `settings` and `onUpdate`. The desk card's profile selects list only `isDangerousCompatible` profiles (as today, `DangerousContentSettings.tsx:75-81`) and, when the list is empty, say so and link to `/settings?tab=providers` and `/settings?tab=images`. The desk card is always visible (today it hides unless `AUTO_ROUTE`, which is how an Unmoderated chat under global `OFF` had no way to name its profile).
- Delete `DangerousContentSettings.tsx` and its mount in `ChatTabContent.tsx:218-229`; remove the uncensored select from `ImageDescriptionSettings.tsx:70-95`; delete the `imagePromptProfileId` wiring at `ChatTabContent.tsx:226-227`.
- `subsystem-defaults.ts`: `concierge.href = '/settings?tab=concierge'`, description *"Who gets asked when the usual providers refuse, and how flagged content is shown"*, add `'concierge'` to `CHILD_SUBSYSTEM_IDS` and fix the comment. `app/foundry/concierge/page.tsx` redirects to the new tab.
- `lib/help-guide/categories.ts`: `{ pattern: '/settings?tab=concierge', categoryId: 'content-routing' }` before the bare `/settings` entry. `help-navigate-tool.ts:43`, `text-block-prompt.ts:142`, `useHelpChatStreaming.ts:35`: example URLs updated (snapshot changes).
- Voice for card copy: steampunk/Wodehouse, one sentence of description per card, plain labels on controls.

### 6. Help

- `help/dangerous-content.md` is renamed `help/the-concierge.md` (`url: /settings?tab=concierge`; In-Chat Navigation `help_navigate(url: "/settings?tab=concierge")`), rewritten around the five cards, the three chat states, the refusal rule, the auto-switch, and the pre-screen as an advanced option. Section anchors: `&section=on-duty`, `uncensored-desk`, `refusals`, `display`, `pre-screening`. Every other help file that links `dangerous-content.md` (`quick-hide`, `chat-settings`, `connection-profiles`, `image-generation-profiles`, `autonomous-rooms`, `story-backgrounds`, `provider-recommendations`, `scene-state-tracker`, `settings`) repoints.
- `help/settings.md`: "The Eight Tabs", a "### The Concierge" entry, the Dangerous Content bullet removed from Chat, the deep-link example on line 17 changed to `?tab=concierge&section=uncensored-desk`.
- `help/chat-settings-ai-services.md:62-86,321`: the uncensored vision fallback moved to the Concierge; `help/story-backgrounds.md:59-61` and `help/image-generation-profiles.md:469`: the crafter and the image profile live on the Concierge tab.
- `help/provider-recommendations.md:42-54,85` and the new Concierge help must agree on the recommended uncensored provider; pick one wording (Grok for hosted, Ollama/OpenRouter/self-hosted for local) and use it in both.
- Rebuild the help bundle (`scripts/build-help-index.ts`).

## Decisions of record

- **The mode is retired, not renamed.** `OFF` becomes the on-duty switch; `AUTO_ROUTE` becomes the default; `DETECT_ONLY` had no honest successor and is translated to pre-screen-on, with the behaviour change stated.
- **The classifier is an option, not the backbone.** It costs a call per message and its verdicts are guesses; refusals are facts. New installs get failover with no classifier.
- **The vision fallback and the prompt crafter are Concierge settings.** Both exist only to serve the uncensored desk; where they were stored was an accident of when they were added.
- **`enabled: false` disables the per-chat select** rather than hiding it, so a user who finds a disabled control learns where the switch is.

## Implementation order

0. The two phase-3 carry-overs above (the `conciergeOverride` drop rides the same release as this phase's migration; the `-info` removal waits on its storybook publish).
1. Schema, migration, DDL, backup remap, API validation, `useChatSettings` handler.
2. `resolveConciergeSettings` and the mode-check replacement table (§4); the sweep gate.
3. Tab, cards, deletions from the Chat tab, subsystem defaults, foundry redirect, help-guide category, tool examples, snapshot.
4. Help rewrite and bundle rebuild.
5. Changelog, catalog, `CLAUDE.md` glossary (`/settings?tab=concierge`) and `GEMINI.md`.

## Testing

- **Migration**: the mapping table above as fixtures, including a row with no `dangerousContentSettings` at all; idempotence; `reportProgress` present.
- **`resolver.test.ts`** (rewritten): `enabled: false` → nothing allowed anywhere; Locked → no failover, no pre-screen, no auto-switch; Unmoderated → `routeDirect`, no pre-screen; Moderated → global; exempt chat types → off.
- **Route**: PUT with a legacy `dangerousContentSettings` → 400; PUT `conciergeSettings` round-trips.
- **`useChatSettings.test.tsx`**: `handleConciergeUpdate` deep-merges `display` and `preScreen`.
- **Tab**: a rendering test for `ConciergeTabContent` (the first for any tab; use `renderWithQuery`) asserting the five sections exist, `?section=uncensored-desk` force-opens the desk, and an empty compatible-profile list shows the two links.
- **Help plumbing**: `categories.test.ts` (`/settings?tab=concierge` → `content-routing`), `labelFromUrl.test.ts` ("Settings → Concierge"), `help-navigate-tool.test.ts`, the tool snapshot.
- **Sweep**: `scheduled-danger-scan.test.ts` — does not start when no user has `summaryClassification`.
- **Lint**: `npm run lint` (the spelling sweep and the `qt-*` gate cover the new cards).

## Documentation and housekeeping

- `docs/CHANGELOG.md`: the tab, the settings object, the migration table, the `DETECT_ONLY` behaviour change, the removed controls.
- `docs/developer/DDL.md` (`conciergeSettings`; deprecated columns), `docs/developer/API.md` (settings shape, `help_settings` category), `docs/developer/SYSTEM_FLOWCHARTS.md:275,447-459` (classifier now opt-in).
- `components/settings/chat-settings/README.md:27,183-198`: the card moved.
- `.claude/commands/update-documentation.md`: this spec, the renamed help file, the rewritten `dangerous.md` note.
- `CLAUDE.md` glossary row for The Concierge → `/settings?tab=concierge`; the chokepoint bullet names `resolveConciergeSettings`.
