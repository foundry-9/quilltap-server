---
url: /settings?tab=chat&section=composer-spellcheck
---

# In their own words: impersonated lines, rehearsed

> **[Open this page in Quilltap](/settings?tab=chat&section=composer-spellcheck)**

There is a particular embarrassment known to everyone who has ever taken a character's seat. You know *what* Evangeline would say — you know it precisely, you could sketch it on the back of an envelope — and what arrives under her portrait is nevertheless unmistakably yours: your rhythms, your vocabulary, your fondness for the semicolon. She sounds, for one line, like a person who has been reading your correspondence.

This amenity addresses the matter with the oldest device in the theatre: a prompter's box. You write the line. Before a syllable reaches the room, it is laid before you once more — and, should you ask, Evangeline herself is handed your draft — her own model, her own prompt, her own memory of the evening — and asked to say it as she would actually say it. Nothing is posted until you say so.

It lives in the **Composer** card on the Chat tab in Settings, and has three positions:

- **Never** — the factory setting. Impersonated lines go straight to the room, as typed.
- **Ask each time** — the prompter stands by but keeps his mouth shut. The panel opens on your draft alone; no model is consulted, and no request is spent, unless you press **Restate in their voice**. The presumption is that you are speaking for Evangeline yourself, and **Send as written** is the button that sits in the place of honour.
- **Always restate** — the prompter begins whispering the moment the panel opens, as he did when this amenity was first installed. You may still send your own words as written.

## What sets it off

Precisely one thing: the **Impersonate** button. When you have taken an LLM character's seat — the portrait in the composer is theirs, the Participants drawer says you are driving it — and the setting is anything but **Never**, a typed line goes to the prompter's box first.

It is worth being exact about what does *not* set it off, because the distinction is the whole design:

- **Speaking as yourself never does.** Your own persona, or any seat you have set to *User (you type)* in the participant card's dropdown, is a seat with no voice of its own to consult. Those lines go straight to the room, exactly as they always have.
- **A send carrying only attachments or tool results never does.** There is nothing to restate.
- **A Carina address never does.** A line beginning `@Evangeline:` or `@Evangeline?` is machinery — an instruction to fetch an answer — and a paraphrase of an address is no longer an address. Those go through untouched.
- **Document Mode edits never do.** They travel by an entirely different road.

A small quill badge appears in the corner of the speaking-as portrait whenever the prompter is standing by, and the Send button says which kind of prompter he is when you hover it. Neither of them *does* anything; they are there so that pressing Enter is never a surprise.

## The dialog, and its doors

The panel that opens is the familiar floating sort — drag it by its title bar, tug its corner, and it will remember where it last stood. It holds your draft at the top (still editable) and the voice it would be rehearsed in.

**Before anything is rehearsed** — which, under *Ask each time*, is how the panel always opens — that is all it holds. Four doors:

- **Send as written** posts *your* words, verbatim. It is the primary button, and Cmd/Ctrl+Enter in your draft presses it for you.
- **Restate in their voice** hands the draft to the character. This, and only this, spends a request.
- **Edit original** shuts the panel and returns you to the composer, your draft sitting exactly where you left it, cursor restored.
- **Cancel** changes nothing at all.

**Once a restatement has been asked for** — at once, under *Always restate* — what the character proposes to say appears beneath your draft, and the doors become:

- **Send** posts the proposal. Edit it first if you like — the lower editor is yours, and Cmd/Ctrl+Enter sends from it.
- **Regenerate** asks again. Edits you have made to your draft are carried into the new attempt.
- **Send as written**, **Edit original** and **Cancel**, exactly as before.

**Edit original** and **Send as written** are never taken away from you, not even when the rehearsal fails outright. A provider that has gone dark, a model in a sulk, a refusal: the panel reports it and keeps both doors open. A draft you have taken the trouble to write is never held hostage to a machine that will not answer.

There are also two pickers. The first asks *how* they should say it, and begins on the character's own connection profile — the one their turns already use, which survives the impersonation untouched and is nearly always the right answer. The second appears only when the character keeps more than one system prompt on file. Changing either discards any proposal on screen, since it was spoken in the wrong voice — but it does **not** rehearse afresh on its own. Press **Restate in their voice** when you are ready, so that fiddling with the pickers never costs you a request you did not mean to make.

## What the character is told — and what they are not

This is the part worth reading twice, because it is what separates this from the off-scene rehearsal in the Insert Announcement dialog.

There, a character is told they stand *outside* the conversation and may speak in to it. Here they are **in the room.** They receive their ordinary per-turn briefing: their identity, the scene's roleplay template (so that asterisks and quotation marks land where the rest of the conversation puts them), the house's Taboo list, and any standing instructions the project or their Groups impose. They are shown the last dozen played lines of the conversation — shaped exactly as they would see them on a real turn, which is to say with other speakers named and with nothing whispered past them. A Commonplace Book recall runs against your draft, so what they remember about the matter at hand is in front of them.

Then they are handed your draft and told: it is your turn; this is the substance of what you mean to say; say it as you would say it. Keep the meaning, the addressees, every specific fact, and any dice notation or `@Name` address exactly as written. Say only this — do not continue past it, do not answer it, do not speak for anyone else.

They are given **no tools.** A rehearsal has nothing to fetch, nothing to write, and nothing to roll.

Nothing about the rehearsal is filed anywhere. The proposal is not a message until you send it; the draft you discarded leaves no trace in the chat. The one record kept is the ordinary wire record of the call itself, which you will find in the Almanack's Wire Records — and in the Salon's own LLM inspector — filed under **Voice Rewrite**, should you ever want to know what a fortnight of rehearsals has cost you. The Insert Announcement rehearsal is filed there too; until now both were shelved among the chat summaries, which made the accounting less than candid.

## A caution, stated plainly

**The line is written by a model, and you should read it before you send it.** That is not a disclaimer tucked into the small print; it is the reason the panel exists at all rather than the rewrite simply happening on its way out the door.

A model asked to preserve the substance of a sentence will usually preserve it, and will occasionally not. It may soften a refusal into a maybe. It may name a thing you had deliberately left unnamed. It may take a `2d6+3` you meant Pascal to notice and render it as *a pair of dice and a favour*. The instruction forbids all of this in the firmest terms available, and the instruction is not a guarantee. The proposal in front of you is a proposal; your eyes are the last gate, and the **Send as written** door is there for the evenings when the prompter is simply wrong — or, under *Ask each time*, for the far more numerous evenings when you never wanted his help at all.

Should you find a particular kind of notation reliably mangled, the remedy is a bypass rather than a sterner instruction — tell us, and we shall add it to the list alongside the Carina addresses.

## Related

- [Chat Settings](/settings?tab=chat) — the Composer card, where the setting lives
- [Chat Participants](/chats) — the Impersonate button and what it does to a seat
- [Inserting your own announcements](/salon) — the off-scene cousin of this rehearsal

## In-Chat Navigation

```
help_navigate(url: "/settings?tab=chat&section=composer-spellcheck")
```
