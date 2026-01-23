/**
 * Environment variable validation using Zod
 * Ensures all required environment variables are present and valid
 */

import { z } from 'zod';

const envSchema = z
  .object({
    // Node environment
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // Database (legacy - no longer used, MongoDB is required)
    DATABASE_URL: z.string().url().optional(),

    // Base URL for the application (used for OAuth callbacks, etc.)
    BASE_URL: z.string().url().optional().default('http://localhost:3000'),

    // OAuth Providers (all optional - configured via auth plugins)
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    APPLE_ID: z.string().optional(),
    APPLE_SECRET: z.string().optional(),
    GITHUB_ID: z.string().optional(),
    GITHUB_SECRET: z.string().optional(),

    // Encryption
    ENCRYPTION_MASTER_PEPPER: z
      .string()
      .min(32, 'ENCRYPTION_MASTER_PEPPER must be at least 32 characters'),

    // Rate Limiting (optional)
    RATE_LIMIT_API_MAX: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_API_WINDOW: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_AUTH_MAX: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_AUTH_WINDOW: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_CHAT_MAX: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_CHAT_WINDOW: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_GENERAL_MAX: z.string().regex(/^\d+$/).optional(),
    RATE_LIMIT_GENERAL_WINDOW: z.string().regex(/^\d+$/).optional(),

    // Logging (optional)
    LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).optional().default('info'),
    LOG_OUTPUT: z.enum(['console', 'file', 'both']).optional().default('console'),
    LOG_FILE_PATH: z.string().optional().default('./logs'),
    LOG_FILE_MAX_SIZE: z.string().regex(/^\d+$/).optional(),
    LOG_FILE_MAX_FILES: z.string().regex(/^\d+$/).optional(),

    // Production SSL (optional)
    DOMAIN: z.string().optional(),
    SSL_EMAIL: z.string().email().optional(),

    // Data Backend Configuration
    // NOTE: 'json' option is deprecated and will be removed in a future version.
    // Use the migration plugin (qtap-plugin-upgrade) to migrate JSON data to MongoDB.
    DATA_BACKEND: z.enum(['json', 'mongodb']).optional().default('mongodb'),

    // MongoDB Configuration (required - MongoDB is the default data backend)
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required for MongoDB backend'),
    MONGODB_DATABASE: z.string().optional().default('quilltap'),
    MONGODB_MODE: z.enum(['external', 'embedded']).optional().default('external'),
    MONGODB_DATA_DIR: z.string().optional().default('/data/mongodb'),
    MONGODB_CONNECTION_TIMEOUT_MS: z.string().regex(/^\d+$/).optional(),
    MONGODB_MAX_POOL_SIZE: z.string().regex(/^\d+$/).optional(),

    // File Storage Configuration
    // Path for local filesystem storage (built-in backend)
    QUILLTAP_FILE_STORAGE_PATH: z.string().optional().default('./data/files'),
    // Encryption key for mount point secrets (auto-generated if not set, falls back to ENCRYPTION_MASTER_PEPPER)
    QUILLTAP_ENCRYPTION_KEY: z.string().min(32).optional(),

    // S3 Configuration (optional - S3 is now a plugin, local filesystem is the default)
    // These env vars are used to auto-create an S3 mount point during migration
    S3_MODE: z.enum(['embedded', 'external', 'disabled']).optional().default('disabled'),
    S3_ENDPOINT: z.string().url().optional(),
    S3_REGION: z.string().optional().default('us-east-1'),
    S3_ACCESS_KEY: z.string().optional(),
    S3_SECRET_KEY: z.string().optional(),
    S3_BUCKET: z.string().optional().default('quilltap-files'),
    S3_PATH_PREFIX: z.string().optional(),
    S3_PUBLIC_URL: z.string().url().optional(),
    S3_FORCE_PATH_STYLE: z.enum(['true', 'false']).optional(),
  })
  .refine(
    (data) => {
      // MongoDB URI is required when DATA_BACKEND is 'mongodb' (the default)
      if (data.DATA_BACKEND === 'mongodb' && !data.MONGODB_URI) {
        return false;
      }
      return true;
    },
    {
      message: 'MONGODB_URI is required when DATA_BACKEND is mongodb',
      path: ['MONGODB_URI'],
    }
  )
  .refine(
    (data) => {
      // S3 configuration validation for external mode
      if (data.S3_MODE === 'external') {
        // For AWS S3 (with or without endpoint), credentials are optional - IAM roles can provide them
        // Only require explicit credentials if one is provided but not the other
        if (
          (data.S3_ACCESS_KEY && !data.S3_SECRET_KEY) ||
          (!data.S3_ACCESS_KEY && data.S3_SECRET_KEY)
        ) {
          return false;
        }
      }
      return true;
    },
    {
      message:
        'S3_ACCESS_KEY and S3_SECRET_KEY must both be provided, or both omitted (for IAM role auth)',
      path: ['S3_MODE'],
    }
  );

export type Env = z.infer<typeof envSchema>;

