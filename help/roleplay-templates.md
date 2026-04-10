---
url: /settings?tab=templates&section=roleplay-templates
---

# Roleplay Templates

> **[Open this page in Quilltap](/settings?tab=templates&section=roleplay-templates)**

Roleplay templates define how the AI formats dialogue, actions, thoughts, and other narrative elements in your chats. They provide formatting instructions that shape how responses are structured and displayed, helping create consistent storytelling conventions.

## What Are Roleplay Templates?

A roleplay template is:

- **A formatting system** — Defines how dialogue, actions, and narration should be structured
- **System prompt instructions** — Guides the AI on formatting conventions to follow
- **Applicable to chats** — Can be assigned to individual chats or set as a default for all new chats
- **Customizable** — You can create your own templates or use built-in ones

Templates ensure your roleplay sessions maintain consistent formatting conventions throughout.

## How Templates Work

### The System Prompt

Each template includes a **system prompt** containing:

- Formatting rules (how to format dialogue, actions, etc.)
- Structural guidelines (how to organize response content)
- Conventions (what characters to use, spacing, etc.)
- Examples of correctly formatted responses

This system prompt is prepended to the character's system prompt when the template is active.

### Template Application

When a template is active in a chat:

1. The template's system prompt is added to the character's instructions
2. The AI follows the formatting rules defined in the template
3. Responses use the specified formatting conventions
4. All participants in the chat follow the same format

### {{char}} and {{user}} Placeholders

Templates can include placeholders that get replaced with actual names:

- **{{char}}** — Replaced with the character's name
- **{{user}}** — Replaced with the user's name or user character name

This allows templates to reference character and user names dynamically.

## Built-in Templates

Quilltap includes several built-in templates that you can use immediately:

### Default Built-in Template

The default template provides:

- Standard formatting for dialogue and actions
- Clear distinction between dialogue ("speech") and actions (*actions*)
- Support for out-of-character (OOC) comments ((comments))
- Balanced structure for most roleplay styles

### Available Built-in Templates

Additional built-in templates may be available in your installation:

- Different formatting conventions
- Alternative structures for specific roleplay styles
- Specialized formats for particular genres

### Working with Built-in Templates

Built-in templates:

- **Can be viewed** — See the complete system prompt
- **Cannot be edited** — Built-in templates are read-only
- **Can be copied** — Create your own version by copying a built-in template
- **Can be previewed** — See the full formatting instructions before using

## Using Templates in Chats

### Setting a Chat Template

You can set a roleplay template for any chat:

1. Open the chat
2. Click the **chat settings** button (gear icon)
3. Find the **Roleplay Template** section
4. Select a template from the dropdown
5. Click **Save**
6. The template applies to all responses in the chat

### Per-Chat vs. Default Template

- **Default template** — Applied to all new chats automatically
- **Per-chat template** — Override the default for a specific chat
- **No template** — Select "None" to use no formatting template

Each chat can have its own template or use the default.

### Changing a Chat's Template

1. In the chat, open **Chat Settings**
2. Find the **Roleplay Template** dropdown
3. Select a different template
4. The new template applies to subsequent responses
5. Previous messages keep their original formatting

## Default Template Setting

### Setting a Default Template

The default template is the one applied to all new chats:

1. Go to **Settings** → **Roleplay Templates**
2. Find the **Default Template** section at the top
3. Choose a template from the dropdown
4. Click save
5. All new chats now use this template

### Why Use a Default Template?

Use a default template if you:

- **Have a preferred format** — Use it for all chats automatically
- **Want consistency** — All new chats follow the same style
- **Save time** — Don't need to set templates per-chat
- **Match your workflow** — Match your preferred roleplay convention

### Changing Your Default

1. Return to **Settings** → **Roleplay Templates**
2. Select a different default template
3. Changes only apply to **new** chats
4. Existing chats keep their settings
5. You can still override per-chat

## Creating Custom Templates

### Why Create Custom Templates?

Create custom templates to:

- **Define your style** — Exactly how you want formatting to work
- **Standardize your work** — Create consistent conventions across projects
- **Experiment** — Try different formatting approaches
- **Share with others** — Distribute your templates to the community

### Creating a New Template

1. Go to **Settings** → **Roleplay Templates**
2. In the **My Templates** section, click **Create Template**
3. Fill in the template details:
   - **Name** — What to call the template
   - **Description** — Explain the formatting style (optional)
   - **System Prompt** — The formatting instructions
4. Click **Save**
5. Your template is now available to use

### Template Form Fields

- **Template Name** — Display name (up to 100 characters)
- **Description** — What makes this template unique (optional, up to 500 characters)
- **System Prompt** — The formatting instructions (required)

### System Prompt Best Practices

When writing system prompts:

1. **Be explicit** — Clearly state formatting rules
2. **Use examples** — Show what properly formatted responses look like
3. **Define separators** — Specify what characters indicate dialogue, actions, etc.
4. **Set expectations** — Explain the structure responses should follow
5. **Include placeholders** — Use {{char}} and {{user}} for dynamic names

## Managing Templates

### Viewing Template Details

To see a template's full system prompt:

1. Go to **Settings** → **Roleplay Templates**
2. Find the template card
3. Click **Preview** or **View Details**
4. See the complete system prompt and description
5. Close to return to the template list

### Editing Templates

To edit a template you created:

1. Go to **Settings** → **Roleplay Templates**
2. Find your template in **My Templates**
3. Click the **Edit** button (pencil icon)
4. Modify the name, description, or system prompt
5. Click **Save**
6. Changes apply to existing chats using this template

### Copying Templates

To create a new template based on an existing one:

