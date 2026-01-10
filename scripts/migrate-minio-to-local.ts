#!/usr/bin/env npx ts-node
/**
 * One-time utility to migrate files from MinIO to local storage
 *
 * This script:
 * 1. Connects to MinIO at localhost:9000
 * 2. Lists all files in the quilltap-files bucket
 * 3. Downloads each file and saves to ~/.quilltap/files/
 * 4. Verifies the migration by checking file counts
 *
 * Run with: npx ts-node scripts/migrate-minio-to-local.ts
 */

import { S3Client, ListObjectsV2Command, GetObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';

const MINIO_ENDPOINT = 'http://localhost:9000';
const MINIO_ACCESS_KEY = 'minioadmin';
const MINIO_SECRET_KEY = 'minioadmin';
const MINIO_BUCKET = 'quilltap-files';
const LOCAL_STORAGE_PATH = path.join(process.env.HOME || '~', '.quilltap', 'files');

interface MigrationStats {
  total: number;
  copied: number;
  skipped: number;
  failed: number;
  errors: string[];
}

async function main() {
  console.log('=== MinIO to Local Storage Migration ===\n');
  console.log(`Source: ${MINIO_ENDPOINT}/${MINIO_BUCKET}`);
  console.log(`Destination: ${LOCAL_STORAGE_PATH}\n`);

  // Create S3 client for MinIO
  const s3Client = new S3Client({
    endpoint: MINIO_ENDPOINT,
    region: 'us-east-1', // MinIO doesn't care but SDK requires it
    credentials: {
      accessKeyId: MINIO_ACCESS_KEY,
      secretAccessKey: MINIO_SECRET_KEY,
    },
    forcePathStyle: true,
  });

  const stats: MigrationStats = {
    total: 0,
    copied: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  try {
    // List all objects in the bucket
    console.log('Listing files in MinIO...');
    const objects: { key: string; size: number }[] = [];
    let continuationToken: string | undefined;

    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: MINIO_BUCKET,
        ContinuationToken: continuationToken,
      });

      const response = await s3Client.send(listCommand);

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key && obj.Size !== undefined) {
            objects.push({ key: obj.Key, size: obj.Size });
          }
        }
      }

      continuationToken = response.NextContinuationToken;
    } while (continuationToken);

    stats.total = objects.length;
    console.log(`Found ${stats.total} files to migrate\n`);

    if (stats.total === 0) {
      console.log('No files to migrate. Exiting.');
      return;
    }

    // Ensure base directory exists
    fs.mkdirSync(LOCAL_STORAGE_PATH, { recursive: true });

    // Download each file
    for (const obj of objects) {
      const localPath = path.join(LOCAL_STORAGE_PATH, obj.key);
      const localDir = path.dirname(localPath);

      // Check if file already exists with correct size
      if (fs.existsSync(localPath)) {
        const localStats = fs.statSync(localPath);
        if (localStats.size === obj.size) {
          console.log(`[SKIP] ${obj.key} (already exists)`);
          stats.skipped++;
          continue;
        }
      }

      try {
        // Ensure directory exists
        fs.mkdirSync(localDir, { recursive: true });

        // Download file
        const getCommand = new GetObjectCommand({
          Bucket: MINIO_BUCKET,
          Key: obj.key,
        });

        const response = await s3Client.send(getCommand);

        if (response.Body) {
          const writeStream = fs.createWriteStream(localPath);
          await pipeline(response.Body as Readable, writeStream);

          console.log(`[COPY] ${obj.key} (${formatBytes(obj.size)})`);
          stats.copied++;
        } else {
          throw new Error('Empty response body');
        }
      } catch (error) {
        const errorMsg = `Failed to copy ${obj.key}: ${error instanceof Error ? error.message : 'Unknown error'}`;
        console.error(`[FAIL] ${errorMsg}`);
        stats.failed++;
        stats.errors.push(errorMsg);
      }
    }

    // Print summary
    console.log('\n=== Migration Summary ===');
    console.log(`Total files:  ${stats.total}`);
    console.log(`Copied:       ${stats.copied}`);
    console.log(`Skipped:      ${stats.skipped}`);
    console.log(`Failed:       ${stats.failed}`);

    if (stats.errors.length > 0) {
      console.log('\nErrors:');
      stats.errors.forEach(err => console.log(`  - ${err}`));
    }

    // Verify
    const localFileCount = countFilesRecursive(LOCAL_STORAGE_PATH);
    console.log(`\nLocal files after migration: ${localFileCount}`);

    if (localFileCount >= stats.total) {
      console.log('\n✓ Migration complete! All files are now in local storage.');
      console.log('\nYou can now optionally:');
      console.log('1. Test the app to ensure files load correctly');
      console.log('2. Stop the MinIO container if no longer needed');
      console.log('3. Delete this script');
    } else {
      console.log('\n⚠ Some files may not have migrated. Please check the errors above.');
    }

  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function countFilesRecursive(dir: string): number {
  let count = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && !entry.name.endsWith('.meta.json')) {
        count++;
      } else if (entry.isDirectory()) {
        count += countFilesRecursive(path.join(dir, entry.name));
      }
    }
  } catch {
    // Directory doesn't exist or can't be read
  }
  return count;
}

main().catch(console.error);
