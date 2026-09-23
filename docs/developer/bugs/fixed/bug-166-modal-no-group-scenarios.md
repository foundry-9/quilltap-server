# Bug 166 — the workspace New Chat dialog never offers group scenarios

| | |
|---|---|
| **Status** | **FIXED in v4 (2026-09-23)** |
| **Found** | 2026-09-23, live-verifying the Scenario Builder on V4test |
| **Fixed** | 2026-09-23, v4.10-dev |
| **Severity** | Low — a missing option, not wrong data; the `/salon/new` page and the in-chat picker both offered the tier |
| **Who it bites** | anyone starting a chat from the workspace's **Start Chat** dialog with a cast member who belongs to a group that keeps scenarios |
| **Provenance** | Original to v4. `d25dacc1d` threaded group scenarios into `NewChatPageClient` but not into `NewChatModal`, which renders the same `NewChatForm` |
| **Fix site** | `components/new-chat/NewChatModal.tsx` |
| **v5 status** | Not assessed |
| **Index** | [bugs.md](../../bugs.md) |

**FIXED in v4 (2026-09-23).** `NewChatModal` destructures `groupScenarios` from `useNewChat`
(which always fetched them) and passes it to `NewChatForm`.

## Symptom

In the workspace, the **Start Chat** dialog's **Starting Scenario** picker listed General and
project scenarios but never a **Group Scenarios** section, even with a cast member in a group
whose `Scenarios/` folder had entries. `help/groups.md` and `help/chats.md` say the New Chat
dialog offers them.

## Root cause

`useNewChat` fetched `/api/v1/groups/scenarios` and returned `groupScenarios`, but
`NewChatModal` never read it, so `NewChatForm` got its default `[]`.

## Why it survived

The `/salon/new` page renders the same form with the prop wired, and that page is where the
group-scenario work was tested.

## Fix

Pass the prop. Found because the Scenario Builder's save-then-select path (group target) could
not select a tier the dialog wasn't showing; that handler now also checks the re-read tiers
before selecting anything, so it can never point the form at a preset the picker doesn't list.

## Verify

- Live (V4test, 2026-09-23): workspace **Start Chat** with Lorian (a member of the Aeronauts
  Club) lists *Group Scenarios: Aeronauts Club: …*.
- `components/new-chat/__tests__/NewChatForm.test.tsx` — *selecting a scene the Host just
  filed*: a group target is selected only when the re-read tiers carry it.
