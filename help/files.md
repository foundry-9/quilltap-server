---
url: /files
---

# Files Management

> **[Open this page in Quilltap](/files)**

The Files page is where you upload, organize, and manage all your general files in Quilltap. General files are files not associated with any specific project, making them accessible to the AI in any chat.

## What Are General Files?

General files are:

- **Global** — Accessible to the AI in any chat (unlike project files which are project-specific)
- **Organized** — Can be stored in folders and organized by category
- **Accessible** — Can be read, previewed, edited, and managed from the Files page
- **Promotable** — Chat message attachments can be saved as permanent general files

Compare with:

- **Project Files** — Only accessible within a specific project's chats
- **Message Attachments** — Temporary files attached to individual messages
- **Character Images** — Specific to character profiles

## Accessing the Files Page

1. Click **Files** in the left sidebar (folder icon)
2. Or navigate to the Files section in the main menu
3. You'll see your general files organized in folders

## Understanding the Files Interface

### Main Elements

**Header Section:**

- Title: "Files"
- Description: "Browse and manage your general files (not in any project)"
- Quick action buttons

**File Browser:**

- Grid or list view toggle (top of browser)
- Breadcrumb navigation showing current folder path
- File/folder listing with actions
- Sort and filter options

**About General Files Section:**

- Information about file scope and usage
- Explains project files vs. general files
- Notes about AI access and file management

## Viewing Files

### Grid View

The default view shows files as cards:

- **File Thumbnails** — Images show preview thumbnails, files show type icons
- **File Names** — Displayed with text wrapping
- **Folder Icons** — Directories show folder icon with file count
- **File Information** — Size, type, and date (on hover)
- **Action Buttons** — Download, preview, edit, delete, move (on hover)

**When to use:** Visual browsing, working with images, quick scanning

### List View

Alternative tabular view:

- **Name Column** — File or folder name
- **Associations Column** — What's using this file (characters, chats, etc.)
- **Type Column** — File type (image, PDF, text, etc.)
- **Date Column** — Creation or modification date
- **Sort Options** — Click column headers to sort
- **Action Buttons** — At the end of each row

**When to use:** Detailed information, working with many files, sorting needs

### Switching Views

1. Look for view toggle buttons (grid/list icons) at the top of the file browser
2. Click to switch between Grid and List views
3. Your preference is saved for next time

## Navigating Folders

### Breadcrumb Navigation

At the top of the file browser:

- Shows current location (e.g., `/documents/reports/`)
- Click any part to jump to that folder
- Click root `/` to go to top level

**Example path:** `/` > `Documents` > `Reports`

### Folder Contents

- **Folders** appear first with folder icon and file count
- **Files** appear below with file type icon or thumbnail
- Both can be expanded or navigated into

### Creating Folders

1. In the file browser, look for **New Folder** or **+ Folder** button
2. Enter a folder name (e.g., "Projects", "Research")
3. Press Enter or click Create
4. Folder appears in the current directory
5. Can create nested folders (e.g., `/Documents/2025/`)

### Going Up

To go to the parent folder:

1. Click the **up arrow** or **..** at the top of the file list
2. Or click the parent folder name in the breadcrumb
3. You move up one level in the hierarchy

## Uploading Files

### Single File Upload

1. Click **Upload** or **+ Upload** button
2. Choose the file(s) from your computer
3. Files are uploaded to the current folder
4. See progress indicator while uploading
5. File appears in the list when complete

### Multiple File Upload

1. Click **Upload** button
2. Hold **Ctrl** (Windows) or **Cmd** (Mac) while selecting files
3. Click Open to upload all selected files at once
4. All files upload to current folder

### Drag and Drop Upload

Many systems support dragging files directly:

1. Drag file from your computer's file explorer
2. Drop onto the file browser area
3. File uploads automatically to current folder

**Note:** If not available, use the Upload button

### Supported File Types

Quilltap accepts most file types:

- **Images** — JPG, PNG, GIF, WebP, SVG, BMP, TIFF, etc.
- **Documents** — PDF, DOCX, DOC, PPTX, XLS, XLSX, etc.
- **Text** — TXT, MD, CSV, JSON, XML, HTML, CSS, JS, etc.
- **Code** — Python, JavaScript, TypeScript, Java, C++, etc.
- **Archives** — ZIP, RAR, 7Z, TAR, GZ, etc.
- **Media** — MP3, MP4, WAV, AVI, MOV, etc.
- **Other** — Most file types accepted

**File Size:** Individual files can be quite large (check your storage limits)

## Managing Files

### Downloading Files

To save a file to your computer:

1. Find the file in the file browser
2. Click the **Download** button (down arrow icon)
3. File downloads to your Downloads folder
4. Can download multiple files

