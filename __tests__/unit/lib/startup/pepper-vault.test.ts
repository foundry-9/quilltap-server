/**
 * Unit Tests for Pepper Vault
 * Tests lib/startup/pepper-vault.ts
 *
 * Tests the pepper vault lifecycle: provisioning, setup, unlock, and vault storage.
 * Uses mocked SQLite database and process.env manipulation.
 */

import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';

// ============================================================================
// Mocks
// ============================================================================

// Store original env
const originalEnv = { ...process.env };

// Mock paths must resolve from test file to the actual module locations.
// pepper-vault.ts imports '../../migrations/lib/logger' from lib/startup/,
// which resolves to <rootDir>/migrations/lib/logger.
// From __tests__/unit/lib/startup/, that's ../../../../migrations/lib/logger.

// Mock the migration logger
jest.mock('../../../../migrations/lib/logger', () => {
  const mockLogger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    child: jest.fn(() => mockLogger),
  };
  return { logger: mockLogger };
});

// In-memory storage to simulate SQLite
let mockStore: Record<string, unknown> = {};
let mockTableExists = false;

jest.mock('../../../../migrations/lib/database-utils', () => ({
  getSQLiteDatabase: jest.fn(() => ({
    exec: jest.fn((sql: string) => {
      if (sql.includes('CREATE TABLE')) {
        mockTableExists = true;
      }
    }),
    prepare: jest.fn((sql: string) => ({
      get: jest.fn((..._params: unknown[]) => {
        if (sql.includes('SELECT') && mockTableExists) {
          return mockStore['pepper_vault'] || undefined;
        }
        return undefined;
      }),
      run: jest.fn((...params: unknown[]) => {
        if (sql.includes('INSERT OR REPLACE')) {
          mockStore['pepper_vault'] = {
            id: 1,
            encrypted_pepper: params[0],
            pepper_hash: params[1],
            has_passphrase: params[2],
            created_at: params[3],
          };
        }
      }),
    })),
  })),
  closeSQLite: jest.fn(),
  ensureSQLiteDataDir: jest.fn(),
}));

// Mock process.exit — just records the call; provisionPepper's catch block handles the rest
const mockExit = jest.spyOn(process, 'exit').mockImplementation((() => {
  // Don't throw — let the code continue through its catch block
}) as never);

// ============================================================================
// Test Helpers
// ============================================================================

// Re-import the module fresh for each test
async function importPepperVault() {
  jest.resetModules();
  // Re-apply the mocks after reset
  jest.mock('../../../../migrations/lib/logger', () => {
    const mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(() => mockLogger),
    };
    return { logger: mockLogger };
  });

  jest.mock('../../../../migrations/lib/database-utils', () => ({
    getSQLiteDatabase: jest.fn(() => ({
      exec: jest.fn((sql: string) => {
        if (sql.includes('CREATE TABLE')) {
          mockTableExists = true;
        }
      }),
      prepare: jest.fn((sql: string) => ({
        get: jest.fn((..._params: unknown[]) => {
          if (sql.includes('SELECT') && mockTableExists) {
            return mockStore['pepper_vault'] || undefined;
          }
          return undefined;
        }),
        run: jest.fn((...params: unknown[]) => {
          if (sql.includes('INSERT OR REPLACE')) {
            mockStore['pepper_vault'] = {
              id: 1,
              encrypted_pepper: params[0],
              pepper_hash: params[1],
              has_passphrase: params[2],
              created_at: params[3],
            };
          }
        }),
      })),
    })),
    closeSQLite: jest.fn(),
    ensureSQLiteDataDir: jest.fn(),
  }));

  return await import('@/lib/startup/pepper-vault');
}

// ============================================================================
// Tests
// ============================================================================

