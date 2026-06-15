# Plan: "Chat as" any already-added character (non-default-user)

## Goal

In the **New Chat** and **Continue Elsewhere** (non-autonomous) dialogs, let the
user "Chat as" / "Play As" **any character already added to the chat** — not only
characters whose default `controlledBy` is `'user'`. Selecting such a character
**switches that participant in place** to `controlledBy: 'user'` (its connection
becomes "Play as user"). The moment any user-controlled participant exists, an
**autonomous room becomes impossible**, and the "Make this an autonomous room"
toggle is **disabled with an explanatory note** (in addition to the existing
submit-time validation).

This is UI/state-layer work only. The server, schemas, and API already support
arbitrary `controlledBy: 'user'` participants and already reject user
participants on autonomous rooms (`app/api/v1/chats/route.ts` ~lines 905-917). No
schema, DDL, migration, or `.qtap`/SillyTavern export changes are required.

## Decisions (confirmed with Charlie)

1. **Both controls, made consistent.** Extend the simple **"Play As (Optional)"**
   dropdown in `NewChatForm` *and* keep the picker panel's per-character
   **"Play As (User)"** option, ensuring both paths agree and both disable
   autonomous rooms.
2. **Switch in place to user.** A chosen character stays in the cast; its
   `controlledBy` flips to `'user'`. It is not duplicated or kept as an LLM
   participant.
3. **Disable the toggle + explain.** Grey out the autonomous checkbox with a
   short note when any user-controlled participant is present, on top of the
   existing submit-time guard.

## Current behavior (grounding)

- `components/new-chat/CharacterPickerPanel.tsx` — the **expanded** picker already
  renders a per-character "Connection Profile" select whose first real option is
  `Play As (User)` (`USER_CONTROLLED_PROFILE`). `handleProfileChange`
  (lines ~119-132) already flips `controlledBy` to `'user'` and clears
  `connectionProfileId`. **This path already does the "switch in place" thing.**
- `components/new-chat/NewChatForm.tsx` — the **"Play As (Optional)"** dropdown
  (lines ~446-468) is the simple control. It is populated **only** from
  `userControlledCharacters` (characters whose *default* is user-controlled) and
  writes to `state.selectedUserCharacterId`. On submit, `useNewChat` appends that
  ID as a **separate** `controlledBy: 'user'` participant (lines ~612-619). This
  is the control that does **not** currently meet the request.
- `components/new-chat/hooks/useNewChat.ts` — builds `userControlledCharacters`
  by filtering the roster to `controlledBy === 'user'` (lines ~228-235); LLM
  characters are filtered out of `characters` entirely (`c.controlledBy !== 'user'`).
  Submit logic at lines ~559-619; autonomous validation at ~565-577.
- `components/new-chat/NewChatModal.tsx` — wires both panels; computes its own
  `canSubmit` (lines ~124-131). The picker is **collapsed by default** for a new
  chat, **expanded** for continuation.
- `app/salon/new/page.tsx` — the standalone page entry point; has its own
  `canSubmit` with the autonomous condition (per Explore report, ~lines 69-77).
- `app/salon/[id]/page.tsx` — opens the modal in continuation mode (~lines 1472-1490).

## Design

### The unifying idea

There are two ways the user can mark a character as "the one I play as," and they
currently disagree:

- **Picker panel:** per-character select → sets `controlledBy: 'user'` on that
  `SelectedCharacter` (in-place; correct).
- **"Play As" dropdown:** sets `state.selectedUserCharacterId` → appended as a
  separate participant at submit (only allows *default*-user characters).

We make the **"Play As" dropdown** operate by the **same in-place mechanism** as
the picker. Concretely:

- The dropdown's option list becomes: *all currently-selected characters* (so any
  added character can be chosen) **plus** the default-user characters that aren't
  already in the cast (preserving today's ability to pull in a default-user
  persona that wasn't picked).
- Choosing a **selected** character flips that `SelectedCharacter.controlledBy` to
  `'user'` in place (and clears its `connectionProfileId`), instead of writing
  `state.selectedUserCharacterId`.
- Choosing a **default-user character not in the cast** keeps today's behavior:
  it's added as a `controlledBy: 'user'` participant at submit. (Implementation
  detail: simplest is to *add it to `selectedCharacters`* as a user-controlled
  entry so there is **one** source of truth — see "Single source of truth" below.)
- "Chat as yourself" clears any in-place user flag that the dropdown set, reverting
  that character to `'llm'`.

This makes both controls reflect and mutate the **same state** (`selectedCharacters[].controlledBy`),
satisfying "both controls, made consistent" and the SRP/DRY guidance in CLAUDE.md.

