---
url: /salon
---

# Chats Overview

> **[Open this page in Quilltap](/salon)**

Chats are the core of Quilltap. They're where you have conversations with AI characters, explore stories, collaborate on creative work, and interact with your configured AI assistants.

## What Are Chats?

Chats are conversation sessions where you:

- **Talk to Characters** — Interact with AI-driven personalities you create
- **Tell Stories** — Collaborate on roleplay, fiction, and worldbuilding
- **Get Assistance** — Ask questions, brainstorm ideas, and work through problems
- **Use Tools** — Generate images, search the web, manage files, and more

Each chat maintains its own history, context, and settings. You can have ongoing conversations that span multiple sessions, with the AI remembering what you've discussed.

## Types of Chats

### Single-Character Chats

The simplest chat type:

- One AI character responds to your messages
- Direct conversation between you and the character
- Great for focused interactions, Q&A, or one-on-one roleplay

### Multi-Character Chats

More complex conversations with multiple participants:

- Multiple AI characters can participate
- Characters take turns speaking based on the turn manager
- You can also control characters yourself (impersonation)
- Ideal for group scenes, ensemble stories, or collaborative worldbuilding

See [Multi-Character Chats](chat-multi-character.md) for details.

### Project Chats

Chats associated with a specific project:

- Access project-specific files and context
- Characters can reference project documents
- Organized within project workspace
- Great for focused creative work or research

## Starting a Chat

### From the Characters Page

1. Go to **Characters** in the left sidebar
2. Find the character you want to chat with
3. Click **Chat** button on their card
4. A new chat opens with that character

### From a Character's Profile

1. Open a character's profile
2. Click **Start Chat** or **New Chat** button
3. Chat opens with that character ready to respond

### From the Chats Page

1. Go to **Chats** in the left sidebar
2. Click **New Chat** button
3. Select a character to chat with
4. Optionally configure chat settings before starting

### Quick Start

Most characters have a **First Message** — an introductory message the character sends when you start a new chat. This sets the scene and establishes the character's voice.

## The Chat Interface

### Message Area

The main area where conversation happens:

- **Your Messages** — Appear on one side with your avatar
- **Character Messages** — Appear with the character's avatar, name, and a small provider/model badge showing which LLM service generated the response
- **System Messages** — Background operations like memory extraction (if enabled)
- **Timestamps** — Show when messages were sent

### Input Area

Where you compose messages:

- **Text Field** — Type your message here
- **Send Button** — Click to send (or press Enter)
- **Attachment Button** — Add files or images to your message
- **Tool Palette** — Access quick actions and settings

### Header

Shows chat information and controls:

- **Chat Title** — Auto-generated or custom name
- **Character Info** — Who you're chatting with
- **Settings Button** — Configure this chat
- **Action Menu** — Additional chat operations

### Participants Sidebar

For multi-character chats, shows all participants:

- **Character Avatars** — Visual indicator of who's in the chat
- **Turn Information** — Whose turn it is to speak
- **Controls** — Manage character participation

See [Participants Sidebar](chat-participants.md) for details.

## Basic Chat Actions

### Sending Messages

1. Type your message in the input field
2. Press **Enter** to send (or click Send button)
3. Character responds automatically (if LLM-controlled)

**Tip:** Use **Shift+Enter** for line breaks without sending.

### Viewing History

Scroll up to see earlier messages in the conversation. Long chats may have:

- **Context Summary** — Brief summary of earlier conversation at the top
- **Load More** — Button to load older messages if history is truncated

### Waiting for Responses

When the AI is generating a response:

- **Typing Indicator** — Shows the character is "thinking"
- **Stop Button** — Cancel generation if you change your mind
- **Progress** — Some themes show generation progress

## Message Actions

Each message has actions you can perform:

### For Your Messages

- **Edit** — Modify the message content
- **Delete** — Remove the message
- **Resend** — Send the same message again

### For Character Messages

- **Swipe/Regenerate** — Generate a new alternative response
- **Edit** — Modify what the character said
- **Delete** — Remove the message
- **Reattribute** — Change which character said it (multi-character chats)

See [Message Actions](chat-message-actions.md) for complete details on editing, regenerating, and managing messages.

## Chat Settings and Configuration

### Per-Chat Settings

Each chat can have its own configuration:

- **Roleplay Template** — Formatting and style settings (in chat settings modal)
- **Image Generation** — Which image provider to use (in chat settings modal)
- **Connection Profiles** — Which LLM to use per participant (on each participant card in the sidebar)
- **System Prompt Overrides** — Custom context per participant (on each participant card in the sidebar)
- **Tools** — Which AI tools are available
- **Project** — Which project this chat belongs to

