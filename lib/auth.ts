/**
 * NextAuth Configuration
 *
 * Uses lazy initialization pattern to ensure plugins are loaded before
 * auth providers are configured. This allows auth provider plugins to
 * register themselves during startup.
 */

import { NextAuthOptions } from "next-auth";
import { Adapter } from "next-auth/adapters";
import CredentialsProvider from "next-auth/providers/credentials";
import { verifyPassword } from "@/lib/auth/password";
import { isAuthDisabled } from "@/lib/auth/config";
import { runPostLoginMigrations } from "@/lib/auth/post-login-migrations";
import { logger } from "@/lib/logger";
import { buildNextAuthProviders, getConfiguredAuthProviders } from "@/lib/plugins/auth-provider-registry";
import { initializePlugins, isPluginSystemInitialized } from "@/lib/startup/plugin-initialization";
import { getMongoDBAuthAdapter } from "@/lib/mongodb/auth-adapter";
import { getRepositories } from "@/lib/repositories/factory";

// ============================================================================
// LAZY-LOADED SINGLETONS
// ============================================================================

let adapter: Adapter | null = null;

function getAdapter(): Adapter {
  if (adapter) return adapter;

  logger.debug('Selecting auth adapter', { context: 'getAdapter', backend: 'mongodb' });
  adapter = getMongoDBAuthAdapter();
  logger.info('Using MongoDB auth adapter', { context: 'getAdapter' });

  return adapter;
}

/**
 * Build credentials provider for username/password login
 */
function buildCredentialsProvider() {
  return CredentialsProvider({
    id: 'credentials',
    name: 'Username and Password',
    credentials: {
      username: { label: 'Username', type: 'text' },
      password: { label: 'Password', type: 'password' },
      totpCode: { label: '2FA Code (if enabled)', type: 'text' },
      trustedDeviceToken: { label: 'Trusted Device Token', type: 'text' },
      rememberDevice: { label: 'Remember Device', type: 'text' },
    },
    async authorize(credentials, req) {
      if (!credentials?.username || !credentials?.password) {
        logger.debug('Missing credentials', { context: 'authorize', hasUsername: !!credentials?.username });
        throw new Error('Username and password required')
      }

      // Find user from MongoDB
      const user = await getRepositories().users.findByUsername(credentials.username)

      if (!user?.passwordHash) {
        logger.debug('User not found or no password hash', { context: 'authorize', username: credentials.username });
        throw new Error('Invalid username or password')
      }

      // Verify password
      const valid = await verifyPassword(
        credentials.password,
        user.passwordHash
      )

      if (!valid) {
        logger.debug('Invalid password', { context: 'authorize', username: credentials.username });
        throw new Error('Invalid username or password')
      }

      // Check if 2FA is enabled
      if (user.totp?.enabled) {
        const { verifyTOTP, checkTOTPLockout, verifyTrustedDevice } = await import('@/lib/auth/totp')

        // Check for lockout first
        const lockoutStatus = await checkTOTPLockout(user.id)
        if (lockoutStatus.locked) {
          logger.debug('Account locked due to too many 2FA attempts', {
            context: 'authorize',
            username: credentials.username,
            secondsRemaining: lockoutStatus.secondsRemaining,
          });
          throw new Error(`Account temporarily locked. Try again in ${lockoutStatus.secondsRemaining} seconds.`)
        }

        // Check for trusted device first (bypass TOTP if valid)
        if (credentials.trustedDeviceToken) {
          const deviceValid = await verifyTrustedDevice(user.id, credentials.trustedDeviceToken)
          if (deviceValid) {
            logger.debug('TOTP bypassed via trusted device', {
              context: 'authorize',
              username: credentials.username,
            });
            // Skip TOTP verification
          } else {
            // Trusted device invalid/expired, fall through to TOTP check
            if (!credentials.totpCode) {
              logger.debug('2FA required - trusted device invalid', { context: 'authorize', username: credentials.username });
              throw new Error('2FA code required')
            }
          }
        } else if (!credentials.totpCode) {
          logger.debug('2FA required but not provided', { context: 'authorize', username: credentials.username });
          throw new Error('2FA code required')
        }

        // Verify TOTP if code was provided and device wasn't trusted
        if (credentials.totpCode && !credentials.trustedDeviceToken) {
          const totpValid = await verifyTOTP(user.id, credentials.totpCode)

          if (!totpValid) {
            // Check if now locked after this attempt
            const newLockoutStatus = await checkTOTPLockout(user.id)
            if (newLockoutStatus.locked) {
              logger.debug('Account now locked after failed 2FA attempt', {
                context: 'authorize',
                username: credentials.username,
              });
              throw new Error(`Invalid 2FA code. Account locked for ${newLockoutStatus.secondsRemaining} seconds.`)
            }
            logger.debug('Invalid 2FA code', { context: 'authorize', username: credentials.username });
            throw new Error('Invalid 2FA code')
          }
        }
      }

      logger.info('User authenticated successfully', { context: 'authorize', userId: user.id, username: user.username });

      return {
        id: user.id,
        email: user.email || user.username, // NextAuth expects email, use username as fallback
        name: user.name,
        image: user.image,
      }
    },
  });
}

