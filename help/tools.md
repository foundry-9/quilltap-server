# Tools

> **[Open this page in Quilltap](/foundry/forge)**

Tools are AI capabilities that allow the AI assistant to perform actions within Quilltap and access information beyond the conversation. They extend what the AI can do during a chat session.

## What Are Tools?

Tools are functions that the AI can call to:

- **Generate images** - Create AI-generated artwork and images
- **Search information** - Look up memories, past conversations, and web content
- **Access files** - Read project files and manage documents
- **Get context** - Access project information and character details

When you send a message, the AI decides which tools (if any) to use to best answer your question or fulfill your request.

## Types of Tools

### Built-In Tools

These tools are always available in Quilltap:

**Generate Image**

- Creates images using AI image generation providers
- Requires: Image generation profile configured for the character
- Useful for: Illustrating descriptions, creating character artwork, visual ideas

**Search Memories**

- Searches through stored memories and past conversations
- Always available when memory is enabled
- Useful for: Retrieving relevant past information and context

**Search Web**

- Searches the internet for current information
- Requires: Web search enabled in the connection profile
- Useful for: Finding recent news, facts, and current information

**Project Info**

- Accesses project information and files
- Requires: Chat associated with a project
- Useful for: Getting project context and accessing project files

**Manage Files**

- Reads, writes, and manages files in the file system
- Always available
- Useful for: Working with documents and file-based information

**Search Help**

- Searches Quilltap's help documentation for features, settings, and usage guidance
- Always available
- Useful for: Getting accurate information about how to use Quilltap features, configure settings, or troubleshoot issues

**Random Number Generator (RNG)**

- Rolls dice, flips coins, or randomly selects a chat participant
- Always available
- Useful for: Tabletop gaming, roleplay decisions, adding chance elements to stories
- See [RNG Tool](rng-tool.md) for detailed usage

### Plugin Tools

Additional tools provided by installed plugins or extensions:

- These appear in the Tools section with their plugin name
- Availability depends on plugin configuration
- Can be organized into groups or categories

## How Tools Work

**Automatic Tool Use:**

1. You send a message to the AI
2. The AI analyzes your message
3. If relevant tools exist, the AI decides whether to use them
4. The AI calls the selected tools with appropriate parameters
5. Tool results are returned to the AI
6. The AI uses these results to form its response
7. You see the AI's response incorporating the tool results

**Tool Availability:**

- Some tools depend on your chat configuration (image generation requires an image profile)
- Some tools are context-specific (Project Info only works in project chats)
- You can enable or disable tools per chat in the Tool Settings

## Why Enable/Disable Tools?

**Enable tools when:**

- You want the AI to have full access to capabilities
- You're working on a task that benefits from tool use (generating images, searching web)
- You want the AI to remember and search through your conversation history

**Disable tools when:**

- You want faster responses (fewer tool calls)
- You want the AI to focus on text-only responses
- You're on a limited connection or concerned about rate limits
- A tool is interfering with your workflow

## Quick Settings Access

To configure which tools the AI can use in your current chat:

1. **While in a chat**, look for the **Tool Settings** option (usually in a menu or toolbar)
2. **Click Tool Settings** to open the configuration dialog
3. **Enable or disable** individual tools
4. **Apply your changes** - they take effect on the next message
5. **The AI will use** only the enabled tools going forward

For more details, see [Configuring Chat Tools](tools-settings.md).

## Related Topics

- [Configuring Chat Tools](tools-settings.md) - How to enable/disable tools for your chat
- [Using Tools in Chat](tools-usage.md) - Understanding how to work with tools
- [Plugins](plugins.md) - Adding plugin tools to your system
