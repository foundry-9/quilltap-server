---
url: /files
---

# Using Files with AI

> **[Open this page in Quilltap](/files)**

Learn how to give your AI access to files and have it work with your file library.

## Overview: Files and AI

The AI in your chats reads, writes, and searches files through the **Scriptorium** — Quilltap's encrypted document-store system. The older `file_management` tool has been retired; in its place, characters use a family of **`doc_*` tools** that work directly against a project's linked document store or a character's own vault.

With these tools, the AI can:

- **Reference files in conversations** — "Look at this document"
- **Analyze files** — "Summarize this PDF"
- **Create and edit files** — "Write results to a file", "Replace this phrase with that one"
- **Organize files** — "Create folder X and move these notes into it"
- **Extract information** — "Find all mentions of X in my research files"

## How AI Accesses Files

### File Scope

The AI's access depends on which document stores are linked to the chat's context:

**Project Document Store** — Available in any chat attached to the project

- When a project is linked to a store, every character in that project's chats can list, read, search, and (with permission) write files in it
- Story backgrounds, character avatars, and uploaded documents all land here

**Character Vault** — The character's private document store

- Each character can have its own vault, readable and writable by that character in any chat it joins
- Contains the character's prompts, scenarios, wardrobe, and personal notes

**Peer Vaults (read-only, opt-in)** — In multi-character chats

- When the chat's "Shared Vaults" toggle is on, characters can read each other's vaults
- Writes are always scoped to the acting character's own vault

### Requesting File Access

**In your chat:**

You can ask the AI to work with files:

- "Can you read the research document?"
- "Find everything in my notes about the protagonist's childhood"
- "Create a summary file with your analysis"
- "List the files in the Scenarios folder"

**AI responds:**

If the AI needs to write or change something:

1. AI explains what it wants to do
2. Calls the appropriate `doc_*` tool
3. You see the result (or error) in the chat
4. For destructive operations, the AI will usually describe the plan first and wait for your go-ahead

## Available Document Tools

The AI has a full document-editing toolkit. See [Document Editing Tools](document-editing-tools.md) for the complete reference.

**Reading and searching:**

- **`doc_list_files`** — List files in a document store or folder
- **`doc_read_file`** — Read the full content of a text file
- **`doc_grep`** — Search across files for matching text
- **`doc_read_frontmatter`** — Read YAML frontmatter from a markdown file
- **`doc_read_heading`** — Read a specific heading's section from a markdown file

**Writing and editing:**

- **`doc_write_file`** — Create or overwrite a file
- **`doc_str_replace`** — Find and replace exact text (must match uniquely)
- **`doc_insert_text`** — Insert text at a specific position
- **`doc_update_frontmatter`** — Update a single frontmatter field
- **`doc_update_heading`** — Replace content under a specific heading

**Organizing:**

- **`doc_move_file`** / **`doc_delete_file`** — Move, rename, or delete a file
- **`doc_create_folder`** / **`doc_delete_folder`** — Manage folder structure

## Project Context

The `project_info` tool gives the AI a quick overview of the current project:

- **`get_info`** — Project name, description, character roster, file/chat/memory counts, and the name of the linked Scriptorium store (if any)
- **`get_instructions`** — Full project instructions text

For everything else (listing, reading, searching files), characters reach for the `doc_*` tools directly against the project's store.

## Working with Files in Chats

### Analyzing File Content

```
User: "Can you review the character descriptions in my Characters folder?"

AI: "I'll have a look. Let me list what's in there first."
[Calls doc_list_files]

AI: "I found three files: alice.md, bob.md, charlie.md.
I'll read each one and give you feedback."
[Calls doc_read_file three times]

AI: [Provides analysis]
```

### Creating Files from Chat

```
User: "Summarize our conversation and save it as a file"

AI: "I'll draft a summary and file it as
     'conversation-summary.md' in the project store."
[Calls doc_write_file]

AI: "Done. The summary is now at /conversation-summary.md."
```

### Finding Information Across Files

```
User: "Where did I write about the healing system?"

AI: [Calls doc_grep with query "healing"]
AI: "Three hits — two in magic-system.md and one in
     session-notes-03.md. The design doc has the fullest
     treatment; I'll read that section for you."
[Calls doc_read_heading with heading "Healing"]
```

## Troubleshooting

**AI says a file isn't accessible:**

- Confirm the chat is in a project, and the project has a linked document store (Project > The Scriptorium)
- For character vaults, confirm the character has a linked document store in its Aurora edit page
- For peer vaults, confirm the chat's "Shared Vaults" toggle is on

**AI can't find a file it wrote earlier:**

- Check the actual path it reported — characters sometimes write to a folder that turns out to be wrong; ask the AI to `doc_list_files` and verify

**Writes are failing:**

- Confirm the target is the acting character's own vault or a project-linked store (peer vaults are read-only even when shared)

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/files")`

## Related Topics

- [The Scriptorium](scriptorium.md) — Document stores, how they work, how to link them
- [Document Editing Tools](document-editing-tools.md) — Full `doc_*` tool reference
- [File Management](files.md) — Browse and manage files
- [Uploading Files](file-uploads.md) — Add files to system
- [Chats](chats.md) — Work with files in conversations
- [Tools Usage](tools-usage.md) — How tools work in chats
