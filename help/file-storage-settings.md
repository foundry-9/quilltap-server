# File Storage Settings

> **[Open this page in Quilltap](/foundry/forge)**

File Storage Settings configure where Quilltap stores uploaded files and generated images. You can use local filesystem storage, cloud storage, or a combination of both.

## Understanding File Storage

Quilltap needs to store:

- **Uploaded Images** — Images you upload to character profiles or memory
- **Generated Images** — Images created by AI image generation
- **Chat Attachments** — Files attached to chat messages
- **System Files** — Application data and backups
- **Profile Pictures** — Character and user avatars

Storage configuration determines where these files go and how they're accessed.

## Accessing File Storage Settings

1. Click **Settings** (gear icon) in the left sidebar
2. Click the **File Storage** tab
3. You'll see storage backend configuration

## Understanding Storage Backends

### Local Filesystem Storage

Files stored on your computer's hard drive.

**Pros:**

- Fast access
- No cloud costs
- Complete privacy
- No internet required

**Cons:**

- Limited to local machine
- May fill up disk space
- No backup to cloud
- Not accessible from other devices

**Best for:**

- Single-user local installation
- Private, sensitive content
- Development and testing

**Typical path:**

- Linux/Mac: `/home/user/.quilltap/files`
- Windows: `C:\Users\user\.quilltap\files`

### Cloud Storage (S3 Compatible)

Files stored on cloud provider (AWS S3, MinIO, etc.).

**Pros:**

- Scalable storage
- Accessible anywhere
- Automatic backups
- Disaster recovery

**Cons:**

- Requires internet
- API costs per operation
- Need cloud credentials
- Latency may be higher

**Best for:**

- Shared installations
- Large file volumes
- Multi-user setups
- Production deployments

**Providers:**

- Amazon S3
- MinIO (self-hosted S3-compatible)
- DigitalOcean Spaces
- Other S3-compatible services

## Viewing Storage Configuration

The Storage Settings page shows:

- **Active Mount Points** — Where files are currently stored
- **Default Mount** — Which location is used by default
- **Backend Type** — Local filesystem, S3, etc.
- **Health Status** — Whether backend is working
- **File Count** — Approximate number of files stored

## Creating a New Mount Point

### Step 1: Choose Backend Type

**For Local Storage:**

1. Click **Add Mount Point**
2. Select **Local Filesystem**
3. Continue to Step 2

**For Cloud Storage:**

1. Click **Add Mount Point**
2. Select **S3 Compatible** (or specific provider)
3. Obtain credentials from your cloud provider
4. Continue to Step 2

### Step 2: Configure Backend

**For Local Filesystem:**

- **Mount Name** — Give it a name (e.g., "Local Storage", "Main Drive")
- **Path** — Directory where files will be stored
  - Must be readable and writable
  - Should have sufficient free space
  - Example: `/home/user/quilltap-files`
- **Scope** — System-wide or user-specific
- **Default** — Make this default storage location

**For S3 Compatible Storage:**

- **Mount Name** — Name for this storage config (e.g., "AWS S3", "MinIO")
- **Access Key ID** — Your S3 access key
- **Secret Access Key** — Your S3 secret key
- **Bucket Name** — S3 bucket to use
- **Region** — AWS region (e.g., us-east-1)
- **Endpoint** — (Optional) For non-AWS S3 services like MinIO
- **Scope** — System-wide or user-specific
- **Default** — Make this default storage location

### Step 3: Test Connection

After creating a mount point:

1. Click **Test Connection**
2. Quilltap verifies:
   - Storage backend is accessible
   - Path exists and is writable (local) or credentials work (cloud)
   - Sufficient permissions to store files
3. Shows result:
   - ✓ **Healthy** — Storage is ready to use
   - ⚠️ **Degraded** — Storage works but has issues
   - ✗ **Unhealthy** — Storage can't be used

## Editing a Mount Point

To modify storage configuration:

1. Find the mount point in the list
2. Click **Edit** button
3. Update:
   - Mount name
   - Path (local) or credentials (cloud)
   - Default status
4. Click **Save Changes**
5. Test connection to verify it still works

## Setting a Default Mount Point

Your default storage is used when:

- Uploading files
- Saving generated images
- Storing attachments
- Storing system data

**To set as default:**

1. Find the mount point in the list
2. Click **Set as Default**
3. A badge shows "Default"
4. New files stored in this location

**Multiple mount points:**

- Can have many mount points configured
- Only one is default
- Can change default anytime
- Old files stay where they are stored

