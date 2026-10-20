---
url: /salon/:id
---

# The Log

> **[Open this page in Quilltap](/salon)**

Every well-run household keeps a log. Not a diary, mind you, which is a private and rather fretful thing, but the plain ship's-log sort of record: *Tuesday, fog; the silver counted twice; Mr. Fenwick not yet returned.* **The Log** is that book for your Quilltap instance. Characters write a line in it when something deserves remembering by anyone who happens to glance in, and any character, in any chat, may afterwards turn the pages and find it.

It is not the [Commonplace Book](memory.md). Memories belong to one character and are weighed, folded and recalled on their own account. The Log belongs to the whole house: one shared book, every chat, every character, plain lines in order of writing.

## What a line is

- A message of one to four thousand characters.
- Stamped with the time, the chat it was written from, and the character who wrote it. When you run one of the tools yourself from the Salon, the line goes down under the character you ran it as (the first active character, if you did not choose one); it carries no character only when the chat has no character in it at all.
- Written once and never altered. If the facts change, write another line.

## The three tools

Three tools are offered to characters in the Salon, switched on by default:

- **`log_create_entry`** takes a `message` and writes it, stamped as above.
- **`log_grep`** searches every line in the Log with a regular expression (JavaScript syntax), newest first. It takes a `pattern`, an optional `ignore_case`, and a `limit` (50 unless told otherwise, 200 at most).
- **`log_read`** reads the book by any combination of: `conversationId` (`"current"` means this very chat), `character` (a name, any case, or an id), `from` and `to` (ISO-8601 dates or times, both ends inclusive; a bare date such as `2026-10-19` means the whole of that day, reckoned in UTC, so giving the same date for both reads that one day), and `limit`. Given no filters at all, it returns the latest lines from everywhere.

Both reading tools answer with the entries (each with its text, chat, character, character name and time), a count, and the limit applied. The scope is the entire instance, every chat and every character, so a character may read what another wrote in a different story. If that is not to your taste, switch the tools off, as below.

One quirk: during an autonomous-room turn, a line written is not committed until the turn's work lands, so a `log_read` or `log_grep` later in that same turn will not see it. The next turn will.

## Switching it off

In a chat's tool settings (the wrench in the Salon's toolbar) and in a project's tool settings, the three tools sit together under a group called **The Log**. Untick the group, or any one tool, and the character is no longer told it exists. See [Tool Settings](tools-settings.md). The Brahma Console does not offer the Log.

## Custom tools can write to it

A [custom tool](custom-tools.md#writing-to-the-log) may carry a **log** effect: a line of text, with the usual `{{value}}`, `{{roll}}`, `{{character}}`, `{{params.x}}` placeholders, written once the roll is done. In [Pascal's Workbench](pascals-workbench.md) it is the **Log line** kind of side effect. It is a handy way to have a dice-driven event leave a note that other characters can find later.

## How long it is kept

Lines are pruned with the LLM logs: anything older than the retention period in Chat Settings (30 days by default; 0 keeps everything) is swept away by the nightly tidy-up, even if LLM logging itself is switched off. See [LLM Logs](system-llm-logs.md#log-retention--storage). The Log is not included in `.qtap` exports or backups, any more than the LLM logs are.

## In-Chat Navigation

`help_navigate(url: "/salon/:id")`
