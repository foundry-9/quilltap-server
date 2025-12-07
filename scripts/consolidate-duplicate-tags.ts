/**
 * Consolidate Duplicate Tags Script
 *
 * This script finds duplicate tags (same userId + nameLower) and consolidates them:
 * 1. For each set of duplicates, keeps the tag that has style info (or the first one if none)
 * 2. Updates all references in entities (characters, personas, chats, etc.)
 * 3. Migrates tag styles from duplicates to the kept tag
 * 4. Deletes the duplicate tags
 *
 * Usage: npx tsx scripts/consolidate-duplicate-tags.ts [--dry-run]
 */

import { config } from 'dotenv';
config({ path: '.env.local' });
import { MongoClient, Db } from 'mongodb';

// MongoDB Configuration
const mongoUri = process.env.MONGODB_URI;
const mongoDb = process.env.MONGODB_DATABASE || 'quilltap';

// Parse command line args
const isDryRun = process.argv.includes('--dry-run');

interface Tag {
  id: string;
  userId: string;
  name: string;
  nameLower: string;
  quickHide: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TagStyle {
  emoji?: string | null;
  foregroundColor?: string;
  backgroundColor?: string;
  emojiOnly?: boolean;
  bold?: boolean;
  italic?: boolean;
  strikethrough?: boolean;
}

interface DuplicateGroup {
  userId: string;
  nameLower: string;
  tags: Tag[];
  tagWithStyle: Tag | null;
  keepTag: Tag;
  deleteTags: Tag[];
}

/**
 * Check if a tag style is non-default (has customization)
 */
function hasNonDefaultStyle(style: TagStyle | undefined): boolean {
  if (!style) return false;

  const defaults = {
    emoji: null,
    foregroundColor: '#1f2937',
    backgroundColor: '#e5e7eb',
    emojiOnly: false,
    bold: false,
    italic: false,
    strikethrough: false,
  };

  // Check if any value differs from default
  if (style.emoji && style.emoji !== defaults.emoji) return true;
  if (style.foregroundColor && style.foregroundColor !== defaults.foregroundColor) return true;
  if (style.backgroundColor && style.backgroundColor !== defaults.backgroundColor) return true;
  if (style.emojiOnly && style.emojiOnly !== defaults.emojiOnly) return true;
  if (style.bold && style.bold !== defaults.bold) return true;
  if (style.italic && style.italic !== defaults.italic) return true;
  if (style.strikethrough && style.strikethrough !== defaults.strikethrough) return true;

  return false;
}

/**
 * Find all duplicate tags grouped by (userId, nameLower)
 */
async function findDuplicateTags(db: Db): Promise<DuplicateGroup[]> {
  console.log('\n=== Finding Duplicate Tags ===');

  const tagsCollection = db.collection('tags');
  const chatSettingsCollection = db.collection('chat_settings');

  // Aggregate to find (userId, nameLower) pairs with more than one tag
  const duplicates = await tagsCollection
    .aggregate([
      {
        $group: {
          _id: { userId: '$userId', nameLower: '$nameLower' },
          count: { $sum: 1 },
          tags: { $push: '$$ROOT' },
        },
      },
      {
        $match: { count: { $gt: 1 } },
      },
    ])
    .toArray();

  console.log(`Found ${duplicates.length} groups of duplicate tags`);

  const groups: DuplicateGroup[] = [];

  for (const dup of duplicates) {
    const userId = dup._id.userId;
    const nameLower = dup._id.nameLower;
    const tags = dup.tags.map((t: any) => {
      const { _id, ...tagData } = t;
      return tagData as Tag;
    });

    // Get chat settings for this user to check for styled tags
    const chatSettings = await chatSettingsCollection.findOne({ userId });
    const tagStyles: Record<string, TagStyle> = chatSettings?.tagStyles || {};

    // Find which tag (if any) has a non-default style
    let tagWithStyle: Tag | null = null;
    for (const tag of tags) {
      if (hasNonDefaultStyle(tagStyles[tag.id])) {
        tagWithStyle = tag;
        break;
      }
    }

    // Determine which tag to keep:
    // - If one has style info, keep that one
    // - Otherwise, keep the oldest one (by createdAt)
    let keepTag: Tag;
    if (tagWithStyle) {
      keepTag = tagWithStyle;
    } else {
      // Sort by createdAt ascending and take the first
      tags.sort((a: Tag, b: Tag) => a.createdAt.localeCompare(b.createdAt));
      keepTag = tags[0];
    }

    const deleteTags = tags.filter((t: Tag) => t.id !== keepTag.id);

    groups.push({
      userId,
      nameLower,
      tags,
      tagWithStyle,
      keepTag,
      deleteTags,
    });

    console.log(`\n  User: ${userId}`);
    console.log(`    Tag name: "${tags[0].name}" (${tags.length} duplicates)`);
    console.log(`    Keeping: ${keepTag.id} (${tagWithStyle ? 'has style' : 'oldest'})`);
    console.log(`    Deleting: ${deleteTags.map((t: Tag) => t.id).join(', ')}`);
  }

  return groups;
}

/**
 * Update tag references in an entity collection
 */
async function updateEntityTags(
  db: Db,
  collectionName: string,
  oldTagId: string,
  newTagId: string
): Promise<number> {
  const collection = db.collection(collectionName);

  // Find documents that have the old tag ID in their tags array
  const docs = await collection.find({ tags: oldTagId }).toArray();

  if (docs.length === 0) {
    return 0;
  }

  let updatedCount = 0;

  for (const doc of docs) {
    const tags: string[] = doc.tags || [];
    const hasNewTag = tags.includes(newTagId);
    const hasOldTag = tags.includes(oldTagId);

    if (hasOldTag) {
      let newTags: string[];
      if (hasNewTag) {
        // Already has the new tag, just remove the old one
        newTags = tags.filter((t: string) => t !== oldTagId);
      } else {
        // Replace old tag with new tag
        newTags = tags.map((t: string) => (t === oldTagId ? newTagId : t));
      }

      if (!isDryRun) {
        await collection.updateOne(
          { _id: doc._id },
          { $set: { tags: newTags, updatedAt: new Date().toISOString() } }
        );
      }
      updatedCount++;
    }
  }

  return updatedCount;
}

/**
 * Migrate tag styles from deleted tags to the kept tag
 */
async function migrateTagStyles(
  db: Db,
  userId: string,
  keepTagId: string,
  deleteTagIds: string[]
): Promise<boolean> {
  const chatSettingsCollection = db.collection('chat_settings');
  const chatSettings = await chatSettingsCollection.findOne({ userId });

  if (!chatSettings) {
    return false;
  }

  const tagStyles: Record<string, TagStyle> = chatSettings.tagStyles || {};
  let needsUpdate = false;

  // Check if any deleted tag has a style that should be migrated
  for (const deleteTagId of deleteTagIds) {
    if (tagStyles[deleteTagId] && hasNonDefaultStyle(tagStyles[deleteTagId])) {
      // If the kept tag doesn't have a style, migrate this one
      if (!hasNonDefaultStyle(tagStyles[keepTagId])) {
        tagStyles[keepTagId] = tagStyles[deleteTagId];
        console.log(`      Migrated style from ${deleteTagId} to ${keepTagId}`);
      }
      // Remove the style for the deleted tag
      delete tagStyles[deleteTagId];
      needsUpdate = true;
    } else if (tagStyles[deleteTagId]) {
      // Remove default styles for deleted tags too
      delete tagStyles[deleteTagId];
      needsUpdate = true;
    }
  }

  if (needsUpdate && !isDryRun) {
    await chatSettingsCollection.updateOne(
      { userId },
      { $set: { tagStyles, updatedAt: new Date().toISOString() } }
    );
  }

  return needsUpdate;
}

/**
 * Delete duplicate tags
 */
async function deleteDuplicateTags(db: Db, tagIds: string[]): Promise<number> {
  if (tagIds.length === 0) return 0;

  const tagsCollection = db.collection('tags');

  if (!isDryRun) {
    const result = await tagsCollection.deleteMany({ id: { $in: tagIds } });
    return result.deletedCount;
  }

  return tagIds.length;
}

/**
 * Main consolidation function
 */
async function consolidateTags(db: Db): Promise<void> {
  const groups = await findDuplicateTags(db);

  if (groups.length === 0) {
    console.log('\nNo duplicate tags found. Nothing to consolidate.');
    return;
  }

  console.log(`\n=== Consolidating ${groups.length} Groups of Duplicates ===`);
  if (isDryRun) {
    console.log('(DRY RUN - no changes will be made)\n');
  }

  const entityCollections = [
    'characters',
    'personas',
    'chats',
    'connection_profiles',
    'files',
    'memories',
  ];

  let totalUpdates = 0;
  let totalDeletes = 0;

  for (const group of groups) {
    console.log(`\nProcessing: "${group.tags[0].name}" for user ${group.userId}`);
    console.log(`  Keeping tag: ${group.keepTag.id}`);

    // Update references in all entity collections
    for (const deleteTag of group.deleteTags) {
      console.log(`  Replacing ${deleteTag.id} -> ${group.keepTag.id}:`);

      for (const collectionName of entityCollections) {
        const count = await updateEntityTags(db, collectionName, deleteTag.id, group.keepTag.id);
        if (count > 0) {
          console.log(`    ${collectionName}: ${count} documents`);
          totalUpdates += count;
        }
      }
    }

    // Migrate tag styles
    const styleMigrated = await migrateTagStyles(
      db,
      group.userId,
      group.keepTag.id,
      group.deleteTags.map((t: Tag) => t.id)
    );
    if (styleMigrated) {
      console.log(`  Tag styles migrated`);
    }

    // Delete duplicate tags
    const deleteTagIds = group.deleteTags.map((t: Tag) => t.id);
    const deletedCount = await deleteDuplicateTags(db, deleteTagIds);
    console.log(`  Deleted ${deletedCount} duplicate tag(s)`);
    totalDeletes += deletedCount;
  }

  console.log('\n=== Summary ===');
  console.log(`Total entity updates: ${totalUpdates}`);
  console.log(`Total tags deleted: ${totalDeletes}`);

  if (isDryRun) {
    console.log('\n(DRY RUN - no changes were made. Run without --dry-run to apply changes)');
  }
}

async function main() {
  console.log('=== Consolidate Duplicate Tags Script ===');
  console.log('This script will:');
  console.log('1. Find duplicate tags (same user + case-insensitive name)');
  console.log('2. Keep the tag with style info (or oldest if none have styles)');
  console.log('3. Update all entity references to use the kept tag');
  console.log('4. Migrate tag styles to the kept tag');
  console.log('5. Delete duplicate tags\n');

  if (isDryRun) {
    console.log('*** DRY RUN MODE - No changes will be made ***\n');
  }

  if (!mongoUri) {
    throw new Error('Missing MONGODB_URI environment variable');
  }

  const client = new MongoClient(mongoUri);

  try {
    await client.connect();
    console.log(`Connected to MongoDB: ${mongoUri.replace(/\/\/[^:]+:[^@]+@/, '//<credentials>@')}`);
    console.log(`Database: ${mongoDb}`);

    const db = client.db(mongoDb);

    await consolidateTags(db);

    console.log('\n=== Done ===');
  } catch (error) {
    console.error('\nError:', error);
    process.exit(1);
  } finally {
    await client.close();
    console.log('MongoDB connection closed');
  }
}

main();
