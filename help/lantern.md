---
url: /prospero
---

# The Lantern — Announcing Generated Images to Characters

The Lantern produces three distinct flavors of picture during your salon session: the atmospheric backdrop projected behind the chat, the per-character avatar that keeps pace with wardrobe changes, and any image conjured by a character's own use of the `generate_image` tool. By default these images appear in the UI but pass entirely unnoticed by your characters — they cannot refer to them, react to them, or remark on the likeness of their new attire.

The **Announce Lantern Images to Characters** setting changes that. When enabled, each successful generation drops a polite announcement into the chat — a proper ASSISTANT-role message with the picture attached as a thumbnail — so every character present may behold the image on their next turn. Vision-capable providers see the image itself; other providers see the announcement text and can reference it.

## What characters see

- **A new background** — "The Lantern has projected a new backdrop behind the proceedings..."
- **A new avatar** — "The Lantern has thrown up a fresh likeness of {character name}..."
- **A character-requested image** — "The Lantern, acting upon the instructions of {requester name}, has produced the following picture..."

Each announcement carries the generated file as an attachment. Click the thumbnail in the chat to open the standard full-screen viewer. On the character's next turn, the image is forwarded to vision-capable models alongside the recent conversation, so the character may actually look at it and respond accordingly.

## Where the setting lives

The toggle exists at two levels, and they work the way project defaults always do:

- **Project default** — `/prospero/{id}`, Image Generation card, *Announce Lantern Images to Characters*. Choose **Announce to characters**, **Keep silent**, or **Inherit from global** (the global default is silent).
- **Per-chat override** — inside any chat, open the Chat Settings modal and pick *Announce to characters*, *Keep silent*, or *Inherit from project*.

A chat-level override always wins. If both the chat and the project defer to inheritance, the global default applies, which is silent.

## When to use it

Enable it when you want your characters to be aware of visual context — for instance, when a character's outfit has just been visibly updated by the sidebar, when the Lantern has rendered a new setting you'd like the narrator to describe, or when one character has summoned an image for another to examine. Leave it off for chats where you'd rather the images remain purely for the reader's benefit.

## In-Chat Navigation

```
help_navigate(url: "/prospero")
```
