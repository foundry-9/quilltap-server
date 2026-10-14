---
url: /salon/new
---

# The Scenario Builder — Asking the Host to Set the Scene

> **[Open this page in Quilltap](/salon/new)**

There are evenings when one knows precisely where the story ought to begin — *the Gare du Nord, a March morning in 1926* — and simply cannot face writing the paragraph that puts one there. For such evenings the Host keeps himself available. Tell him where and when, and he will go off, make his enquiries, and return with a scene set and ready: the light, the weather, the noise from the platform, what has just happened and what is about to.

## Where to Find Him

Wherever scenarios are written or chosen there is a small button bearing the Host's likeness: **Ask the Host to set the scene**. You will find it in five places:

- **On the new-chat form** (in its own page at `/salon/new`, and in the new-chat dialog that opens within the workspace), on the same line as the **Starting Scenario** label.
- **In an open chat**, in the **Chat Sidebar**'s **Chat** drawer, beneath the **Scenario** picker and its **Show archived** box.
- **On the General Scenarios page** (`/scenarios`), beside **+ New scenario**.
- **On a project's page**, in its **Scenarios** card, beside **+ New scenario**.
- **On a group's page**, in its **Scenarios** card, beside **+ New scenario**.

The first two set the scene for a particular chat. The last three are for stocking the shelves: there is no chat to put the scene into, so the Host brings it back only to be filed (see *Called to a Shelf*, below).

## The Four Questions

The Host asks four things, and only four:

- **Real or in-world?** Is the place to be found on an ordinary map, or does it belong to a world of your own devising? This decides where he goes looking (see below).
- **Location** — the place itself. *The Lantern Inn at Vey's Crossing*, *the reading room of the British Museum*, *the bridge of the* Aldebaran.
- **Time** — the moment. *An autumn evening, 1927*; *now*; *the third day of the siege*. "Now", "tonight" and "this morning" are understood against the present date and hour.
- **Further details** (optional) — anything else he ought to know: the mood, the weather, what has just happened, how long a scene you would like. Should you have views on tone or length, this is where to air them.

Beneath these sits the **Model** drop-down, which chooses the connection profile that does the actual legwork. Your default profile is chosen for you. Profiles with tool use switched off appear, but cannot be selected, since the Host cannot make a single enquiry without his tools.

## Where He Looks

**In-world** places are researched entirely from your own document stores — and only those this company could see in the chat you are about to begin: the character vaults of everyone you have cast (your own persona's included), the stores of every group any of them belongs to, the stores of the chosen project, and the household shelf, **Quilltap General**. He searches them (documents and `Knowledge/` folders alike) and reads what he finds. He never consults the wider world for an in-world place, and he never reads anyone's memories or past conversations.

Called from a shelf, there is no cast yet, so the Host reads the stores that shelf belongs to: from the General Scenarios page, **Quilltap General** alone; from a project's card, that project's stores and Quilltap General; from a group's card, that group's own store, the stores linked to it, and Quilltap General. From a project or a group he assumes an in-world place unless you say otherwise; from the General page, a real one.

**Real** places are researched on the web — he runs searches, and reads pages where the **curl** plugin permits — *and* in the same stores an in-world run would read, in case you have already written something about the place yourself.

## When the Wider World Is Out of Reach

Should you choose **Real** on a profile that may not search the web, or on an instance with no search provider engaged, the dialog says so plainly before you begin. The Host will still go — he simply makes do with what he already knows and with your stores, and where he is unsure of a particular he keeps the scene general rather than invent it.

To put the web within his reach:

1. Install and configure a search-provider plugin (or supply a search API key) — see [Plugins](plugins.md).
2. Tick **Allow web search** on the connection profile you mean to use — see [Connection Profiles](connection-profiles.md).

## He Leaves the Company Out of It

The scene the Host returns never names, counts, or describes the people who will be present, and contains no `{{char}}` or `{{user}}` placeholders. It is written in the present tense and addressed to no one: the place, the time, the weather, the sounds, what is afoot. Even when a character's vault describes that character in loving detail, he reads it for the *world* — the town, its customs, its history — and leaves the character out.

This is deliberate, and it is what makes a built scene worth keeping: one that says nothing about who is in the room can be filed among your general or project scenarios and handed to any company at all.

He aims for about a thousand tokens or fewer — a paragraph or two is usual — though if the details ask for more or less, he obliges.

## Watching Him Work

While he is out, the dialog shows a running account of his enquiries — *Consulting the wider world about…*, *Leafing through the stores for…*, *Opening…* — each line settling to a tick or a cross as the answer comes back. Models that think aloud show their reasoning beneath. **Stop** calls him back at once and returns you to where you were — your four questions just as you left them, or your draft untouched if he was out on a revision; closing the window mid-errand does the same, and no further enquiries are made.

## Revising the Draft

When he returns, the scene appears in an editor of its own. Amend it by hand as freely as you like. Or tell him what to change in the **Revise** box — *make it raining, and two hours later* — and press **Revise**: he goes round again with your current draft and your instruction, and brings back the whole scene revised. Should a revision miscarry, your draft is left exactly as it was.

## Using It, and Keeping It

- **Use this scene** puts the text into the custom scenario box and closes the dialog. On the new-chat form it replaces any scenario you had picked from the drop-down, and **Create Chat** sends it exactly as though you had typed it yourself. In an open chat it appears in the **Custom...** box, and you press **Change scenario** to make it so — whereupon the Host announces the revision to the room in the usual way.
- **Save as scenario…** files the scene for another day. Give it a name (and, if you like, a description), then choose its home:
  - **Quilltap General** — available to every chat.
  - **Project: …** — when a project is chosen.
  - **Group: …** — any group one of the cast belongs to.
  - ***Someone*'s scenarios** — one cast character's own collection.

  After a save, the picker switches to the newly filed scenario wherever that picker can offer it (a character's own scenarios are offered only when exactly one AI character is cast); otherwise your text stays in the custom box. Saving does not close the dialog, so you may still **Use** the scene afterwards. A name already taken is refused with a note, and the save window stays open for you to choose another.

## Called to a Shelf

Summoned from the General Scenarios page, or from a project's or group's **Scenarios** card, the Host's dialog has no **Use this scene** — there is no chat awaiting it — and **Save as scenario…** takes its place as the principal button. Here the save window offers *every* home a scenario may have, not merely those one chat could reach:

- **Quilltap General**;
- every **Project**;
- every **Group**;
- every character's own scenarios (archived characters excepted, since they take no new ones).

The home you came from is chosen for you — General from the General page, the project from its card, the group from its card — and you may change it to any other. The shelf you called him from refreshes after each save, and the dialog stays open, so you may revise the scene and file a variation elsewhere before pressing **Close**.

Nothing about a run is kept on the server: no chat is created, and no messages are written. The only record is the line in the LLM logs, marked **Scenario Builder**.

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/new")`

## Related Pages

- [General Scenarios](general-scenarios.md) — The household collection of scenarios.
- [Project Scenarios](project-scenarios.md) — Scenarios kept with a project.
- [Groups](groups.md) — Groups, and the stores and scenarios they keep.
- [Chats Overview](chats.md) — Starting a chat and changing its scene.
- [The Brahma Console](brahma-console.md) — Another tool-using assistant, for the operator's own questions.
