# Plan: Ad-Hoc NPC verification + "Summon from Lore" in the Salon

**Audience:** Claude Code, implementing in `quilltap-server`.
**Scope:** Two related changes to the Salon "Add Character" flow.

1. **Verify and fix** the existing "Create Ad-Hoc NPC" dialog (it has two silent
   data-loss bugs — Scenario and Physical Description are dropped on every NPC).
2. **Add** a "Summon from Lore" button to the same Participants UI that runs the
   Aurora AI-import (summon-from-lore) flow and adds the resulting character to
   the current chat as a participant.

Follow all CLAUDE.md standing rules (spelling "Quilltap"; steampunk/Wodehouse
user-facing voice; CHANGELOG + `help/*.md` updates; `npx tsc` for typechecking;
debug logging on touched backend paths; the `/commit` skill handles lint/test/
version). No stubs or placeholder code.

---

## Background — how the pieces fit today (verified against the code)

**Participants live as a JSON array** on `chats.participants` (see
`docs/developer/DDL.md`). A participant is a join to a character via
`characterId`. There is no separate participants table.

**Add-participant API:** `POST /api/v1/chats/{id}?action=add-participant`.
- Route: `app/api/v1/chats/[id]/route.ts` → `handlers/post.ts` (action
  `'add-participant'`) → `actions/participants.ts` `handleAddParticipantAction()`.
- Payload schema: `app/api/v1/chats/[id]/schemas.ts` `addParticipantSchema`
  (`type:'CHARACTER'`, `characterId`, optional `connectionProfileId`,
  `controlledBy`, `hasHistoryAccess`, `joinScenario`, `outfitSelection`, …).
- Persists via `repos.chats.addParticipant()` in
  `lib/database/repositories/chats-participants.ops.ts`.

**The UI entry point** is the Participants section of the Salon sidebar:
- `app/salon/[id]/page.tsx` wires `onAddCharacter={modals.openAddCharacter}`
  (`hooks/useModalState.ts`) into `components/chat/ChatSidebar.tsx`
  (ParticipantsSection → "Add Character" button).
- That opens **`components/chat/AddCharacterDialog.tsx`**, which:
  - queries the character list via TanStack Query (`queryKeys.characters.list()`),
    excluding `existingCharacterIds`;
  - has a grid of existing characters plus a **"Create New NPC"** button that
    opens `CreateNPCDialog`;
  - on NPC creation calls `handleNPCCreated(characterId)` →
    `setSelectedCharacterId(characterId)` and closes the NPC dialog, leaving the
    new character selected so the user finishes with connection profile / outfit
    and the dialog's own `handleAddCharacter()` does the
    `?action=add-participant` POST.

So **both** "existing character" and "ad-hoc NPC" converge on the *same*
`handleAddCharacter()` → add-participant call once a `characterId` exists. **This
is the convergence point the Summon button must also reuse.**

**Summon from Lore today** lives entirely in Aurora, not the Salon:
- Button "Summon From Lore" in `app/aurora/page.tsx` opens the
  `AIImportWizard` (`components/settings/ai-import/AIImportWizard.tsx`, driven by
  `hooks/useAIImport.ts`).
- It is a multi-step wizard: upload files / paste text → pick connection profile
  + toggles → SSE generation (`POST /api/v1/system/tools?action=ai-import-stream`,
  service `lib/services/ai-import.service.ts` `runAIImportStreaming()`) → review →
  import (`POST /api/v1/system/tools?action=import-execute`, conflictStrategy
  `'duplicate'`).
- On success it calls `onImportSuccess(characterId?)`. The Aurora page uses that
  to refetch the character list. **The wizard already returns the created
  character id** — that is what we hand to the add-participant flow.
- The summon flow has **no** "add to chat" concept today; it only creates a
  standalone character. That is the gap Part 2 fills.

---

## Part 1 — Verify & fix the Ad-Hoc NPC dialog

**File:** `components/chat/CreateNPCDialog.tsx`
**Server schema (source of truth):** `app/api/v1/characters/handlers/post.ts`
`createCharacterSchema` (lines ~30–82).

### Bug 1 — Scenario is silently dropped
The dialog sends a scalar `scenario`:
```ts
// CreateNPCDialog.tsx ~178
if (scenario.trim()) {
  characterData.scenario = scenario.trim()
}
```
But the schema only accepts a `scenarios` **array** of `{ id?, title, content }`.
Zod strips the unknown `scenario` key, so the Scenario field never persists.

**Fix:** send a one-element `scenarios` array:
```ts
if (scenario.trim()) {
  characterData.scenarios = [
    { id: crypto.randomUUID(), title: 'Default', content: scenario.trim() },
  ]
}
```
(`title` must be 1–200 chars, `content` non-empty — both satisfied. `id` is
optional per schema but harmless to include for consistency with the
systemPrompts block.)

