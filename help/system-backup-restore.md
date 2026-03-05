---
url: /settings?tab=system
---

# Backup & Restore

> **[Open this page in Quilltap](/settings?tab=system)**

The Backup & Restore tool lets you create complete backups of your Quilltap system and restore from previous backups.

## What Gets Backed Up?

A complete backup includes everything needed to recreate your Quilltap environment:

**Your Content**
- All characters and their configurations
- All chat histories and messages
- All memories and memory data
- All files you've uploaded (images, documents, attachments)
- All folder structures you've created
- Projects and their settings

**Profiles & Settings**
- Connection profiles (API key references — keys need re-entry after restore)
- Image generation profiles
- Embedding profiles
- Chat display and behavior settings
- File write permissions (LLM file access grants)
- Plugin configurations (per-plugin settings)

**Templates & Organization**
- Prompt templates (user-created)
- Roleplay templates (user-created)
- Tags and organizational data

**Plugins**
- npm-installed plugins from your `plugins/npm/` directory
- Plugin-specific configurations

**Logs & History**
- LLM request/response logs (the Inspector's records)

**Not Included in Backups**

Certain data is intentionally excluded from backups:

- **API keys** — encrypted with device-specific keys and cannot be transferred between instances. You will need to re-enter your API keys in your connection, image, and embedding profiles after a restore.
- **Encryption key (.dbkey file)** — the master encryption key for your database is not included for security. Keep your `.dbkey` file backed up separately if you use database encryption.
- **Embedding vectors and search indices** — these are regenerated automatically after restore. Semantic search in the Commonplace Book may be temporarily unavailable until reindexing completes.
- **Background jobs** — any in-flight or queued tasks (embedding generation, memory extraction, etc.) are not preserved. They will be re-triggered as needed.
- **Built-in plugins** — these ship with Quilltap and do not need backing up.
- **Cached provider model lists** — while included in backups for convenience, these are refreshed automatically from your providers.

## Creating a Backup

**Step-by-Step:**

1. **Go to the **AI Providers** tab in Settings** (`/settings?tab=providers`)

2. **Find the Backup & Restore card**

3. **Click the "Create Backup" button**

4. **Wait for the backup to be created**
   - A progress indicator may be displayed
   - Time depends on amount of data

5. **Download the backup file**
   - Your browser will download a ZIP file
   - The file contains all your data

6. **Store the backup safely**
   - Save it to a secure location on your computer
   - Consider cloud storage (Google Drive, Dropbox, etc.) for redundancy

**Backup sizes:**

- Varies based on your data volume
- Typically 10 MB - 1 GB depending on number of characters, chats, and files
- Backups are compressed to save space

## Restoring from a Backup

**Important:** Restoring can either replace your current data or import alongside it.

**Step-by-Step:**

1. **Go to the **AI Providers** tab in Settings** (`/settings?tab=providers`)

2. **Find the Backup & Restore card**

3. **Click "Restore from Backup"**

4. **Select your backup file**
   - Click to browse or drag and drop
   - Supports .zip backup files

5. **Preview the backup contents**
   - See what's included (characters, chats, files, etc.)
   - Review the counts before proceeding

6. **Choose restore mode:**
   - **Replace Existing Data:** Delete all current data and replace with backup
   - **Import as New Data:** Keep existing data and import backup with new IDs

7. **Confirm and start restore**
   - For "Replace" mode, you must confirm the deletion warning
   - Click "Start Restore"

8. **Wait for restore to complete**
   - System will show progress
   - Do not close the browser tab

9. **Restore complete**
   - Your system reloads with the restored data
   - npm plugins are extracted and ready to use

## Restore Modes Explained

**Replace Existing Data:**
- Deletes ALL your current data
- Replaces it entirely with the backup contents
- Use when migrating to a new instance
- Use when recovering from data corruption
- Cannot be undone

**Import as New Data:**
- Keeps all your existing data
- Imports backup contents with regenerated IDs
- Use to merge data from another instance
- Use to duplicate content for testing
- Existing data remains untouched

## Understanding Backup Timing

**When to create backups:**

- **Before major changes:** System updates, configuration changes
- **Regularly:** Weekly or monthly for data protection
- **Before experiments:** Trying new features or settings
- **Before deletion:** Before deleting large amounts of data
- **Before migration:** Before moving to a different instance

**When NOT to restore with "Replace" mode:**

- Don't replace if you've made important changes since the backup was created
- Consider "Import" mode if you want to preserve current data

## Managing Your Backups

**Storing backups:**

- Save backups to your computer's documents folder
- Use cloud storage (Google Drive, Dropbox, iCloud) for redundancy
- Consider external hard drives for large backups
- Name files clearly with dates (e.g., `quilltap-backup-2026-02-03.zip`)

**Backup organization tips:**

- Keep at least 2-3 recent backups
- Delete old backups when they're no longer needed
- Archive important milestone backups separately

## Troubleshooting

**Backup failed**

- Check that your system has enough disk space
- Try again after stopping any running tasks
- Check the browser console for error details

**Restore failed**

- Ensure the backup file is not corrupted
- Try a different backup file
- Check that the file is a valid Quilltap backup (.zip format)

**Backup is very large**

- Large file collections increase backup size
- Consider archiving old files you don't need
- Backups are compressed but can still be large with many images

**API keys missing after restore**

- API keys are not backed up for security reasons
- Re-enter your API keys in connection profiles after restore
- The connection profile settings are preserved, just not the keys

## Best Practices

**Regular Backups:**

- Create a backup at least weekly
- Create before major system changes
- Keep at least 2-3 recent backups

**Backup Retention:**

- Don't keep backups forever - they take up space
- Delete backups older than 3 months unless you have a specific need
- Archive important backups to cloud storage

**Testing Restores:**

- Periodically test that you can restore successfully
- Verify your backup strategy works before you really need it
- Use "Import" mode to test without affecting current data

**Secure Storage:**

- Store backups in a secure location
- Don't share backup files - they contain all your data
- Consider encrypting sensitive backups

## Related Topics

- [System Tools](system-tools.md) - Overview of all system tools
- [Import & Export Data](system-import-export.md) - Transferring data in and out
- [Managing Tasks](system-tasks-queue.md) - Background job monitoring
