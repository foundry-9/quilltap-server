---
url: /prospero/:id
---

# Project Characters

> **[Open this page in Quilltap](/prospero)**

Every project keeps a **character roster** — a guest list, if you like, kept by a butler of the old school who admits only those whose names he has been given. The roster does not decide who may *chat* in a project; any character may be invited into any project conversation, and every one of them hears the project's instructions and benefits from its knowledge as a matter of course. What the roster governs is the key to the study and the wardrobe:

- **Project files** — whether a character may open, list, search, write or edit the project's documents *with their own tools* (`doc_read_file`, `doc_list_files`, `doc_grep`, `doc_write_file`, `search_scriptorium`, and their cousins)
- **The shared wardrobe** — whether a character may browse and put on the garments hanging in the project's `Wardrobe/` folders (`wardrobe_list`, `wardrobe_wear`, and the rest of the `wardrobe_*` set)

A character off the roster can still chat perfectly happily. They simply find the study door locked and the project's coat-rack out of reach, and are told so politely should they try the handle.

## The Two Modes

The **Allow Any Character** switch at the top of the project's **Characters** card chooses between them.

### Open House (the default)

**Allow Any Character = ON**

- Every character in a project chat may use the project files and shared wardrobe
- The roster is set aside, and the add/remove controls are tucked away
- New projects begin this way

**Best for:** general-purpose projects, exploratory worldbuilding, and any household where the doors stand open.

### Roster Only

**Allow Any Character = OFF**

- Only the characters on the roster may use the project files and shared wardrobe
- Everyone else may still chat, but their file and wardrobe tools come up empty for this project
- The roster is curated entirely by hand — joining a project chat does **not** put a character on it

**Best for:** campaigns where some characters should not be rummaging through the game-master's notes, stories with secrets kept from part of the cast, and collaborative projects with specific keyholders.

## Managing the Roster

The roster lives on the project's page, in the **Characters** card. Switch **Allow Any Character** off and the controls appear.

### Adding a Character

1. Open the project
2. Expand the **Characters** card
3. Make sure **Allow Any Character** is off
4. Click **Add character**
5. Search for the character by name, then click them to add them
6. Click **Done** when the guest list is complete

Characters already on the roster do not appear in the picker. Archived characters cannot be added until they are rehydrated.

### Removing a Character

1. Find the character's card in the roster
2. Click the small **×** in its corner

The character keeps their chats, their messages and their place in your library. They lose only the key: from their next tool call onward, the project's files and shared wardrobe are closed to them.

### Each Roster Card Shows

- Avatar (or initials)
- Character name
- How many of the project's chats they appear in

Quick-hide rules apply to the roster just as they do elsewhere, so a hidden character may leave the card reading "No visible characters (some may be hidden)."

## What the Roster Does Not Touch

- **Chatting** — any character may join any project chat, roster or no
- **Project instructions** — delivered to every character in a project chat
- **Automatic knowledge** — project knowledge is still offered to every character each turn; only *deliberate* file access by tool is gated
- **What a character is already wearing** — garments already on stay on; a character off the roster simply cannot pick new ones from the project's wardrobe
- **You** — when you dress a character yourself from the Salon's outfit dialog, the project's wardrobe is always at hand, whatever the roster says
- **Group stores, the character's own vault, and Quilltap General** — those follow their own rules and are not project property

## Troubleshooting

### A character says the project files are closed to them

**Cause:** Allow Any Character is off and the character is not on the roster.

**Solution:** Add the character to the roster, or switch Allow Any Character on.

### A character cannot find a garment from the project's wardrobe

**Cause:** the same — the project wardrobe is roster-gated.

**Solution:** Add the character to the roster, or dress them yourself from the Salon's outfit dialog.

### I removed a character, but they still appear in project chats

**Expected.** The roster governs file and wardrobe access, not chat membership. Remove them from the chat itself if you would rather they leave the room.

### The roster is empty and nobody can reach the files

**Cause:** Allow Any Character is off with no one on the roster.

**Solution:** Add the characters who should have access, or switch Allow Any Character back on.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/prospero/:id")`

## Related Pages

- [Projects Overview](projects.md) — Main project documentation
- [Project Settings](project-settings.md) — Configuration options
- [Project Chats](project-chats.md) — Conversations in projects
- [Characters](characters.md) — Character management
- [Multi-Character Chats](chat-multi-character.md) — Group conversations
