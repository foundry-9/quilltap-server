# Project Files

> **[Open this page in Quilltap](/prospero)**

Project files are documents, images, and other materials associated with a specific project. They provide context that the AI can access during conversations, enabling richer, more informed interactions.

## What Are Project Files?

Project files are:

- **Contextual** — Accessible to the AI in project chats
- **Organized** — Grouped by project for easy management
- **Searchable** — AI can find relevant files using semantic search
- **Referenced** — AI can read and quote from your documents

Unlike general files (which are available everywhere), project files are scoped to their project, helping focus the AI on relevant materials.

## Supported File Types

### Text Files

Fully readable and searchable:

- **Plain Text** — `.txt` files
- **Markdown** — `.md` files with formatting preserved
- **CSV** — Data files readable as structured text
- **JSON/XML** — Configuration and data files

### Documents

Text extracted and made searchable:

- **PDF** — Text content extracted from PDF documents
- **Rich Text** — `.rtf` files converted to plain text

**Note:** PDF extraction works best with text-based PDFs. Scanned documents may have limited text extraction.

### Code Files

Syntax-aware with language detection:

- **JavaScript/TypeScript** — `.js`, `.ts`, `.jsx`, `.tsx`
- **Python** — `.py` files
- **Java** — `.java` files
- **C/C++** — `.c`, `.cpp`, `.h`, `.hpp`
- **And many more** — Most programming languages supported

### Images

Auto-described for AI understanding:

- **JPEG/PNG** — Common image formats
- **GIF** — Including static GIFs
- **WebP** — Modern web format

Images are automatically described using your cheap LLM profile, making the description searchable and accessible to the AI.

### Other Files

- **Binary files** — Stored but content not readable
- **Archives** — `.zip`, `.tar` stored but not extracted
- **Media** — Audio/video files stored but not transcribed

## Adding Files to a Project

### Upload New Files

1. Open the project
2. Go to the **Files** section
3. Click **Upload** button
4. Select file(s) from your computer
5. Files are uploaded and associated with the project

### Drag and Drop

1. Open the project page
2. Drag files from your computer
3. Drop onto the Files section
4. Files are uploaded automatically

### Multiple File Upload

1. Click **Upload** button
2. Hold **Ctrl** (Windows) or **Cmd** (Mac)
3. Select multiple files
4. All selected files are uploaded

### From Existing Files

If you have files in your general library:

1. Go to the **Files** page
2. Find the file you want to associate
3. Click **Move** or **Associate with Project**
4. Select the target project
5. File is now a project file

## Viewing Project Files

### Files Section

On the project page, the Files section shows:

- **File Name** — Original filename
- **File Type** — Category and MIME type indicator
- **Size** — Formatted as B, KB, or MB
- **Date** — When the file was added

### File Preview

Click a file to preview:

- **Text/Markdown** — Formatted content display
- **Code** — Syntax-highlighted source
- **PDF** — Page-by-page viewer
- **Images** — Full-size display
- **Other** — File information and download option

### Browse All Files

Click **Browse All** to open the full file browser:

- See all project files in list or grid view
- Sort by name, date, size, or type
- Search within project files
- Bulk actions available

## Managing Project Files

### Removing Files

To remove a file from a project:

1. Find the file in the Files section
2. Click the **X** or **Remove** button
3. Confirm removal

**Note:** This removes the project association. The file itself is not deleted and remains in your file library.

### Deleting Files

To permanently delete a file:

1. Open file preview or file browser
2. Click **Delete** button
3. Confirm deletion

**Warning:** This permanently removes the file from the system.

### Renaming Files

1. Open file preview
2. Click the filename or **Rename** option
3. Enter new name
4. Save changes

### Moving Files Between Projects

1. Find the file in the file browser
2. Click **Move**
3. Select new project (or "No Project" for general files)
4. Confirm the move

## How AI Uses Project Files

### Automatic Access

When chatting in a project, the AI can:

1. **List Files** — See what's available in the project
2. **Read Files** — Access full content of text, code, or documents
3. **Search Files** — Find relevant files semantically

### Example Interaction

**You:** "What does the magic system doc say about healing spells?"

