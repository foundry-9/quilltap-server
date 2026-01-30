# Backup and Restore Guide

## Overview

Quilltap stores application data in **SQLite** and files in **S3-compatible storage**. This guide covers backing up and restoring your Quilltap data safely.

## Built-in Backup & Restore (Recommended)

Quilltap includes a built-in backup and restore system accessible from the **Tools** page (`/tools`).

### Using the UI

1. Navigate to **Tools** from the dashboard or sidebar
2. Click **Create Backup** to export your data:
   - **Download**: Creates a ZIP file downloaded to your computer
   - **Save to Cloud**: Stores the backup in your S3 storage for later restoration
3. Click **Restore from Backup** to import data:
   - Upload a local ZIP file, or
   - Select a cloud backup from the list

### What's Included in Backups

The backup creates a ZIP file containing:

- All characters and their metadata (including user-controlled characters)
- Chat history, messages, and impersonation state
- Tags
- Memories (including inter-character relationships)
- Connection profiles (API keys remain encrypted)
- Image profiles
- Embedding profiles
- LLM request/response logs
- File metadata (actual files are referenced from S3)

### Cloud Backups

Cloud backups are stored in your S3 bucket under `backups/{userId}/` and can be:

- Listed and restored directly from the UI
- Downloaded for offline storage
- Restored even after account data is cleared

### API Endpoints

For automation or scripting, you can use the backup API directly:

```bash
# Create a backup (save to S3)
curl -X POST https://your-quilltap/api/tools/backup/create \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{"destination": "s3"}'

# List cloud backups
curl https://your-quilltap/api/tools/backup/list \
  -H "Cookie: your-session-cookie"

# Preview a backup before restoring
curl -X POST https://your-quilltap/api/tools/backup/preview \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{"s3Key": "backups/user-id/backup-2024-01-15.zip"}'

# Restore from cloud backup
curl -X POST https://your-quilltap/api/tools/backup/restore \
  -H "Content-Type: application/json" \
  -H "Cookie: your-session-cookie" \
  -d '{"s3Key": "backups/user-id/backup-2024-01-15.zip"}'
```

---

## Manual Backup Procedures

For server administrators who need direct database access or want additional backup strategies involving SQLite:

## Data Structure

Since Quilltap uses SQLite, all data is contained in a single database file. The database includes tables for:

- `users` - User accounts and authentication data
- `characters` - Character definitions and metadata (includes `controlledBy` for LLM/user control)
- `chats` - Chat metadata, message history, and impersonation state
- `files` - File metadata (actual files stored in S3)
- `tags` - Tag definitions
- `memories` - Character memory data with inter-character relationships
- `connectionProfiles` - LLM connection configurations
- `embeddingProfiles` - Embedding provider configurations
- `imageProfiles` - Image generation configurations
- `llm_logs` - LLM request/response logs for debugging and monitoring

### S3 Storage

Files are stored in S3-compatible storage:

- `users/{userId}/files/` - User-uploaded files
- `users/{userId}/images/` - Generated and uploaded images

**Important:**

- `ENCRYPTION_MASTER_PEPPER` in `.env` - Master encryption key (required to decrypt API keys)
- SQLite database file path configuration
- S3 credentials and bucket configuration

## Regular Backups

### Automated Daily Backups

For production environments, set up automated daily backups using cron:

```bash
#!/bin/bash
# Create backup script: backup-quilltap.sh
BACKUP_DIR="/backups/quilltap"
SQLITE_PATH="/app/quilltap/data/quilltap.db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Backup SQLite database
cp "$SQLITE_PATH" "$BACKUP_DIR/quilltap_$TIMESTAMP.db"
tar -czf "$BACKUP_DIR/quilltap_$TIMESTAMP.db.tar.gz" \
  -C "$BACKUP_DIR" "quilltap_$TIMESTAMP.db"
rm "$BACKUP_DIR/quilltap_$TIMESTAMP.db"

# Backup S3 files (using MinIO client or AWS CLI)
# mc mirror myminio/quilltap-files "$BACKUP_DIR/s3_$TIMESTAMP"

# Keep only last 7 days of backups
find "$BACKUP_DIR" -name "quilltap_*.db.tar.gz" -mtime +7 -delete
```

