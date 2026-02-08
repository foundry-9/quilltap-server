# Configuring Chat Tools

> **[Open this page in Quilltap](/foundry/forge)**

This guide explains how to enable and disable AI tools for individual chats in Quilltap.

## What Can You Configure?

For each chat, you can control which tools the AI has access to. This lets you:

- Enable all tools for maximum AI capability
- Disable specific tools to avoid unwanted behavior
- Disable all tools for text-only conversations
- Disable tool groups (like MCP servers) in bulk

## Opening Tool Settings

**Step-by-Step:**

1. **Open a chat** in Quilltap

2. **Look for the Tool Settings button:**
   - Usually appears in the chat toolbar or menu
   - Look for an icon that suggests settings or tools
   - May be labeled "Tool Settings" or "Configure Tools"

3. **Click Tool Settings** to open the configuration dialog

4. The **Tool Settings modal** appears showing available tools

## Understanding the Tool List

The Tool Settings modal displays:

**Tool Name**

- The name of the tool (e.g., "Generate Image", "Search Memories")
- Built-in tools vs. plugin tools are shown

**Availability Status**

- ✓ **Available** - The tool can be enabled and used in this chat
- ⚠️ **Unavailable (grayed out)** - The tool cannot be used due to missing configuration
  - Example: "Generate Image requires an image generation profile"
  - Unavailable tools cannot be enabled

**Current Status**

- **Checked ☑️** - Tool is enabled (AI can use it)
- **Unchecked ☐** - Tool is disabled (AI will not use it)
- **Indeterminate —** - Some tools in a group are enabled, others disabled

**Tool Categories**

- Tools may be organized by category (Built-in, Memory, Search, Project, Files, etc.)
- Plugins tools appear under their plugin names

## Enabling and Disabling Tools

**To enable a tool:**

1. Find the tool in the list
2. Click the checkbox next to the tool name
3. The checkbox becomes checked ☑️
4. The tool is now enabled

**To disable a tool:**

1. Find the tool in the list
2. Click the checkbox next to the tool name
3. The checkbox becomes unchecked ☐
4. The tool is now disabled (AI won't use it)

**To enable/disable all tools in a group:**

1. Locate the group name (e.g., "Plugin: MCP" or "Built-In")
2. Click the checkbox next to the group name
3. All tools in that group toggle on or off together

**To enable/disable a subgroup:**

1. Some groups have subgroups (like MCP servers)
2. Click the subgroup checkbox to toggle all its tools at once

## Making Changes Take Effect

**Important:** Tool setting changes take effect on the **next AI message** you send.

**What happens when you save:**

1. Click **Save Changes** button to save your settings
2. A success message appears
3. The modal closes
4. Your settings are stored for this chat
5. On your next message, the AI uses only the enabled tools

**What if you change your mind:**

- Click **Cancel** to discard your changes without saving
- Your settings revert to what they were before you opened the dialog

## Unavailable Tools

Some tools show as unavailable (grayed out). This means the tool **cannot be used** in this chat because of missing configuration.

**Common reasons for unavailability:**

**Generate Image - Unavailable**

- Reason: No image generation profile configured for the character
- Solution: Set up an image profile for your character (see your character settings)

**Project Info - Unavailable**

- Reason: This chat is not associated with a project
- Solution: Create a chat within a project, or move the chat to a project

**Search Web - Unavailable**

- Reason: Web search is not enabled in the connection profile
- Solution: Enable web search in your connection profile settings

If a tool you need is unavailable, the dialog shows the reason. Take the suggested action to make it available.

## Tool Groups and Subgroups

**Plugin Tools** are often organized in groups:

**Plugin Groups**

- Example: "Plugin: MyExtension"
- Contains all tools from that plugin
- Enable/disable the entire group at once

**Subgroups (MCP Servers)**

- Some plugins (like MCP) have multiple servers
- Each server has its own subgroup
- Example: "Filesystem Server", "GitHub Server", etc.
- You can enable tools from some servers while disabling others

**Using Subgroups:**

- Click the expand arrow ▶️ next to a subgroup name to see its tools
- Subgroup checkbox shows status:
  - ☑️ All tools in subgroup enabled
  - ☐ All tools in subgroup disabled
  - — Some tools in subgroup enabled, others disabled

## Best Practices

**For Optimal Performance:**

- **Enable only tools you need** - Fewer enabled tools = faster responses (fewer tool calls)
- **Start minimal** - Enable tools as needed, not all at once
- **Disable slow tools** - If certain tools are slowing down responses, disable them

**For Maximum Capability:**

- **Enable most tools** - The AI has more options to help you
- **Keep Search Memories enabled** - This helps the AI remember context
- **Consider enabling web search** - Gives the AI access to current information

**For Experimental/Unsafe Tasks:**

- **Disable File Management** - If you're worried about file changes
- **Disable Project Info** - If you want isolated chat sessions
- **Test settings** - Use tool settings to safely test different configurations

## Troubleshooting

**My tools aren't working**

- Check if the tools are enabled in Tool Settings
- If a tool is grayed out/unavailable, read the unavailability reason
- Try resending your message - sometimes the AI just doesn't use a tool

**The AI isn't using a tool I expected**

- The AI chooses which tools to use based on your message
- Just because a tool is enabled doesn't mean the AI will use it
- Try being more explicit in your request

**I want to undo a change**

- Open Tool Settings again and click Cancel to revert
- Your previous settings are restored

**One tool keeps interfering with my chats**

- Disable just that tool in Tool Settings
- The AI will find alternative ways to help you
- You can re-enable it anytime

## Related Topics

- [Tools Overview](tools.md) - Understand what tools are and how they work
- [Using Tools in Chat](tools-usage.md) - Tips for working with AI tools
- [Chat Settings](settings.md) - Other chat configuration options
