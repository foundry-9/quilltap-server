---
url: /salon/:id
---

# Participants Sidebar

> **[Open this page in Quilltap](/salon)**

The Participants Sidebar is your control center for managing characters in multi-character chats. It shows who's in the conversation, whose turn it is, and provides controls for managing participation.

## What Is the Participants Sidebar?

The Participants Sidebar is a panel on the right side of the chat interface that:

- **Shows All Participants** — Lists every character in the chat
- **Displays Turn Status** — Shows whose turn it is and who's queued
- **Provides Controls** — Manage talkativeness, turns, and impersonation
- **Indicates Activity** — Shows who's speaking, waiting, or inactive

## Accessing the Sidebar

### Opening the Sidebar

The sidebar appears automatically in multi-character chats. If collapsed:

1. Look for the sidebar strip on the right edge of the chat
2. Click the **expand button** (left-facing arrow)
3. Or click any mini avatar in the collapsed strip
4. Sidebar expands to full width

### Closing the Sidebar

To collapse and save space:

1. Click the **collapse button** (right-facing arrow) in the sidebar header
2. Sidebar minimizes to a thin strip with mini avatars
3. Click expand or any avatar to open again

## Sidebar Views

### Collapsed View

When collapsed, the sidebar shows:

**Mini Avatars:**
- Small circular avatars for each participant
- Stacked vertically on the right edge, sorted by predicted turn order
- Shows current speaker with glowing border
- Turn position badges on all active participants (color-coded by status)
- Status overlay icons on avatars indicate non-active states (silent, absent) so you can see at a glance who's participating even with the sidebar collapsed
- Absent participants shown dimmed

**Quick Actions:**
- Pause/Resume button at the top
- Click any avatar to expand sidebar

**When to use:**
- Maximize chat space
- Quick glance at participants
- On smaller screens

### Expanded View

Full sidebar showing complete participant information:

**Header:**
- Participant count ("3 characters")
- Turn status message
- Queue count if applicable
- Pause/Resume button

**Participant Cards:**
- Full character information
- All control options
- Talkativeness sliders
- Action buttons

**Footer:**
- Add Character button

**When to use:**
- Managing participants
- Adjusting settings
- Multi-character scene orchestration

## Participant Cards

Each character in the sidebar has a card with:

### Identity Section

**Avatar:**
- Character's profile image or initials
- Current speaker has glowing/animated border
- Turn position badge showing predicted speaking order (color-coded by status)

**Name and Title:**
- Character's name
- Optional title/role beneath

**Type Badge:**
- "Character" for regular characters
- "User Character" for user-controlled characters
- "NPC" for on-the-fly characters

### Connection Profile Dropdown

Each character card includes a **connection profile dropdown** that lets you change which LLM service and model the character uses, directly from the sidebar:

- **Dropdown selector** shows the current model (e.g., "gpt-4-turbo", "claude-3-opus")
- **"User (you type)"** option switches the character to user control (impersonation)
- **Change immediately** — selecting a different profile saves automatically
- Only shown for CHARACTER participants, not personas

This makes switching models the fastest possible action — no need to open a settings modal.

### System Prompt Dropdown

