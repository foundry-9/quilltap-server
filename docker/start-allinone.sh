#!/bin/sh
# Quilltap All-in-One Startup Script
# Starts MinIO and Quilltap application in a single container

set -e

# Colors for output (optional, removed for pure POSIX sh compatibility)
# Instead we use simple echo statements

echo "================================================"
echo "Quilltap All-in-One Container Startup"
echo "================================================"
echo ""

# =============================================================================
# MinIO Startup
# =============================================================================

echo "Starting MinIO..."
mkdir -p /data/minio

# Set MinIO credentials from environment variables
export MINIO_ROOT_USER="${S3_ACCESS_KEY:-minioadmin}"
export MINIO_ROOT_PASSWORD="${S3_SECRET_KEY:-minioadmin}"

echo "MinIO user: $MINIO_ROOT_USER"

# Start MinIO server in background
# --address restricts to localhost only
minio server /data/minio --address 127.0.0.1:9000 &

# Wait for MinIO to be ready using health endpoint
echo "Waiting for MinIO to be ready..."
MINIO_READY=0
MINIO_ATTEMPTS=0
MAX_MINIO_ATTEMPTS=30

while [ $MINIO_READY -eq 0 ] && [ $MINIO_ATTEMPTS -lt $MAX_MINIO_ATTEMPTS ]; do
  if wget -q --spider http://127.0.0.1:9000/minio/health/ready 2>/dev/null; then
    MINIO_READY=1
    echo "MinIO is ready"
  else
    MINIO_ATTEMPTS=$((MINIO_ATTEMPTS + 1))
    echo "Waiting for MinIO... (attempt $MINIO_ATTEMPTS/$MAX_MINIO_ATTEMPTS)"
    sleep 1
  fi
done

if [ $MINIO_READY -eq 0 ]; then
  echo "ERROR: MinIO failed to start after $MAX_MINIO_ATTEMPTS attempts"
  exit 1
fi

echo "MinIO started successfully"
echo ""

# =============================================================================
# Create Default Bucket
# =============================================================================

echo "Creating default S3 bucket..."

# Set MinIO client alias with credentials
mc alias set local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"

# Create bucket if it doesn't exist
# The --ignore-existing flag prevents errors if bucket already exists
BUCKET_NAME="${S3_BUCKET:-quilltap-files}"
mc mb --ignore-existing "local/$BUCKET_NAME"

echo "Bucket '$BUCKET_NAME' is ready"
echo ""

# =============================================================================
# Quilltap Application Startup
# =============================================================================

echo "================================================"
echo "Starting Quilltap application..."
echo "================================================"
echo "Database: SQLite at $SQLITE_PATH"
echo "S3 Endpoint: $S3_ENDPOINT"
echo "S3 Bucket: $BUCKET_NAME"
echo ""

# Use exec to replace the shell process with node
# This ensures signals (SIGTERM) are properly forwarded to the Node process
exec node server.js
