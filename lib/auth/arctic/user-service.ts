/**
 * OAuth User Service
 *
 * Handles user creation and account linking for OAuth authentication.
 */

import { getMongoDatabase } from '@/lib/mongodb/client';
import { logger } from '@/lib/logger';
import crypto from 'crypto';
import type { ArcticUserInfo, ArcticTokenResult } from './types';
import { importImageFromUrl, deleteImageById } from '@/lib/images-v2';

/**
 * User document type for OAuth
 */
interface OAuthUser {
  id: string;
  username: string;
  email?: string | null;
  emailVerified?: string | null;
  name?: string | null;
  image?: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * Account document type
 */
interface OAuthAccount {
  userId: string;
  type: string;
  provider: string;
  providerAccountId: string;
  refresh_token?: string;
  access_token?: string;
  expires_at?: number;
  id_token?: string;
  oauthImageUrl?: string;   // Original OAuth provider URL for change detection
  oauthImageHash?: string;  // SHA256 hash for detecting if provider image changed
  createdAt: string;
  updatedAt: string;
}

/**
 * Generate a UUID for new entities
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Get current timestamp as ISO string
 */
function now(): string {
  return new Date().toISOString();
}

/**
 * Cache OAuth profile image locally
 * Downloads the image and stores it using the file storage system
 *
 * @param imageUrl - URL of the profile image from OAuth provider
 * @param userId - User's ID for storage linking
 * @returns Object with filepath and hash, or null on failure
 */
async function cacheOAuthProfileImage(
  imageUrl: string,
  userId: string
): Promise<{ filepath: string; hash: string } | null> {
  if (!imageUrl) return null;

  try {
    const result = await importImageFromUrl(imageUrl, userId, [`user:${userId}`]);
    logger.debug('Cached OAuth profile image', {
      context: 'arctic.user-service.cacheOAuthProfileImage',
      userId,
      filepath: result.filepath,
      hash: result.sha256,
    });
    return { filepath: result.filepath, hash: result.sha256 };
  } catch (error) {
    logger.warn('Failed to cache OAuth profile image, will use external URL', {
      context: 'arctic.user-service.cacheOAuthProfileImage',
      userId,
      imageUrl,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Check if an OAuth profile image has changed by comparing its hash
 *
 * @param newImageUrl - New image URL from OAuth provider
 * @param existingHash - Previously stored hash
 * @returns true if image has changed (or if we can't determine), false if unchanged
 */
function hasOAuthImageChanged(newImageUrl: string | undefined, existingHash: string | undefined): boolean {
  // If no new URL or no existing hash, assume changed (will re-cache or use URL)
  if (!newImageUrl || !existingHash) return true;
  // We can't compare URL to hash directly, so we'll need to check after download
  // For now, return true to trigger re-validation via download
  return true;
}

/**
 * Clean up old cached profile image if it's a local path
 *
 * @param imagePath - Path to check and potentially clean up
 */
async function cleanupOldProfileImage(imagePath: string | null | undefined): Promise<void> {
  if (!imagePath) return;

  // Only clean up if it's a local file path (our cached images)
  if (!imagePath.startsWith('/api/v1/files/')) return;

  const fileId = imagePath.replace('/api/v1/files/', '');
  try {
    await deleteImageById(fileId);
    logger.debug('Cleaned up old cached profile image', {
      context: 'arctic.user-service.cleanupOldProfileImage',
      fileId,
    });
  } catch (error) {
    logger.warn('Failed to clean up old cached profile image', {
      context: 'arctic.user-service.cleanupOldProfileImage',
      fileId,
      error: error instanceof Error ? error.message : String(error),
    });
    // Don't throw - cleanup failure shouldn't block the update
  }
}

/**
 * Find a user by ID
 *
 * @param userId - User's ID
 * @returns User if found, null otherwise
 */
async function findUserById(userId: string): Promise<OAuthUser | null> {
  try {
    const db = await getMongoDatabase();
    const usersCollection = db.collection<OAuthUser>('users');
    return await usersCollection.findOne({ id: userId }) || null;
  } catch (error) {
    logger.error(
      'Failed to find user by ID',
      { context: 'arctic.user-service.findUserById', userId },
      error instanceof Error ? error : undefined
    );
    return null;
  }
}

/**
 * Find OAuth account by provider and account ID
 *
 * @param provider - OAuth provider name
 * @param providerAccountId - Account ID from provider
 * @returns Account if found, null otherwise
 */
async function findOAuthAccount(
  provider: string,
  providerAccountId: string
): Promise<OAuthAccount | null> {
  try {
    const db = await getMongoDatabase();
    const accountsCollection = db.collection<OAuthAccount>('accounts');
    return await accountsCollection.findOne({ provider, providerAccountId }) || null;
  } catch (error) {
    logger.error(
      'Failed to find OAuth account',
      { context: 'arctic.user-service.findOAuthAccount', provider },
      error instanceof Error ? error : undefined
    );
    return null;
  }
}

/**
 * Find a user by their linked OAuth account
 *
 * @param provider - OAuth provider name (e.g., 'google')
 * @param providerAccountId - The user's ID from the provider
 * @returns User if found, null otherwise
 */
export async function findUserByOAuthAccount(
  provider: string,
  providerAccountId: string
): Promise<OAuthUser | null> {
  try {
    const db = await getMongoDatabase();
    const accountsCollection = db.collection<OAuthAccount>('accounts');
    const usersCollection = db.collection<OAuthUser>('users');

    const account = await accountsCollection.findOne({
      provider,
      providerAccountId,
    });

    if (!account) {
      logger.debug('OAuth account not found', {
        context: 'arctic.user-service.findUserByOAuthAccount',
        provider,
      });
      return null;
    }

    const user = await usersCollection.findOne({ id: account.userId });

    if (!user) {
      logger.warn('User not found for OAuth account', {
        context: 'arctic.user-service.findUserByOAuthAccount',
        provider,
        userId: account.userId,
      });
      return null;
    }

    logger.debug('Found user by OAuth account', {
      context: 'arctic.user-service.findUserByOAuthAccount',
      provider,
      userId: user.id,
    });

    return user;
  } catch (error) {
    logger.error(
      'Failed to find user by OAuth account',
      { context: 'arctic.user-service.findUserByOAuthAccount', provider },
      error instanceof Error ? error : undefined
    );
    return null;
  }
}

/**
 * Find a user by email
 *
 * @param email - User's email address
 * @returns User if found, null otherwise
 */
export async function findUserByEmail(email: string): Promise<OAuthUser | null> {
  try {
    const db = await getMongoDatabase();
    const usersCollection = db.collection<OAuthUser>('users');

    const user = await usersCollection.findOne({ email });

    return user || null;
  } catch (error) {
    logger.error(
      'Failed to find user by email',
      { context: 'arctic.user-service.findUserByEmail', email },
      error instanceof Error ? error : undefined
    );
    return null;
  }
}

/**
 * Result of creating an OAuth user, including image metadata for the account
 */
interface CreateOAuthUserResult {
  user: OAuthUser;
  imageMetadata?: { url: string; hash: string };
}

/**
 * Create a new user from OAuth provider info
 * Caches the profile image locally to avoid expiring OAuth URLs
 *
 * @param userInfo - User information from OAuth provider
 * @returns Created user and image metadata
 */
export async function createOAuthUser(userInfo: ArcticUserInfo): Promise<CreateOAuthUserResult> {
  const db = await getMongoDatabase();
  const usersCollection = db.collection<OAuthUser>('users');

  const id = generateId();
  const timestamp = now();

  // Generate username from email or name
  let username =
    userInfo.email?.split('@')[0] ||
    userInfo.name?.toLowerCase().replace(/\s+/g, '_') ||
    `user_${id.substring(0, 8)}`;

  // Ensure username is unique
  let existingUser = await usersCollection.findOne({ username });
  while (existingUser) {
    username = `${username}_${Math.random().toString(36).substring(2, 6)}`;
    existingUser = await usersCollection.findOne({ username });
  }

  // Cache the OAuth profile image locally
  let imageToStore: string | null = userInfo.image || null;
  let imageMetadata: { url: string; hash: string } | undefined;

  if (userInfo.image) {
    const cached = await cacheOAuthProfileImage(userInfo.image, id);
    if (cached) {
      imageToStore = cached.filepath;
      imageMetadata = { url: userInfo.image, hash: cached.hash };
    }
    // If caching fails, imageToStore remains as the external URL (fallback)
  }

  const user: OAuthUser = {
    id,
    username,
    email: userInfo.email || null,
    emailVerified: userInfo.email ? timestamp : null,
    name: userInfo.name || null,
    image: imageToStore,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await usersCollection.insertOne(user as any);

  logger.info('Created OAuth user', {
    context: 'arctic.user-service.createOAuthUser',
    userId: id,
    username,
    email: userInfo.email,
    imageCached: !!imageMetadata,
  });

  return { user, imageMetadata };
}

/**
 * Link an OAuth account to a user
 *
 * @param userId - User's ID
 * @param provider - OAuth provider name
 * @param providerAccountId - User's ID from the provider
 * @param tokens - OAuth tokens
 * @param imageMetadata - Optional OAuth image URL and hash for change detection
 */
export async function linkOAuthAccount(
  userId: string,
  provider: string,
  providerAccountId: string,
  tokens: ArcticTokenResult,
  imageMetadata?: { url: string; hash: string }
): Promise<void> {
  const db = await getMongoDatabase();
  const accountsCollection = db.collection<OAuthAccount>('accounts');

  const timestamp = now();

  const account: OAuthAccount = {
    userId,
    type: 'oauth',
    provider,
    providerAccountId,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    expires_at: tokens.accessTokenExpiresAt
      ? Math.floor(tokens.accessTokenExpiresAt.getTime() / 1000)
      : undefined,
    id_token: tokens.idToken,
    oauthImageUrl: imageMetadata?.url,
    oauthImageHash: imageMetadata?.hash,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await accountsCollection.insertOne(account as any);

  logger.info('Linked OAuth account', {
    context: 'arctic.user-service.linkOAuthAccount',
    userId,
    provider,
    hasImageMetadata: !!imageMetadata,
  });
}

/**
 * Update OAuth account tokens
 *
 * @param provider - OAuth provider name
 * @param providerAccountId - User's ID from the provider
 * @param tokens - New OAuth tokens
 */
export async function updateOAuthTokens(
  provider: string,
  providerAccountId: string,
  tokens: ArcticTokenResult
): Promise<void> {
  const db = await getMongoDatabase();
  const accountsCollection = db.collection<OAuthAccount>('accounts');

  await accountsCollection.updateOne(
    { provider, providerAccountId },
    {
      $set: {
        access_token: tokens.accessToken,
        refresh_token: tokens.refreshToken,
        expires_at: tokens.accessTokenExpiresAt
          ? Math.floor(tokens.accessTokenExpiresAt.getTime() / 1000)
          : undefined,
        id_token: tokens.idToken,
        updatedAt: now(),
      },
    }
  );

  logger.debug('Updated OAuth tokens', {
    context: 'arctic.user-service.updateOAuthTokens',
    provider,
  });
}

/**
 * Update user profile from OAuth provider info
 * Updates name and image if they've changed, caching images locally
 *
 * @param userId - User's ID
 * @param provider - OAuth provider name
 * @param providerAccountId - Account ID from provider
 * @param userInfo - User information from OAuth provider
 * @returns Updated user
 */
export async function updateUserProfileFromOAuth(
  userId: string,
  provider: string,
  providerAccountId: string,
  userInfo: ArcticUserInfo
): Promise<OAuthUser | null> {
  const db = await getMongoDatabase();
  const usersCollection = db.collection<OAuthUser>('users');
  const accountsCollection = db.collection<OAuthAccount>('accounts');

  // Get the existing user and account for comparison
  const existingUser = await findUserById(userId);
  const existingAccount = await findOAuthAccount(provider, providerAccountId);

  const updateFields: Partial<OAuthUser> = {
    updatedAt: now(),
  };

  const accountUpdateFields: Partial<OAuthAccount> = {
    updatedAt: now(),
  };

  // Update name if provided
  if (userInfo.name) {
    updateFields.name = userInfo.name;
  }

  // Handle image caching with change detection
  if (userInfo.image) {
    const existingHash = existingAccount?.oauthImageHash;
    const existingOAuthUrl = existingAccount?.oauthImageUrl;

    // Check if the OAuth URL has changed (provider gave us a different URL)
    const oauthUrlChanged = existingOAuthUrl !== userInfo.image;

    if (oauthUrlChanged || !existingHash) {
      // URL changed or no existing hash - need to cache the new image
      logger.debug('OAuth image URL changed or no existing hash, caching new image', {
        context: 'arctic.user-service.updateUserProfileFromOAuth',
        userId,
        oauthUrlChanged,
        hasExistingHash: !!existingHash,
      });

      const cached = await cacheOAuthProfileImage(userInfo.image, userId);

      if (cached) {
        // Check if the actual image content changed (by hash)
        const imageContentChanged = cached.hash !== existingHash;

        if (imageContentChanged) {
          // Clean up old cached image if it exists
          await cleanupOldProfileImage(existingUser?.image);

          updateFields.image = cached.filepath;
          accountUpdateFields.oauthImageUrl = userInfo.image;
          accountUpdateFields.oauthImageHash = cached.hash;

          logger.debug('OAuth profile image updated (content changed)', {
            context: 'arctic.user-service.updateUserProfileFromOAuth',
            userId,
            newHash: cached.hash,
            oldHash: existingHash,
          });
        } else {
          // Content is the same even though URL changed - just update the URL reference
          accountUpdateFields.oauthImageUrl = userInfo.image;

          logger.debug('OAuth image URL changed but content is same, skipping re-cache', {
            context: 'arctic.user-service.updateUserProfileFromOAuth',
            userId,
            hash: cached.hash,
          });
        }
      } else {
        // Caching failed - fall back to external URL
        updateFields.image = userInfo.image;
        logger.debug('OAuth image caching failed, using external URL', {
          context: 'arctic.user-service.updateUserProfileFromOAuth',
          userId,
        });
      }
    } else {
      // URL unchanged and we have a hash - no need to re-download
      logger.debug('OAuth image unchanged, skipping re-cache', {
        context: 'arctic.user-service.updateUserProfileFromOAuth',
        userId,
        existingHash,
      });
    }
  }

  // Update user document
  const result = await usersCollection.findOneAndUpdate(
    { id: userId },
    { $set: updateFields },
    { returnDocument: 'after' }
  );

  // Update account document with image metadata if changed
  if (Object.keys(accountUpdateFields).length > 1) {
    // More than just updatedAt
    await accountsCollection.updateOne(
      { provider, providerAccountId },
      { $set: accountUpdateFields }
    );
  }

  if (result) {
    logger.debug('Updated user profile from OAuth', {
      context: 'arctic.user-service.updateUserProfileFromOAuth',
      userId,
      updatedUserFields: Object.keys(updateFields),
      updatedAccountFields: Object.keys(accountUpdateFields),
    });
  }

  return result || null;
}

/**
 * Create or find a user from OAuth login
 * This is the main entry point for OAuth authentication
 *
 * @param provider - OAuth provider name
 * @param userInfo - User information from the provider
 * @param tokens - OAuth tokens
 * @returns The user (existing or newly created)
 */
export async function createOrFindOAuthUser(
  provider: string,
  userInfo: ArcticUserInfo,
  tokens: ArcticTokenResult
): Promise<OAuthUser> {
  // First, check if we already have an account for this provider + providerAccountId
  const existingUser = await findUserByOAuthAccount(provider, userInfo.id);

  if (existingUser) {
    // Update tokens for existing account
    await updateOAuthTokens(provider, userInfo.id, tokens);

    // Update user profile (name, image) from provider with caching
    const updatedUser = await updateUserProfileFromOAuth(
      existingUser.id,
      provider,
      userInfo.id,
      userInfo
    );

    logger.debug('OAuth login - returning existing user', {
      context: 'arctic.user-service.createOrFindOAuthUser',
      provider,
      userId: existingUser.id,
    });

    return updatedUser || existingUser;
  }

  // Check if we have a user with this email (for account linking)
  if (userInfo.email) {
    const userByEmail = await findUserByEmail(userInfo.email);

    if (userByEmail) {
      // Cache the profile image before linking
      let imageMetadata: { url: string; hash: string } | undefined;
      if (userInfo.image) {
        const cached = await cacheOAuthProfileImage(userInfo.image, userByEmail.id);
        if (cached) {
          imageMetadata = { url: userInfo.image, hash: cached.hash };
          // Update user image to use cached path
          const db = await getMongoDatabase();
          const usersCollection = db.collection<OAuthUser>('users');
          await usersCollection.updateOne(
            { id: userByEmail.id },
            { $set: { image: cached.filepath, updatedAt: now() } }
          );
        }
      }

      // Link this OAuth account to the existing user with image metadata
      await linkOAuthAccount(userByEmail.id, provider, userInfo.id, tokens, imageMetadata);

      // Update user profile (name only since we just handled image)
      const updatedUser = await findUserById(userByEmail.id);

      logger.info('OAuth login - linked account to existing user by email', {
        context: 'arctic.user-service.createOrFindOAuthUser',
        provider,
        userId: userByEmail.id,
        email: userInfo.email,
        imageCached: !!imageMetadata,
      });

      return updatedUser || userByEmail;
    }
  }

  // Create a new user (image is cached during creation)
  const { user: newUser, imageMetadata } = await createOAuthUser(userInfo);

  // Link the OAuth account with image metadata
  await linkOAuthAccount(newUser.id, provider, userInfo.id, tokens, imageMetadata);

  logger.info('OAuth login - created new user', {
    context: 'arctic.user-service.createOrFindOAuthUser',
    provider,
    userId: newUser.id,
    imageCached: !!imageMetadata,
  });

  return newUser;
}

/**
 * Unlink an OAuth account from a user
 *
 * @param userId - User's ID
 * @param provider - OAuth provider name
 */
export async function unlinkOAuthAccount(
  userId: string,
  provider: string
): Promise<void> {
  const db = await getMongoDatabase();
  const accountsCollection = db.collection<OAuthAccount>('accounts');

  await accountsCollection.deleteOne({ userId, provider });

  logger.info('Unlinked OAuth account', {
    context: 'arctic.user-service.unlinkOAuthAccount',
    userId,
    provider,
  });
}

/**
 * Get all linked OAuth accounts for a user
 *
 * @param userId - User's ID
 * @returns Array of linked account providers
 */
export async function getLinkedOAuthAccounts(
  userId: string
): Promise<{ provider: string; providerAccountId: string }[]> {
  const db = await getMongoDatabase();
  const accountsCollection = db.collection<OAuthAccount>('accounts');

  const accounts = await accountsCollection
    .find({ userId })
    .project({ provider: 1, providerAccountId: 1 })
    .toArray();

  return accounts.map((a) => ({
    provider: a.provider,
    providerAccountId: a.providerAccountId,
  }));
}