### Previewing Files

To view file content without downloading:

1. Click the **Preview** button (eye icon) or click the file name
2. A preview modal opens showing:
   - Full file content
   - File information (name, size, type, date)
   - Navigation arrows to view other files
   - Download option from preview

**Preview Capabilities:**

**Images:**

- Full-size display with metadata
- Zoom and pan capabilities
- Shows image dimensions and size

**PDFs:**

- Full PDF viewer with page navigation
- Can zoom in/out
- Search within PDF

**Text & Markdown:**

- Syntax-highlighted code
- Formatted markdown with headings, links, lists
- Line numbers for code files
- Special support for Wikilinks and YAML frontmatter

**Code Files:**

- Language-specific syntax highlighting
- Line numbers and indentation preserved
- Support for all common programming languages

**Unsupported Types:**

- Shows file information and metadata
- Download option available
- Type-specific icon displayed

### Navigating Within Preview

When previewing multiple files:

1. Use **arrow buttons** at top of preview to browse through files
2. Or use **arrow keys** on keyboard
3. File counter shows position (e.g., "2 of 5")
4. Files shown in same order as file browser

### Renaming Files

To change a file's name:

1. Find the file in the file browser
2. Right-click the file and select **Rename** (or click rename button if visible)
3. A modal appears with the current name highlighted
4. Type the new name
5. Press Enter or click Save
6. File name is updated immediately

**Tips:**

- Keep file names descriptive
- Use proper extensions (e.g., `.pdf`, `.txt`)
- Avoid special characters if possible

### Deleting Files

To remove a file permanently:

1. Find the file in the file browser
2. Click the **Delete** button (trash icon)
3. A confirmation dialog appears showing:
   - File name
   - Any associations (characters, chats using this file)
   - Warning if file is in use
4. Click **Confirm Delete** to remove the file

**Important:** Deletion is permanent and cannot be undone.

**If File is in Use:**

If the file is associated with characters or messages:

1. Confirmation shows what's using the file
2. You have options:
   - **Cancel** — Keep the file
   - **Delete Anyway** — Remove file and dissociate from characters/messages
3. Choose based on whether you still need the associations

### Moving Files

To move a file to a different folder or project:

1. Find the file in the file browser
2. Click the **Move** button (arrow icon)
3. Choose destination:
   - **Different folder** — Select from folder tree
   - **Project** — Move to a project (becomes project file, no longer general)
   - **General Files** — If in project, move back to general storage
4. Confirm the move
5. File appears in new location

**Use Cases:**

- Reorganizing files into folders
- Promoting files to projects for project-specific use
- Moving files from project to general storage

## File Organization

### Creating a Folder Structure

Plan your organization:

```
/
├── Documents/
│   ├── Research/
│   ├── Notes/
│   └── References/
├── Images/
│   ├── Characters/
│   ├── Locations/
│   └── Items/
├── Code/
│   └── Scripts/
└── Archives/
```

### Organization Tips

- **By Purpose** — Documents, Images, Code, etc.
- **By Project** — Folder for each project's files
- **By Date** — Year/Month subfolders for time-based organization
- **By Type** — Separate folders for images, documents, code

### Renaming Folders

To rename a directory:

1. Right-click the folder
2. Select **Rename**
3. Enter new folder name
4. Press Enter
5. Folder is renamed

**Note:** Renaming doesn't affect files inside the folder

### Deleting Folders

To remove an empty folder:

1. Right-click the folder
2. Select **Delete**
3. Confirm deletion
4. Folder is removed

**Note:** Can only delete empty folders. Move or delete files first.

## Using Files with AI

### AI Access to General Files

The AI in your chats can access general files using the **File Management Tool**:

**What the AI can do:**

- **List Files** — See what files and folders exist
- **Read Files** — View content of text, code, markdown, or other files
- **Create Files** — Create new text/code files (with your permission)
- **Organize** — Create folders and manage file structure
- **Use Content** — Reference file content in conversations

### Requesting AI File Access

To ask the AI to work with files:

1. In a chat, mention: "Use my files to..." or "Check the files..."
2. The AI requests access to your files
3. You approve or deny the request
4. If approved, AI can read and work with files

**Examples:**

- "Can you review the code in my files?"
- "Summarize the documents in my Research folder"
- "Create a new file with the analysis results"

### File Permissions

When AI requests access:

- You approve or deny each request
- AI cannot access files without permission
- Some operations (like writing files) may require confirmation
- File scope determines what AI can see (general vs. project files)

## File Associations

Files can be associated with:

- **Characters** — Used as profile images, body descriptions, etc.
- **Chats** — Attached to messages within conversations
- **Projects** — Project-specific files only used in that project

### Viewing Associations

In list view, the "Associations" column shows:

- What characters use this file (profile pictures, descriptions)
- Which chats include this as an attachment
- How many times used across the system

Click on associations to see details or navigate to related content.

### Managing Associations

If you delete a file that's in use:

- Confirm dialog shows associations
- Choose to delete anyway (removes associations) or cancel
- Associations are cleared if file is deleted

If you move a file:

- Associations remain with the file
- Character profile images follow file to new location
- Chat attachments can reference file in new location

## Promoting Message Attachments

Files attached to chat messages can be saved as permanent general files:

1. In a chat, find a message with file attachment
2. Look for **Save as File** or **Make Persistent** option
3. Choose to save as:
   - **General File** — Accessible in any chat
   - **Project File** — Accessible in this project's chats
4. Choose folder location
5. File is saved and appears in Files page

**Benefits:**

- Keep important chat files organized
- Make temporary attachments permanent
- Organize files by purpose

## Filesystem Sync

Quilltap's file storage is backed by real directories on disk. You may add, remove, or rearrange files directly in the filesystem — much as one might reshuffle the card catalogue at a particularly well-appointed library — and Quilltap will detect the changes.

### How It Works

A vigilant filesystem watcher monitors your files directory at all times, rather like a tireless butler who notices when someone has rearranged the silverware. When files appear, vanish, or change on disk, the database is updated automatically:

- **New files** discovered on disk appear as "untracked" in the file browser
- **Removed files** are quietly de-catalogued from the database
- **Changed files** have their records updated to match

### Untracked Files

Files found on disk without a corresponding database record are marked as **untracked**. They appear with a subtle amber indicator in both grid and list views. These are perfectly usable files — they simply arrived by some means other than the usual upload button. The AI can access them, you can preview them, and they behave in every respect like proper files, save for a faint air of mystery about their origins.

### Manual Sync

Should you wish to trigger an immediate reconciliation — perhaps after copying a great many files into the directory at once — click the **Sync** button (the circular arrows icon) in the file browser header. This performs a thorough scan of the entire files directory and ensures the database reflects reality with the utmost fidelity.

### On-Disk Layout

Files are stored in a straightforward directory structure:

```
files/
├── _general/           # General files (not in any project)
│   ├── documents/
│   │   └── my-notes.txt
│   └── my-image.png
├── {project-id}/       # Project-specific files
│   └── research/
│       └── data.csv
└── _thumbnails/        # Auto-generated image thumbnails
```

You may browse this directory at your leisure. It lives at the configured data path under the `files/` subdirectory.

### Startup Reconciliation

Each time Quilltap starts, it performs a comprehensive reconciliation — a sort of morning inventory, if you will — comparing every file on disk against every record in the database. Files that have appeared are catalogued; records for vanished files are retired. This ensures that even if the watcher missed something (perhaps during a period of dormancy), the slate is wiped clean at each fresh beginning.

## Troubleshooting Files

### Can't upload file

**Causes:**

- File too large
- Unsupported file type
- Network issue
- Storage full

**Solutions:**

- Check file size limits
- Try different file format
- Check internet connection
- Free up storage space

### File won't download

**Causes:**

- Network issue
- File corrupted during upload
- Browser security settings

**Solutions:**

- Try again later
- Check internet connection
- Try different browser
- Re-upload file

### Can't see files after uploading

**Causes:**

- Uploading still in progress
- Uploaded to wrong folder
- File browser needs refresh

**Solutions:**

- Wait for progress to complete
- Check current folder location (breadcrumb)
- Refresh page (Ctrl+R or Cmd+R)
- Navigate to different folder and back

### AI can't access files

**Causes:**

- File scope issue
- Permission denied
- File is project-specific but in wrong project

**Solutions:**

- Verify file is in general storage (not project)
- Grant permission when AI requests access
- Move file to general files if needed
- Check file is uploaded successfully

### File preview not working

**Causes:**

- Unsupported file type
- Corrupted file
- Very large file
- Browser issue

**Solutions:**

- Download file instead of preview
- Check file format is correct
- Try with smaller file
- Try different browser

### Folder operations slow

**Causes:**

- Many files in folder
- Network latency
- Large files being scanned

**Solutions:**

- Split large folders into subfolders
- Use search/filter instead of browsing
- Close unused tabs/apps
- Check internet connection

## Related Pages

- **Projects** — Manage project-specific files
- **Characters** — Upload character images and profile files
- **Chats** — Attach and manage message files
- **The Forge > File Storage** — Configure where files are stored
- **Search** — Find files by name or content