### Single source of truth

Today the user persona lives in **two** places depending on the path:
`state.selectedUserCharacterId` (dropdown) vs. `SelectedCharacter.controlledBy`
(picker). Collapse to **one**: `selectedCharacters[].controlledBy === 'user'`.

- Introduce a derived notion of "the user-controlled selected character(s)."
  In practice there is normally at most one; the autonomous guard already treats
  *any* count > 0 as disqualifying, so we don't need to hard-limit to one — but
  the simple dropdown should present a single-select that maps onto "the" user
  character. If more than one user-controlled character exists (possible via the
  picker), the dropdown should show the first/representative and a small hint, and
  not silently clobber the others. (Keep this edge case simple: dropdown reflects
  `selectedCharacters.find(sc => sc.controlledBy === 'user')`.)
- `state.selectedUserCharacterId` can be **retired** as the persistence mechanism.
  Either remove it, or keep it as a transient convenience that is always
  reconciled into `selectedCharacters`. **Prefer removing it** to avoid drift, but
  this touches seeding (continuation `initialUserCharacterId`, single-character
  `defaultPartnerId`) — see "Seeding" below. If removal is too invasive for one
  pass, keep the field but make `selectedCharacters` authoritative and derive the
  dropdown value from it, writing through to `selectedCharacters` on change.

### Autonomous toggle disabling

- Compute `hasUserControlled = selectedCharacters.some(sc => sc.controlledBy === 'user')`.
- In `NewChatForm` autonomous toggle (lines ~356-382): add `disabled={creating || hasUserControlled}`
  to the checkbox and render a short note when `hasUserControlled && !isAutonomous`,
  e.g. *"A character is set to Play As (user). Autonomous rooms have no user —
  remove the user character to enable."* Keep the existing inverse note
  (lines ~377-381) for the already-autonomous + lingering-selection case, though
  with the in-place model that case largely disappears.
- Keep the existing submit-time guards in `useNewChat` (lines ~565-577) and the
  server guard as defense in depth.

## Files to change

1. **`components/new-chat/NewChatForm.tsx`** — rework the "Play As (Optional)"
   dropdown:
   - Build its option list from `selectedCharacters` (label each, mark the
     current user one selected) plus default-user characters not already selected.
   - On change: if the chosen ID is a selected character, call
     `setSelectedCharacters` to set that entry `controlledBy: 'user'`,
     `connectionProfileId: ''`, and set every *other* previously-user entry back
     to `'llm'` (single-user semantics for this control). If "yourself," revert
     the current user entry to `'llm'`. If the chosen ID is a default-user
     character not in the cast, add it to `selectedCharacters` as a user entry.
   - Disable the autonomous checkbox via `hasUserControlled`; add the explanatory
     note. Remove/adjust reliance on `state.selectedUserCharacterId`.
   - Update `outfitCharacters` (lines ~289-300) to derive the user-controlled
     character from `selectedCharacters` instead of `state.selectedUserCharacterId`.

2. **`components/new-chat/hooks/useNewChat.ts`** —
   - Submit (lines ~598-619): drop the separate "append user character" block;
     since user-controlled characters now live in `selectedCharacters`, the
     existing `.map` already emits them with `controlledBy: 'user'` and
     `connectionProfileId: undefined`. Verify the map sends `controlledBy` for
     user entries and omits the profile (it does).
   - Seeding: where `selectedUserCharacterId` was seeded
     (continuation `initialUserCharacterId` ~line 413; single-char
     `defaultPartnerId`/`seededPartnerId` ~line 454; ~line 548), instead ensure
     the corresponding character is present in `selectedCharacters` as a
     `controlledBy: 'user'` entry. For continuation, `initialUserCharacterId`
     comes from a participant that was user-controlled in the source chat — seed
     it as a user entry. For a single new chat, `defaultPartnerId` points at a
     default-user character — seed it as a user entry (it won't be in the LLM
     `characters` list, so fetch/lookup may be needed; see note below).
   - Decide the fate of `state.selectedUserCharacterId` (remove vs. keep-as-derived).
   - Keep autonomous submit guards.

3. **`components/new-chat/CharacterPickerPanel.tsx`** — largely already correct.
   Verify the per-character select and `handleProfileChange` remain the canonical
   in-place switch. No behavioral change expected beyond consistency; optionally
   surface the same autonomous-disabling note isn't needed here (the toggle lives
   in the form).

