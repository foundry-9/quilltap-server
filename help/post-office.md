---
url: /salon
---

# The Post Office — Letters Between Characters

Not every thought wishes to be spoken aloud across a crowded Salon. Sometimes one character has a private word for another — a confidence, a proposal, a pointed remark best delivered in an envelope rather than declaimed to the assembled company. For these occasions the establishment maintains a Post Office, and at its counter stands **Suparṇā**, who carries letters from one character's hand to another's mailbox with the unhurried certainty of someone who has never once lost a parcel.

A letter is an ordinary Markdown document. It is written by one character, addressed to another, and delivered into the recipient's own vault — where it waits, patient as a folded note under a door, until the recipient next takes the floor and Suparṇā steps in to read it to them.

## Who may write to whom

Anyone to anyone. There is no guest list at this counter and no requirement that the two parties share a chat. Any character may post a letter to any other character in your establishment; a character may even write to itself, should it wish to leave a note for later. The reference desk has its rules of etiquette — the Post Office has none beyond "address it properly."

## Sending a letter: `send_mail`

A character with tool-calling abilities posts a letter with the **`send_mail`** tool. It asks for two things, and accepts a third:

- **character** — the name (or id) of the recipient. Suparṇā finds them by their nameplate.
- **message** — the body of the letter, written in Markdown. Write the words only; the envelope — who sent it, when, and so forth — is stamped for you. Do not pen any frontmatter yourself.
- **in_reply_to** *(optional)* — the id of a letter in **your own** mailbox you are answering. When supplied, your reply is prefaced with a tidy quoted copy of the original.

Suparṇā takes the letter in hand and delivers it. No copy is kept in the sender's own files — a letter, once posted, belongs to the one who receives it.

## Posting a letter yourself: the Compose Mail button

You need not wait for a character to reach for the tool — you may post a letter with your own hand, signed as whichever character you happen to be playing. Look to the little palette of tools in the composer's left margin (the same block that holds the announcement megaphone, the library clip, and the dice). The **envelope** button — *"Post a letter"* — opens the **Compose Mail** window.

Inside, you will find:

- **Signed by** — the player-character the letter is sent *as*. If you are playing exactly one character in the scene, that name is fixed; if you wear more than one hat, a little dropdown lets you choose which one holds the pen. (Only characters *you* are playing appear here — you cannot sign on another's behalf.)
- **Addressed to** — the recipient. Any character in your establishment may receive a letter, whether or not they're present in this scene — the full cast is at your disposal, the sender excepted.
- **In reply to** — left at *"No quoted reply."* by default. Should you wish to answer something, the dropdown offers the letters already resting in your chosen character's own postbox; pick one and your letter will quote it, just as the tool would. Switch who the letter is *signed by* and the list refreshes to that character's postbox.
- **The letter** — the body, written in Markdown.

Press **Send** and Suparṇā takes it from there, delivering it exactly as she would a letter posted by the `send_mail` tool — frontmatter stamped, recipient's `Mail/` folder and all. Her delivery whisper appears the next time the recipient takes the floor.

## Where mail lives

Every delivered letter lands as a file in the recipient's vault, in a folder named **`Mail/`** that the Post Office creates on first delivery. Each letter is its own document, named for the hour it arrived and the hand that sent it — for example, `Mail/1718370000000-from-ariadne.md`. That path is also the letter's **id**: the thing you name when you wish to read it, answer it, or throw it away.

The envelope (the document's frontmatter) records who sent it, their character id, when it was posted, whether Suparṇā has yet announced it, and — if it was a reply — which letter it answered. All of this is the Post Office's bookkeeping; a character never writes it.

## Suparṇā's announcement

A letter sitting unread in a mailbox would be a poor sort of letter. So whenever a character is about to take its turn, the Post Office quietly checks that character's mailbox — right after the Commonplace Book has finished its own whispering. Any letters that have arrived since last time prompt **Suparṇā** to step forward with a private word: she names each sender, says when the letter came, reads it aloud, and reminds the recipient how to answer or set it aside. Each such announcement is a one-time event — Suparṇā does not repeat herself on later turns, for once a letter has been announced it is marked as delivered-to-attention and left in peace.

Suparṇā keeps no secrets behind a screen: her announcements are openly visible to every character, so even a character who otherwise keeps the Staff at arm's length still hears that the post has come.

And what of a letter addressed to the very character *you* are playing? You never take a turn in the mechanical sense — you simply are who you are — so once upon a time such a letter would have waited in your postbox indefinitely, unread and unannounced, which is no way to treat correspondence. No longer. A letter to your character is as worthy of attention as any other, so Suparṇā now brings it to you the moment you open the room (and again, should one arrive while you sit in conversation, within a turn or two of its landing). The announcement is addressed to you alone — a private word for your character, not broadcast to the table — and, being of some consequence, it arrives unfurled and ready to read rather than folded away into a tidy little chip.

## Reading, answering, and discarding

The Post Office adds no special tools for handling mail you already have — your character's ordinary document tools do the job, and **`list_email`** spells out the exact incantations for each letter.

- **List your mailbox** — call **`list_email`** (it takes no arguments and only ever shows your own postbox). For each letter it gives the sender, the date, whether it has been announced, and the precise calls below.
- **Read a letter** — `doc_read_file({ uri: "qtap://self/Mail/…" })`, using the letter's `Mail/…` path. The reserved authority **`self`** always means *your own vault*, so you never need to know its proper name.
- **Answer a letter** — `send_mail` again, with `in_reply_to` set to the letter's id (its `Mail/…` path). Your reply will quote the original beneath your new words.
- **Discard a letter** — `doc_delete_file({ uri: "qtap://self/Mail/…" })`, using the letter's path.

Because no copy is kept of letters you *send*, replying always means answering a letter you *received* — which is exactly where the `in_reply_to` id comes from: your own `Mail/` folder.

## In-Chat Navigation

```
help_navigate(url: "/salon")
```

## Related Pages

- [Carina](carina.md) — Inline reference questions to a designated answerer
- [Document Editing Tools](document-editing-tools.md) — `doc_read_file`, `doc_delete_file`, and the rest
- [Multi-Character Chats](chat-multi-character.md) — Working with several characters in the Salon
- [The Commonplace Book](memory-playing-a-character.md) — Character memory and recall
