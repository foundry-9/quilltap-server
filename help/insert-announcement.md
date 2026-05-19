---
url: /salon
---

# Inserting your own announcements into the Salon

There are occasions, you will find, when the proceedings demand a public proclamation that neither the assembled cast nor the assiduous Staff have yet thought to deliver. A scene shifts. A bell tolls in the next street over. A character not presently in the room is mentioned — and the conversation would be much improved if that character could, for a brief and dignified moment, be heard. The Insert Announcement button, freshly installed in the composer's left gutter directly above the picture-making apparatus, is the instrument for precisely such occasions.

## What it does

A single click summons a tidy floating panel — drag it about by its title bar, tug its lower-right corner to whatever proportions suit you, and rest assured it will remember where it last stood the next time you call upon it. Because it does not draw a curtain across the Salon behind it, you remain free to scroll the conversation, select a passage, and copy a turn of phrase to quote in the announcement you are presently composing. There you choose who is speaking: a member of the Staff, a workspace character who is not presently in this chat, or — should neither suit — an arbitrary name of your own invention. You compose the message in a small Lexical editor, mark it up with whatever bold and italic flourishes the moment requires, and post.

The result lands in the conversation as a public bubble, indistinguishable in deportment from the Salon's automated announcements: every participant present (and silent participants too) sees it, every character's LLM receives it as part of their transcript, and the database keeps it forever. It is not a whisper. It is not a private aside. It is, in the strictest sense, *announced.*

## Choosing a speaker

The dialog offers three tabs.

**Staff** lists the eight personified members of Quilltap's staff — The Host, The Librarian, The Lantern, Aurora, The Concierge, Prospero, The Commonplace Book, and Ariel — each with their canonical name and avatar. Pick one and the bubble renders with their familiar likeness. There is no override here: a Staff member always appears as themselves.

**Off-scene character** offers a searchable list of every workspace character who is *not* presently a participant in this chat. Use it when you want an absent figure to speak from offstage — a letter read aloud, a voice through a closed door, an introduction to a person being discussed but not yet on the scene. The bubble shows the character's name and avatar; characters in the chat will see them named and identified, but the absent character is still absent — adding them as a participant remains a separate ceremony.

**Custom** is the catch-all: a single text field for whatever name you please. *The Narrator.* *A Distant Bell.* *Someone from the kitchen.* The bubble renders with that name and a placeholder avatar. Useful for narration that doesn't belong to any specific character or member of Staff.

## Letting a character speak in their own voice

When you choose an off-scene character, two further pickers reveal themselves. The first asks *how* they should say it — either verbatim (the polite default the system reaches for whenever the speaker happens to be user-controlled, lest a hand-written line be rephrased against your wishes) or routed through one of your connection profiles for a proper in-character rewrite. The second appears only when the character keeps more than one system prompt on file, and lets you pick which prompt should guide them. Both pickers begin with the character's own preferences (their default profile, their default system prompt) so that selecting the character is, ordinarily, the only choice you need to make.

When a profile is selected, the **Preview in character** button takes the place of Post. Click it and the dialog hands your seed text to the character — only your seed text, and only what the character knows: their identity stack, a fresh Commonplace Book recall against the seed, and a list of who is presently in the chat as audience. Crucially, the character is not told that they are announcing anything. They are told that they stand outside the conversation and may speak to the people inside it; the rest is their own voice. The quill rocks while they compose, and a moment later the proposed line appears below your seed, ready for your review.

From there: post it as it stands, polish it with a small edit, click **Regenerate** to try the recall again, or click **Edit seed** to unlock your original prompt and start over. Nothing is posted to the chat until you click **Post Announcement** — the preview is a private rehearsal between you and the character.

## What characters see

The bubble's *content* — the Markdown body you typed — is exactly what every character's LLM receives. The avatar and name on the bubble are for the human audience; the LLM reads the prose. As with the Salon's automated Staff messages, this means the announcement's content should carry whatever attribution the conversation needs. *"The Host raises a glass and says…"* will read clearly to any character; bare prose with no speaker indicated may leave them guessing.

## A note on permanence

Announcements, once posted, become part of the chat history. They may be edited or deleted using the same controls as any other message bubble. They are included in exports and imports. They contribute to context summaries and memory extraction, just as any other conversation turn does. Pose them with the care you would pose any other message — the Commonplace Book remembers everything.

## In-Chat Navigation

```
help_navigate(url: "/salon")
```