## Deleting a Mount Point

To remove storage configuration:

1. Find the mount point in the list
2. Click **Delete** button
3. Confirm deletion
4. Mount point is removed

**Important:** Deleting doesn't delete stored files — they remain in the location. You can manually delete them later if desired.

## Scanning for Orphaned Files

Over time, some files may become orphaned (not referenced by any content).

**To scan:**

1. Find the mount point in the list
2. Click **Scan for Orphans**
3. Quilltap scans the entire filesystem
4. Shows found orphaned files
5. Can delete orphaned files to free space

**When to scan:**

- Freeing up storage space
- After deleting many memories/characters
- Regular maintenance (monthly)

## File Storage Workflow

### Initial Setup (Fresh Installation)

1. Default local storage is automatically configured
2. Location depends on OS and installation type
3. Can check current location in File Storage tab
4. Most users can keep default setup

### Adding Cloud Storage

1. Create S3 bucket with cloud provider
2. Get access keys and credentials
3. Add mount point in Settings
4. Test connection
5. Optionally set as default for new uploads

### Switching Between Locations

1. Keep existing mount point (files stay there)
2. Add new mount point with different location
3. Set new location as default
4. New uploads go to new location
5. Old files remain in original location

### Backing Up Files

**Local to Cloud:**

1. Create S3 mount point (e.g., AWS S3)
2. Add as secondary storage
3. Manually copy files from local to cloud
4. Or implement backup script

**Manual Backup:**

1. Find local file path in File Storage settings
2. Copy directory to external drive
3. Store in safe location
4. Can restore by moving back

## Storage Requirements

### Disk Space Estimation

- **Avatar images** — ~100 KB each
- **Generated images** — 1-5 MB each
- **Chat documents** — ~10-100 KB each
- **Full system** — Varies (50 MB to several GB)

### Planning Storage

For average user with:

- 10 characters × 2 profiles = 20 avatars (~2 MB)
- 100 chats × 2 generated images = 200 images (~400 MB)
- Chat documents and misc files (~100 MB)
- **Total: ~500 MB for typical use**

For heavy users:

- Consider 5-10 GB depending on usage
- Monitor storage regularly
- Set up cleanup routine for old files

## Troubleshooting File Storage

### Mount point shows "Unhealthy"

**For Local Storage:**

- Check that path exists and is accessible
- Verify read/write permissions
- Ensure disk has free space
- Check file path is valid

**For Cloud Storage:**

- Verify S3 credentials are correct
- Check bucket exists and is accessible
- Verify region is correct
- Check IAM permissions allow access

### Can't upload files

**Causes:**

- No mount points configured
- Default mount point is unhealthy
- Disk/quota full

**Solutions:**

- Configure at least one mount point
- Fix unhealthy mount point or set different default
- Delete old files to free space
- Add additional storage

### Files disappear after upload

**Possible causes:**

- Mount point misconfigured
- Backend storage was reset
- Permissions issue

**Solutions:**

- Check mount point settings
- Verify backend storage (local disk or S3 bucket) isn't cleared
- Check file permissions
- Restore from backup if available

### Very slow file operations

**Causes:**

- Network latency (cloud storage)
- Slow storage backend
- Large file sizes

**Solutions:**

- Switch to local storage for speed
- Check network connection
- Optimize file sizes (compress images)
- Consider SSD for local storage

### Cloud storage costs high

**Causes:**

- Many API calls to storage
- Large file sizes
- Frequent uploads

**Solutions:**

- Batch operations where possible
- Compress images before upload
- Clean up old/orphaned files
- Use lifecycle policies to archive old files

## File Storage Best Practices

### Security

- **Local storage** — Secure your physical computer
- **Cloud storage** — Use strong credentials and 2FA
- **Access keys** — Rotate periodically
- **Encryption** — Enable if available (S3 encryption)
- **Backup** — Keep offline backup of important files

### Performance

- **Local first** — Use local storage when possible for speed
- **Cloud backup** — Use cloud as secondary backup location
- **Monitor** — Track storage usage over time
- **Cleanup** — Regularly remove orphaned files

### Maintenance

- **Monthly scan** — Scan for orphaned files
- **Quarterly review** — Check what's taking space
- **Backup routine** — Regular backups to safe location
- **Archive old** — Move very old files to archive storage

## Related Settings

- **Appearance** — Where profile avatars are stored
- **Images** — Generated image storage
- **Characters** — Character profile storage
- **Chats** — Chat attachment storage
- **Backup/Restore** — System-wide file management
