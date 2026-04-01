---
url: /files
---

# Using Files with AI

> **[Open this page in Quilltap](/files)**

Learn how to give your AI access to files and have it work with your file library.

## Overview: Files and AI

The AI in your chats can access and work with your files using the **File Management Tool**. This lets you:

- **Reference files in conversations** — "Look at this document"
- **Have AI analyze files** — "Summarize this PDF"
- **Create new files** — "Write results to a file"
- **Organize files** — "Create folder X and organize files"
- **Extract information** — "Find all mentions of X in my research files"

## How AI Accesses Files

### File Scope

The AI can access files based on scope:

**General Files** — Accessible in any chat

- Files stored in main Files library
- Can be referenced from any conversation
- Best for reference materials, resources

**Project Files** — Only in that project's chats

- Files uploaded to project
- Only accessible within that project
- Best for project-specific documents

**Character Files** — Images associated with character

- Character profile images
- Body description images
- Links to character descriptions

### Requesting File Access

**In your chat:**

You can ask the AI to work with files:

- "Can you read the research document?"
- "Check my file library for information about X"
- "Create a summary file with your analysis"
- "List all files in my Characters folder"
- "Find the most recent version of this file"

**AI responds:**

If the AI needs access:

1. AI explains what it wants to do
2. Shows which files it wants to access
3. Asks for your permission
4. You approve or deny

### Permission System

**Permissions needed:**

- **Reading** — Can view file content (usually auto-approved)
- **Writing** — Creating new files (usually requires approval)
- **Organizing** — Creating folders, moving files (may require approval)

**How it works:**

1. AI requests permission
2. You see notification with details
3. Can approve once, or for all future operations
4. Can revoke permissions any time

## File Management Tool Capabilities

### What AI Can Do

The AI has these file operations:

**list_files**

- See what files exist in accessible scope
- Filter by folder or type
- Get file count
- Example: "List all files in my project"

**list_folders**

- See folder structure
- Understand how files are organized
- Navigate between folders
- Example: "Show me my folder structure"

**read_file**

- Read and display file content
- Works with text, code, markdown, etc.
- Cannot read binary files directly
- Example: "Read the document.pdf"

**write_file**

- Create new files
- Automatically overwrites if a file with the same name already exists in the same folder
- When overwriting, the original file ID is preserved so references remain intact
- Requires your permission
- Example: "Save the analysis to a new file"

**create_folder**

- Create new directories
- Organize files
- Build folder structure
- Example: "Create a 'Results' folder"

**promote_attachment**

- Save chat message attachments as files
- Move to project or general storage
- Example: "Save this as a permanent file"

## Working with Files in Chats

### Analyzing File Content

**Ask the AI to analyze:**

```
User: "Can you review the character descriptions in my Characters folder?"

AI: "I'll look at your character files. Let me list them first."
[Accesses file list]

AI: "I found 3 character files: Alice, Bob, Charlie. 
Can I read these to give you feedback?"

User: "Yes, go ahead."

AI: [Reads files and provides analysis]
```

### Creating Files from Chat

**Ask the AI to create files:**

```
User: "Summarize our conversation and save it as a file"

AI: "I'll create a summary file. Is it okay if I create 
'conversation-summary.md' in your General Files?"

User: "Yes, that's fine."

AI: [Creates file and saves content]
"Done! I've saved the summary to 'conversation-summary.md'"
```

### Using Files as Reference

**Embed files in your questions:**

```
User: "Based on the research file 'solar-power.pdf', 
what are the key advantages?"

AI: "Let me read that file."
[Reads file]
AI: [Provides analysis based on file content]
```

### Organizing with AI Help

**Ask AI to organize:**

```
User: "My files are messy. Can you organize them into folders?"

AI: "I can help organize. What structure would you like?
For example:
- By project (Projects/Novel, Projects/Game)
- By type (Documents, Images, Code)
- By date (2024, 2025)

What makes sense for your workflow?"

User: "By project and then by type"

AI: [Creates folder structure and moves files]
```

## File Limitations and Scope

### What AI Can't Do

**File limitations:**

- **Read binary files** — Images, executables, archives can't be read as text
- **Run executables** — Can't execute code or scripts
- **Move to external** — Can't upload files outside Quilltap
- **Bypass permissions** — Can't access private/restricted files
- **Read project files from other project** — Only in current project

**Scope limitations:**

- **General AI** — Can only see general files
- **Project chat** — Only sees files in that project
- **Character chat** — Only sees character-associated files

### Maximum File Size

**For AI reading:**

- **Text files** — Usually up to 1MB+ of content
- **Large files** — May be truncated if very large
- **Response limits** — AI can process file but response is limited

**If file too large:**

1. AI may ask to read specific sections
2. Can manually excerpt relevant parts
3. Or upload smaller sections

## Permission Management

### Granting Permissions

**First time access:**

1. AI requests permission with details
2. Shows which files or operations needed
3. You can:
   - **Allow This Time** — Approve for this operation
   - **Allow Always** — Approve for all future operations
   - **Deny** — Reject this request

