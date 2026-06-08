---
url: /salon
---

# Carina — Inline Queries to a Reference Character

There are moments in any well-appointed Salon when the conversation calls for a swift consultation — not a full discourse, not a fresh interlocutor joining the party with all the attendant ceremony, but simply an answer. The capital of a country. The formula for a compound. The contents of a particular file. In civilised establishments, one dispatches such questions to the reference desk.

Carina is Quilltap's reference desk. She does not speak as herself — she has no self to speak from, strictly speaking. What she does is route your inquiry to whichever character you have designated as the answerer, extract a clean response from that character's personality, their own recollections, and the chat's available tools, and deliver it back to you with a minimum of fuss. No conversation history consulted. No elaborate entrance. Just the answer, attributed to the character who provided it, appearing in your chat with the discreet economy of a well-trained librarian. The answerer does, however, remember being asked — a question put to the reference desk is a question the desk recalls afterward.

## The `@Name` syntax

To consult a Carina answerer from any message in the Salon, place an `@Name` invocation at the beginning of a line. The character name must be followed immediately by either a colon (`:`) for a public answer or a question mark (`?`) for a whispered one.

### Public queries (`@Name:`)

```
@Archivist: What were the main clauses of the Treaty of Westphalia?
```

The answerer's reply appears in the chat for all participants to see — a compact reference card, visually distinct from ordinary conversation turns, attributed to the character named. The card arrives the very instant the answer is ready: you need not wait for the assembled company to finish their own remarks before the reference desk slides its note across the table to you.

### Whispered queries (`@Name?`)

```
@Archivist? What were the main clauses of the Treaty of Westphalia?
```

Precisely the same machinery, but the answer is whispered back to you alone. Other characters in the chat remain blissfully unaware that any consultation took place.

### Multi-sentence questions (quoted form)

If your inquiry spans more than a few words and you are concerned about how the parser will read it, wrap the question in quotation marks — straight or the elegant curled variety are both received with equal grace:

```
@Archivist: "What were the main clauses of the Treaty of Westphalia? And who were the principal signatories?"
@Archivist? 'What is the melting point of pure iron, and how does carbon content affect that figure?'
```

The quoted form captures everything between the opening and closing mark. Smart quotes pair correctly with their counterparts (`"…"` and `'…'`). Questions do not span multiple lines even in the quoted form.

### One query per message

A message may contain only one `@Name` invocation that fires — the first matching line is acted upon, and any subsequent `@Name` lines in the same message are left as plain text. This is a deliberate courtesy rather than a limitation: it keeps consultations orderly without requiring time-based throttling machinery that nobody particularly wishes to think about.

## What the answerer knows (and does not know)

The answerer character builds its response from:

- Its own **personality**, **identity**, **description**, and **manifesto** — its full character as configured in Aurora
- Its own **memories** — recollections from its Commonplace Book that bear on your question, whispered in for the occasion just as they would be for an ordinary turn
- Its **default scenario**, if one is set
- Any **previous Carina exchanges** in this chat directed at this same character — so follow-up questions ("And what about...?") carry appropriate continuity

What the answerer does **not** receive:

- The chat history — the answerer cannot see what has been discussed
- Project context or core whispers
- Other characters' messages or perspectives

This isolation is the point. A Carina answer is a reference answer: drawn from the character's nature, its own recollections, and the tools at hand — not from the conversational context it has not been party to.

### What the answerer remembers afterward

A consultation is not forgotten the moment it concludes. After the answer is delivered, the answerer forms its own memories of the exchange — what it was asked, and what it replied — filed away in its Commonplace Book exactly as any other turn would be. Whispered consultations are remembered no less than public ones: the answerer experienced the question regardless of who was permitted to see the reply. Over time, a frequently consulted reference character accumulates a sense of what it is repeatedly asked, and its recollections inform later answers. (The party putting the question — you, or another character via `ask_carina` — forms no memory of the exchange on Carina's account; only the answerer remembers.)

## The `ask_carina` tool

LLM characters with tool-calling capabilities may invoke Carina programmatically via the `ask_carina` tool, rather than writing `@Name` markup in their message. The effect is identical: the named character is consulted, and the answer is posted into the chat (publicly or as a whisper, per the `whisper` parameter). The calling character receives the answer as a tool result and may incorporate it into their own response.

This is chiefly of interest in autonomous rooms or multi-character scenarios where a character might need to look something up without interrupting the conversational flow — like sending a discreet note to the reference desk from across the room.

## Enabling a character as a Carina answerer

Not every character is available for `@Name` consultation by default. To designate a character as a Carina answerer:

1. Open **Aurora** (`/aurora`) and find the character you wish to designate
2. Click **Edit** to open the character edit form
3. Scroll to the control flags section — where you will find options such as system transparency, wardrobe controls, and similar
4. Enable the toggle labelled **"Can answer @-queries (Carina)"**
5. Save the character

For a quicker enrolment, you may skip the edit form entirely: a small **console** switch sits among the toggles in the upper right of every character card — both on the Aurora roster and atop a character's own page, tucked between the favourite star and the user-control figure. Click it to enlist or dismiss the character as a Carina answerer on the spot; the console glows when the character is enrolled, and the change is saved at once with no further ceremony.

A character with this flag enabled may be invoked by `@Name` from any chat — they need not be a participant in the chat to answer. If no answerer by the requested name can be found, or if the character in question lacks an LLM connection, Prospero will report the difficulty.

Characters without this flag cannot be invoked via `@Name` syntax, even if their name matches exactly.

## Errors

When something goes awry — the named character is not found, is not enabled as a Carina answerer, or has no LLM connection that can be resolved — Prospero steps in to deliver the news. Public queries receive a public error message; whispered queries receive a whispered one. Carina herself has no voice for these announcements; she dispatches the matter to Prospero with the quiet efficiency of someone who knows better than to make a scene.

## In-Chat Navigation

```
help_navigate(url: "/salon")
```

## Related Pages

- [Characters](characters.md) — Creating and managing characters in Aurora
- [Character Editing](character-editing.md) — Editing character properties and control flags
- [Multi-Character Chats](chat-multi-character.md) — Working with multiple characters in the Salon
- [Whispers](chat-multi-character.md) — Private messages in multi-character chats
- [Tools](tools.md) — Available LLM tools including `ask_carina`
