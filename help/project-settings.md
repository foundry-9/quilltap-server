---
url: /prospero/:id
---

# Project Settings

> **[Open this page in Quilltap](/prospero)**

Project settings let you configure how your project works, including instructions, file storage, tool access, and character participation. These settings affect all chats and operations within the project.

## Accessing Project Settings

1. Open the project
2. Find the **Settings** card/section
3. Click to expand or access settings
4. Make changes and save as needed

## Project Instructions

The most important setting — custom instructions that apply to all project chats.

### What Instructions Do

- Prepended to system prompts in every project conversation
- Define world rules, settings, constraints
- Establish tone, style, genre expectations
- Provide persistent context

### Writing Instructions

1. Open project settings
2. Find the **Instructions** editor
3. Write or edit your text
4. Click **Save**

**Maximum length:** 10,000 characters

### Effective Instructions

**Be Specific:**
```
Setting: Medieval fantasy kingdom of Eldoria
Time Period: 300 years after the Great War
Magic: Common but requires formal training
Technology: Pre-gunpowder, medieval European level
```

**Set Expectations:**
```
Writing Style:
- Third person narrative
- Show don't tell
- Maintain consistency with established lore
- Build on previous conversations
```

**Define Rules:**
```
Character Guidelines:
- Stay in character at all times
- Reference the world bible when appropriate
- Ask clarifying questions if unsure about lore
- Don't contradict established facts
```

### When Instructions Apply

- Every new message in project chats
- All characters receive the instructions
- Instructions persist across sessions
- Updates apply to new messages immediately

## Tool Settings

Control which AI tools are available in project chats.

### Default Tool Access

By default, project chats have access to:
- All enabled global tools
- Project info tool (always enabled in projects)
- Character-specific tools

### Disabling Tools

1. Open project settings
2. Find **Tool Settings** section
3. Click to open tool configuration
4. Disable specific tools or tool groups
5. Save changes

**Disabled tools affect:**
- All new chats in the project
- New messages in existing chats
- All characters in project chats

### Tool Groups

You can disable entire groups:
- Plugin tools (e.g., `plugin:mcp`)
- Category of tools (e.g., all image tools)
- Specific tool by name

### Why Disable Tools?

**Privacy:**
- Disable web search for private projects
- Prevent external API calls

**Focus:**
- Disable image generation for text-only projects
- Remove irrelevant tool options

**Control:**
- Limit what AI can do in specific contexts
- Prevent accidental tool usage

### Settings Display

Tool settings show:
- Number of disabled tools
- Number of disabled groups
- Summary of restrictions

## Character Access Settings

Control which characters can participate in project chats.

### Allow Any Character

Toggle that controls character access:

**ON (Default):**
- Any character can join project chats
- No roster restrictions
- Most flexible

**OFF (Roster Mode):**
- Only roster characters can participate
- Characters must be approved
- More controlled

### Managing the Roster

When roster mode is enabled:
- Characters section shows approved list
- Add characters via roster or chat creation
- Remove characters from roster as needed

See [Project Characters](project-characters.md) for full roster details.

## Project Identity Settings

Configure how the project appears in the UI.

### Project Name

- Display name shown everywhere
- Maximum 100 characters
- Editable from project page header

**To change:**
1. Click project name or Edit button
2. Enter new name
3. Save changes

### Project Description

- Summary shown on project page
- Maximum 2,000 characters
- Helps remember project purpose

**To change:**
1. Click description or Edit button
2. Update text
3. Save changes

### Visual Customization

**Color:**
- Hex color code (e.g., `#3B82F6`)
- Used for project badge
- Helps distinguish projects visually

**Icon:**
- Emoji or icon identifier
- Displayed with project name
- Quick visual identification

## Settings Organization

Settings are typically organized in cards:

### Instructions Card
- Text editor for project instructions
- Save button
- Character count indicator

### Tools Card
- Summary of restrictions
- Configure button
- Tool selection modal

### Characters Card
- Allow Any Character toggle
- Roster display (when applicable)
- Add/remove character options

## Saving Settings

Most settings save automatically or with explicit save:

### Auto-Save
- Toggle switches (Allow Any Character)
- Dropdown selections
- Immediate effect

### Manual Save
- Instructions text (Save button required)
- Complex configurations
- Shows save confirmation

### Save Indicators
- Loading spinner during save
- Checkmark on success
- Error message on failure

## Best Practices

### Instructions Best Practices

- Keep focused and specific
- Update as project evolves
- Don't repeat character-level info
- Use clear, parseable formatting

### Tool Best Practices

- Disable only what you need to
- Test after disabling tools
- Remember project info tool is always on

### Character Best Practices

- Use roster mode for focused projects
- Leave open for exploration
- Review roster periodically

## Troubleshooting

### Instructions not saving

**Causes:**
- Network issue
- Text too long
- Validation error

**Solutions:**
- Check network connection
- Reduce instruction length
- Remove invalid characters
- Try again

### Tool settings not applying

**Causes:**
- Settings not saved
- Chat predates setting change
- Tool is core/unblockable

**Solutions:**
- Verify settings saved
- Send new message (settings apply to new messages)
- Check if tool can be disabled

### Character settings not updating

**Causes:**
- Toggle didn't save
- UI not refreshed
- Existing chats unaffected

**Solutions:**
- Verify toggle state
- Refresh page
- New chats will use new settings

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/prospero/:id")`

## Related Pages

- [Projects Overview](projects.md) — Main project documentation
- [Project Files](project-files.md) — File management
- [Project Chats](project-chats.md) — Conversations in projects
- [Project Characters](project-characters.md) — Character roster
- [Tools Settings](tools-settings.md) — Global tool configuration
