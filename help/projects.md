---
url: /prospero
---

# Projects Overview

> **[Open this page in Quilltap](/prospero)**

Projects are optional organizational containers that group files, chats, and characters together to provide focused context for your AI conversations. They help you compartmentalize different creative works, worldbuilding efforts, or collaborative stories.

## What Are Projects?

Projects are workspaces that:

- **Organize Content** — Group related chats, files, and characters together
- **Provide Context** — Inject project-specific instructions into all conversations
- **Focus AI Attention** — Give the AI access to relevant reference materials
- **Control Participation** — Optionally restrict which characters can participate

Think of projects like folders for your creative work, but smarter — they actively help the AI understand the context of your conversations.

## When to Use Projects

### Good Use Cases

- **Novel or Story Series** — Keep all chats, notes, and character interactions for a specific work together
- **Roleplay Campaigns** — Organize campaign settings, character rosters, and session logs
- **Worldbuilding** — Collect lore documents, character profiles, and exploratory conversations
- **Research Topics** — Group related discussions and reference materials
- **Character Development** — Focus on developing specific characters with relevant background

### When You Might Not Need Projects

- **Casual Conversations** — Quick chats that don't need persistent context
- **One-off Interactions** — Single-use conversations with no related materials
- **Testing Characters** — Trying out new characters before committing to a project

Projects are entirely optional — you can use Quilltap's full functionality without ever creating one.

## Creating a Project

### Basic Creation

1. Click **Projects** in the left sidebar
2. Click **Create Project** or **+ New Project**
3. Enter a project name (required)
4. Optionally add a description
5. Click **Create**

Your project is now ready to use.

### Project Properties

When creating or editing a project:

**Name** (required)
- Display name for the project
- Maximum 100 characters
- Shown in sidebar, project cards, and chat headers

**Description** (optional)
- Brief summary of the project's purpose
- Maximum 2,000 characters
- Displayed on the project page
- Helps you remember what each project is for

**Color** (optional)
- Hex color code (e.g., `#3B82F6`)
- Used for project badge in UI
- Helps visually distinguish projects

**Icon** (optional)
- Emoji or icon identifier
- Displayed alongside project name
- Quick visual identification

## The Project Page

When you open a project, you see:

### Header

- Project name and description
- Edit button to modify project details
- Project statistics (chat count, file count, character count)

### Content Sections

**Chats Card**
- Lists conversations associated with this project
- Shows chat title, message count, participants
- Quick access to recent project chats
- Button to create new chat

**Files Card**
- Shows files attached to this project
- File type, size, and upload date
- Upload and manage project files
- Browse all files button

**Characters Card**
- Character roster (if using controlled mode)
- Or indicator that any character can participate
- Shows which characters have chatted in this project

**Settings Card**
- Project instructions editor
- File storage configuration
- Tool settings for project chats
- Character access controls

## Project Chats

Chats associated with a project receive special context:

### Automatic Benefits

- **Project Instructions** — Injected into every conversation
- **File Access** — AI can read and search project files
- **Project Context** — AI understands it's working within a specific project
- **Memory Tagging** — Memories can be associated with the project

### Creating a Project Chat

**From the Project Page:**
1. Open the project
2. Click **New Chat** in the Chats section
3. Select a character
4. Chat is automatically associated with the project

**From Any Chat:**
1. Open an existing chat
2. Go to chat settings
3. Select a project from the dropdown
4. Chat becomes a project chat

See [Project Chats](project-chats.md) for more details.

## Project Files

Files in a project are accessible to the AI during conversations:

### What Project Files Do

- Provide reference material the AI can read
- Enable semantic search across your documents
- Give characters access to world lore, notes, or research
- Supplement character knowledge without manual copy-paste

### Adding Files

1. Open the project
2. Go to the Files section
3. Click **Upload** or drag files into the area
4. Files are associated with the project

See [Project Files](project-files.md) for complete file management details.

## Character Roster

Projects can control which characters participate:

### Open Mode (Default)

- Any character can start or join project chats
- Most flexible option
- Good for general-purpose projects

### Roster Mode

- Only approved characters can participate
- Enable by turning off "Allow Any Character"
- Add characters to the roster manually
- Characters are auto-added when they join a project chat

