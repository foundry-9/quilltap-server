---
url: /salon/:id
---

# The Chat Gallery — Every Picture in the Conversation

A conversation accumulates pictures the way a drawing room accumulates ash: from every direction, all evening, and without anybody quite meaning it. The Lantern paints a fresh backdrop every few turns. Aurora repaints a character's portrait when they change their coat. A character summons an illustration, or brings out a photograph they filed away nine chats ago. The Librarian fetches a plate from a document store. You yourself upload a snapshot. And the whole cast has been hanging their standing portraits over every message since the first line was written.

Until lately, the only way to lay hands on any of it was to find the message it hung beneath — assuming it hung beneath one at all, which backdrops and repainted portraits generally do not — and press the bookmark on that message's ribbon. This was, we are told, considered a nuisance.

The **Gallery** now sits in the sidebar's **Organize** drawer, at the foot of the list, and reads `Gallery (12)` or whatever the tally happens to be. Press it and every picture in the conversation is laid out at once.

## What's in it

Seven kinds of picture, and the gallery knows which is which:

- **Backgrounds** — the backdrops the Lantern painted for this story. Every one of them, not merely the one currently on the wall: a conversation's backdrops over the course of an evening are a record of where the evening went, and it would be a poor gallery that showed only the last.
- **Avatars** — the portraits Aurora repainted mid-conversation, when a character changed their outfit or their circumstances. Again, all of them; the one presently being worn is marked.
- **Portraits** — the cast's own standing portraits, the faces they wear by default. These belong to the characters, not to this conversation, and the gallery is only looking at them.
- **Generated** — the pictures summoned in this conversation, whether by a character reaching for `generate_image` or by your own hand at the Generate Image dialog.
- **Attached** — photographs you uploaded, files you linked in from the library, and plates the Librarian fetched out of a document store.
- **Kept** — pictures brought back out of a photo album by a character who wanted to show you something again.
- **Inline** — pictures written directly into the prose with a Markdown link, rather than pinned beneath a message.

A row of chips across the top lets you narrow to any one of these, with its count beside it. A kind with nothing in it gets no chip, and if the whole gallery turns out to be one kind, the row does not appear at all — there is nothing to filter.

## The "current" badge

Two of the seven change over time: the backdrop on the wall and the portrait a character is wearing. Both leave their predecessors behind in the gallery, which is the point — but you will want to know which one is presently in play. Those wear a small **current** badge in the corner. They are also, deliberately, the two you cannot delete.

## Saving a picture to an album

Hover any thumbnail and a small bookmark appears. It opens exactly the dialog the message ribbon's bookmark opens, with the same list of albums — your own persona's, each character in the chat, the project's album, every linked document store, and Quilltap General at the foot — the same caption field, and the same polite refusal if that album already holds the picture. See [Save Image to a Photo Album](chat-message-actions.md) for the full account of that dialog.

The difference is only in what it will accept. The ribbon's bookmark can save an image that hangs beneath a message; the gallery's can save anything in the conversation, message or no message. A backdrop the Lantern painted without announcing itself, a standing portrait, a picture woven into the prose — all of them can now be filed away properly.

## Downloading a picture

Hover and press the downward arrow, and the picture is handed to you as a proper file: a native save dialog in the desktop application, your browser's customary arrangements otherwise. No right-clicking required, which matters a great deal in the desktop shell, where right-clicking offers nothing at all.

The picture is not first hauled into the application's memory to be handed over — it is streamed straight to disk. On a four-thousand-pixel backdrop this is the difference between a download and a hesitation.

The same **Download** button, with **Copy** beside it, sits at the top right of the enlarged view when you click a thumbnail.

## When the bin appears, and when it does not

The bin is offered only where the conversation itself minted the record: photographs you uploaded, pictures generated here, and superseded backdrops and repainted portraits. Everything else in the gallery belongs to somebody else — a character owns their standing portrait, an album owns a kept picture, a document store owns a fetched plate — and the gallery is a view over other people's shelves, not a licence to clear them.

Nor will you find a bin on the backdrop presently on the wall or the portrait a character is presently wearing. Those are what the conversation is showing; retiring one out from under it would leave the Salon looking at nothing.

Where the bin does appear, it asks once before it acts. Deleting severs the link; if this conversation was the last place holding a hand on those bytes, the bytes themselves are garbage-collected. (If a character's album, your own *My Photos* gallery, or any other link still points at the picture, it stays exactly where it is.) A picture deleted from beneath a message leaves a small note in its place, so the transcript does not silently rearrange itself.

## The enlarged view

Click any thumbnail and the picture fills the frame. Along the top: **Save**, **Download**, **Copy** and **Close**. In the bottom corner, where the conversation owns the record, the bin. Arrow keys walk you along the roll; Escape closes it.

Under the picture sits a line of provenance — what kind of picture it is, whose it is when that is known, when it was made, and whether it is the current one. Where the picture hangs beneath a message, a **Jump to message** link takes you to that place in the transcript.

## A note on the tally

The number beside the **Gallery** button and the pictures in the grid are the same answer to the same question, asked once. This was not always so, and for a good long while the button did not appear at all, on account of a count that was reading an address that had never existed. It now keeps itself current on its own: when the Lantern finishes a backdrop or Aurora finishes a portrait, the number moves without your having to reload anything.

Because the cast's standing portraits are in the gallery, a conversation with anybody in it is never empty, and the button is always there.

## In-Chat Navigation

To direct the conversation to the gallery, navigate to the chat itself and open the **Organize** drawer in the sidebar:

```
help_navigate(url: "/salon/:id")
```
