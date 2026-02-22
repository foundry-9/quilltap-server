/**
 * Environment variable validation using Zod
 * Ensures all required environment variables are present and valid
 */

import { z } from 'zod';

const envSchema = z
  .object({
    // Node environment
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

    // Base URL for the application (used for OAuth callbacks, etc.)
    BASE_URL: z.string().url().optional().default('http://localhost:3000'),

    // OAuth Providers (all optional - configured via auth plugins)
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    APPLE_ID: z.string().optional(),
    APPLE_SECRET: z.string().optional(),
    GITHUB_ID: z.string().optional(),
    GITHUB_SECRET: z.string().optional(),

    // NOTE: ENCRYPTION_MASTER_PEPPER is NOT in the schema.
    // It is managed by the pepper vault (lib/startup/pepper-vault.ts) and
    // read directly from process.env at runtime by lib/encryption.ts.
    // See app/setup/page.tsx for the setup wizard.

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

    // Timezone Configuration
    // IANA timezone name from the host OS (e.g., "America/New_York")
    // Detected automatically by Electron and passed to Lima/WSL2/Docker
    // Docker users can set this manually: -e QUILLTAP_TIMEZONE=America/New_York
    QUILLTAP_TIMEZONE: z.string().optional(),

    // File Storage Configuration
    // Base directory for all Quilltap data (database, files, logs)
    // Platform defaults: Linux: ~/.quilltap, macOS: ~/Library/Application Support/Quilltap, Windows: %APPDATA%\Quilltap
    QUILLTAP_DATA_DIR: z.string().optional(),
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
      path: ['S3_MODE'],
        error: 'S3_ACCESS_KEY and S3_SECRET_KEY must both be provided, or both omitted (for IAM role auth)'
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
      const missingVars = error.issues.map((err) => {
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
    return null;
  }
}

/**
 * Check if the deployment is user-managed (locally hosted)
 *
 * A deployment is considered "user-managed" if:
 * - The S3 endpoint points to localhost/127.0.0.1 or is in embedded mode
 *
 * This is useful for determining whether to show development/admin features,
 * enable certain debugging capabilities, or adjust behavior for self-hosted deployments.
 *
 * @returns true if the deployment appears to be locally/self-managed
 */
export function checkIsUserManaged(): boolean {
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
 * True if file storage is running locally
 */
export const isUserManaged = checkIsUserManaged();
