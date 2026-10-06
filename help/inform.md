---
url: /salon
---

# Informing the cast

An announcement is *said.* An inform is *known.*

There are moments when a character ought to be in possession of a fact without anyone having gone to the trouble of stating it aloud. She has noticed that the clock has stopped. He has remembered, rather too late, where he has seen that face before. The letter went into a sleeve, and she saw it go. None of this is dialogue. None of it belongs in a bubble. It is simply the furniture of a mind, and until now the only way to install it was to say it out loud and hope the company had the tact to pretend they hadn't heard.

The **Inform** button — the small *i* in the composer's left gutter, keeping company with Pascal — is the instrument for such occasions.

## What it does

Click it and a floating panel appears: wide enough to hold the whole formatting rail without the buttons wrapping, draggable by its title bar, resizable at the corner, and disposed to remember where you last left it. Choose who is to be informed. Write a short passage. Press **Inform**.

Each character you named receives that passage — *your words exactly*, beneath a single line of introduction — as the very last thing they read before they next open their mouth. And then it is spent, for them, forever. (Unless you tell it to stay. See [Keeping it standing](#keeping-it-standing-in-this-chat).)

Three properties are worth committing to memory, because everything else follows from them.

**It is never spoken.** The passage goes to the model as a private note, not as a line in the scene. Nobody hears it. Nobody can quote it. It is not a message and it never becomes one.

**It is verbatim, and it is vouched for.** Your words arrive untouched. The House sets exactly one line above them, and that line says only this: *these things are true, you already know them, and where they quarrel with an older memory or something in your records, they win.* There is no anxious little rider about not mentioning it to the others, and no Staff member clears their throat. The vouching line is there because a bare sentence, however true, is easily out-argued — a character who has just recalled forty memories to the contrary will otherwise trust the forty. What you typed is still what arrives, which is why *how* you write it matters rather more than usual. See the next section.

**It is consumed, not standing — unless you say otherwise.** Once a character has actually taken their turn, the note is gone from their next one. An inform steers a moment; it does not become a house rule. If you want something to stay, tick the box described below, and it will stay — but only in this conversation.

## Write it to them, in the second person

The passage is delivered inside the character's own prompt, at the tail of it, where the House ordinarily addresses them directly about the moment at hand. Write it the way that place reads:

> You see that Alice slipped the letter into her sleeve.

> You remember that Bob and Carol were at school together.

Not *"Tell Alice about the letter"* — that is an instruction to a machine, and it will be followed like one. Not *"Alice slipped the letter into her sleeve"* — a bare third-person statement sits ambiguously between narration and stage direction, and a model asked to interpret it may simply narrate it back at you.

If the news overturns something the character firmly believes, say so outright rather than leaving them to reconcile it. *"You and Charlie found a way to make more Tessarium; the old 'last ingot' limit no longer holds"* carries the day where *"The hull will be re-plated in Tessarium"* may be met with polite, well-sourced disbelief. And if the fact is meant to outlive this conversation, it belongs in the Commonplace Book as a memory, not only on the mantelpiece.

And be mindful when you inform several characters at once. Everyone you tick receives the **identical words**. If the passage is true from Alice's chair but nonsense from Bob's, you want two informs, not one.

## Choosing who is told

The panel offers **Everyone** — the default — followed by a chip for each LLM-controlled character in the chat.

Characters you are playing yourself do not appear. You already know what you know; there is no seat there to inform.

Silent and absent characters *do* appear, and may be informed. They will collect the passage whenever they next take a turn, however long that is. Impersonating a seat changes nothing: an impersonated character is still LLM-controlled, and delivery waits for their next genuine generation.

Tick every character individually and Quilltap treats it as Everyone. The distinction that follows is about who was actually covered, not about how you happened to click.

## Keeping it standing in this chat

At the foot of the panel, beside the buttons, sits a modest checkbox: **Keep it standing in this chat.** It is unticked every time the panel opens, and an ordinary inform is the one-shot affair described above.

Tick it, and the passage stops being a note fed to the fire and becomes a card propped on the mantelpiece. Every character you named receives it on **every** turn they take in this conversation from now on — the same words, in the same place, last before they speak — until you withdraw it. Taking a turn does not spend it. Passing does not spend it. A swipe of an earlier line carries it too, for a standing note is in force for every prompt made while it stands.

The emphasis on *this chat* is not decorative. A standing inform belongs to the conversation in which you wrote it and nowhere else:

- It does not alter the character. Their personality, manifesto and system prompts are untouched.
- It does not follow the character into any other chat, nor into a new one you start tomorrow.
- It does not travel through a merge or a continuation.
- It does not become a memory.

If you find yourself wanting the same standing note in every conversation a character has, that is a sign it belongs in the character proper — their personality or a system prompt — rather than on the mantelpiece of one room.

When a character has standing notes and an ordinary one waiting at once, the standing notes come first and the fresh one follows, divided by the usual rule.

## The record in the transcript

Every inform leaves a note in the conversation, authored by The Host, carrying exactly the words you wrote. Its chip reads *out of character.*

If you informed the entire company, the record is public. If you informed a subset, it is whispered to those characters — and the chip names them, *to Alice, Bob*, so you can tell the two apart at a glance without expanding anything.

Either way, **the record never reaches a model.** Not the characters it names, not the ones it doesn't, not the summariser, not the title-writer, not the Courier. It is bookkeeping, kept so that you can look back in a month and see what you told whom. The delivery has already happened elsewhere, and a record that also reached the models would simply say everything twice, to everybody, for the rest of the conversation.

Nor does it become memory. The passage is not a message, so the turn's memory extractor never sees it; the record is a Staff note, and those are skipped as a matter of course. An inform steers a scene without quietly rewriting anybody's past.

## Before it is collected

While a character still has an inform waiting, a small chip sits above the composer — *Informing Alice, Bob before their next turn* — with the first line of the passage on hover. Press its **×** to call the whole thing back.

A standing inform has a chip of its own that never clears by itself: *Informing Alice, Bob on every turn in this chat.* That chip is the only way to see which notes are standing, and its **×** is the only way to take one down. Withdraw it and it is gone for every character it named, from their very next turn.

Cancel before anyone has collected it and the record goes too; it would be an odd sort of archive that documented something which never happened. Cancel after some of the company have already had it, and the record stays (it is now true) while the characters still waiting are quietly struck off the list. A standing note withdrawn after it has been delivered even once likewise keeps its record — the transcript ought to show what was in force while it was.

Post two informs to the same character before she speaks and she gets both, in the order you wrote them, separated by a modest horizontal rule. They stack; they do not overwrite.

## The finer points

**If a character passes,** declining the floor with nothing to add, the passage stays pending. It waits until she actually says something. Information owed is not information delivered.

**If the connection falls over** before anything is saved, likewise: nothing was delivered, so nothing is spent, and the next attempt carries the same note.

**Regenerating or swiping** a line re-applies whatever that line's generation saw, so the re-roll is judged on the same information as the original. A *new* inform, posted since, deliberately stays out of it — it was written for the character's next turn, not for a second attempt at her last one.

**Autonomous rooms** receive informs exactly as the Salon does. The next chained turn collects them, and the chip clears when the run's job completes.

**Carina does not hear them.** An inline `@Name:` query builds its own small, fresh call and does not carry the scene's pending informs.

**A merge does not carry them.** Pending informs belong to the conversation they were written in. Merge or continue a chat and any uncollected notes stay behind; post them again in the new conversation if they are still wanted.

## See also

- [Inserting your own announcements](/salon) — for when the room genuinely should hear it. An announcement is said; an inform is known.

## In-Chat Navigation

```
help_navigate(url: "/salon")
```
