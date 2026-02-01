# Backup & Restore

> **[Open this page in Quilltap](/tools)**

The Backup & Restore tool lets you create complete backups of your Quilltap system and restore from previous backups.

## What Gets Backed Up?

A complete backup includes:

- All characters and their configurations
- All chat histories and messages
- All memories and memory data
- All files you've uploaded
- All settings and profiles
- Templates and prompts
- API keys and connection profiles
- Tags and organizational data

**Not included:** Running background jobs or temporary data.

## Creating a Backup

**Step-by-Step:**

1. **Go to the Tools page** (`/tools`)

2. **Find the Backup & Restore card**

3. **Click the "Create Backup" button** (usually blue/primary colored)

4. **Choose backup options:**
   - **Include Images:** Whether to include uploaded images in the backup
   - **Local or Cloud:** Where to store the backup

5. **Wait for backup to complete**
   - Backup progress may be displayed
   - Time depends on amount of data
   - You can continue working while backup runs

6. **Confirmation message appears** when backup is complete

**Backup sizes:**

- Varies based on your data volume
- Typically 10 MB - 1 GB depending on number of characters, chats, and files
- Cloud backups are compressed to save space

## Viewing Available Backups

The Backup & Restore card shows a list of your backups:

**For each backup, you see:**

- **Filename** - The backup's name (usually includes date/time)
- **Created At** - When the backup was made
- **Size** - The file size of the backup

**Actions available:**

- **Restore** - Load this backup (see below)
- **Download** - Save the backup file locally
- **Delete** - Remove this backup (to save space)

## Restoring from a Backup

**Important:** Restoring a backup replaces your current data with the backup's data.

**Step-by-Step:**

1. **Go to the Tools page** (`/tools`)

2. **Find the Backup & Restore card**

3. **Locate the backup** you want to restore in the list

4. **Click the "Restore" button** next to that backup

5. **Review restore options:**
   - Confirm which backup you're restoring
   - Note the backup date/time
   - Understand that current data will be replaced

6. **Click "Confirm Restore"** (usually after confirming)

7. **Wait for restore to complete**
   - System will show progress
   - May take several minutes
   - Do not close the browser tab

8. **Restore complete**
   - Your system reloads with backup data
   - All data is restored to the backup state

## Understanding Backup Timing

**When to create backups:**

- **Before major changes:** System updates, configuration changes
- **Regularly:** Weekly or monthly for data protection
- **Before experiments:** Trying new features or settings
- **Before deletion:** Before deleting large amounts of data
- **Before migration:** Before moving to a different instance

**When NOT to restore:**

- Don't restore if you've made important changes since the backup was created
- Don't restore repeatedly - each restore loses any data added after the backup

## Backup Storage Locations

**Local Backup:**

- Stored on your Quilltap instance
- Suitable for personal instances
- Takes up disk space on your server
- Fast to access and restore

**Cloud Backup:**

- Stored securely in cloud storage (usually S3 or similar)
- Suitable for shared instances
- Provides geographic redundancy
- Accessible from anywhere

## Managing Your Backups

**To download a backup locally:**

1. In the backup list, click the "Download" button
2. The backup file downloads to your computer
3. Store it in a safe location

**To delete old backups:**

1. In the backup list, locate the backup to delete
2. Click the "Delete" button
3. Confirm deletion
4. Backup is removed (to free up space)

**To organize backups:**

- Backups are listed with creation dates
- Most recent appear first
- You can sort by date or size

## Troubleshooting

**Backup failed**

- Check that your system has enough disk space
- Try again after stopping any running tasks
- Contact support if issue persists

**Restore failed**

- Ensure the backup file is not corrupted
- Try restoring an older backup
- Contact support if multiple backups fail

**Can't see my backups**

- Refresh the page
- Check if you're looking at the right backup location (local vs. cloud)
- Some backups may have expired or been deleted

**Backup is very large**

- You can exclude images from future backups (less space)
- Or regularly delete old backups you don't need
- Upload files are included in backups - consider archiving old files

## Best Practices

**Regular Backups:**

- Create a backup at least weekly
- Create before major system changes
- Keep at least 2-3 recent backups

**Backup Retention:**

- Don't keep backups forever - they take up space
- Delete backups older than 3 months unless you have a specific need
- Archive important backups locally on your computer

**Testing Restores:**

- Periodically test that you can restore successfully
- Verify your backup strategy works before you really need it
- Document which backups are most important

**Secure Storage:**

- If backing up locally, store in a safe place
- For cloud backups, rely on your hosting provider's security
- Keep your login credentials secure

## Related Topics

- [System Tools](system-tools.md) - Overview of all system tools
- [Import & Export Data](system-import-export.md) - Transferring data in and out
- [Managing Tasks](system-tasks-queue.md) - Background job monitoring
