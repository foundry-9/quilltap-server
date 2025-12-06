/**
 * Migrate API Key UserIds Script
 *
 * Adds the userId field to existing API keys in the database.
 * The script attempts to determine the correct userId for each key by:
 * 1. For single-user systems: assigns all keys to that user
 * 2. For multi-user systems: tries decryption with each user's ID
 *
 * Usage: npx tsx scripts/migrate-apikey-userids.ts
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { MongoClient } from 'mongodb';
import { decryptApiKey } from '../lib/encryption';

const mongoUri = process.env.MONGODB_URI;
const mongoDb = process.env.MONGODB_DATABASE || 'quilltap';

interface ApiKeyDoc {
  id: string;
  userId?: string;
  ciphertext: string;
  iv: string;
  authTag: string;
  label: string;
  provider: string;
}

interface UserDoc {
  id: string;
  username: string;
}

async function main() {
  console.log('=== Migrate API Key UserIds ===\n');

  if (!mongoUri) {
    throw new Error('Missing MONGODB_URI');
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    const db = client.db(mongoDb);

    // Get all users
    const users = await db.collection<UserDoc>('users').find({}).toArray();
    if (users.length === 0) {
      throw new Error('No users found in database');
    }

    console.log(`Found ${users.length} user(s)`);
    users.forEach(u => console.log(`  - ${u.username} (${u.id})`));

    // Get all API keys
    const apiKeys = await db.collection<ApiKeyDoc>('api_keys').find({}).toArray();
    console.log(`\nTotal API keys: ${apiKeys.length}`);

    if (apiKeys.length === 0) {
      console.log('\nNo API keys to migrate!');
      return;
    }

    // Find keys without userId
    const keysWithoutUserId = apiKeys.filter(k => !k.userId);
    console.log(`Keys without userId: ${keysWithoutUserId.length}`);

    if (keysWithoutUserId.length === 0) {
      console.log('\nAll API keys already have userId assigned!');
      return;
    }

    // Migration strategy
    let updatedCount = 0;
    let failedCount = 0;
    const failedKeys: string[] = [];

    for (const apiKey of keysWithoutUserId) {
      let assignedUserId: string | null = null;

      // If only one user, assign to them directly
      if (users.length === 1) {
        assignedUserId = users[0].id;
      } else {
        // Try decryption with each user's ID to find the owner
        for (const user of users) {
          try {
            decryptApiKey(apiKey.ciphertext, apiKey.iv, apiKey.authTag, user.id);
            // If decryption succeeds, this is the owner
            assignedUserId = user.id;
            console.log(`  Key "${apiKey.label}" (${apiKey.id}) decrypts with user ${user.username}`);
            break;
          } catch {
            // Decryption failed - not this user's key
          }
        }
      }

      if (assignedUserId) {
        // Update the API key with the userId
        await db.collection('api_keys').updateOne(
          { id: apiKey.id },
          {
            $set: {
              userId: assignedUserId,
              updatedAt: new Date().toISOString(),
            },
          }
        );
        updatedCount++;
        console.log(`  ✓ Updated key "${apiKey.label}" with userId ${assignedUserId}`);
      } else {
        // Could not determine owner
        failedCount++;
        failedKeys.push(apiKey.id);
        console.log(`  ✗ Could not determine owner for key "${apiKey.label}" (${apiKey.id})`);
      }
    }

    console.log('\n=== Migration Summary ===');
    console.log(`Updated: ${updatedCount}`);
    console.log(`Failed: ${failedCount}`);

    if (failedKeys.length > 0) {
      console.log(`\nFailed keys (may need manual intervention):`);
      failedKeys.forEach(id => console.log(`  - ${id}`));
      console.log('\nThese keys may have been encrypted with a user ID that no longer exists.');
      console.log('You may need to delete them and re-create them.');
    }

    // Verify
    const verifyKeys = await db.collection('api_keys').find({ userId: { $exists: true } }).toArray();
    console.log(`\nAPI keys with userId after migration: ${verifyKeys.length}`);

  } finally {
    await client.close();
  }
}

main().catch(console.error);
