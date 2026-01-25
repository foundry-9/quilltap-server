/**
 * Unit Tests for Arctic OAuth User Service
 * Tests lib/auth/arctic/user-service.ts
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import type { Collection, Db } from 'mongodb';
import type { ArcticUserInfo, ArcticTokenResult } from '@/lib/auth/arctic/types';

// Mock the logger
jest.mock('@/lib/logger', () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

// Mock image import/delete functions
jest.mock('@/lib/images-v2', () => ({
  importImageFromUrl: jest.fn().mockResolvedValue({
    filepath: '/api/v1/files/cached-image-123',
    sha256: 'hash-abc123',
  }),
  deleteImageById: jest.fn().mockResolvedValue(undefined),
}));

// Mock MongoDB
const mockUsersCollection = {
  findOne: jest.fn(),
  find: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
  findOneAndUpdate: jest.fn(),
} as unknown as Collection;

const mockAccountsCollection = {
  findOne: jest.fn(),
  find: jest.fn(),
  insertOne: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
} as unknown as Collection;

const mockDb = {
  collection: jest.fn((name: string) => {
    if (name === 'users') return mockUsersCollection;
    if (name === 'accounts') return mockAccountsCollection;
    throw new Error(`Unexpected collection: ${name}`);
  }),
} as unknown as Db;

jest.mock('@/lib/mongodb/client', () => ({
  __esModule: true,
  getMongoDatabase: jest.fn(() => Promise.resolve(mockDb)),
}));

// Import after mocking
const {
  findUserByOAuthAccount,
  findUserByEmail,
  createOAuthUser,
  linkOAuthAccount,
  updateOAuthTokens,
  updateUserProfileFromOAuth,
  createOrFindOAuthUser,
  unlinkOAuthAccount,
  getLinkedOAuthAccounts,
} = require('@/lib/auth/arctic/user-service') as typeof import('@/lib/auth/arctic/user-service');

// Test fixtures
const now = new Date().toISOString();

const createMockUser = (overrides = {}) => ({
  id: 'user-123',
  username: 'testuser',
  email: 'test@example.com',
  emailVerified: now,
  name: 'Test User',
  image: '/api/v1/files/image-123',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const createMockAccount = (overrides = {}) => ({
  userId: 'user-123',
  type: 'oauth',
  provider: 'google',
  providerAccountId: 'google-user-456',
  access_token: 'access-token-abc',
  refresh_token: 'refresh-token-xyz',
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  id_token: 'id-token-123',
  oauthImageUrl: 'https://google.com/avatar.jpg',
  oauthImageHash: 'hash-abc123',
  createdAt: now,
  updatedAt: now,
  ...overrides,
});

const createMockUserInfo = (overrides = {}): ArcticUserInfo => ({
  id: 'google-user-456',
  email: 'test@example.com',
  name: 'Test User',
  image: 'https://google.com/avatar.jpg',
  ...overrides,
});

const createMockTokens = (overrides = {}): ArcticTokenResult => ({
  accessToken: 'access-token-abc',
  refreshToken: 'refresh-token-xyz',
  accessTokenExpiresAt: new Date(Date.now() + 3600000),
  idToken: 'id-token-123',
  ...overrides,
});

describe('Arctic OAuth User Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);
    (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(null);
    (mockUsersCollection.find as jest.Mock).mockReturnValue({
      project: jest.fn().mockReturnValue({
        toArray: jest.fn().mockResolvedValue([]),
      }),
    });
  });

  describe('findUserByOAuthAccount', () => {
    it('returns user when account exists', async () => {
      const account = createMockAccount();
      const user = createMockUser();
      
      (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(account);
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(user);

      const result = await findUserByOAuthAccount('google', 'google-user-456');

      expect(result).toEqual(user);
      expect(mockAccountsCollection.findOne).toHaveBeenCalledWith({
        provider: 'google',
        providerAccountId: 'google-user-456',
      });
    });

    it('returns null when account not found', async () => {
      (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(null);

      const result = await findUserByOAuthAccount('google', 'nonexistent');

      expect(result).toBeNull();
    });

    it('returns null when user not found for account', async () => {
      const account = createMockAccount();
      (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(account);
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);

      const result = await findUserByOAuthAccount('google', 'google-user-456');

      expect(result).toBeNull();
    });

    it('logs warning when user missing for account', async () => {
      const account = createMockAccount();
      (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(account);
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);
      const { logger } = require('@/lib/logger');

      await findUserByOAuthAccount('google', 'google-user-456');

      expect(logger.warn).toHaveBeenCalledWith(
        'User not found for OAuth account',
        expect.objectContaining({ provider: 'google' })
      );
    });

    it('returns null on database error', async () => {
      (mockAccountsCollection.findOne as jest.Mock).mockRejectedValue(new Error('DB error'));

      const result = await findUserByOAuthAccount('google', 'google-user-456');

      expect(result).toBeNull();
    });
  });

  describe('findUserByEmail', () => {
    it('returns user when found', async () => {
      const user = createMockUser();
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(user);

      const result = await findUserByEmail('test@example.com');

      expect(result).toEqual(user);
      expect(mockUsersCollection.findOne).toHaveBeenCalledWith({ 
        email: 'test@example.com' 
      });
    });

    it('returns null when not found', async () => {
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);

      const result = await findUserByEmail('nonexistent@example.com');

      expect(result).toBeNull();
    });

    it('returns null on database error', async () => {
      (mockUsersCollection.findOne as jest.Mock).mockRejectedValue(new Error('DB error'));

      const result = await findUserByEmail('test@example.com');

      expect(result).toBeNull();
    });
  });

  describe('createOAuthUser', () => {
    it('creates new user with cached image', async () => {
      const userInfo = createMockUserInfo();
      (mockUsersCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'user-id' });
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);

      const result = await createOAuthUser(userInfo);

      expect(result.user).toMatchObject({
        username: 'test',
        email: 'test@example.com',
        name: 'Test User',
        image: '/api/v1/files/cached-image-123',
      });
      expect(result.imageMetadata).toEqual({
        url: 'https://google.com/avatar.jpg',
        hash: 'hash-abc123',
      });
    });

    it('generates username from email', async () => {
      const userInfo = createMockUserInfo({ email: 'john.doe@example.com' });
      (mockUsersCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'user-id' });
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);

      const result = await createOAuthUser(userInfo);

      expect(result.user.username).toBe('john.doe');
    });

    it('generates username from name when email missing', async () => {
      const userInfo = createMockUserInfo({ 
        email: undefined, 
        name: 'John Doe' 
      });
      (mockUsersCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'user-id' });
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);

      const result = await createOAuthUser(userInfo);

      expect(result.user.username).toBe('john_doe');
    });

    it('generates unique username when collision occurs', async () => {
      const userInfo = createMockUserInfo();
      const existingUser = createMockUser({ username: 'test' });
      
      (mockUsersCollection.findOne as jest.Mock)
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce(null);
      (mockUsersCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'user-id' });

      const result = await createOAuthUser(userInfo);

      expect(result.user.username).toMatch(/^test_[a-z0-9]{4}$/);
    });

    it('falls back to external URL when image caching fails', async () => {
      const userInfo = createMockUserInfo();
      const { importImageFromUrl } = require('@/lib/images-v2');
      (importImageFromUrl as jest.Mock).mockRejectedValue(new Error('Cache failed'));
      (mockUsersCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'user-id' });
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);

      const result = await createOAuthUser(userInfo);

      expect(result.user.image).toBe('https://google.com/avatar.jpg');
      expect(result.imageMetadata).toBeUndefined();
    });

    it('handles user without image', async () => {
      const userInfo = createMockUserInfo({ image: undefined });
      (mockUsersCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'user-id' });
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);

      const result = await createOAuthUser(userInfo);

      expect(result.user.image).toBeNull();
      expect(result.imageMetadata).toBeUndefined();
    });

    it('sets emailVerified when email provided', async () => {
      const userInfo = createMockUserInfo();
      (mockUsersCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'user-id' });
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);

      const result = await createOAuthUser(userInfo);

      expect(result.user.emailVerified).toBeTruthy();
    });

    it('does not verify email when email missing', async () => {
      const userInfo = createMockUserInfo({ email: undefined });
      (mockUsersCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'user-id' });
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);

      const result = await createOAuthUser(userInfo);

      expect(result.user.email).toBeNull();
      expect(result.user.emailVerified).toBeNull();
    });
  });

  describe('linkOAuthAccount', () => {
    it('creates OAuth account with tokens', async () => {
      const tokens = createMockTokens();
      const imageMetadata = { url: 'https://google.com/avatar.jpg', hash: 'hash-123' };
      (mockAccountsCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'account-id' });

      await linkOAuthAccount('user-123', 'google', 'google-user-456', tokens, imageMetadata);

      expect(mockAccountsCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          provider: 'google',
          providerAccountId: 'google-user-456',
          access_token: 'access-token-abc',
          refresh_token: 'refresh-token-xyz',
          id_token: 'id-token-123',
          oauthImageUrl: 'https://google.com/avatar.jpg',
          oauthImageHash: 'hash-123',
        })
      );
    });

    it('converts expires_at to unix timestamp', async () => {
      const expiresAt = new Date('2026-01-22T12:00:00Z');
      const tokens = createMockTokens({ accessTokenExpiresAt: expiresAt });
      (mockAccountsCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'account-id' });

      await linkOAuthAccount('user-123', 'google', 'google-user-456', tokens);

      expect(mockAccountsCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          expires_at: Math.floor(expiresAt.getTime() / 1000),
        })
      );
    });

    it('handles missing image metadata', async () => {
      const tokens = createMockTokens();
      (mockAccountsCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'account-id' });

      await linkOAuthAccount('user-123', 'google', 'google-user-456', tokens);

      expect(mockAccountsCollection.insertOne).toHaveBeenCalledWith(
        expect.objectContaining({
          oauthImageUrl: undefined,
          oauthImageHash: undefined,
        })
      );
    });

    it('logs successful link', async () => {
      const tokens = createMockTokens();
      const { logger } = require('@/lib/logger');
      (mockAccountsCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'account-id' });

      await linkOAuthAccount('user-123', 'google', 'google-user-456', tokens);

      expect(logger.info).toHaveBeenCalledWith(
        'Linked OAuth account',
        expect.objectContaining({ userId: 'user-123', provider: 'google' })
      );
    });
  });

  describe('updateOAuthTokens', () => {
    it('updates tokens for existing account', async () => {
      const tokens = createMockTokens();
      (mockAccountsCollection.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

      await updateOAuthTokens('google', 'google-user-456', tokens);

      expect(mockAccountsCollection.updateOne).toHaveBeenCalledWith(
        { provider: 'google', providerAccountId: 'google-user-456' },
        {
          $set: expect.objectContaining({
            access_token: 'access-token-abc',
            refresh_token: 'refresh-token-xyz',
            id_token: 'id-token-123',
          }),
        }
      );
    });

    it('updates updatedAt timestamp', async () => {
      const tokens = createMockTokens();
      (mockAccountsCollection.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

      await updateOAuthTokens('google', 'google-user-456', tokens);

      expect(mockAccountsCollection.updateOne).toHaveBeenCalledWith(
        expect.any(Object),
        {
          $set: expect.objectContaining({
            updatedAt: expect.any(String),
          }),
        }
      );
    });
  });

  describe('updateUserProfileFromOAuth', () => {
    it('updates user name from OAuth', async () => {
      const user = createMockUser();
      const account = createMockAccount();
      const userInfo = createMockUserInfo({ name: 'Updated Name' });

      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(user);
      (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(account);
      (mockUsersCollection.findOneAndUpdate as jest.Mock).mockResolvedValue(
        { ...user, name: 'Updated Name' }
      );

      const result = await updateUserProfileFromOAuth(
        'user-123',
        'google',
        'google-user-456',
        userInfo
      );

      expect(mockUsersCollection.findOneAndUpdate).toHaveBeenCalledWith(
        { id: 'user-123' },
        { $set: expect.objectContaining({ name: 'Updated Name' }) },
        { returnDocument: 'after' }
      );
    });

    it('caches new OAuth image when URL changes', async () => {
      const user = createMockUser({ image: '/api/v1/files/old-image' });
      const account = createMockAccount({ 
        oauthImageUrl: 'https://google.com/old-avatar.jpg',
        oauthImageHash: 'old-hash',
      });
      const userInfo = createMockUserInfo({ 
        image: 'https://google.com/new-avatar.jpg' 
      });

      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(user);
      (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(account);
      (mockUsersCollection.findOneAndUpdate as jest.Mock).mockResolvedValue(user);

      await updateUserProfileFromOAuth('user-123', 'google', 'google-user-456', userInfo);

      const { importImageFromUrl } = require('@/lib/images-v2');
      expect(importImageFromUrl).toHaveBeenCalledWith(
        'https://google.com/new-avatar.jpg',
        'user-123',
        ['user:user-123']
      );
    });

    it('cleans up old cached image when content changes', async () => {
      const user = createMockUser({ image: '/api/v1/files/old-image-123' });
      const account = createMockAccount({ 
        oauthImageUrl: 'https://google.com/old-avatar.jpg',  // Different URL
        oauthImageHash: 'old-hash',
      });
      const userInfo = createMockUserInfo({
        image: 'https://google.com/new-avatar.jpg'  // New URL
      });
      const { importImageFromUrl } = require('@/lib/images-v2');

      // Mock importImageFromUrl to return a different hash to trigger cleanup
      (importImageFromUrl as jest.Mock).mockResolvedValueOnce({
        filepath: '/api/v1/files/new-image-456',
        sha256: 'new-hash-different',
      });

      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(user);
      (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(account);
      (mockUsersCollection.findOneAndUpdate as jest.Mock).mockResolvedValue(user);

      await updateUserProfileFromOAuth('user-123', 'google', 'google-user-456', userInfo);

      const { deleteImageById } = require('@/lib/images-v2');
      expect(deleteImageById).toHaveBeenCalledWith('old-image-123');
    });

    it('skips re-cache when OAuth URL unchanged', async () => {
      const user = createMockUser();
      const account = createMockAccount({ 
        oauthImageUrl: 'https://google.com/avatar.jpg',
        oauthImageHash: 'hash-abc123',
      });
      const userInfo = createMockUserInfo();

      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(user);
      (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(account);
      (mockUsersCollection.findOneAndUpdate as jest.Mock).mockResolvedValue(user);

      await updateUserProfileFromOAuth('user-123', 'google', 'google-user-456', userInfo);

      const { importImageFromUrl } = require('@/lib/images-v2');
      expect(importImageFromUrl).not.toHaveBeenCalled();
    });

    it('returns null when user not found', async () => {
      const userInfo = createMockUserInfo();
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);
      (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(null);
      (mockUsersCollection.findOneAndUpdate as jest.Mock).mockResolvedValue(null);

      const result = await updateUserProfileFromOAuth(
        'nonexistent',
        'google',
        'google-user-456',
        userInfo
      );

      expect(result).toBeNull();
    });
  });

  describe('createOrFindOAuthUser', () => {
    it('returns existing user and updates tokens', async () => {
      const existingUser = createMockUser();
      const userInfo = createMockUserInfo();
      const tokens = createMockTokens();

      (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(createMockAccount());
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(existingUser);
      (mockUsersCollection.findOneAndUpdate as jest.Mock).mockResolvedValue(existingUser);
      (mockAccountsCollection.updateOne as jest.Mock).mockResolvedValue({ modifiedCount: 1 });

      const result = await createOrFindOAuthUser('google', userInfo, tokens);

      expect(result).toEqual(existingUser);
      expect(mockAccountsCollection.updateOne).toHaveBeenCalled();
    });

    it('links account to existing user by email', async () => {
      const existingUser = createMockUser();
      const userInfo = createMockUserInfo();
      const tokens = createMockTokens();

      (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(null);
      (mockUsersCollection.findOne as jest.Mock)
        .mockResolvedValueOnce(existingUser) // findUserByEmail
        .mockResolvedValueOnce(existingUser); // findUserById
      (mockAccountsCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'account-id' });

      const result = await createOrFindOAuthUser('google', userInfo, tokens);

      expect(result.id).toBe(existingUser.id);
      expect(mockAccountsCollection.insertOne).toHaveBeenCalled();
    });

    it('creates new user when no existing account or email match', async () => {
      const userInfo = createMockUserInfo();
      const tokens = createMockTokens();

      (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(null);
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);
      (mockUsersCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'new-user-id' });
      (mockAccountsCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'account-id' });

      const result = await createOrFindOAuthUser('google', userInfo, tokens);

      expect(mockUsersCollection.insertOne).toHaveBeenCalled();
      expect(mockAccountsCollection.insertOne).toHaveBeenCalled();
    });

    it('logs new user creation', async () => {
      const userInfo = createMockUserInfo();
      const tokens = createMockTokens();
      const { logger } = require('@/lib/logger');

      (mockAccountsCollection.findOne as jest.Mock).mockResolvedValue(null);
      (mockUsersCollection.findOne as jest.Mock).mockResolvedValue(null);
      (mockUsersCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'new-user-id' });
      (mockAccountsCollection.insertOne as jest.Mock).mockResolvedValue({ insertedId: 'account-id' });

      await createOrFindOAuthUser('google', userInfo, tokens);

      expect(logger.info).toHaveBeenCalledWith(
        'OAuth login - created new user',
        expect.any(Object)
      );
    });
  });

  describe('unlinkOAuthAccount', () => {
    it('removes OAuth account link', async () => {
      (mockAccountsCollection.deleteOne as jest.Mock).mockResolvedValue({ deletedCount: 1 });

      await unlinkOAuthAccount('user-123', 'google');

      expect(mockAccountsCollection.deleteOne).toHaveBeenCalledWith({
        userId: 'user-123',
        provider: 'google',
      });
    });

    it('logs successful unlink', async () => {
      const { logger } = require('@/lib/logger');
      (mockAccountsCollection.deleteOne as jest.Mock).mockResolvedValue({ deletedCount: 1 });

      await unlinkOAuthAccount('user-123', 'google');

      expect(logger.info).toHaveBeenCalledWith(
        'Unlinked OAuth account',
        expect.objectContaining({ userId: 'user-123', provider: 'google' })
      );
    });
  });

  describe('getLinkedOAuthAccounts', () => {
    it('returns list of linked accounts', async () => {
      const accounts = [
        { provider: 'google', providerAccountId: 'google-123' },
        { provider: 'github', providerAccountId: 'github-456' },
      ];

      (mockUsersCollection.find as jest.Mock).mockReturnValue({
        project: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue(accounts),
        }),
      });
      (mockAccountsCollection.find as jest.Mock).mockReturnValue({
        project: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue(accounts),
        }),
      });

      const result = await getLinkedOAuthAccounts('user-123');

      expect(result).toEqual(accounts);
    });

    it('returns empty array when no accounts linked', async () => {
      (mockAccountsCollection.find as jest.Mock).mockReturnValue({
        project: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([]),
        }),
      });

      const result = await getLinkedOAuthAccounts('user-123');

      expect(result).toEqual([]);
    });
  });
});
