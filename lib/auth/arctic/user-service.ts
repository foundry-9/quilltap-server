/**
 * OAuth User Service
 *
 * Handles user creation and account linking for OAuth authentication.
 */

import { getMongoDatabase } from '@/lib/mongodb/client';
import { logger } from '@/lib/logger';
import crypto from 'crypto';
import type { ArcticUserInfo, ArcticTokenResult } from './types';

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
 * Create a new user from OAuth provider info
 *
 * @param userInfo - User information from OAuth provider
 * @returns Created user
 */
export async function createOAuthUser(userInfo: ArcticUserInfo): Promise<OAuthUser> {
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

  const user: OAuthUser = {
    id,
    username,
    email: userInfo.email || null,
    emailVerified: userInfo.email ? timestamp : null,
    name: userInfo.name || null,
    image: userInfo.image || null,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await usersCollection.insertOne(user as any);

  logger.info('Created OAuth user', {
    context: 'arctic.user-service.createOAuthUser',
    userId: id,
    username,
    email: userInfo.email,
  });

  return user;
}

/**
 * Link an OAuth account to a user
 *
 * @param userId - User's ID
 * @param provider - OAuth provider name
 * @param providerAccountId - User's ID from the provider
 * @param tokens - OAuth tokens
 */
export async function linkOAuthAccount(
  userId: string,
  provider: string,
  providerAccountId: string,
  tokens: ArcticTokenResult
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
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  await accountsCollection.insertOne(account as any);

  logger.info('Linked OAuth account', {
    context: 'arctic.user-service.linkOAuthAccount',
    userId,
    provider,
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

    logger.debug('OAuth login - returning existing user', {
      context: 'arctic.user-service.createOrFindOAuthUser',
      provider,
      userId: existingUser.id,
    });

    return existingUser;
  }

  // Check if we have a user with this email (for account linking)
  if (userInfo.email) {
    const userByEmail = await findUserByEmail(userInfo.email);

    if (userByEmail) {
      // Link this OAuth account to the existing user
      await linkOAuthAccount(userByEmail.id, provider, userInfo.id, tokens);

      logger.info('OAuth login - linked account to existing user by email', {
        context: 'arctic.user-service.createOrFindOAuthUser',
        provider,
        userId: userByEmail.id,
        email: userInfo.email,
      });

      return userByEmail;
    }
  }

  // Create a new user
  const newUser = await createOAuthUser(userInfo);

  // Link the OAuth account
  await linkOAuthAccount(newUser.id, provider, userInfo.id, tokens);

  logger.info('OAuth login - created new user', {
    context: 'arctic.user-service.createOrFindOAuthUser',
    provider,
    userId: newUser.id,
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