/**
 * Check if we're in a build-only phase (no runtime needed)
 * During Next.js build, we skip env validation since runtime vars aren't available in CI
 */
const isBuildPhase =
  process.env.SKIP_ENV_VALIDATION === 'true' ||
  process.env.NEXT_PHASE === 'phase-production-build' ||
  (process.env.NEXT_RUNTIME === undefined && process.argv.some(arg => arg.includes('next') && process.argv.includes('build')));

/**
 * Validate and parse environment variables
 * Throws an error if validation fails
 * Skips validation during build phase for CI compatibility
 */
export function validateEnv(): Env {
  // Skip validation during build phase - env vars may not be available in CI
  if (isBuildPhase) {
    // Return minimal defaults for build-time type checking
    return {
      NODE_ENV: process.env.NODE_ENV || 'production',
      BASE_URL: process.env.BASE_URL || 'http://localhost:3000',
      ENCRYPTION_MASTER_PEPPER: process.env.ENCRYPTION_MASTER_PEPPER || 'build-time-placeholder-pepper-value',
      MONGODB_URI: process.env.MONGODB_URI || 'mongodb://localhost:27017',
      MONGODB_DATABASE: 'quilltap',
      MONGODB_MODE: 'external',
      MONGODB_DATA_DIR: '/data/mongodb',
      DATA_BACKEND: 'mongodb',
      QUILLTAP_FILE_STORAGE_PATH: './data/files',
      S3_MODE: 'disabled',
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'quilltap-files',
      LOG_LEVEL: 'info',
      LOG_OUTPUT: 'console',
      LOG_FILE_PATH: './logs',
    } as Env;
  }

  try {
    const env = envSchema.parse(process.env);
    return env;
  } catch (error) {
    if (error instanceof z.ZodError) {
      const missingVars = error.errors.map((err) => {
        return `  - ${err.path.join('.')}: ${err.message}`;
      });

      console.error('❌ Environment validation failed:');
      console.error(missingVars.join('\n'));
      console.error('\nPlease check your .env file and ensure all required variables are set.');
      console.error('See .env.example for reference.\n');

      // Don't exit in test environment
      if (process.env.NODE_ENV !== 'test') {
        process.exit(1);
      }
      throw error;
    }
    throw error;
  }
}

/**
 * Validated environment variables
 * Use this instead of process.env for type safety
 */
export const env = validateEnv();

/**
 * Check if we're in production
 */
export const isProduction = env.NODE_ENV === 'production';

/**
 * Check if we're in development
 */
export const isDevelopment = env.NODE_ENV === 'development';

/**
 * Check if we're in test mode
 */
export const isTest = env.NODE_ENV === 'test';

/**
 * Check if a hostname is considered "local"
 * @param hostname - The hostname to check
 * @returns true if the hostname is localhost or 127.0.0.1
 */
function isLocalHostname(hostname: string): boolean {
  const lowerHostname = hostname.toLowerCase();
  return lowerHostname === 'localhost' || lowerHostname === '127.0.0.1';
}

/**
 * Extract hostname from a URL string
 * @param urlString - The URL to parse
 * @returns The hostname or null if parsing fails
 */
function extractHostname(urlString: string | undefined): string | null {
  if (!urlString) return null;
  try {
    const url = new URL(urlString);
    return url.hostname;
  } catch {
    // For MongoDB URIs, try a simple extraction
    // mongodb://hostname:port or mongodb+srv://hostname
    const match = urlString.match(/mongodb(?:\+srv)?:\/\/(?:[^:@]+(?::[^@]+)?@)?([^:/?]+)/);
    return match ? match[1] : null;
  }
}

/**
 * Check if the deployment is user-managed (locally hosted)
 *
 * A deployment is considered "user-managed" if either:
 * - The MongoDB URI points to localhost/127.0.0.1 or is in embedded mode
 * - The S3 endpoint points to localhost/127.0.0.1 or is in embedded mode
 *
 * This is useful for determining whether to show development/admin features,
 * enable certain debugging capabilities, or adjust behavior for self-hosted deployments.
 *
 * @returns true if the deployment appears to be locally/self-managed
 */
export function checkIsUserManaged(): boolean {
  // Check MongoDB - embedded mode or localhost URI means user-managed
  const mongodbMode = env.MONGODB_MODE;
  if (mongodbMode === 'embedded') {
    return true;
  }

  const mongoHostname = extractHostname(env.MONGODB_URI);
  if (mongoHostname && isLocalHostname(mongoHostname)) {
    return true;
  }

  // Check S3 - embedded mode or localhost endpoint means user-managed
  const s3Mode = env.S3_MODE;
  if (s3Mode === 'embedded') {
    return true;
  }

  const s3Hostname = extractHostname(env.S3_ENDPOINT);
  if (s3Hostname && isLocalHostname(s3Hostname)) {
    return true;
  }

  return false;
}

/**
 * Whether the deployment is user-managed (locally hosted)
 * True if either database or file storage is running locally
 */
export const isUserManaged = checkIsUserManaged();
