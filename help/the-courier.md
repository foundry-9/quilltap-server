---
url: /settings?tab=providers&section=the-courier
---

# The Courier

> **[Open this page in Quilltap](/settings?tab=providers&section=the-courier)**

The Courier is Quilltap's manual transport — a connection profile that does not telephone any LLM provider on your behalf. Instead, when one of your characters comes due to speak, the Courier presents you with a tidy bundle of Markdown: everything Quilltap *would* have wired across the æther, neatly arranged so you may carry it, by hand, to whichever obliging engine you fancy. The reply you receive you simply paste back into Quilltap, and the parlour proceeds as if the message had arrived by ordinary post.

It is, in short, for those occasions when you would rather not give Quilltap your house key — when you'd prefer to chaperone every conversation past the gate yourself.

## Why one might prefer The Courier

- **No API key in this house, thank you.** Use any LLM you can paste into — Claude desktop, the ChatGPT web parlour, a stoic little local model in LM Studio, a friend's account, a free trial. Quilltap need never know.
- **Bring your own ceremony.** If you prefer to read each prompt before it goes, edit it, redact it, route it through three different services and pick the best reply — The Courier hands you the reins.
- **Models Quilltap has never heard of.** The Courier doesn't care which LLM you're using; it merely hands you a Markdown bundle. What you do with it is your own affair.
- **A holiday for your API budget.** Free tiers, browser-only models, and "I already pay for a Pro subscription" are all serviceable destinations for a Courier.

## Setting up a Courier profile

1. Open **Settings** (the gear icon) and select the **Providers** tab.
2. Click **Add Connection Profile**.
3. At the top of the form, set **Transport** to **The Courier (manual / clipboard)**. The form will tighten its sleeves and present you with only the fields a Courier actually needs.
4. Give the profile a **name** that reminds you which destination you intend to carry messages to ("Claude desktop courier", "ChatGPT o3 in the web parlour", "Friday's local Llama", etc.).
5. In **Which LLM will you carry to?**, type whatever you like — it's purely informational. Quilltap doesn't validate or call it; the label appears on the placeholder bubble so future-you remembers which window to switch to.
6. Tick **Set as default profile** if you want every new chat to lean on The Courier by default, or **Mark as cheap LLM** if you intend to use it for housekeeping tasks like memory extraction (be warned: every cheap LLM call will also pause for you to paste).
7. Save.

Once saved, you can attach this profile to any character (per-character default in the character editor) or to any chat participant (in the Participants sidebar of a Salon).

## Taking a Courier-bound turn

When it is the Courier-attached character's turn to speak, the Salon pauses and presents a placeholder bubble in the character's seat:

- The **bundle** appears as a fenced Markdown blob, complete with a **Copy prompt** button. One press whisks the entire bundle to your clipboard.
- Any **attached files** referenced by prior messages are listed as download links, in case the destination LLM accepts attachments and you wish to bring them along by hand.
- A **paste textarea** waits for the reply.
- Two buttons: **Submit reply** carries the paste back into the parlour as the character's spoken turn; **Cancel turn** discards the whole affair and unpauses the chat without a word from the character.

While the bubble waits, the chat is gently paused — Quilltap will not auto-fire the next character's turn until you either submit or cancel.

## What is — and isn't — in the bundle

In the bundle you will find:

- The full system message: the character's manifesto, identity, description, personality, pronouns, aliases, physical descriptions, example dialogues, the chat's roleplay template, project context, and any other instructions Quilltap would normally include.
- The current **scene state** — who is present, what each present character is wearing — exactly as Quilltap's own staff (Aurora and the Commonplace Book) would whisper it.
- Any **Commonplace Book** recall from memory for the responding character.
- The **full conversation** so far, in role order, including system whispers and prior assistant turns.
- A closing instruction telling the LLM whose turn it is and how to respond.

You will **not** find:

- **Tools.** The Courier exposes none of Quilltap's tools, because the external LLM has no way to reach back into the parlour. Your character will not be able to update its wardrobe, search the help library, or modify documents during a Courier turn. (The external LLM may, of course, use whatever tools its own host happens to offer — Quilltap is none the wiser.)
- **Images, in any LLM-readable form.** Attachments are listed as download links so you may save them locally and re-attach in your destination client if it supports the type. Pasting raw image bytes back into the reply is not supported; the reply text is what Quilltap persists.
- **API keys, base URLs, secrets.** The Courier has none of these.

## Delta mode (and the full-context fallback)

By default, a Courier profile arrives in **delta mode**. The first time a character takes a Courier turn in a given chat, you'll receive the full bundle as described above. From the second turn onward, however, Quilltap notices that your desktop LLM has been keeping its own conversation and elects to travel light: you'll be handed only what is *new* since the last reply — the new user message, any Aurora wardrobe whispers, fresh Commonplace Book recall, the Librarian's announcements, and so forth. The system prompt is omitted, since the LLM already knows who it is.

This makes for a markedly shorter bundle on every subsequent turn — particularly welcome for long roleplay scenes where the full prompt would otherwise grow to fortune-teller proportions.

Should your destination LLM lose the thread — a new conversation in the desktop client, an app restart, a switch from Claude to ChatGPT mid-scene — the bubble offers a graceful pivot: the **Use full context** button in the prompt toolbar swaps the displayed bundle to the full version (which Quilltap obligingly kept on hand). Copy that instead, paste it in, and the LLM is restored to its full briefing.

To disable delta mode altogether — perhaps because you switch between clients on every turn — uncheck **Delta mode after first turn** when editing the Courier profile. Every turn will then arrive as a full bundle.

## Some practical notes

- **Don't paste tool calls.** The Courier hasn't told the LLM about Quilltap's tools, so the reply ought to be plain Markdown prose. If you do find yourself pasting JSON, take a moment first; it isn't going anywhere helpful.
- **Reloading is safe.** A pending Courier turn is persisted to the chat — close the tab, reload, come back tomorrow — the bundle and the paste-back textarea will be waiting just where you left them.
- **Multi-character chats.** If several participants share a Courier profile, each one's turn will pause for its own paste-back in sequence. You can also mix Courier-bound and ordinary API-bound characters in the same chat.
- **Memory extraction and danger classification** still fire on Courier turns. If your cheap LLM is itself a Courier profile, you will be asked to paste those, too — most users will prefer a real API-backed profile for the cheap-LLM slot.
- **Token tracking** is naturally absent. The Courier has no usage numbers to record.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=providers&section=the-courier")`