4. **`components/new-chat/NewChatModal.tsx`** — `canSubmit` (lines ~124-131) is
   fine as-is (it already only requires ≥1 LLM with a profile). No change unless
   you want to mirror the disabled-toggle note. Confirm nothing reads
   `state.selectedUserCharacterId`.

5. **`app/salon/new/page.tsx`** — reconcile its `canSubmit` autonomous condition
   (`!isAutonomous || (llmCount >= 2 && !hasUserCharacter)`) so `hasUserCharacter`
   is derived from `selectedCharacters` (it likely already is). Ensure the
   autonomous toggle here is disabled the same way (or shares the form component).

6. **`components/new-chat/types.ts`** — if `state.selectedUserCharacterId` is
   removed from `NewChatFormState`, update the type and `INITIAL_STATE`. The
   `USER_CONTROLLED_PROFILE` constant stays.

## Data-model considerations (lookups)

- The roster fetch (`/api/v1/characters`) splits results: LLM characters into
  `characters`, default-user characters into `userControlledCharacters`
  (`useNewChat` lines ~228-235). The "Play As" dropdown therefore has access to
  **both** lists. When the dropdown adds a *default-user* character not in the
  cast, you have its `{id, name, title}` from `userControlledCharacters` but **not**
  a full `Character` object — and `SelectedCharacter` needs `character: Character`.
  Options:
  - (a) Stop splitting the roster: keep all characters in one list with their
    `controlledBy`, derive `userControlledCharacters` as a filtered view, and look
    up the full `Character` when adding to `selectedCharacters`. **Recommended** —
    one source of truth for the roster.
  - (b) Lazily fetch the full character via `/api/v1/characters/[id]` when a
    default-user character is chosen from the dropdown.
  - Prefer (a); it also makes the dropdown's "add default-user character" path
    trivial.

## Logging (per CLAUDE.md backend-logging rule)

This is front-end React state; no backend handlers change. No new debug logs are
required server-side. If any touched client code already uses the app logger, add
debug lines around the in-place switch for parity, but do not introduce a new
logging dependency into these components.

## Help docs (per CLAUDE.md "all user-visible changes")

User-visible behavior changes, so update help:

- The relevant New Chat / Salon help file under `help/*.md` (find the one
  describing starting chats / "Play As" — grep `help/` for "Play As" /
  "Chat as" / autonomous room). Add a short, in-voice (steampunk/Wodehouse)
  passage explaining that any already-cast character may take the user's chair,
  which retires the room's autonomous ambitions. Ensure its `url` frontmatter and
  the "In-Chat Navigation" `help_navigate(...)` call match (per the help-file rule).
- The autonomous-rooms help (`/help/autonomous-rooms`, linked at NewChatForm
  line ~370) should note that picking a user character disables the toggle.

## Testing

- **Unit/component (Jest):** the new dropdown logic — selecting a cast character
  flips exactly that entry to `'user'`, reverting any prior user entry; "yourself"
  reverts; default-user-not-in-cast gets added. Assert `hasUserControlled` drives
  the autonomous checkbox `disabled`.
- **Submit mapping:** assert the POST body lists the user character with
  `controlledBy: 'user'` and no `connectionProfileId`, and that no duplicate
  participant is produced (the old append path is gone).
- **Continuation seeding:** a source chat with a user-controlled participant seeds
  that character as a user entry in `selectedCharacters`; the dropdown reflects it.
- **Autonomous guard:** with a user-controlled character present, the toggle is
  disabled and submit is blocked; clearing it re-enables.
- **Playwright (optional):** drive the modal — pick a normally-LLM character as
  "Play As," verify the autonomous toggle greys out with the note, and that
  creating the chat lands a user-controlled participant.
- **Type check:** `npx tsc` (not `npm run build`).

## Out of scope / non-goals

- No schema, DDL, migration, `.qtap`/SillyTavern export, or backup changes.
- No change to how the **Salon** mid-chat Participants sidebar switches a live
  participant's connection (that's a separate flow); this plan is the
  creation-time dialogs only. If you want the same capability mid-chat, file a
  follow-up.
- No multi-user-persona UX beyond what the picker already permits; the simple
  dropdown remains single-select.

## Suggested commit slicing

1. Roster unification in `useNewChat` (single list + derived views) + types.
2. Rework the "Play As" dropdown in `NewChatForm` to the in-place model + outfit
   derivation.
3. Autonomous toggle disabling + note (form + `/salon/new` page parity).
4. Remove the submit-time append path; reconcile seeding.
5. Tests.
6. Help docs + changelog (`docs/CHANGELOG.md`, terse/plain per CLAUDE.md).
