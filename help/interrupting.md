---
url: /salon/:id
---

# Cutting In — Raising a Hand and Stopping

> **[Open this page in Quilltap](/salon)**

There comes a moment in every good salon when one simply must get a word in. The composer offers you two ways of doing so, stacked to the right of the editor beneath the familiar **Send** button. They wake only while somebody is speaking — the rest of the time they sit greyed and patient, like footmen between courses.

| Button | Colour | What it does |
|---|---|---|
| **Send** (paper aeroplane) | the theme's own | Sends your message. Unavailable while the room is speaking. |
| **Raise your hand** (a raised palm) | amber | The polite interruption. The next character to take the floor is asked whether they will yield it to you. |
| **Stop** (an octagon) | red | The firm interruption. The reply is cut off where it stands and the floor is yours at once. |

You may type freely while a character is speaking, so your remark can be ready and waiting the instant the floor comes round to you.

## Raising a Hand

Press the amber hand while a character is mid-reply, and the hand stays up — the button glows with a slow, expectant pulse — until somebody answers it. The character currently speaking is left to finish in peace; it is **the next character to take the floor** who is asked, quite plainly, whether they will yield to you or carry on regardless.

- **If they yield**, the Host announces it — a raised hand spied at the back of the room, a gracious little bow — and it is immediately your turn. A yielding character may add a word of their own first ("After you, my dear"), which is kept as their reply. The room is *not* paused: send your message and the conversation resumes its ordinary rotation.
- **If they carry on**, their turn proceeds as though nothing had happened, your hand comes down, and a small notice tells you who chose to keep talking. Nobody after them is asked; raise your hand again if you are still determined.

Changed your mind? Press the hand again to lower it before anyone is asked.

The hand is a courtesy for a crowd. It is offered only in a chat with more than one character present — in a one-on-one, the floor returns to you the moment your companion finishes anyway — and it is not offered in [Autonomous Rooms](autonomous-rooms.md), which run on their own and keep their own controls.

## Stopping

Press the red octagon and the reply stops *immediately* — Quilltap stops listening to the provider on the spot rather than waiting for it to finish. Then:

- **What had already appeared on screen is kept** as the character's reply, cut off mid-sentence if that is where it was. What had not yet arrived is discarded.
- **The character's thinking is discarded.** Only the words of the reply itself are kept.
- **Tools already used stay used.** If the character had already written to a file, changed an outfit or rolled the dice, that happened and is recorded. No further tool call is started — not even one the model had just finished asking for.
- **Nothing tries to "rescue" the turn.** No retry, no understudy, no automatic second attempt — a stop is a stop.
- **In a chat with characters taking turns, the room is paused**, so nobody else picks up where the stopped character left off. Press **Resume** in the sidebar when you are ready for the others to answer again.

If you stop a character before a single word of their reply has arrived, nothing is saved for that turn at all.

Stopping lives here in the composer now; the participant cards in the sidebar no longer carry a Stop button of their own.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`

## Related Pages

- [Turn Manager](chat-turn-manager.md) — Who speaks next, and why
- [Nothing to Add — Turn Skipping](turn-skipping.md) — When a character passes its turn
- [Multi-Character Chats](chat-multi-character.md) — How several characters share a scene
- [Chats](chats.md) — The Salon and its composer