describe('Pepper Vault', () => {
  beforeEach(() => {
    mockStore = {};
    mockTableExists = false;
    process.env = { ...originalEnv };
    delete process.env.ENCRYPTION_MASTER_PEPPER;
    jest.clearAllMocks();
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ==========================================================================
  // Crypto Primitives
  // ==========================================================================

  describe('Crypto primitives (via setupPepper roundtrip)', () => {
    it('should generate and store a pepper successfully', async () => {
      const vault = await importPepperVault();

      // Force needs-setup state
      const state = await vault.provisionPepper();
      expect(state).toBe('needs-setup');

      // Setup with no passphrase
      const result = vault.setupPepper('');
      expect(result.pepper).toBeDefined();
      expect(result.pepper.length).toBeGreaterThan(0);

      // Pepper should be set in env
      expect(process.env.ENCRYPTION_MASTER_PEPPER).toBe(result.pepper);
    });

    it('should setup with a passphrase', async () => {
      const vault = await importPepperVault();

      await vault.provisionPepper();
      const result = vault.setupPepper('my-secure-passphrase');

      expect(result.pepper).toBeDefined();
      expect(process.env.ENCRYPTION_MASTER_PEPPER).toBe(result.pepper);

      // Verify stored data has passphrase flag
      const stored = mockStore['pepper_vault'] as { has_passphrase: number } | undefined;
      expect(stored?.has_passphrase).toBe(1);
    });
  });

  // ==========================================================================
  // provisionPepper() scenarios
  // ==========================================================================

  describe('provisionPepper()', () => {
    it('should return needs-setup when no env var and no stored pepper', async () => {
      const vault = await importPepperVault();
      const state = await vault.provisionPepper();
      expect(state).toBe('needs-setup');
    });

    it('should return needs-vault-storage when env var is set but no stored pepper', async () => {
      process.env.ENCRYPTION_MASTER_PEPPER = 'a'.repeat(44); // base64 of 32 bytes
      const vault = await importPepperVault();
      const state = await vault.provisionPepper();
      expect(state).toBe('needs-vault-storage');
    });

    it('should return resolved when env var matches stored hash', async () => {
      // First, set up a pepper to get a stored record
      const vault = await importPepperVault();
      await vault.provisionPepper(); // needs-setup
      const result = vault.setupPepper('testpass');

      // Now simulate restart: set env var to the generated pepper and re-provision
      process.env.ENCRYPTION_MASTER_PEPPER = result.pepper;

      const vault2 = await importPepperVault();
      const state = await vault2.provisionPepper();
      expect(state).toBe('resolved');
    });

    it('should FATAL exit when env var does not match stored hash', async () => {
      // First, set up a pepper
      const vault = await importPepperVault();
      await vault.provisionPepper();
      vault.setupPepper('testpass');

      // Now set a different pepper in env
      process.env.ENCRYPTION_MASTER_PEPPER = 'completely-different-pepper-value-that-is-long-enough';

      const vault2 = await importPepperVault();
      await vault2.provisionPepper();
      expect(mockExit).toHaveBeenCalledWith(1);
    });

    it('should return needs-unlock when stored pepper has passphrase and no env var', async () => {
      // Set up with passphrase
      const vault = await importPepperVault();
      await vault.provisionPepper();
      vault.setupPepper('my-passphrase');

      // Clear env var (simulate restart without env var)
      delete process.env.ENCRYPTION_MASTER_PEPPER;

      const vault2 = await importPepperVault();
      const state = await vault2.provisionPepper();
      expect(state).toBe('needs-unlock');
    });

    it('should auto-resolve when stored pepper has no passphrase and no env var', async () => {
      // Set up without passphrase
      const vault = await importPepperVault();
      await vault.provisionPepper();
      const result = vault.setupPepper('');

      // Clear env var (simulate restart without env var)
      delete process.env.ENCRYPTION_MASTER_PEPPER;

      const vault2 = await importPepperVault();
      const state = await vault2.provisionPepper();
      expect(state).toBe('resolved');

      // Pepper should be restored in env
      expect(process.env.ENCRYPTION_MASTER_PEPPER).toBe(result.pepper);
    });
  });

  // ==========================================================================
  // setupPepper()
  // ==========================================================================

  describe('setupPepper()', () => {
    it('should throw if not in needs-setup state', async () => {
      process.env.ENCRYPTION_MASTER_PEPPER = 'a'.repeat(44);
      const vault = await importPepperVault();
      await vault.provisionPepper(); // needs-vault-storage

      expect(() => vault.setupPepper('')).toThrow('Cannot setup pepper in state');
    });

    it('should generate a base64 pepper of adequate length', async () => {
      const vault = await importPepperVault();
      await vault.provisionPepper();

      const result = vault.setupPepper('');
      // 32 random bytes = 44 chars base64
      expect(result.pepper.length).toBe(44);
    });
  });

  // ==========================================================================
  // unlockPepper()
  // ==========================================================================

  describe('unlockPepper()', () => {
    it('should unlock with correct passphrase', async () => {
      const passphrase = 'unlock-me-please';

      // Setup
      const vault = await importPepperVault();
      await vault.provisionPepper();
      const result = vault.setupPepper(passphrase);
      const expectedPepper = result.pepper;

      // Simulate restart
      delete process.env.ENCRYPTION_MASTER_PEPPER;
      const vault2 = await importPepperVault();
      await vault2.provisionPepper(); // needs-unlock

      const success = vault2.unlockPepper(passphrase);
      expect(success).toBe(true);
      expect(process.env.ENCRYPTION_MASTER_PEPPER).toBe(expectedPepper);
    });

    it('should fail with wrong passphrase', async () => {
      // Setup with a passphrase
      const vault = await importPepperVault();
      await vault.provisionPepper();
      vault.setupPepper('correct-passphrase');

      // Simulate restart
      delete process.env.ENCRYPTION_MASTER_PEPPER;
      const vault2 = await importPepperVault();
      await vault2.provisionPepper(); // needs-unlock

      const success = vault2.unlockPepper('wrong-passphrase');
      expect(success).toBe(false);
      expect(process.env.ENCRYPTION_MASTER_PEPPER).toBeUndefined();
    });

    it('should throw if not in needs-unlock state', async () => {
      const vault = await importPepperVault();
      await vault.provisionPepper(); // needs-setup

      expect(() => vault.unlockPepper('anything')).toThrow('Cannot unlock pepper in state');
    });
  });

  // ==========================================================================
  // storePepperInVault()
  // ==========================================================================

  describe('storePepperInVault()', () => {
    it('should store existing env var pepper with passphrase', async () => {
      const pepper = 'a'.repeat(44);
      process.env.ENCRYPTION_MASTER_PEPPER = pepper;

      const vault = await importPepperVault();
      await vault.provisionPepper(); // needs-vault-storage

      vault.storePepperInVault('vault-passphrase');

      const stored = mockStore['pepper_vault'] as { has_passphrase: number } | undefined;
      expect(stored?.has_passphrase).toBe(1);
      expect(vault.getPepperState()).toBe('resolved');
    });

    it('should store existing env var pepper without passphrase', async () => {
      const pepper = 'b'.repeat(44);
      process.env.ENCRYPTION_MASTER_PEPPER = pepper;

      const vault = await importPepperVault();
      await vault.provisionPepper(); // needs-vault-storage

      vault.storePepperInVault('');

      const stored = mockStore['pepper_vault'] as { has_passphrase: number } | undefined;
      expect(stored?.has_passphrase).toBe(0);
      expect(vault.getPepperState()).toBe('resolved');
    });

    it('should throw if not in needs-vault-storage state', async () => {
      const vault = await importPepperVault();
      await vault.provisionPepper(); // needs-setup

      expect(() => vault.storePepperInVault('')).toThrow('Cannot store pepper in vault in state');
    });
  });

  // ==========================================================================
  // getPepperState()
  // ==========================================================================

  describe('getPepperState()', () => {
    it('should reflect state changes through lifecycle', async () => {
      const vault = await importPepperVault();

      // Initial state before provisioning
      // Note: module initializes to 'needs-setup'
      expect(vault.getPepperState()).toBe('needs-setup');

      // After provisioning with no config
      await vault.provisionPepper();
      expect(vault.getPepperState()).toBe('needs-setup');

      // After setup
      vault.setupPepper('');
      expect(vault.getPepperState()).toBe('resolved');
    });
  });

  // ==========================================================================
  // Table creation idempotency
  // ==========================================================================

  describe('Table creation', () => {
    it('should handle multiple provisionPepper calls safely', async () => {
      const vault = await importPepperVault();

      const state1 = await vault.provisionPepper();
      expect(state1).toBe('needs-setup');

      // Calling again should not error
      const state2 = await vault.provisionPepper();
      expect(state2).toBe('needs-setup');
    });
  });
});