1. Find the template (built-in or custom)
2. Click **Copy** or **Copy as New**
3. A modal opens with the template details
4. Edit as needed (name, description, system prompt)
5. Click **Save** to create the copy
6. Your new template appears in your list

### Deleting Templates

To remove a custom template:

1. Go to **Settings** → **Roleplay Templates**
2. Find the template in **My Templates**
3. Click **Delete**
4. Confirm the deletion
5. The template is removed

**Note:** Deleting a template doesn't affect chats that already use it; they'll continue with the formatting they had.

## Built-in vs. Custom Templates

### Built-in Templates

Built-in templates:

- Provided by Quilltap or plugins
- Cannot be modified (read-only)
- Always available
- Display a "Built-in" badge
- Can be previewed and copied

### Custom Templates

Custom templates:

- Created by you
- Can be edited or deleted
- Stored in your settings
- Available only to you (unless exported)
- Show in the "My Templates" section

### When to Use Each

- **Use built-in templates** for quick setup without customization
- **Copy built-in templates** as a starting point for customization
- **Create custom templates** when built-in ones don't match your needs
- **Modify custom templates** to refine your formatting as needed

## Template Features

### Annotation Buttons

Some templates include annotation buttons for quick formatting:

- These appear in document editing mode
- Buttons like "Narration," "Out of Character," "Dialogue"
- Click to apply formatting around selected text
- Speeds up formatting during writing

### Rendering Patterns

Templates can define how text should be styled:

- How dialogue paragraphs look
- How action paragraphs look
- How special formatting appears
- Visual distinction between different element types

### Dialogue Detection

Some templates include dialogue detection:

- Automatically identifies quoted dialogue
- Applies special styling to dialogue paragraphs
- Helps ensure consistent visual formatting
- Makes conversations easy to distinguish

## Best Practices

### When Creating Templates

1. **Start simple** — Begin with basic formatting rules
2. **Test thoroughly** — Use the template in chats before finalizing
3. **Document your rules** — Clear examples prevent confusion
4. **Use clear separators** — Make different elements easy to distinguish
5. **Include edge cases** — Address unusual formatting situations
6. **Be specific** — Exact formatting beats vague guidelines

### Narration Delimiters (Required)

Every roleplay template **must** declare how narration is delimited. This is the `narrationDelimiters` field, which tells the system how to identify narration text in the AI's response — not just for display styling, but for semantic understanding of what is narration versus speech.

Narration delimiters can be:

- **A single character** — The same delimiter opens and closes narration (e.g., `*` for `*narration*`)
- **A pair of characters** — Different opening and closing delimiters (e.g., `[` and `]` for `[narration]`)

Speech (dialogue) is everything that isn't delimited as narration. If your template uses quotes for speech, that's a display convention — but what the system needs to know is how narration is marked.

**Examples:**

| Template | Narration Delimiters | Narration Looks Like |
|----------|---------------------|---------------------|
| Standard | `*` | `*She crossed her arms.* ` |
| Quilltap RP | `[`, `]` | `[She crossed her arms.]` |

### Formatting Conventions

Common elements to define:

- **Dialogue** — How speech is marked (quotes, asterisks, etc.)
- **Actions** — How actions are marked (*action* or [action])
- **Narration** — How narrative text is formatted (must be declared via narration delimiters)
- **Thoughts** — How character thoughts are shown
- **Out-of-Character** — How OOC comments appear ((comment))
- **Emphasis** — How **bold** and *italic* text should work

### Example Formatting Elements

```
"Dialogue here" — Speech between quotes
*Action here* — Actions in single asterisks
[Narration here] — Narrative text in brackets
((OOC here)) — Out-of-character in double parentheses
```

## Template Persistence

### How Templates Are Saved

- Your custom templates are saved to your account
- Chat settings remember which template is assigned
- Changes to a template affect all chats using it
- Deleting a template doesn't delete chat history

### Accessing Your Templates

Your templates are available:

- In chat settings when selecting a template for a chat
- In Settings → Roleplay Templates for management
- Across all your devices when logged in
- Only to you (not shared with others unless exported)

## Troubleshooting

### Template Not Applying

**Problem:** Selected template doesn't affect chat responses

**Solutions:**

- Verify the template is selected in Chat Settings
- Check that you saved the Chat Settings
- Try with a new chat to verify it works
- Restart the chat if it's been running a while

### Can't See New Template

**Problem:** A template you created doesn't appear

**Solutions:**

- Refresh the page
- Check the "My Templates" section (not "Built-in")
- Verify it was saved successfully
- Check for error messages

### Formatting Not Working

**Problem:** Chat responses don't follow the template format

**Solutions:**

- Review the template's system prompt for clarity
- Make sure the template is actually assigned to the chat
- Try a simpler template to verify templates work
- Check if the character has conflicting instructions

### Can't Edit Template

**Problem:** The edit button is disabled or missing

**Solutions:**

- Make sure it's a custom template (not built-in)
- Try refreshing the page
- Copy a built-in template if you want to modify it
- Check if it's marked as "Built-in"

### Changes Not Saving

**Problem:** Template edits don't persist

**Solutions:**

- Check your internet connection
- Verify you're logged in
- Try saving again
- Refresh and check if changes were saved
- Look for error messages

## Tips for Success

1. **Start with built-ins** — Understand existing templates before creating
2. **Test before using** — Try templates in test chats first
3. **Keep it simple** — Complex formatting isn't always better
4. **Document your style** — Write clear examples in descriptions
5. **Review and iterate** — Refine templates as you use them
6. **Backup important templates** — Save copies before major edits

## In-Chat Navigation

Characters with help tools enabled can navigate directly to this page:

`help_navigate(url: "/settings?tab=templates&section=roleplay-templates")`

Roleplay templates are powerful tools for standardizing your creative writing—invest time in creating the perfect format for your style!