**Ongoing permissions:**

- Granted permissions persist for the chat session
- Different chats have separate permissions
- Permissions reset when you close chat

### Revoking Permissions

**During a chat:**

If you want to stop letting AI access files:

1. Tell AI directly: "Stop accessing my files"
2. AI stops making requests
3. Or close and reopen chat for fresh start

**System-wide:**

Check Settings for File Permissions:

- See what permissions are granted
- Revoke specific permissions
- Whitelist/blacklist folders

### Permission Best Practices

**When to approve:**

- ✓ AI only needs to read specific files
- ✓ You understand what it's doing
- ✓ Operation is safe (reading, not writing)

**When to deny:**

- ✗ Unsure what AI is doing
- ✗ Don't want all files accessed
- ✗ Sensitive data in folder
- ✗ Excessive file writing

## Practical Examples

### Example 1: Character Development

```
User: "My character Alice needs more development. 
Review the description and suggest improvements."

AI: "I'll look at your character files. 
Can I access the Characters folder?"

User: "Yes"

AI: [Reads alice-description.md]

AI: "Alice's description is good but could use:
1. More personality details
2. Stronger motivations
3. Conflict examples

Should I update the file with suggestions?"

User: "Create a new version with improvements"

AI: [Creates alice-v2.md with enhanced content]
```

### Example 2: Research Analysis

```
User: "Analyze all my research documents and create a summary"

AI: "I'll search your Research folder. Let me list files first."

[Sees: research-1.pdf, research-2.pdf, research-3.md]

AI: "Found 3 research files. Reading them..."

[Reads and analyzes all files]

AI: "Creating summary file with findings..."

[Creates research-summary.md with analysis]
```

### Example 3: Code Review

```
User: "Review my script and suggest improvements"

AI: "I'll read your script file. Which one?"

User: "scripts/game-logic.js"

AI: [Reads code]

AI: "I found several optimization opportunities:
1. This loop can be more efficient
2. This function could be simplified
3. Consider using this pattern instead

Should I create an improved version?"

User: "Yes, but keep the current as backup"

AI: [Creates game-logic-improved.js with suggestions]
```

### Example 4: File Organization

```
User: "Help me organize my messy file library"

AI: "I see you have 47 files. Let me suggest organization:

Current: Everything in root
Suggested:
/Projects/Novel/
/Projects/Game/
/Resources/
/Archive/

Should I proceed?"

User: "Yes, reorganize for me"

AI: [Creates folders and moves files]

AI: "Done! I've organized 47 files into 8 folders.
Created: Projects/Novel (12 files), Projects/Game (15 files),
Resources (10 files), Archive (10 files)"
```

## Using Files with Multiple Chats

### File Consistency Across Chats

**With General Files:**

- Changes made by AI in one chat affect all chats
- If AI creates a file, it's accessible everywhere
- Different chats can collaborate on same files

**With Project Files:**

- Only accessible within that project
- Different projects have separate file spaces
- Good for keeping data isolated

### Sharing Analysis Between Chats

1. Chat A creates an analysis file
2. Chat B can read that file
3. Continue work or build on previous analysis
4. Files serve as persistent workspace

### Preventing Conflicts

**Best practices:**

- Create versioned files (v1, v2, v3)
- Use timestamps in file names
- Organize by purpose/scope
- Archive old versions
- Use project files for isolated work

## Troubleshooting File Access

### AI Says File Not Found

**Causes:**

- File doesn't exist
- File in different scope (project vs. general)
- Wrong file path
- File deleted

**Solutions:**

- Ask AI to list files first
- Check file browser to verify file exists
- Verify scope (general vs. project)
- Re-upload file if deleted

### AI Can't Read File

**Causes:**

- File type not supported (binary, executable)
- File very large
- File corrupted
- Permission denied

**Solutions:**

- Confirm file type is text-readable
- Break large file into smaller parts
- Re-upload file if corrupted
- Check permissions in settings

### AI Asks for Permission Every Time

**Causes:**

- Chat session ended and restarted
- Permission set to "Allow This Time" not "Allow Always"
- Permissions were revoked

**Solutions:**

- Use "Allow Always" for recurring operations
- Check system permissions in settings
- Restore permissions if revoked

### File Updates Not Showing

**Problem:** AI read file, but later changes not reflected

**Causes:**

- AI may be caching content
- File refresh needed
- Wrong version of file

**Solutions:**

- Tell AI: "Refresh and re-read the file"
- Close and reopen chat
- Ask AI to list files and verify version

### Can't Create File

**Causes:**

- Storage full
- Permission denied
- Folder doesn't exist

**Solutions:**

- Delete old files to free space
- Approve file writing permission
- Ensure destination folder exists
- Check The Forge > File Storage configuration

## Related Topics

- [File Management](files.md) — Browse and manage files
- [Uploading Files](file-uploads.md) — Add files to system
- [File Organization](file-organization.md) — Organize with folders
- [Chats](chats.md) — Work with files in conversations
- [Tools Usage](tools-usage.md) — How tools work in chats
