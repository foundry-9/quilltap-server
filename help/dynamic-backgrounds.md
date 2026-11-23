---
url: /settings?section=dynamic-backgrounds
---

# Dynamic Backgrounds

> **[Open this page in Quilltap](/settings?section=dynamic-backgrounds)**

The house has, by now, commissioned a good many pictures on your behalf — backdrops for every scene the Lantern has lit, portraits from every sitting Aurora has arranged. **Dynamic Backgrounds** takes them down from the attic and hangs them where they can be admired: a collage behind the home parlour, behind each project, and behind each character, rehung with a fresh arrangement every few minutes.

It is an instance-wide setting, and it pays no attention to which theme you are wearing.

## Where the Collages Hang

| Page | What it is made of | How it is arranged |
|---|---|---|
| **Home** | Every story background in the house | Rows |
| **A project** | The story backgrounds painted for that project's chats — including chats moved into it after their backdrops were painted | Rows |
| **A character** | That character's avatar sittings (the **Avatar Rolls** in Aurora) | Columns |

The pictures are set edge to edge with no gaps between them. Each keeps roughly its own proportions, so the tiles differ in width (in rows) or height (in columns), but every row is the same height and every column the same width. A wall shaped differently from the collage — a tall, narrow window, say — trims a little off the outermost pictures rather than squashing anything.

A collage needs **at least three different pictures**. With fewer, the page shows whatever it showed before: a project its own background setting, a character and the home parlour the theme's walls. A small pool is repeated to fill the wall, though never with the same picture twice in a row.

On a project page, a collage wins over the project's own **Story Backgrounds** display mode whenever there is one to show; switch Dynamic Backgrounds off, and the project's own choice is in charge again. The same courtesy is extended to the theme: should the theme you are wearing paper the whole house with a background of its own, the collage takes precedence over it on the home parlour, a project and a character alike, and the theme's paper returns the moment there is no collage to hang. A conversation with a background of its own still wins the whole screen when it sits beside one of these pages in a split workspace.

Only the page you are looking at is rehung. A tab tucked away behind another keeps its walls as they were until you return to it.

## The Three Settings

Open **Settings → Appearance → Dynamic Backgrounds**.

1. **Dynamic backgrounds** — the master switch. Off by default.
2. **Allow uncensored images** — off by default, and offered only while the switch is on. With it off, any picture drawn at the Concierge's uncensored desk is kept out of every collage.
3. **Minutes between changes** — how long each collage hangs before another replaces it: anywhere from 1 to 120 minutes, three by default. Type a number and press Enter, or click away, to save it.

## What "Uncensored" Means Here

A picture painted since Quilltap 4.14 remembers which studio painted it — the same record that puts the red **Uncensored** badge on it in every gallery (see [The Concierge](the-concierge.md#the-uncensored-badge-on-pictures)). Any picture with that badge is left off the walls unless you allow uncensored images; so is a picture sharing its very bytes with one that wears it.

Pictures painted **before 4.14 carry no such record**, and the house must guess. Such a picture is left out when a chat it belongs to is **Unmoderated** at present, or was ever flagged by the Concierge's classifier; otherwise it is hung. The guess can be wrong in both directions — a respectable picture from a chat that later went astray stays in the back room, and an immodest one from a chat that never caught the Concierge's eye may make it onto the wall. If you would rather not take the chance, leave Dynamic Backgrounds off, or keep an eye on the walls for a while.

## A Few Particulars

- The collage is assembled fresh on each change and is never stored: it appears in no gallery, export or backup, and nothing about your pictures is altered.
- The collage sits behind everything as decoration; the usual veil over the backdrop keeps the text in front of it legible.
- Turning the setting off takes the collages down at once.

## In-Chat Settings Access

Characters with help tools enabled can read these settings during a conversation using the `help_settings` tool with `category: "appearance"`. Ask a help-tools-enabled character something like "Are dynamic backgrounds on?" and it will look.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?section=dynamic-backgrounds")`

## Related Topics

- [Appearance Settings](appearance-settings.md)
- [Story Backgrounds](story-backgrounds.md) — where the home and project pictures come from
- [Character Gallery](character-gallery.md) — the Avatar Rolls a character's collage is made of
- [The Concierge](the-concierge.md) — the Uncensored badge and the three postures of a chat