Immediately beneath the connection profile selector, each LLM-controlled character card also carries a **system prompt dropdown**. If the character has more than one named system prompt (defined on the character's edit page), this lets you pick which one the LLM should speak from — without leaving the chat:

- **Use default prompt** — the entry marked as default on the character takes the stage
- **Every named prompt** the character carries appears in the list, with the default marked
- **Effect is immediate** — the next turn (nudge, auto-response, or swipe) uses the newly chosen prompt
- Only shown for LLM-controlled characters that have at least one named prompt on file

If you want a character to keep the same costume but change their register for an afternoon — swap them from their "Formal" variant to their "Casual" one here, and the switch takes effect with the very next line they speak.

### Status Indicators

**Control Mode:**
- LLM icon if AI-controlled, with a provider icon badge showing the current LLM service and model
- "You" indicator if impersonated

**Participation Status:**
- Full color when **active** — speaking and roleplaying normally
- Muted styling with **Silent** badge when silenced — present but observing
- Dimmed with **Absent** badge when away — turns are skipped entirely
- Removed participants no longer appear in the sidebar

**Current Turn:**
- Glowing border when it's this character's turn
- "Generating..." text while responding
- Typing animation during generation

### Control Section

**Talkativeness Slider:**
- Horizontal slider (LLM-controlled characters only)
- Drag to adjust speaking frequency
- Left = quieter, Right = chattier
- Changes apply immediately

**Turn Action Buttons:**

- **Nudge** — Force immediate response (LLM characters)
- **Queue** — Add to speaking queue
- **Dequeue** — Remove from queue (if queued)
- **Stop** — Interrupt the current generation (shown on the generating character's card)

**Status Dropdown:**
- A dropdown selector on every participant card lets you set their participation state
- **Active** — Character speaks and roleplays normally (default)
- **Silent** — Character receives turns but is instructed to observe silently; they may have inner thoughts, physical reactions, and actions, but must not speak aloud. Messages from silent characters appear with a distinctive dotted border and muted tones, rather like whispered asides at a particularly discreet garden party
- **Absent** — Character is temporarily away from the scene; the turn manager skips them entirely, and they appear dimmed at the bottom of the sidebar. Other characters are notified of their departure
- **Removed** — Character has left the chat for good; they cannot be whispered to and have no knowledge of events after their departure. Their past messages remain visible
- When any character's status changes, all other LLM-controlled characters are informed in their next turn's prompt

**Impersonation Controls:**

- **Impersonate** — Take control of this character
- **Stop Impersonate** — Return to AI control

**Remove Button:**
- Remove this character from the chat
- Only available if more than one character present

## Header Information

The sidebar header shows:

### Participant Count

"3 characters" or "2 characters"

- Counts only LLM-controlled characters
- Helps track chat complexity

### Turn Status

Current state of the conversation:

- **"Your turn to speak"** — All characters have spoken, waiting for you
- **"Generating response..."** — AI is creating a response
- **"Waiting for [Name]..."** — Waiting for specific character
- **"[Name] is thinking..."** — Character actively generating

### Queue Information

If characters are queued:

- **"2 in queue"** — Shows how many are waiting
- Queue empties as characters speak

### Pause/Resume Button

Controls auto-response flow:

- **Pause** — Stop automatic turn progression
- **Resume** — Continue automatic responses
- Most useful for all-LLM chats

## Managing Participants

### Announcements from the Host

Whenever a character is added to the chat, removed from it, or switched between **active**, **silent**, and **absent** states, the Host steps forward and announces the change in the conversation as a synthetic message — visible to you and to every other LLM character in the chat. Add announcements include the new arrival's avatar and either their **identity** (drawn from `identity.md` in the character's vault, when one exists) or their **description** field as a fallback — identity preferred, description used only when there is no vault identity to draw upon. Remove and state-switch announcements are text-only.

Characters whose **System Transparency** is off do not see the Host's messages — the same Staff-filter rule that already hides Lantern, Aurora, Librarian, and Prospero announcements from opaque characters applies here too. You always see them.

The Host also issues a one-time advisory whisper when a chat has no user-controlled character attached. Without one, the auto-memory pipeline cannot record what your characters come to know about *you* — only what they come to know about themselves — so the Host gently nudges you toward attaching or creating a user persona. The whisper appears at most once per chat; once acted upon (or once a user-controlled character has been added), it does not return.

### Announcements from Prospero

When you reassign a participant to a different connection profile from the sidebar — swapping the LLM that drives a particular character — Prospero, master of the agentic and tool-using systems, steps forward and announces the change so the rest of the room is in on the news. The note records the participant's name, the new profile, and the one it replaced. Like the Host's announcements, Prospero's messages are filtered out of the conversation handed to characters whose **System Transparency** is off; you always see them.

### Adding Characters

1. Click **Add Character** at the bottom of the sidebar
2. A character selector opens
3. Choose a character from your library
4. Configure options:
   - **History Access** — Can they see previous messages?
   - **Join Scenario** — Optional entrance description
5. Click **Add** to confirm
6. Character appears in the sidebar

### Removing Characters

1. Find the character's card in the sidebar
2. Click the **Remove** button (X or trash icon)
3. Confirm removal
4. Character leaves the chat

**Notes:**
- Cannot remove the last character
- Past messages from removed characters remain visible
- Character can be re-added later

### Reordering (if supported)

Some versions support drag-and-drop reordering:

1. Click and hold a character card
2. Drag to new position
3. Release to drop
4. Order affects display, not turn selection

## Talkativeness Control

### What Talkativeness Does

Controls how likely a character is to speak when it's time to select the next speaker:

- **Higher values** — More likely to be selected
- **Lower values** — Less likely to be selected
- **Zero** — Never volunteers (must be nudged or queued)

### Adjusting Talkativeness

1. Find the character's card
2. Locate the slider below their name
3. Drag left or right to adjust
4. Value updates immediately
5. Next turn selection uses new value

### Suggested Settings

**Lead Character:** 0.7-1.0
- Speaks frequently, drives the conversation

**Supporting Character:** 0.4-0.6
- Balanced participation

**Background Character:** 0.1-0.3
- Chimes in occasionally

**Silent/Reactive:** 0.0
- Only speaks when prompted

## Turn Control

### Using Nudge

Forces a character to speak immediately:

1. Find the character in sidebar
2. Click **Nudge**
3. Character generates response immediately
4. Overrides normal turn order

**Use cases:**
- Character should react to something specific
- Breaking normal flow for dramatic effect
- Testing a character's response

### Using Queue

Adds characters to an ordered speaking list:

1. Click **Queue** on first character to speak
2. Badge "1" appears on their avatar
3. Queue more characters as needed
4. They speak in the order queued

**Managing queue:**
- Click **Dequeue** to remove from queue
- Queue persists until processed or cleared
- Queued characters speak before random selection

### Turn Order Badges

Position badges on each participant show their predicted turn order:

- **Green pulsing** — Currently generating (#1)
- **Green static** — Next speaker
- **Blue** — Queued to speak
- **Neutral** — Eligible, sorted by talkativeness
- **Amber** — Your turn position
- **Dimmed** — Already spoke this cycle
- **No badge** — Absent or removed participant

## Impersonation

### Starting Impersonation

1. Find the character to control
2. Click **Impersonate**
3. Character switches to user control
4. When it's their turn, you type their response

### Visual Indicators

When impersonating:

- Card shows "You" indicator
- Impersonate button changes to "Stop Impersonate"
- Input area shows which character you're typing as

### Switching Characters

If impersonating multiple characters:

1. Look above the input field
2. Click the character name/avatar to switch
3. Your next message sends as that character

### Stopping Impersonation

1. Click **Stop Impersonate** on the character's card
2. Select a connection profile for AI control
3. Character returns to LLM control

## Pause and Resume

### The Pause Button

Located in the sidebar header:

- **Pause** (shown during auto-responses) — Stop automatic progression
- **Resume** (shown when paused) — Continue auto-responses

### When to Pause

- Reading and absorbing a complex scene
- Planning your next action carefully
- Taking a break during long sessions
- Preventing runaway all-LLM conversations

### Auto-Pause

In all-LLM chats (no user-controlled characters):

- System auto-pauses after several turns
- Notification appears asking to continue
- Click Resume or Pause to respond
- Prevents infinite conversation loops

## Sidebar Behavior

### Responsiveness

The sidebar adapts to screen size:

- **Wide screens** — Full expanded sidebar by default
- **Medium screens** — Collapsed by default, expand on click
- **Narrow screens** — Overlay mode, closes after action

### Persistence

Your sidebar state is remembered:

- Collapsed/expanded preference saved
- Talkativeness settings persist per chat
- Queue clears when processed

### Updates

The sidebar updates in real-time:

- Turn indicators update as characters speak
- Queue badges update as queue processes
- Status messages reflect current state

## Troubleshooting

### Sidebar won't open

**Causes:**
- Single-character chat (sidebar not shown)
- UI issue
- Screen too narrow

**Solutions:**
- Verify multiple characters in chat
- Refresh the page
- Try wider screen or zoom out

### Can't remove character

**Causes:**
- Last remaining character
- Character is speaking

**Solutions:**
- Add another character first
- Wait for current generation to complete

### Talkativeness not affecting turns

**Causes:**
- Only one character active
- Characters are queued (queue overrides)
- Very similar talkativeness values

**Solutions:**
- Ensure multiple characters active
- Clear the queue
- Increase difference between values

### Nudge not working

**Causes:**
- Character is inactive
- Connection profile issue
- Already generating

**Solutions:**
- Activate the character
- Check connection profile
- Wait for current generation

### Queue order wrong

**Causes:**
- Clicked in wrong order
- Queue was modified
- Display not updated

**Solutions:**
- Clear queue (dequeue all) and re-queue
- Refresh if display seems stale

### Impersonation issues

**Causes:**
- Character already AI-controlled with active generation
- Multiple impersonations confusing input

**Solutions:**
- Wait for generation to complete
- Check which character is selected above input
- Click correct character to switch

## Tips for Using the Sidebar

### For Roleplay

- Keep sidebar expanded during complex scenes
- Adjust talkativeness as scene focus shifts
- Use queue to set up dramatic moments
- Pause to plan important responses

### For Performance

- Collapse sidebar on small screens
- Reduce active characters when not needed
- Use talkativeness instead of removing/adding

### For Organization

- Note queue positions for planned sequences
- Watch turn indicators to follow conversation
- Use pause to prevent missed content

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`

## Related Pages

- [Chats Overview](chats.md) — Basic chat functionality
- [Multi-Character Chats](chat-multi-character.md) — Setting up group conversations
- [Turn Manager](chat-turn-manager.md) — How turns are determined
- [Message Actions](chat-message-actions.md) — Working with messages
- [Characters](characters.md) — Creating chat participants