Add to crontab:

```bash
crontab -e
# Add line: 0 2 * * * /path/to/backup-quilltap.sh
```

### Manual Backups

**SQLite Database Backup:**

```bash
# Simple copy of database file
cp /path/to/quilltap.db /backup/quilltap-$(date +%Y%m%d).db

# Or create a compressed archive
tar -czf quilltap-$(date +%Y%m%d).db.tar.gz /path/to/quilltap.db

# While the application is running (recommended):
# SQLite can be safely backed up while in use due to WAL mode
cp /path/to/quilltap.db /backup/quilltap-$(date +%Y%m%d).db
```

**S3/MinIO Backup:**

```bash
# Using MinIO client
mc mirror myminio/quilltap-files ./s3-backup-$(date +%Y%m%d)/

# Using AWS CLI
aws s3 sync s3://quilltap-files ./s3-backup-$(date +%Y%m%d)/ --endpoint-url http://localhost:9000
```

**Docker Environment:**

```bash
# Backup SQLite database from Docker volume
docker cp quilltap-app:/app/quilltap/data/quilltap.db ./quilltap-$(date +%Y%m%d).db

# Or backup the entire data directory
docker cp quilltap-app:/app/quilltap/data ./quilltap-data-backup-$(date +%Y%m%d)/
```

## Backup Best Practices

### Before Major Operations

Always backup before:

- Upgrading to a new version
- Making configuration changes
- Running production deployments
- Modifying encryption settings

### Backup Location

Store backups in multiple locations:

```bash
# Local SQLite backup
cp /path/to/quilltap.db ./quilltap-backup-$(date +%Y%m%d).db

# Network backup (NAS/Network share)
cp quilltap-backup-*.db /mnt/nas/quilltap-backups/

# Cloud backup for SQLite database
aws s3 cp quilltap-backup-*.db s3://my-backup-bucket/quilltap/

# For S3 files, sync to another bucket
aws s3 sync s3://quilltap-files s3://my-backup-bucket/quilltap-files/
```

### Encryption & Security

**Protect your backups:**

```bash
# Encrypt SQLite backup with GPG
gpg --symmetric --cipher-algo AES256 -o quilltap-backup.db.gpg quilltap-backup.db

# Encrypt with OpenSSL
openssl enc -aes-256-cbc -in quilltap-backup.db -out quilltap-backup.db.enc

# Verify backup integrity
sha256sum quilltap-backup.db > quilltap-backup.db.sha256
```

## Restore Procedures

### From SQLite Backup

**Stop the application first:**

```bash
docker-compose down
# OR for local development
# Kill the npm dev process
```

**Restore SQLite database:**

```bash
# From uncompressed backup
cp quilltap-backup-YYYYMMDD.db /path/to/quilltap.db

# From compressed archive
tar -xzf quilltap-backup-YYYYMMDD.db.tar.gz -C /path/to/
cp quilltap.db /path/to/quilltap.db
```

**Restore S3 files:**

```bash
# Using MinIO client
mc mirror ./s3-backup-YYYYMMDD/ myminio/quilltap-files

# Using AWS CLI
aws s3 sync ./s3-backup-YYYYMMDD/ s3://quilltap-files/ --endpoint-url http://localhost:9000
```

**Restart the application:**

```bash
docker-compose up -d
# OR
npm run dev
```

### From Docker Container Backup

```bash
# Stop container
docker-compose down

# Restore SQLite database file
docker cp ./quilltap-backup-YYYYMMDD.db quilltap-app:/app/quilltap/data/quilltap.db

# Restart
docker-compose up -d
```

### From Encrypted Backup