**AI's Process:**
1. Uses `search_files` with query "healing spells magic system"
2. Finds `magic-system.md` with high relevance
3. Uses `read_file` to get the content
4. Responds with information from your document

### File Content in Context

When AI reads a file, it receives:

- **Text Files** — Full text content
- **Code Files** — Source code with language hint
- **Markdown** — Formatted content
- **Images** — Auto-generated description
- **PDF** — Extracted text content

### Semantic Search

The AI searches files using meaning, not just keywords:

- "healing magic" finds content about "restorative spells"
- "character background" finds "protagonist history"
- Relevance scores help AI prioritize results

## File Organization

### Recommended Structure

Organize project files by purpose:

```
Project: Eldoria Novel
├── World Building
│   ├── magic-system.md
│   ├── geography.md
│   └── history.md
├── Characters
│   ├── protagonist-bio.md
│   └── antagonist-notes.md
├── Plot
│   ├── outline.md
│   └── chapter-summaries.md
└── Research
    ├── medieval-weapons.pdf
    └── castle-architecture.md
```

**Note:** Folder structure is conceptual — use filenames or prefixes to organize.

### Naming Conventions

Good file names help the AI find content:

**Clear and Descriptive:**
- `magic-system-rules.md`
- `character-aria-backstory.md`
- `world-map-description.md`

**Avoid Vague Names:**
- `notes.txt` (too generic)
- `doc1.md` (no context)
- `stuff.md` (meaningless)

### File Size Considerations

**Optimal Sizes:**
- Text files: Any size (split very large files for better search)
- Documents: Under 10MB recommended
- Images: Standard web sizes

**Large Files:**
- May take longer to process
- Consider splitting into logical sections
- AI reads full content, affecting token usage

## File Storage Options

### Default Storage

Files use your system's default storage location:

- Local storage (file system)
- Configured S3/MinIO storage

### Project-Specific Mount Points

Projects can use dedicated storage:

1. Open project Settings
2. Find **File Storage** section
3. Select a different mount point
4. Optionally migrate existing files

**Use Cases:**
- Store media-heavy projects on S3
- Keep sensitive projects on local storage
- Separate storage for different project types

### Migrating Files

When changing mount points:

1. Select new mount point
2. Click **Migrate Files**
3. Files are copied to new location
4. Original files can be cleaned up

## Best Practices

### For World Building

- Keep lore documents updated as world evolves
- Use consistent formatting for easy AI parsing
- Break large documents into focused topics
- Include example scenarios or Q&A sections

### For Character Development

- Maintain character sheets with key details
- Include relationship maps if relevant
- Document character arcs and growth
- Add example dialogue for voice reference

### For Writing Projects

- Upload outlines and plot summaries
- Include style guides if applicable
- Add research materials as reference
- Keep revision notes separate from final drafts

### General Tips

- Use markdown for formatted documents
- Keep files focused on single topics
- Update files as your project evolves
- Remove outdated files to reduce confusion

## Troubleshooting

### File not appearing in project

**Causes:**
- Upload still in progress
- File association failed
- Viewing wrong project

**Solutions:**
- Wait for upload to complete
- Refresh the page
- Verify you're in the correct project
- Re-upload if necessary

### AI not finding file content

**Causes:**
- File type not readable
- Content not indexed yet
- Search terms don't match

**Solutions:**
- Check file type is supported
- Wait for indexing (especially for new files)
- Try different search terms
- Ask AI to list files first

### File preview not working

**Causes:**
- Unsupported file type
- File corrupted
- Browser issue

**Solutions:**
- Try downloading the file instead
- Re-upload the file
- Try different browser
- Check file opens locally

### Can't delete or remove file

**Causes:**
- File in use
- Permission issue
- UI not responding

**Solutions:**
- Wait for any active operations
- Refresh and try again
- Check file associations

## Related Pages

- [Projects Overview](projects.md) — Main project documentation
- [Project Chats](project-chats.md) — Conversations in projects
- [Project Settings](project-settings.md) — Storage and configuration
- [Files Management](files.md) — General file operations
- [File Uploads](file-uploads.md) — Upload procedures
- [Files with AI](files-with-ai.md) — AI file access