### Accessing Chat Settings

1. Open the chat
2. Click the **Settings** button (gear icon) in the header or action menu to open the chat settings modal (roleplay template and image generation)
3. In multi-character chats, use the **participant sidebar** to change connection profiles and per-participant settings directly on each card

## Managing Chats

### Finding Chats

- **Chats Page** — Lists all your conversations
- **Search** — Find chats by title or content
- **Filter** — Show chats by character, project, or date
- **Sort** — Organize by recent, alphabetical, or other criteria

### Renaming Chats

1. Open the chat
2. Click the title or use the Action Menu
3. Enter a new name
4. Save the change

**Note:** Renaming disables auto-rename for that chat.

### Deleting Chats

1. Open the chat or find it in the Chats list
2. Click **Delete** in the Action Menu
3. Confirm deletion
4. Choose whether to delete associated memories

**Warning:** Deletion is permanent.

### Exporting Chats

Save chats for backup or sharing:

1. Open the chat
2. Use Action Menu > **Export**
3. Choose export format
4. File downloads to your computer

## Advanced Features

### Memory Integration

Quilltap can extract and store memories from your chats:

- **Auto-extraction** — Important facts saved automatically
- **Semantic Search** — Find past conversations by meaning
- **Character Memory** — Characters can remember previous interactions
- **Memory Recap** — When a chat begins or a character joins an existing conversation, the system generates a first-person narrative summary from the character's Commonplace Book memories. This "What You Remember" recap gives each character a sense of continuity across conversations — rather like a butler whispering a briefing in one's ear before entering the drawing room. The recap draws from memories of varying importance and is injected into the character's context automatically; no action on your part is required.

See [Chat Settings](chat-settings.md) for memory configuration.

### Context Management

For long conversations:

- **Summarization** — Old messages condensed to save tokens
- **Compression** — Context optimized for API limits
- **Token Display** — Monitor usage if enabled

### Tool Integration

Use AI tools during chat:

- **Image Generation** — Create images in conversation
- **Web Search** — Access current information
- **File Management** — Read and write files
- **Memory Search** — Find past conversations

See [Using Tools](tools-usage.md) for tool details.

## Best Practices

### For Better Conversations

- **Be specific** — Clear requests get better responses
- **Provide context** — Help the AI understand the situation
- **Use character's style** — Match the tone they expect
- **Give feedback** — Edit or regenerate when responses miss the mark

### For Long-Running Chats

- **Name your chats** — Make them easy to find later
- **Use projects** — Organize related conversations
- **Monitor tokens** — Watch usage for cost management
- **Review memories** — Ensure important facts are captured

### For Roleplay

- **Establish scenes** — Set the stage clearly
- **Stay in character** — Consistent personas improve responses
- **Use templates** — Roleplay templates enhance formatting
- **Add participants** — Multi-character chats for ensemble scenes

## Troubleshooting

### Character not responding

**Causes:**

- Connection profile not configured
- API key invalid or missing
- Rate limit reached
- Network issues

**Solutions:**

- Check character's connection profile in settings
- Verify API key in The Forge > API Keys
- Wait and try again if rate limited
- Check internet connection

### Messages not saving

**Causes:**

- Network interruption
- Server issue
- Storage full

**Solutions:**

- Refresh the page
- Check internet connection
- Try again in a few moments
- Check server status if self-hosting

### Chat is slow

**Causes:**

- Large context (long conversation)
- Complex model being used
- Many tools enabled
- Server load

**Solutions:**

- Start a new chat for fresh context
- Use a faster model
- Disable unnecessary tools
- Wait for server load to decrease

### Can't find a chat

**Causes:**

- Chat was deleted
- Chat is in a project you're not viewing
- Search terms don't match

**Solutions:**

- Check all projects, not just current one
- Try different search terms
- Check recently deleted if available

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/salon")`

## Related Pages

- [Multi-Character Chats](chat-multi-character.md) — Conversations with multiple AI characters
- [Turn Manager](chat-turn-manager.md) — How speaking turns work in group chats
- [Message Actions](chat-message-actions.md) — Edit, regenerate, and manage messages
- [Participants Sidebar](chat-participants.md) — Managing chat participants
- [Chat Settings](chat-settings.md) — Global chat configuration
- [Using Tools](tools-usage.md) — AI tools available during chat
- [Characters](characters.md) — Create and manage chat participants
- [Projects](projects.md) — Organize chats by project
