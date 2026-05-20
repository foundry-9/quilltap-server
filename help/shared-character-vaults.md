---
url: /salon/:id
---

# Shared Vaults — Letting Characters Peek at Each Other's Dossiers

> **[Open this page in Quilltap](/salon)**

Every character in Quilltap carries a private vault — a character document store where the dossier, notebooks, and assorted keepsakes are filed away. By default that vault is a closed drawer, opened only by the character it belongs to (and by any project that has explicitly linked the store in for wider perusal). The **Shared Vaults** toggle, new to the Salon, cracks that drawer open just a little — strictly for reading, never for writing — so that the other characters sitting at the same table may consult each other's papers.

## What the Toggle Does

When Shared Vaults is **on** for a multi-character chat:

- **Every present participant** — that is, any character with status *active* or *silent* — becomes a legal reading destination for the `doc_*` tool family.
- Friday, chatting alongside Amy, may now reach into Amy's vault with `doc_read_file`, `doc_list_files`, `doc_grep`, `doc_read_frontmatter`, `doc_read_heading`, `doc_read_blob`, and `doc_list_blobs` exactly as though the vault were her own.
- The access is **read-only.** Any attempt by Friday to rewrite, rename, delete, or otherwise molest Amy's papers is turned away at the door with a polite but firm *"Amy's vault is read-only in this chat."*
- The **results** of those vault reads are posted publicly: every character at the table sees what was read, and the contents enter each character's LLM context on subsequent turns.

When Shared Vaults is **off** — which is, by genteel default, how every chat starts — the previous arrangement holds: each character may only consult her own vault plus anything linked into the active project. In addition, the **results** of those vault reads are whispered to the calling character only (with the operator copied in, so you still see what's happening). Peer characters' LLM contexts never receive the body of the lookup. A character reaching into her own vault for a private memo will not have that memo silently broadcast to whoever else is in the chat.

## Always-Private Tools

Two tools are treated as inherently per-character and **always whisper their results** regardless of the Shared Vaults setting:

- **`search`** — the unified search across memories, past conversations, documents, and knowledge. Memories and conversation history are character-scoped by their very nature, so a `search` result could always reveal another character's private recollection; the whisper closes that channel unconditionally.
- **`read_conversation`** — renders a transcript of a chat. The caller must already participate in the chat being read, but other characters in the *current* chat have no business overhearing that transcript on its way through.

If a character wants to share what she found, she can quote it back in her own narration; what we prevent is the silent, byte-for-byte injection of one character's lookup into another character's prompt.

## Where to Find It

The toggle lives in the chat header, just to the left of the familiar **All Whispers** switch. It is only rendered in multi-character chats, because in a solo chat there are no peers for any vault to share with.

- Flip it **on** to share. A toast announces, *"Shared vault reads enabled — characters may peek at each other's dossiers."*
- Flip it **off** to lock up again. *"Shared vault reads disabled — each character is once more a closed book."*

The setting is per-chat and persists across reloads. A chat may have the door open while its neighbour keeps hers shut.

## When to Use It

Consider turning Shared Vaults on when:

- **You'd like characters to react to one another's established traits.** If Amy's `personality.md` says she flinches at loud noises, Friday — with Shared Vaults on — can consult that file and react accordingly when a thunderclap strikes, instead of having to be told.
- **You're running a scene where in-world knowledge is shared.** Roommates, colleagues, co-conspirators: characters who would plausibly already know one another's tendencies benefit from being able to read (say) each other's `background.md`.
- **You're testing consistency across characters** and want each one to be able to compare notes on whatever is filed under the others' names.

Consider leaving it off when:

- **Secrecy is part of the scene.** A chat meant to surface what one character *doesn't* know about another loses its point if every vault is an open book.
- **You haven't yet vetted the other characters' vaults** for contents you'd rather not have a stranger thumbing through. The toggle is a blunt instrument — it opens *all* present participants' vaults at once, not a selected subset.

## Read-Only Is Meant Read-Only

The boundary is enforced in two coordinated places:

- **Reads** flow through an expanded accessible-mount-points set when the toggle is on, which is why peer vaults become reachable at all.
- **Writes** — including file edits, deletes, renames, folder operations, and blob writes — continue to see only the acting character's own vault plus any project-linked stores. If a write addresses a mount point that belongs to a peer participant, the operation is rejected up front with a clear message naming the owner, so the model does not waste a turn on a doomed attempt.

This means you may use Shared Vaults as freely as you like without worrying that one character's clumsy edit will scribble in another character's book.

## Related Pages

- [Multi-Character Chats](chat-multi-character.md) — How characters share a chat in the first place
- [Document Editing Tools](document-editing-tools.md) — Details of the `doc_*` tool family
- [Mount Points](mount-points.md) — How vaults and document stores are configured
- [Chats Overview](chats.md) — General chat settings and state

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon/:id")`