### Bug 2 — Physical Description is silently dropped
The dialog sends a plural `physicalDescriptions` **array**:
```ts
// CreateNPCDialog.tsx ~197
characterData.physicalDescriptions = [
  { id, name: 'Default', fullDescription: physicalDescription.trim(), createdAt, updatedAt },
]
```
But the schema accepts a singular `physicalDescription` **object** with this
exact shape (note the required `id`, `name`, `createdAt`, `updatedAt`, and the
prompt fields; `fullDescription` is nullable/optional):
```ts
physicalDescription: { id, name, usageContext?, shortPrompt?, mediumPrompt?,
  longPrompt?, completePrompt?, fullDescription?, createdAt, updatedAt }
```

**Fix:** send the singular object:
```ts
if (physicalDescription.trim()) {
  characterData.physicalDescription = {
    id: crypto.randomUUID(),
    name: 'Default',
    fullDescription: physicalDescription.trim(),
    createdAt: now,
    updatedAt: now,
  }
}
```

### Verification for Part 1
- `npx tsc` clean.
- **Confirm persistence end-to-end** (the bugs are silent, so type-checking alone
  won't catch them). Add a unit/integration test for the characters POST handler
  asserting that a payload with `scenarios` and `physicalDescription` round-trips
  onto the created character (none exists today — see the ad-hoc NPC test gap).
  Place it under `__tests__/unit/app/api/v1/characters/` mirroring existing
  handler tests.
- Manual smoke (dev server at `http://localhost:3000`): in a Salon chat, Add
  Character → Create New NPC, fill all four fields, create, then open the new
  character in Aurora and confirm Scenario and Physical Description are present.
- Tail `logs/combined.log` to confirm the create path logs and no Zod-strip
  warnings.

### Notes / out of scope for Part 1 (mention to the human, don't silently expand)
- The dialog deliberately maps the single "Description" field onto both
  `description` and `personality` (the field label says "Used as both"). Leave as
  is. `identity`, `manifesto`, and `title` are intentionally not exposed in the
  ad-hoc flow.
- Avatar upload (`/api/v1/images` → `?action=avatar`) currently fails soft. Leave
  behavior unchanged unless asked.

---

## Part 2 — "Summon from Lore" button in the Salon Participants flow

**Goal:** From the Salon "Add Character" dialog, the user can click **"Summon from
Lore"**, run the existing AI-import (summon) wizard, and have the resulting
character added to the *current chat* as a participant — reusing the existing
add-participant path exactly as the ad-hoc NPC button does.

### Design decision: reuse, don't fork
The summon wizard (`AIImportWizard` + `useAIImport`) already:
- generates a character from uploaded lore / pasted text,
- persists it via the standard import-execute path,
- returns the new `characterId` via `onImportSuccess(characterId?)`.

So the Salon integration is a thin wrapper, mirroring `CreateNPCDialog`'s
relationship to `AddCharacterDialog`. **Do not duplicate the wizard or the import
service.** If `AIImportWizard` currently lives under `components/settings/...`,
it is already imported by `app/aurora/page.tsx`; importing it from
`AddCharacterDialog.tsx` is fine. (If any settings-only assumptions leak — e.g.
it reads a settings-scoped context — factor those out rather than copy the
component. Verify by reading `AIImportWizard.tsx`'s imports first.)

### Step 2.1 — Add the button in `AddCharacterDialog.tsx`
Next to the existing "Create New NPC" button (the dashed-card affordance, ~lines
381–397), add a second dashed-card button **"Summon from Lore"** with an
appropriate `Icon` (e.g. `sparkles` / `book-open` — check available names in
`components/ui/icon`) and steampunk-voiced helper text (e.g. "Conjure a soul from
your worldbuilding notes").

Add state `const [isSummonOpen, setIsSummonOpen] = useState(false)` alongside the
existing `isCreateNPCOpen` state.

### Step 2.2 — Render the wizard and capture the created character
Render the wizard (in a modal shell consistent with how Aurora presents it —
reuse Aurora's wrapper markup/title "Summon From Lore" so styling matches):
```tsx
{isSummonOpen && (
  <SummonFromLoreModal
    chatId={chatId}
    onClose={() => setIsSummonOpen(false)}
    onSummoned={handleSummoned}
  />
)}
```
Implement `handleSummoned` to mirror `handleNPCCreated`:
```ts
const handleSummoned = (characterId: string) => {
  setSelectedCharacterId(characterId)
  setIsSummonOpen(false)
}
```
This drops the freshly-summoned character into the dialog's existing selection
state. The user then picks connection profile / outfit and clicks the dialog's
normal "Add" button → existing `handleAddCharacter()` → `?action=add-participant`.
**No new API endpoint is required.**

**UX completion (locked):** **Hand back to the picker.** After summon, close the
wizard, auto-select the new character in `AddCharacterDialog`, and let the user
finish via the existing connection-profile/outfit controls and the dialog's Add
button. This matches the ad-hoc NPC UX exactly and adds the least new code. Do
**not** auto-add the participant immediately — the user must be able to set the
connection profile per participant.

### Step 2.3 — `SummonFromLoreModal` wrapper
Create `components/chat/SummonFromLoreModal.tsx`:
- Props: `{ chatId: string; onClose: () => void; onSummoned: (characterId: string) => void }`.
- Renders the existing `AIImportWizard` inside a modal matching Aurora's "Summon
  From Lore" presentation.
- Pass through the wizard's success callback: when the wizard fires
  `onImportSuccess(characterId)`, call `onSummoned(characterId)`.
  - **Verify** that the wizard actually surfaces the created character id on
    success. From the trace it does (`onImportSuccess(characterId?)`), but the id
    is optional — read `useAIImport.ts` `importCharacter()` / `executeImport()` to
    confirm the import-execute response includes the created character id and that
    it's threaded through. If the id is sometimes absent (e.g. multi-character
    imports or conflict-duplicate renames), handle that: fall back to refetching
    the character list and surfacing a clear error if no single id is resolvable,
    rather than silently no-op'ing.
- **Single-character summon only (locked):** target the common case where the
  lore produces one character and the wizard returns one id. Multi-character lore
  producing >1 character is out of scope for this work — if the import-execute
  response resolves to more than one created character (or zero), do not guess:
  surface a clear toast ("Summoning produced more than one soul — open Aurora to
  sort them out" in voice) and leave the picker as-is rather than auto-selecting.
- After a successful summon, ensure the character list the picker reads is fresh:
  invalidate `queryKeys.characters.list()` (and `queryKeys.characters.all`) so the
  newly created character is selectable/visible. The Aurora page already refetches
  on import success — replicate that invalidation here.

### Step 2.4 — Connection profiles / context
The wizard handles its own connection-profile selection for *generation*. The
*participant's* connection profile is chosen later in `AddCharacterDialog` (the
hand-back-to-picker flow) exactly as for any other character — no special
handling needed.

### Step 2.5 — Visibility (locked)
**"Summon from Lore" always appears** in the Add Character dialog, regardless of
whether the chat/project has attached lore. The wizard accepts pasted text, so
there is always something to summon from. Do not gate the button on the presence
of lore.

### Files touched (Part 2)
- `components/chat/AddCharacterDialog.tsx` — new button, state, `handleSummoned`,
  render `SummonFromLoreModal`.
- `components/chat/SummonFromLoreModal.tsx` — **new** thin wrapper around
  `AIImportWizard`.
- Possibly `components/settings/ai-import/AIImportWizard.tsx` — only if a
  settings-scoped assumption must be lifted to make it reusable from the Salon
  (verify first; prefer no change).
- No API, schema, DDL, or repository changes expected (reuses existing
  add-participant + import-execute paths). If verification shows otherwise, stop
  and flag before adding endpoints.

---

## Cross-cutting requirements (CLAUDE.md)

- **CHANGELOG:** add a terse, plain-voice entry to `docs/CHANGELOG.md` covering
  (a) the ad-hoc NPC Scenario/Physical-Description fix and (b) the new Salon
  "Summon from Lore" button.
- **Help docs:** both are user-visible changes → update the relevant
  `help/*.md` (the Salon participants / "adding characters" help page). Ensure the
  `url` frontmatter and the "In-Chat Navigation" `help_navigate(url: "...")` match.
  If no participants help page exists, add a section to the closest Salon help doc
  and register it per the update-documentation command list.
- **Voice:** all new user-facing strings (button label, helper text, modal title,
  toasts) in the steampunk + Roaring-20s + Wodehouse + Lemony Snicket register.
- **Logging:** any touched backend path (none expected in Part 2, the characters
  POST in Part 1 already logs) fires debug logs.
- **Spelling:** "Quilltap" only.

## Final verification checklist (do all)

1. `npx tsc` — clean.
2. New characters-POST test (Part 1) green; run `npx jest` for the touched areas.
   If you register a new tool or change a tool snapshot, run `npx jest -u` on the
   relevant snapshot test only.
3. Manual smoke in dev (`http://localhost:3000`, tail `logs/combined.log`):
   - Ad-hoc NPC with all four fields → Scenario + Physical Description persist.
   - Add Character → **Summon from Lore** → upload/paste lore → wizard completes →
     character is created, appears in the picker, gets added as a participant, and
     shows in the Salon sidebar ParticipantsSection.
   - Confirm the summoned participant can take a turn (connection profile resolved).
4. Re-read the diff; confirm no duplicated wizard/import logic, no new endpoints
   unless justified, CHANGELOG + help updated.
5. Hand off to the `/commit` skill (handles lint, full tests, type-check, version
   bumps). Do **not** initiate a release.

## Decisions (locked — no open questions)

1. **UX completion (Step 2.2):** hand back to the picker so the user sets the
   connection profile per participant. No immediate auto-add.
2. **Visibility (Step 2.5):** "Summon from Lore" always appears.
3. **Scope (Step 2.3):** single-character summon is sufficient. Multi-character
   lore is out of scope; surface a clear message and leave the picker unchanged.
