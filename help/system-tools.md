# System Tools

> **[Open this page in Quilltap](/foundry)**

The Tools page (`/foundry`) is your command center for managing and maintaining your Quilltap system. It provides utilities for backing up your data, importing/exporting, monitoring tasks, and managing your system's capabilities.

## Accessing the Tools Page

Navigate to the **Tools** page in Quilltap at `/foundry` or through your app's navigation menu. The page displays several utility cards, each providing different system management features.

## Available Tools

### 1. Backup & Restore

**Purpose:** Create full backups of your Quilltap data and restore from previous backups.

**What it does:**

- Creates complete snapshots of all your data (characters, chats, memories, files, settings)
- Stores backups securely
- Allows you to restore your entire system from a backup
- Lists all available backups with creation dates and file sizes

**When to use it:**

- Before making major system changes
- Regular scheduled backups for data protection
- Before trying experimental features
- To recover data if something goes wrong

For detailed instructions, see [Backup & Restore](system-backup-restore.md).

### 2. Import / Export

**Purpose:** Transfer your data in and out of Quilltap in native format.

**What it does:**

- **Export:** Save your data (characters, chats, memories, templates) to files
- **Import:** Load data from export files back into Quilltap
- Supports conflict resolution when importing (replace, keep, merge)
- Can include or exclude memories during export/import

**When to use it:**

- Sharing data with others
- Migrating between instances
- Backing up specific data (not everything)
- Transferring characters or chats to another system

For detailed instructions, see [Import & Export Data](system-import-export.md).

### 3. Tasks Queue

**Purpose:** Monitor and manage background jobs (memory extraction, analysis, processing).

**What it does:**

- Shows all background tasks currently running or queued
- Displays task progress and estimated completion time
- Lists failed tasks with error information
- Allows pausing and resuming tasks
- Shows memory usage and system load

**Common tasks:**

- Memory extraction (analyzing chat messages for important information)
- Character analysis
- File processing
- Import operations

For detailed instructions, see [Managing Tasks](system-tasks-queue.md).

### 4. Capabilities Report

**Purpose:** Generate detailed reports about your system's capabilities and configuration.

**What it does:**

- Generates comprehensive system capability reports
- Documents installed providers (AI, image generation, etc.)
- Lists available models and their configurations
- Shows connection profiles and their settings
- Saves reports for later reference

**When to use it:**

- Troubleshooting system issues
- Documenting your setup
- Sharing configuration details with support
- Planning system upgrades

For detailed instructions, see [Capabilities Report](system-capabilities-report.md).

### 5. LLM Logs

**Purpose:** View detailed logs of all AI interactions and model calls.

**What it does:**

- Displays recent LLM (Language Model) logs
- Shows each API call to AI providers
- Lists tokens used and estimated costs
- Shows success/failure status
- Allows viewing detailed log information

**When to use it:**

- Debugging AI responses
- Understanding token usage
- Reviewing cost estimates
- Troubleshooting provider issues

For detailed instructions, see [LLM Logs](system-llm-logs.md).

### 6. Delete All Data

**Purpose:** Permanently delete your entire Quilltap account and all associated data.

**Warning:** This action is irreversible and will delete:

- All characters
- All chats and messages
- All memories
- All files
- All settings and profiles
- All backups

**When to use it:**

- Completely resetting your account
- Uninstalling Quilltap and removing all traces
- Starting completely fresh

For detailed instructions, see [Deleting Your Data](system-delete-data.md).

## Quick Start Guide

**For data safety:**

1. Go to Tools page
2. Click **Backup & Restore**
3. Create a backup

**To transfer data:**

1. Go to Tools page
2. Click **Import / Export**
3. Choose Export to save your data

**To monitor system:**

1. Go to Tools page
2. Check **Tasks Queue** for active jobs
3. View **LLM Logs** for recent activity

## Safety & Best Practices

**Regular Backups:**

- Create backups weekly or before major changes
- Store backups in a safe location
- Test restore functionality occasionally

**Before System Changes:**

- Create a backup
- Check Tasks Queue to ensure no jobs are running
- Note your current configuration in a Capabilities Report

**Monitoring System Health:**

- Check Tasks Queue regularly to ensure jobs complete successfully
- Review LLM Logs if experiencing issues
- Generate Capabilities Reports periodically to document your setup

## Related Topics

- [Backup & Restore](system-backup-restore.md) - Detailed backup and restore guide
- [Import & Export Data](system-import-export.md) - Moving data in and out of Quilltap
- [Managing Tasks](system-tasks-queue.md) - Background job management
- [Capabilities Report](system-capabilities-report.md) - System capability documentation
- [LLM Logs](system-llm-logs.md) - AI interaction logging and troubleshooting
- [Deleting Your Data](system-delete-data.md) - Account and data deletion
