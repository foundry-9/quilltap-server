---
url: /prospero/:id
---

# Project Chats

> **[Open this page in Quilltap](/prospero)**

Project chats are conversations associated with a specific project. They automatically receive project context, including instructions and access to project files, making them ideal for focused creative work.

## What Are Project Chats?

Project chats are regular chats with added benefits:

- **Project Instructions** — Custom instructions are injected into every conversation
- **File Access** — AI can read and search project files
- **Contextual Awareness** — AI knows it's working within a specific project
- **Memory Association** — Memories can be tagged with the project

## Creating Project Chats

### From the Project Page

1. Open the project
2. Find the **Chats** section
3. Click **New Chat** or **Start Chat**
4. Select a character to chat with
5. Chat opens, automatically associated with the project

### From the Characters Page

1. Go to **Characters**
2. Click **Chat** on a character
3. In chat settings, select the project from the dropdown
4. Chat becomes a project chat

### From an Existing Chat

1. Open any chat
2. Open chat settings (gear icon or action menu)
3. Find the **Project** setting
4. Select a project from the dropdown
5. Chat is now associated with that project

## Project Context in Chats

### Automatic Instruction Injection

When you chat in a project, the project instructions are automatically included:

1. Project instructions are prepended to the system prompt
2. Every message in the chat has this context
3. Characters behave according to project rules

**Example:**
If your project instructions say "This is set in a fantasy world with magic," all characters will understand and maintain that context.

### AI File Access

The AI can access project files during conversation:

**Available Actions:**
- **List Files** — See what's in the project
- **Read File** — Get full content of a specific file
- **Search Files** — Find relevant files semantically

**Example Interaction:**

You: "What did I write about the protagonist's childhood?"

AI: *Uses doc_grep to find relevant documents in the project's Scriptorium store*
AI: *Reads the character biography file with doc_read_file*
AI: "According to your character notes, the protagonist grew up in..."

### Project Info Tool

The AI has a dedicated tool for project context:

- **get_info** — Project name, description, character roster, counts, linked Scriptorium store
- **get_instructions** — Full project instructions text

For listing, reading, and searching project files, the AI uses the Scriptorium document tools (`doc_list_files`, `doc_read_file`, `doc_grep`), which operate against the project's linked document store. These are automatically available in project chats.

## Managing Project Chats

### Viewing Project Chats

**From the Project Page:**

1. Open the project
2. Chats section shows associated conversations
3. See title, message count, participants, last updated
4. Click a chat to open it

**From the Chats Page:**

1. Go to **Chats** in sidebar
2. Project chats show a project badge
3. Filter by project if available
4. Click to open any chat

### Identifying Project Chats

Project chats are marked with:

- Project badge/icon in chat list
- Project name in chat header
- Project indicator in chat settings

### Removing a Chat from a Project

1. Open the chat
2. Go to chat settings
3. Find the Project dropdown
4. Select "None" or clear the selection
5. Chat is no longer associated

**Note:** The chat itself is preserved — only the project association is removed.

## Multi-Character Project Chats

Project chats fully support multi-character conversations:

### All Participants Get Context

- Every character in the chat receives project instructions
- All participants can access project files
- Project context is shared across the conversation

### Character Roster

If the project uses roster mode:

- Only roster characters can be added
- Characters are auto-added to roster when they join
- See [Project Characters](project-characters.md) for roster details

### Turn Management

Standard turn management applies:

- Turn manager controls speaking order
- Talkativeness, nudge, and queue work normally
- See [Turn Manager](chat-turn-manager.md) for details

## Project Chats vs. Regular Chats

| Feature | Project Chat | Regular Chat |
|---------|--------------|--------------|
| Project instructions | Automatically included | Not available |
| Project file access | Full access via tools | Not available |
| Memory tagging | Can be project-tagged | No project association |
| Character restriction | Roster mode available | Any character |
| Organization | Grouped by project | General list |

## Best Practices

### For Worldbuilding Projects

- Keep world bible as project files
- Use instructions to establish key rules
- Create chats for exploring specific topics
- Let characters reference lore documents

### For Writing Projects

- Upload outlines and notes as files
- Use instructions for style/tone guidance
- Create chats for character development
- Reference plot documents during writing

### For Roleplay Campaigns

- Define campaign setting in instructions
- Add session logs as project files
- Use roster to control character access
- Create chats for different scenes or sessions

### General Tips

- Start with clear project instructions
- Add relevant files before chatting
- Let the AI discover files naturally
- Update instructions as project evolves

## Troubleshooting

### AI not using project context

**Causes:**
- Chat not properly associated
- Project info tool disabled
- Instructions not saved

**Solutions:**
- Check chat settings for project association
- Verify project info tool is enabled
- Re-save project instructions
- Try asking AI to check project files

### Character can't join project chat

**Causes:**
- Roster mode enabled
- Character not in roster
- Character configuration issue

**Solutions:**
- Add character to project roster
- Or enable "Allow Any Character"
- Check character has valid connection profile

### Project files not accessible

**Causes:**
- No files in project
- Files not indexed
- Tool access issue

**Solutions:**
- Add files to the project first
- Wait for file indexing to complete
- Check tool settings allow file access

### Chat showing wrong project

**Causes:**
- Recently changed association
- Display not updated
- Multiple similar chats

**Solutions:**
- Verify in chat settings
- Refresh the page
- Check you're in the correct chat

### Instructions not affecting responses

**Causes:**
- Instructions too long/truncated
- Instructions unclear
- Character overriding project context

**Solutions:**
- Keep instructions focused and concise
- Use clear, direct language
- Ensure character prompts don't conflict

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/prospero/:id")`

## Related Pages

- [Projects Overview](projects.md) — Main project documentation
- [Project Files](project-files.md) — File management
- [Project Characters](project-characters.md) — Character roster
- [Project Settings](project-settings.md) — Configuration options
- [Chats Overview](chats.md) — General chat functionality
- [Multi-Character Chats](chat-multi-character.md) — Group conversations
