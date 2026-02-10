# Quilltap Production Deployment Guide

## Overview

Quilltap uses **SQLite** for data storage and **S3-compatible storage** for files. SQLite is self-contained and requires no external database services. You only need to configure S3-compatible storage for file uploads.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Server Setup](#server-setup)
- [Quick Start](#quick-start)
- [SSL Configuration](#ssl-configuration)
- [Environment Variables](#environment-variables)
- [Data Management](#data-management)
- [Monitoring](#monitoring)
- [Backup Strategy](#backup-strategy)
- [Updating](#updating)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### Server Requirements

- **Operating System**: Ubuntu 20.04+ or Debian 11+ (recommended)
- **RAM**: Minimum 2GB, recommended 4GB+
- **Storage**: Minimum 10GB SSD (SQLite database file)
- **CPU**: 2+ cores recommended
- **Network**: Public IP address with ports 80 and 443 accessible

### Domain Requirements

- Domain name pointing to your server's IP address
- DNS A record configured (allow 24-48 hours for propagation)

### Storage Requirements

For file storage, you need S3-compatible storage:

- For self-hosted deployments: MinIO running locally or in Docker
- For cloud deployments: AWS S3, Google Cloud Storage, or other S3-compatible service

### Required Software

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add your user to docker group (logout/login after)
sudo usermod -aG docker $USER

# Install Docker Compose
sudo apt install docker-compose-plugin -y

# Verify installations
docker --version
docker compose version
```

## Server Setup

### 1. Create Application User

```bash
# Create dedicated user for Quilltap
sudo adduser --disabled-password --gecos "" quilltap
sudo usermod -aG docker quilltap

# Switch to quilltap user
sudo su - quilltap
```

### 2. Clone Repository

```bash
cd ~
git clone https://github.com/foundry-9/quilltap.git
cd quilltap
```

### 3. Configure Firewall

```bash
# Exit quilltap user temporarily
exit

# Configure UFW firewall
sudo ufw allow 22/tcp     # SSH
sudo ufw allow 80/tcp     # HTTP
sudo ufw allow 443/tcp    # HTTPS
sudo ufw enable

# Verify rules
sudo ufw status
```

### 4. Create Data Directory

```bash
# As quilltap user
cd ~/quilltap

# Create data directory with proper permissions
mkdir -p data
chmod 755 data

# This directory will be populated by the application on first run
```

## Quick Start

### 1. Configure Environment Variables

```bash
# Copy environment template
cp .env.example .env.production

# Edit with your production values
nano .env.production
```

**Required variables:**

```env
# Authentication (production domain)
BASE_URL="https://yourdomain.com"
JWT_SECRET="$(openssl rand -base64 32)"

# Google OAuth (get from https://console.cloud.google.com/) - optional
GOOGLE_CLIENT_ID="your-google-client-id"
GOOGLE_CLIENT_SECRET="your-google-client-secret"

# Encryption (optional: auto-generated on first run via /setup wizard)
# If set, takes precedence over the pepper vault. You'll be prompted to store it.
# ENCRYPTION_MASTER_PEPPER="$(openssl rand -base64 32)"

# SQLite Database
# Database file is automatically created and stored in the data directory
SQLITE_PATH="/app/quilltap/data/quilltap.db"

# S3 Storage (REQUIRED)
# For external S3 (production):
S3_MODE="external"
S3_ENDPOINT="https://s3.amazonaws.com"  # or your MinIO endpoint
S3_REGION="us-east-1"
S3_ACCESS_KEY="your-access-key"
S3_SECRET_KEY="your-secret-key"
S3_BUCKET="quilltap-files"

# SSL
DOMAIN="yourdomain.com"
SSL_EMAIL="admin@yourdomain.com"
```

### 2. Setup Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable Google+ API
4. Go to Credentials → Create Credentials → OAuth client ID
5. Application type: Web application
6. Authorized redirect URIs:
   - `https://yourdomain.com/api/auth/oauth/google/callback`
7. Copy Client ID and Client Secret to `.env.production`

### 3. Initialize SSL Certificates

```bash
# Make script executable
chmod +x docker/init-letsencrypt.sh

# Run SSL initialization
./docker/init-letsencrypt.sh yourdomain.com admin@yourdomain.com
```

This script will:
1. Download recommended TLS parameters
2. Create a dummy certificate
3. Start Nginx
4. Obtain real Let's Encrypt certificate
5. Reload Nginx with proper certificate

**Note**: This may take 1-2 minutes on first run.

### 4. Start Application

```bash
# Start all services (app + nginx)
docker compose -f docker-compose.prod.yml up -d

# Verify it's running
docker compose -f docker-compose.prod.yml ps

# Check logs
docker compose -f docker-compose.prod.yml logs -f app
```

Your application should now be available at `https://yourdomain.com` with auto-renewing SSL certificate.

## SSL Configuration

### Automatic SSL with Let's Encrypt

The `init-letsencrypt.sh` script automates SSL setup:

```bash
./docker/init-letsencrypt.sh yourdomain.com admin@yourdomain.com
```

### Verify SSL Certificate

```bash
# Check certificate details
docker compose -f docker-compose.prod.yml exec nginx \
  openssl x509 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem -text

# Check certificate expiry
docker compose -f docker-compose.prod.yml exec nginx \
  openssl x509 -in /etc/letsencrypt/live/yourdomain.com/fullchain.pem -noout -dates
```

### Manual Certificate Renewal

```bash
# Force renewal (usually automatic)
docker compose -f docker-compose.prod.yml exec nginx \
  certbot renew --force-renewal

# Restart Nginx after renewal
docker compose -f docker-compose.prod.yml restart nginx
```

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `BASE_URL` | Your production domain | `https://yourdomain.com` |
| `JWT_SECRET` | Secret for JWT session signing (32+ chars) | `$(openssl rand -base64 32)` |
| `ENCRYPTION_MASTER_PEPPER` | Master encryption key (optional, auto-generated via /setup) | `$(openssl rand -base64 32)` |
| `SQLITE_PATH` | Path to SQLite database file | `/app/quilltap/data/quilltap.db` |
| `DOMAIN` | Your domain for SSL | `yourdomain.com` |
| `SSL_EMAIL` | Email for SSL renewal notifications | `admin@yourdomain.com` |

### S3 Storage (Required)

| Variable | Description | Default |
|----------|-------------|---------|
| `S3_MODE` | Storage mode (`embedded` or `external`) | `embedded` |
| `S3_ENDPOINT` | S3 endpoint URL (for external mode) | - |
| `S3_REGION` | S3 region | `us-east-1` |
| `S3_ACCESS_KEY` | S3 access key (for external mode) | - |
| `S3_SECRET_KEY` | S3 secret key (for external mode) | - |
| `S3_BUCKET` | S3 bucket name | `quilltap-files` |

### Data Directory (Docker)

| Variable | Description | Default |
|----------|-------------|---------|
| `QUILLTAP_HOST_DATA_DIR` | Where Quilltap data is stored on the **host** machine | `~/.quilltap` |

This variable is read by `docker-compose.yml` to configure the volume mount. The container always sees `/app/quilltap` internally.

**Example:** Store data on an external drive:
```bash
QUILLTAP_HOST_DATA_DIR=/mnt/external/quilltap docker-compose -f docker-compose.prod.yml up -d
```

**Platform-specific recommendations:**
- Linux: `~/.quilltap` (default)
- macOS: `~/Library/Application Support/Quilltap`
- Windows: `%APPDATA%\Quilltap`

**Note:** For non-Docker installations, use `QUILLTAP_DATA_DIR` instead (the application reads this directly).

### Optional

| Variable | Description | Default |
|----------|-------------|---------|
| `GOOGLE_CLIENT_ID` | From Google Cloud Console (for OAuth) | - |
| `GOOGLE_CLIENT_SECRET` | From Google Cloud Console (for OAuth) | - |
| `AUTH_DISABLED` | Completely bypass auth, auto-login as unauthenticated user | `false` |
| `AUTH_UNAUTHENTICATED_USER_NAME` | Display name when `AUTH_DISABLED=true` | `Unauthenticated Local User` |
| `OAUTH_DISABLED` | Hide OAuth buttons but keep credentials login | `false` |
| `LOG_LEVEL` | Logging level | `info` |
| `NODE_ENV` | Environment | `production` |

**CRITICAL SECURITY NOTES:**

1. **Backup `ENCRYPTION_MASTER_PEPPER`** - If lost (and no vault passphrase), all encrypted API keys are unrecoverable. The setup wizard displays it once — save it securely.
2. **Pepper Vault** - The encryption pepper is auto-generated on first run and stored encrypted in SQLite. You can protect it with a passphrase via the `/setup` page. For Docker, either set `ENCRYPTION_MASTER_PEPPER` env var or use a persistent volume so the vault survives container rebuilds.
3. **Use strong values** - Generate with `openssl rand -base64 32`
4. **Keep `.env.production` secret** - Never commit to version control
5. **Restrict file permissions** - `chmod 600 .env.production`

## Plugin Management

### npm-Installed Plugins in Docker

Quilltap supports installing third-party plugins from npm. In Docker deployments, plugins are stored in the data directory which is mounted from the host, so they persist across container restarts.

The data directory mount in `docker-compose.yml` and `docker-compose.prod.yml` includes the plugins:

```yaml
volumes:
  - ${QUILLTAP_HOST_DATA_DIR:-~/.quilltap}:/app/quilltap
```

This stores plugins at `~/.quilltap/plugins/npm/` (or your configured data directory) on the host.

### Plugin Directory Structure

```
~/.quilltap/                     # Host data directory
├── data/                        # SQLite database
├── files/                       # User files
├── logs/                        # Application logs
└── plugins/
    └── npm/                     # npm-installed plugins
        ├── qtap-plugin-foo/
        │   └── node_modules/
        │       └── qtap-plugin-foo/
        │           └── manifest.json
        └── registry.json        # Tracks installed plugins
```

### Installing Plugins

Plugins can be installed via the Settings → Plugins page in the web UI, or via API:

```bash
curl -X POST https://yourdomain.com/api/v1/plugins?action=install \
  -H "Content-Type: application/json" \
  -d '{"packageName": "qtap-plugin-example"}'
```

After installing, restart the container to activate the plugin:

```bash
docker compose -f docker-compose.prod.yml restart app
```

### Troubleshooting Plugins

If plugins appear to install but don't work:

1. **Check the plugin directory exists on host**:
   ```bash
   ls -la ~/.quilltap/plugins/npm/
   ```

2. **Check plugin registry**:
   ```bash
   cat ~/.quilltap/plugins/npm/registry.json
   ```

3. **Verify manifest exists**:
   ```bash
   cat ~/.quilltap/plugins/npm/qtap-plugin-foo/node_modules/qtap-plugin-foo/manifest.json
   ```

4. **Check container logs for plugin errors**:
   ```bash
   docker compose -f docker-compose.prod.yml logs app | grep -i plugin
   ```

### Plugin Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `SITE_PLUGINS_ENABLED` | Comma-separated plugin IDs, or `all` | `all` |
| `SITE_PLUGINS_DISABLED` | Comma-separated plugin IDs to disable | (empty) |

Example: Enable all plugins except one:
```env
SITE_PLUGINS_ENABLED=all
SITE_PLUGINS_DISABLED=qtap-plugin-experimental
```

## Data Management

Quilltap stores application data in two places:

1. **SQLite Database File** - All application data (users, characters, chats, etc.) in a single file
2. **S3-compatible Storage** - User files and generated images

### SQLite Database

The database is stored as a single file, typically at `/app/quilltap/data/quilltap.db` in Docker or platform-specific locations for local installations.

### S3 Storage Structure

Files are stored in S3 with the following structure:

- `users/{userId}/files/` - User-uploaded files
- `users/{userId}/images/` - Generated and uploaded images

### Storage Monitoring

For SQLite:

```bash
# Check database file size
ls -lh /app/quilltap/data/quilltap.db

# Check database integrity
sqlite3 /app/quilltap/data/quilltap.db "PRAGMA integrity_check;"

# Check record counts
sqlite3 /app/quilltap/data/quilltap.db "SELECT COUNT(*) FROM users;"
```

For S3/MinIO:

```bash
# Using AWS CLI
aws s3 ls s3://quilltap-files --recursive --summarize

# Using MinIO client
mc du myminio/quilltap-files
```

### Storage Recommendations

- **Small deployment (< 100 users)**: 1-5 GB (SQLite) + 10-50 GB (S3)
- **Medium deployment (100-1000 users)**: 5-20 GB (SQLite) + 100-500 GB (S3)
- **Large deployment (1000+ users)**: 20-100 GB (SQLite) + 1+ TB (S3)

SQLite deployments require significantly less storage overhead than MongoDB-based deployments.

## Monitoring

### Check Application Status

```bash
# View running containers
docker compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f app

# View specific service logs
docker compose -f docker-compose.prod.yml logs -f nginx
```

### Application Health Check

```bash
# Check if app is responding
curl https://yourdomain.com/api/health

# Expected response: 200 OK
```

### Set Up Monitoring Alerts

For production, consider setting up monitoring:

```bash
# Using curl + cron to check health every 5 minutes
*/5 * * * * curl -f https://yourdomain.com/api/health || \
  mail -s "Quilltap health check failed" admin@yourdomain.com
```

### Resource Monitoring

```bash
# Monitor Docker resource usage
docker stats quilltap-app

# Check memory usage
docker compose -f docker-compose.prod.yml \
  exec app ps aux | grep node
```

## Backup Strategy

### Automated Daily Backups

```bash
#!/bin/bash
# /home/quilltap/backup-quilltap.sh

BACKUP_DIR="/home/quilltap/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
SQLITE_PATH="/app/quilltap/data/quilltap.db"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Backup SQLite database
cp "$SQLITE_PATH" "$BACKUP_DIR/quilltap_$TIMESTAMP.db"
tar -czf "$BACKUP_DIR/quilltap_$TIMESTAMP.db.tar.gz" \
  -C "$BACKUP_DIR" "quilltap_$TIMESTAMP.db"
rm "$BACKUP_DIR/quilltap_$TIMESTAMP.db"

# Backup S3 files (if using MinIO locally)
# mc mirror myminio/quilltap-files "$BACKUP_DIR/s3_$TIMESTAMP"

# Keep only last 7 days
find "$BACKUP_DIR" -name "quilltap_*.db.tar.gz" -mtime +7 -delete

# Log backup
echo "$(date): Backup completed: $TIMESTAMP" >> "$BACKUP_DIR/backup.log"
```

Add to crontab:

```bash
# Schedule daily backup at 2 AM
crontab -e
# Add: 0 2 * * * /home/quilltap/backup-quilltap.sh
```

### Remote Backup

```bash
#!/bin/bash
# Upload backup to remote server/cloud

BACKUP_FILE="$1"
REMOTE_BACKUP_DIR="/mnt/nas/quilltap-backups"

# Copy to NAS/Network share
cp "$BACKUP_FILE" "$REMOTE_BACKUP_DIR/"

# Or upload to S3
aws s3 cp "$BACKUP_FILE" s3://my-backups/quilltap/

# Or upload to Google Cloud Storage
gsutil cp "$BACKUP_FILE" gs://my-backups/quilltap/
```

### Verify Backups

```bash
# List recent backups
ls -lh ~/backups/quilltap_*.db.tar.gz | tail -10

# Verify SQLite backup integrity
tar -tzf ~/backups/quilltap_20250120_120000.db.tar.gz | head

# Check backup size
du -h ~/backups/quilltap_*.db.tar.gz
```

See [Backup & Restore Guide](BACKUP-RESTORE.md) for detailed procedures.

## Updating

### Check for Updates

```bash
cd ~/quilltap

# Check available updates
git fetch origin
git log --oneline main..origin/main

# View changes
git diff main..origin/main
```

### Update Process

```bash
# 1. Backup current data
cp -r data/ data-backup-$(date +%Y%m%d)/

# 2. Pull latest code
git pull origin main

# 3. Rebuild Docker image
docker compose -f docker-compose.prod.yml build

# 4. Restart services
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# 5. Verify it's working
docker compose -f docker-compose.prod.yml logs -f app
curl https://yourdomain.com/api/health
```

### Rollback (If Needed)

```bash
# If something goes wrong, rollback
git checkout HEAD~1  # Go back one commit
docker compose -f docker-compose.prod.yml build
docker compose -f docker-compose.prod.yml down
docker compose -f docker-compose.prod.yml up -d

# Or restore from data backup
rm -rf data/
cp -r data-backup-20250120/ data/
docker compose -f docker-compose.prod.yml restart app
```

## Troubleshooting

### Application Won't Start

```bash
# Check logs
docker compose -f docker-compose.prod.yml logs app

# Common issues:
# - Port 3000 already in use
# - Pepper vault needs setup (navigate to /setup)
# - S3/MinIO not accessible
# - .env.production missing required variables
# - SQLite database file not writable

# Check SQLite database accessibility
ls -l /app/quilltap/data/quilltap.db

# Check SQLite database validity
sqlite3 /app/quilltap/data/quilltap.db "PRAGMA integrity_check;"

# Check MinIO health (if using embedded)
curl -f http://localhost:9000/minio/health/ready

# Fix permissions
chmod 600 .env.production
chmod 755 /app/quilltap/data

# Restart
docker compose -f docker-compose.prod.yml restart app
```

### SSL Certificate Issues

```bash
# Check certificate renewal status
docker compose -f docker-compose.prod.yml exec nginx \
  certbot renew --dry-run

# Force renewal
docker compose -f docker-compose.prod.yml exec nginx \
  certbot renew --force-renewal

# Restart Nginx
docker compose -f docker-compose.prod.yml restart nginx
```

### High Memory Usage

```bash
# Check memory usage
docker stats quilltap-app

# If high, restart the app
docker compose -f docker-compose.prod.yml restart app

# Check for large files in data/
du -sh data/* | sort -h
```

### Data Not Persisting

```bash
# Check SQLite database is being accessed
ls -lh /app/quilltap/data/quilltap.db

# Check database contains data
sqlite3 /app/quilltap/data/quilltap.db "SELECT COUNT(*) FROM users;"

# Check S3 connection
aws s3 ls s3://quilltap-files/ --endpoint-url http://localhost:9000

# For MinIO, check bucket exists
mc ls myminio/quilltap-files

# Check application logs for connection errors
docker compose -f docker-compose.prod.yml logs app | grep -i error
```

### Cannot Connect to Domain

```bash
# Check DNS resolution
nslookup yourdomain.com

# Verify firewall allows traffic
sudo ufw status
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Check if app is running
docker compose -f docker-compose.prod.yml ps

# Check if port 80/443 are in use
sudo netstat -tlnp | grep 80
sudo netstat -tlnp | grep 443
```

## Production Checklist

Before going live, verify:

- [ ] SSL certificate is valid (`curl -v https://yourdomain.com`)
- [ ] All environment variables are set correctly
- [ ] SQLite database file is accessible and writable
- [ ] S3/MinIO is accessible and bucket exists
- [ ] SQLite database backup is scheduled
- [ ] S3 backup/replication is configured
- [ ] Monitoring/alerts are configured
- [ ] Encryption key is securely backed up
- [ ] Firewall rules are configured
- [ ] Google OAuth redirect URI is correct (if using OAuth)
- [ ] Application health check is working
- [ ] Logs are being monitored

## Performance Tuning

### Docker Resource Limits

For high-traffic deployments, set resource limits in docker-compose.prod.yml:

```yaml
services:
  app:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### Nginx Caching

The included Nginx config already has caching for:
- Static assets (30 days)
- API responses (5 minutes)
- Images (1 day)

No additional tuning usually needed.

## Support & Resources

- **Documentation**: [README.md](../README.md)
- **Migration Guide**: [MIGRATION.md](MIGRATION.md)
- **Backup Guide**: [BACKUP-RESTORE.md](BACKUP-RESTORE.md)
- **GitHub Issues**: https://github.com/foundry-9/quilltap/issues
- **Email Support**: charles.sebold@foundry-9.com

## Security Checklist

- [ ] SSH key-only authentication (no password login)
- [ ] Firewall configured (UFW or similar)
- [ ] Regular security updates (`apt update && apt upgrade`)
- [ ] Strong encryption key (32+ characters)
- [ ] Environment file protected (600 permissions)
- [ ] Backups stored off-server
- [ ] SSL certificate auto-renewal verified
- [ ] Rate limiting enabled (default)
- [ ] JWT_SECRET is strong (32+ characters)
- [ ] No Quilltap sensitive files in version control

That's it! Your Quilltap instance is now running securely in production with SQLite and S3-compatible storage.
