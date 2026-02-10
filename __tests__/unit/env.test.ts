/**
 * Unit tests for environment variable validation
 */

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

describe('Environment Validation', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    // Save original environment
    originalEnv = { ...process.env };

    // Set up minimum required environment variables
    process.env.NODE_ENV = 'test';
    process.env.BASE_URL = 'http://localhost:3000';
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;

    // Clear module cache to reset env validation
    jest.resetModules();
  });

  it('should validate with all required variables', async () => {
    const { validateEnv } = await import('@/lib/env');

    expect(() => validateEnv()).not.toThrow();
  });

  it('should succeed without DATABASE_URL (JSON store is default)', async () => {
    delete process.env.DATABASE_URL;

    // We need to re-import after changing env
    jest.resetModules();

    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('should succeed without Google OAuth credentials (plugin-based auth)', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;

    jest.resetModules();

    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('should succeed without ENCRYPTION_MASTER_PEPPER (managed by pepper vault)', async () => {
    delete process.env.ENCRYPTION_MASTER_PEPPER;

    jest.resetModules();

    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('should accept valid NODE_ENV values', async () => {
    const validEnvs = ['development', 'production', 'test'];

    for (const env of validEnvs) {
      process.env.NODE_ENV = env;
      jest.resetModules();

      const { validateEnv } = await import('@/lib/env');
      expect(() => validateEnv()).not.toThrow();
    }
  });

  it('should accept optional rate limit configuration', async () => {
    process.env.RATE_LIMIT_API_MAX = '100';
    process.env.RATE_LIMIT_API_WINDOW = '60';

    jest.resetModules();

    const { validateEnv } = await import('@/lib/env');
    expect(() => validateEnv()).not.toThrow();
  });

  it('should accept optional log level', async () => {
    process.env.LOG_LEVEL = 'debug';

    jest.resetModules();

    const { validateEnv } = await import('@/lib/env');
    const env = validateEnv();

    expect(env.LOG_LEVEL).toBe('debug');
  });

  it('should default log level to info', async () => {
    delete process.env.LOG_LEVEL;

    jest.resetModules();

    const { validateEnv } = await import('@/lib/env');
    const env = validateEnv();

    expect(env.LOG_LEVEL).toBe('info');
  });
});