See [Project Characters](project-characters.md) for roster management.

## Project Instructions

Custom instructions that apply to all project chats:

### What Instructions Do

- Prepended to system prompts in all project conversations
- Define world rules, settings, or constraints
- Establish tone, style, or genre expectations
- Provide persistent context the AI should remember

### Writing Effective Instructions

**Example for a Fantasy Project:**
```
This project is set in the Kingdom of Eldoria, a medieval fantasy world with magic.

World Rules:
- Magic is common but requires training
- The kingdom is at peace but tensions exist with neighboring lands
- Technology is roughly medieval European level

Characters should:
- Stay in character and maintain consistency
- Reference established lore when appropriate
- Build on previous conversations in this project
```

### Managing Instructions

1. Open the project
2. Go to the Settings section
3. Find the Instructions editor
4. Write or edit your instructions
5. Click **Save**

Instructions take effect immediately for new messages.

See [Project Settings](project-settings.md) for all configuration options.

## Project Tools

The AI has special tools for accessing project content:

### Project Info Tool

When chatting in a project, the AI can:

- **Get Project Info** — Learn project name, description, and statistics
- **Get Instructions** — Read the full project instructions
- **List Files** — See what files are available
- **Read File** — Access the content of a specific file
- **Search Files** — Find relevant files using semantic search

### How It Works

1. You ask a question that might need project context
2. The AI decides to use the project info tool
3. Tool retrieves relevant information
4. AI incorporates it into the response

**Example:**
- You: "What's the history of the Eldoria Kingdom?"
- AI: Uses `search_files` to find lore documents
- AI: Uses `read_file` to get the relevant content
- AI: Responds with information from your world bible

## Navigating Projects

### From the Sidebar

- Projects appear in the left sidebar
- Click a project to open it
- Badge shows chat count
- "View all" link goes to projects list

### Projects List Page

1. Click **Projects** in the sidebar
2. See all your projects as cards
3. Search or filter projects
4. Click a project to open it

### Project Indicators

- Chats show project badge in chat list
- Project name appears in chat header
- Files show project association

## Best Practices

### Organizing Your Projects

**By Creative Work:**
- One project per novel, story, or series
- Keeps all related content together
- Easy to find and resume work

**By Genre or Setting:**
- Group similar creative works
- Share world materials across related stories
- Useful for connected universes

**By Purpose:**
- Separate brainstorming from polished drafts
- Different projects for research vs. writing
- Helps focus the AI appropriately

### Effective Project Setup

1. **Start with Instructions** — Define the world/context first
2. **Add Reference Files** — Upload lore, notes, outlines
3. **Configure Characters** — Set up roster if needed
4. **Create Initial Chats** — Start conversations in context

### Maintaining Projects

- Update instructions as your world evolves
- Add new files as you develop content
- Archive completed chats if project is done
- Review and clean up unused projects periodically

## Troubleshooting

### AI not using project context

**Causes:**
- Chat not associated with project
- Project info tool disabled
- Instructions not saved

**Solutions:**
- Verify chat is in the project (check header/settings)
- Check tool settings allow project info access
- Re-save project instructions

### Files not accessible

**Causes:**
- File not associated with project
- File type not supported
- File too large to process

**Solutions:**
- Verify file appears in project's Files section
- Check if file type is readable (text, PDF, code)
- Try with smaller files or text extraction

### Characters can't join project chats

**Causes:**
- Roster mode enabled without character in roster
- Character missing connection profile
- Project restrictions

**Solutions:**
- Add character to roster, or enable "Allow Any Character"
- Verify character has valid connection profile
- Check project character settings

### Project not appearing in sidebar

**Causes:**
- No projects created yet
- Sidebar section collapsed
- Display issue

**Solutions:**
- Create a project first
- Expand the Projects section in sidebar
- Refresh the page

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/prospero")`

## Related Pages

- [Project Chats](project-chats.md) — Managing conversations within projects
- [Project Files](project-files.md) — File management and organization
- [Project Characters](project-characters.md) — Character roster and access control
- [Project Settings](project-settings.md) — Configuration and customization
- [Chats Overview](chats.md) — General chat functionality
- [Files Management](files.md) — Global file management
- [Characters](characters.md) — Character creation and management
