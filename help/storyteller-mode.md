---
url: /salon/:id
---

# Storyteller Mode

> **[Open this page in Quilltap](/salon)**

In an ordinary Salon the company takes its turns by rotation, and in a paused one it waits to be
nudged. **Storyteller mode** is the third arrangement, for the host who prefers to run the table
like a magic-lantern showman: every time you speak, the whole company is asked, at once and in
private, whether they wish to answer and what they mean to do. You read their intentions, tick the
ones you like, and only those characters take the floor. Nobody else says a word, and nothing is
done to the world that you have not first seen proposed.

## Choosing the Mode

The **Participants** drawer of the chat sidebar carries a three-way control:

| Position | What happens when you post |
|---|---|
| **Normal** | The company answers in its weighted rotation, as it always has |
| **Paused** | Your post goes into the record and nobody answers until you nudge them |
| **Storyteller** | Your post opens a *round*: every character bids, and you choose who speaks |

Paused and Storyteller are independent. Pausing a storyteller chat records your posts without
opening rounds; pressing **Storyteller** again resumes the bidding. Should the house pause the room
for you — a failed turn, a Stop — the mode is kept, and un-pausing returns you to it.

Beneath the control, in Storyteller mode, sits **Invite by talkativeness**. Off (the default),
every character is asked every round. On, each is asked with a likelihood that rises with their
talkativeness — the chatterbox nearly always, the wallflower about one round in four. A character
left out is shown on the board as *kept quiet*, with an **Ask anyway** button.

## A Round, Step by Step

1. **You post.** The message goes into the record exactly as it would in any chat.
2. **The company bids.** A board unfolds above the composer with a card for each character. As
   each bid arrives its card fills in: the character's plan in their own words, and how much they
   mean to do. Bids are gathered for up to 45 seconds; any that arrive later still appear.
3. **You choose.** Tick the bids you want and press:
   - **Run in order** — the chosen characters speak one after another, in the turn manager's
     rotation, each hearing what the others said before them. Should you prefer to call the
     order yourself, take hold of a card and drag it into place (on a touch screen, press and
     hold a moment first). Once you have rearranged the board, each chosen card wears a small
     number showing when its owner shall speak, and the rotation stands aside; **Reset order**
     returns the cards to their original places and the decision to the rotation.
   - **All at once** — the chosen characters speak over one another, as people at a dinner table
     do. Each sees the scene as it stood when you posted, and nobody answers anybody else within
     the round. (Characters bidding to *act* go one at a time after the crowd has finished — in
     the order you have dragged them, if you have.)
   - **Let it lie** — nobody answers. The floor stays with you.
4. **The floor returns to you.** Storyteller mode never chains past the round. The board folds
   into one line naming who spoke, until your next post opens a fresh round.

Posting again while a round is still open closes it unrun and opens a new one in its place.

## Bids and Their Tiers

Each bid claims one of four tiers, which govern what the character may do once chosen:

| Tier | The character may | Badge |
|---|---|---|
| **Simple** | Speak or act in character. No tools at all | plain |
| **Lookup** | Consult things first — documents, the transcript, search, read-only custom tools — then speak | blue |
| **Act** | Change the world: write a document, change clothes, move an object, send a letter, run a custom tool with effects | amber |
| **Destroy** | Delete something, which cannot be undone | red, with a warning |

The tier on the card is the house's own reckoning, not merely the character's say-so. If a
character claims *Lookup* but names a tool that writes, the card is raised to *Act* and says so
("Asked for Lookup, named an Act tool"). A chosen character may use **any** tool at or below its
tier, not only the ones it named; the named tools are shown as a statement of intent. Any attempt
to use a tool above the tier is refused on the spot, and the character is told why and carries on.

A **Destroy** bid must be chosen on its own. **Select all** never selects one, and ticking one
clears the others.

## What the Chosen Character Is Told

When a character's bid goes ahead, they are reminded — privately — of what they planned, who has
spoken since, and which tools the turn allows. They are told not to announce or quote the plan, and
that they may adapt it, or pass with *nothing to add* if the moment for it has gone by. The
operator chose the speaker; the speaker may still decline the floor.

## What Is Kept, and What Is Not

- **Bids are not part of the record.** They never enter the transcript, any character's context or
  the Commonplace Book. The board holds them only while the round is open. Every bid call is
  recorded in the [LLM inspector](system-llm-logs.md), under the *Storyteller Rounds* filter,
  which also gathers each round's speaking turns.
- **A speaking turn remembers its bid.** The reply carries the plan and tier it was made under, so
  regenerating it (a swipe) re-rolls the same intention rather than a fresh one.
- Memories, the running summary and the title are brought up to date once per round, after the
  last speaker, rather than after each.

## Things That Skip the Board

- A **whisper** to one character draws that character's one reply, as in every mode.
- An **`@Name:`** or **`@Name?`** query is answered by the house, and opens no round.
- **Nudge** summons one character for a single turn with no tier at all — your direct
  invitation, exactly as in a paused room.

## Silent Characters

A character set to *Silent* is still asked to bid, but told they may only act or emote, not speak
aloud. Their bid tier works as anyone else's.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`

## Related Pages

- [Multi-Character Chats](chat-multi-character.md) — Rotation, pausing and nudging
- [Chat Sidebar](chat-participants.md) — Talkativeness and the turn-mode control
- [Pascal's Workbench](pascals-workbench.md) — How a custom tool's read or write effect is decided
- [Custom Tools](custom-tools.md) — Trigger phrases in storyteller turns
- [Nothing to Add — Turn Skipping](turn-skipping.md) — How a character passes