// ============================================================================
// PROVIDER BUILDING
// ============================================================================

// Cache built providers after plugins are initialized
let cachedProviders: NextAuthOptions['providers'] | null = null;
// Track if we've logged the auth disabled message
let authDisabledLogged = false;
// Track if we've logged the no auth plugins warning
let noAuthPluginsWarningLogged = false;

/**
 * Build the list of authentication providers based on configuration
 * When auth is disabled, no providers are configured
 * OAuth providers are loaded from plugins via the auth provider registry
 */
function buildProviders(): NextAuthOptions['providers'] {
  // Check if auth is disabled
  if (isAuthDisabled()) {
    if (!authDisabledLogged) {
      logger.info('Authentication is disabled - no providers configured', {
        context: 'buildProviders',
      });
      authDisabledLogged = true;
    }
    return [];
  }

  const pluginsInitialized = isPluginSystemInitialized();

  // Return cached providers if available and plugins are initialized
  if (cachedProviders !== null && pluginsInitialized) {
    return cachedProviders;
  }

  const providers: NextAuthOptions['providers'] = [];

  // Load OAuth providers from plugin registry (plugins must be initialized)
  if (pluginsInitialized) {
    const oauthProviders = buildNextAuthProviders();

    // Filter out any null providers and add valid ones
    for (const provider of oauthProviders) {
      if (provider) {
        providers.push(provider);
      }
    }

    const configuredCount = getConfiguredAuthProviders().length;

    if (configuredCount === 0 && !noAuthPluginsWarningLogged) {
      logger.warn('No authentication plugins are configured. Users will only be able to use credentials-based login.', {
        context: 'buildProviders',
        hint: 'Enable an auth plugin (e.g., qtap-plugin-auth-google) and configure its environment variables.',
      });
      noAuthPluginsWarningLogged = true;
    }
  }

  // Always add credentials provider for email/password login
  providers.push(buildCredentialsProvider());

  // Cache providers if plugins are initialized
  if (pluginsInitialized) {
    cachedProviders = providers;
  }

  return providers;
}

// ============================================================================
// AUTH OPTIONS - LAZY INITIALIZATION
// ============================================================================

// Cache the complete auth options after first successful build
let cachedAuthOptions: NextAuthOptions | null = null;

/**
 * Build NextAuth options asynchronously
 * Ensures plugins are initialized before building providers
 *
 * This is the core function for lazy initialization - it waits for
 * the plugin system to be ready before building auth configuration.
 */