```bash
# Decrypt (GPG)
gpg -d quilltap-backup-YYYYMMDD.db.gpg > quilltap-backup-YYYYMMDD.db

# Decrypt (OpenSSL)
openssl enc -d -aes-256-cbc -in quilltap-backup-YYYYMMDD.db.enc -out quilltap-backup-YYYYMMDD.db

# Then restore as normal
cp quilltap-backup-YYYYMMDD.db /path/to/quilltap.db
```

### From Cloud Storage

```bash
# Download SQLite backup from S3
aws s3 cp s3://my-backup-bucket/quilltap/quilltap-backup-YYYYMMDD.db .

# Restore SQLite database
cp quilltap-backup-YYYYMMDD.db /path/to/quilltap.db

# Sync S3 files back
aws s3 sync s3://my-backup-bucket/quilltap-files/ s3://quilltap-files/
```

## Verification

### Check Backup Integrity

```bash
# Verify SQLite database file is valid
sqlite3 quilltap-backup-YYYYMMDD.db "SELECT COUNT(*) FROM users;"

# For compressed backups
tar -tzf quilltap-backup-YYYYMMDD.db.tar.gz | head

# Verify checksum
sha256sum -c quilltap-backup-YYYYMMDD.db.sha256
```

### Test Restore (Optional Environment)

Before restoring to production, test on a separate SQLite database:

```bash
# Create a test copy
cp quilltap-backup-YYYYMMDD.db quilltap-test.db

# Verify data
sqlite3 quilltap-test.db "SELECT COUNT(*) FROM users;"
sqlite3 quilltap-test.db "SELECT COUNT(*) FROM characters;"

# If verification succeeds, use this backup for restoration
rm quilltap-test.db
```

## Recovery Scenarios

### Lost Encryption Key

**Without `ENCRYPTION_MASTER_PEPPER`:**

All encrypted API keys and authentication tokens become unrecoverable. You will need to:

1. Restore from a backup made while you had the key
2. Set `ENCRYPTION_MASTER_PEPPER` to the original value
3. Users can log back in and re-add their API keys

**Prevention:**

```bash
# Backup encryption key separately
echo $ENCRYPTION_MASTER_PEPPER > /secure/location/encryption-pepper.txt
chmod 600 /secure/location/encryption-pepper.txt
```

### Corrupted SQLite Database

If SQLite database is corrupted:

```bash
# Check database integrity
sqlite3 /path/to/quilltap.db "PRAGMA integrity_check;"

# If corrupted, restore from backup
cp quilltap-backup-YYYYMMDD.db /path/to/quilltap.db

# Restart the application
docker-compose restart app
```

### Lost S3 Files

If S3 files are lost but metadata exists in the SQLite database:

```bash
# The application handles missing files gracefully
# Users can re-upload avatars and files as needed

# Or restore from S3 backup
aws s3 sync s3://my-backup-bucket/quilltap-files/ s3://quilltap-files/
```

## Monitoring Backups

### Backup Validation Script

```bash
#!/bin/bash
# backup-validate.sh
BACKUP_FILE="$1"

echo "Validating backup: $BACKUP_FILE"

# Check file exists
if [ ! -f "$BACKUP_FILE" ]; then
  echo "ERROR: Backup file not found"
  exit 1
fi

# Check file size
SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Backup size: $SIZE"

# Verify gzip integrity
if gunzip -t "$BACKUP_FILE" 2>/dev/null; then
  echo "✓ Archive integrity verified"
else
  echo "✗ Archive corrupted"
  exit 1
fi

echo "Validation complete"
```

Usage:

```bash
bash backup-validate.sh quilltap-20250120_120000.db.tar.gz
```

### Alert on Missing Backups

```bash
#!/bin/bash
# check-backup-age.sh
BACKUP_DIR="/backups/quilltap"
MAX_AGE_DAYS=2

LATEST=$(ls -t "$BACKUP_DIR"/quilltap_*.db.tar.gz 2>/dev/null | head -1)

if [ -z "$LATEST" ]; then
  echo "ERROR: No backups found in $BACKUP_DIR"
  # Send alert (email, webhook, etc.)
  exit 1
fi

MODIFIED=$(stat -f %m "$LATEST" 2>/dev/null || stat -c %Y "$LATEST")
NOW=$(date +%s)
AGE=$((($NOW - $MODIFIED) / 86400))

if [ $AGE -gt $MAX_AGE_DAYS ]; then
  echo "WARNING: Latest backup is $AGE days old"
  # Send alert
  exit 1
fi

echo "Latest backup is current: $AGE days old"
```

## Disaster Recovery Plan

### Recovery Time Objective (RTO): 30 minutes

1. **Detection** (5 min): Monitor alerts, confirm data loss
2. **Access Backup** (5 min): Retrieve latest SQLite and S3 backups from secure location
3. **Preparation** (10 min): Verify backup integrity, prepare SQLite and S3
4. **Restore** (5 min): Restore SQLite and S3 data
5. **Verification** (5 min): Check application starts and data is correct

### Recovery Point Objective (RPO): 24 hours

- Daily automated backups at 2 AM
- Last backup ensures maximum 24-hour data loss
- Increase frequency to hourly for production critical systems

### Step-by-Step Recovery

1. **Verify you have the backup:**

   ```bash
   ls -lh /backups/quilltap/quilltap_*.db.tar.gz | tail -3
   ```

2. **Stop the application:**

   ```bash
   docker-compose down
   ```

3. **Restore encryption key (if needed):**

   ```bash
   export ENCRYPTION_MASTER_PEPPER=$(cat /secure/location/encryption-pepper.txt)
   ```

4. **Restore SQLite database:**

   ```bash
   cp /backups/quilltap/quilltap_LATEST.db /app/quilltap/data/quilltap.db
   ```

5. **Restore S3 files (if backed up):**

   ```bash
   aws s3 sync /backups/quilltap/s3_LATEST/ s3://quilltap-files/
   ```

6. **Start application:**

   ```bash
   docker-compose up -d
   ```

7. **Verify:**

   ```bash
   docker-compose logs -f app
   curl http://localhost:3000/api/health
   ```

## Compliance & Retention

### Data Retention Policy

- **Active backups**: Keep 7 days of daily backups
- **Archive backups**: Keep 4 weekly backups
- **Historical**: Keep 1 backup per month for 1 year

```bash
# Implement retention policy
BACKUP_DIR="/backups/quilltap"

# Delete SQLite backups older than 7 days
find "$BACKUP_DIR" -name "quilltap_*.db.tar.gz" -mtime +7 -delete

# Verify deletion
ls -lh "$BACKUP_DIR"
```

### Backup Auditing

```bash
# Log all backup operations
echo "$(date): Backup started" >> $BACKUP_DIR/backup.log
cp "$SQLITE_PATH" "$BACKUP_FILE" >> $BACKUP_DIR/backup.log 2>&1
echo "$(date): Backup completed. Size: $(du -h $BACKUP_FILE)" >> $BACKUP_DIR/backup.log
```

## Troubleshooting

### Backup is Too Large

SQLite backups are typically smaller than MongoDB backups due to the single-file format. If backups are large:

```bash
# Use compression (recommended)
tar -czf quilltap-backup-$(date +%Y%m%d).db.tar.gz /path/to/quilltap.db

# Monitor backup file size
du -h quilltap-backup-*.db*
```

### Restore Takes Too Long

SQLite restore is typically fast since it's a file copy operation:

```bash
# Monitor restore progress
ls -lh /path/to/quilltap.db

# Check application startup logs
docker-compose logs -f app
```

### Verification Failures

```bash
# Check SQLite database validity
sqlite3 /path/to/quilltap.db "PRAGMA integrity_check;"

# Verify table counts
sqlite3 /path/to/quilltap.db "SELECT COUNT(*) FROM users;"
sqlite3 /path/to/quilltap.db "SELECT COUNT(*) FROM characters;"

# Check S3 connectivity
aws s3 ls s3://quilltap-files/ --endpoint-url http://localhost:9000
```

## Further Reading

- [Data Management](../README.md#data-management)
- [Deployment Guide](DEPLOYMENT.md)