export async function buildAuthOptionsAsync(): Promise<NextAuthOptions> {
  // Fast path: return cached options if available
  if (cachedAuthOptions !== null && isPluginSystemInitialized()) {
    return cachedAuthOptions;
  }

  // Ensure plugins are initialized before building providers
  if (!isPluginSystemInitialized()) {
    logger.info('Waiting for plugin system initialization before building auth options', {
      context: 'buildAuthOptionsAsync',
    });
    await initializePlugins();
  }

  const options: NextAuthOptions = {
    adapter: getAdapter(),
    providers: buildProviders(),
    callbacks: {
      async signIn({ user }) {
        // Run post-login migrations for this user
        // This handles per-user data migrations that may have been missed at startup
        if (user?.id) {
          try {
            await runPostLoginMigrations(user.id);
          } catch (error) {
            // Log but don't block sign in if migrations fail
            logger.error('Post-login migrations failed', {
              context: 'signIn',
              userId: user.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return true;
      },
      async jwt({ token, user }) {
        // On initial sign in, add user data to token
        if (user) {
          token.id = user.id;
          token.email = user.email;
          token.name = user.name;
          token.image = user.image;
        }
        return token;
      },
      async session({ session, token, user }) {
        // For JWT sessions (credentials), use token data
        if (token && session.user) {
          session.user.id = token.id as string;
        }
        // For database sessions (OAuth), use user data
        if (user && session.user) {
          session.user.id = user.id;
        }
        return session;
      },
    },
    pages: {
      signIn: '/auth/signin',
      error: '/auth/error',
    },
    session: {
      // Use JWT for credentials provider compatibility
      // The adapter is still used for OAuth providers
      strategy: "jwt",
    },
    debug: process.env.NODE_ENV === "development",
  };

  // Cache the options
  cachedAuthOptions = options;
  logger.info('Auth options built and cached', {
    context: 'buildAuthOptionsAsync',
    providerCount: options.providers.length,
  });

  return options;
}

/**
 * Get auth options synchronously (for backward compatibility)
 * Uses cached options if available, otherwise builds synchronously
 *
 * @deprecated Prefer buildAuthOptionsAsync() for new code
 */
export function getAuthOptions(): NextAuthOptions {
  // Return cached if available
  if (cachedAuthOptions !== null) {
    return cachedAuthOptions;
  }

  // Build synchronously (may not have all plugin providers if plugins aren't ready)
  const options: NextAuthOptions = {
    adapter: getAdapter(),
    providers: buildProviders(),
    callbacks: {
      async signIn({ user }) {
        // Run post-login migrations for this user
        // This handles per-user data migrations that may have been missed at startup
        if (user?.id) {
          try {
            await runPostLoginMigrations(user.id);
          } catch (error) {
            // Log but don't block sign in if migrations fail
            logger.error('Post-login migrations failed', {
              context: 'signIn',
              userId: user.id,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
        return true;
      },
      async jwt({ token, user }) {
        // On initial sign in, add user data to token
        if (user) {
          token.id = user.id;
          token.email = user.email;
          token.name = user.name;
          token.image = user.image;
        }
        return token;
      },
      async session({ session, token, user }) {
        // For JWT sessions (credentials), use token data
        if (token && session.user) {
          session.user.id = token.id as string;
        }
        // For database sessions (OAuth), use user data
        if (user && session.user) {
          session.user.id = user.id;
        }
        return session;
      },
    },
    pages: {
      signIn: '/auth/signin',
      error: '/auth/error',
    },
    session: {
      // Use JWT for credentials provider compatibility
      strategy: "jwt",
    },
    debug: process.env.NODE_ENV === "development",
  };

  // Cache if plugins are ready
  if (isPluginSystemInitialized()) {
    cachedAuthOptions = options;
  }

  return options;
}

/**
 * Legacy authOptions export for backward compatibility
 * New code should use buildAuthOptionsAsync() or the lazy NextAuth handler
 *
 * @deprecated Use buildAuthOptionsAsync() instead
 */
export const authOptions: NextAuthOptions = new Proxy({} as NextAuthOptions, {
  get(_target, prop) {
    return getAuthOptions()[prop as keyof NextAuthOptions];
  },
});

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Clear cached auth options (useful for testing or hot-reload)
 */
export function clearAuthOptionsCache(): void {
  cachedAuthOptions = null;
  cachedProviders = null;
  adapter = null;
  // Reset logging flags so messages can appear again after refresh
  authDisabledLogged = false;
  noAuthPluginsWarningLogged = false;
}

/**
 * Refresh auth providers from plugins
 * Call this after plugins are hot-reloaded
 */
export async function refreshAuthProviders(): Promise<void> {
  clearAuthOptionsCache();
  await buildAuthOptionsAsync();
  logger.info('Auth providers refreshed', { context: 'refreshAuthProviders' });
}
