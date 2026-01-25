/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output for Docker deployments
  output: 'standalone',

  // Dev indicator position (bottom-right instead of default bottom-left)
  devIndicators: {
    position: 'bottom-right',
  },

  // External packages that the main app needs at runtime
  // NOTE: LLM provider SDKs are now bundled INTO plugin output files, so they
  // don't need to be listed here. Only packages used directly by the main app
  // (not plugins) need to be in serverExternalPackages.
  serverExternalPackages: [
    '@openrouter/sdk',  // Used by lib/llm/pricing-fetcher.ts (dynamically imported, optional)
    'zod',              // Used throughout the app
    'better-sqlite3',   // Native module for SQLite database
  ],

  // Include dependencies in standalone output for Docker deployments
  // NOTE: Plugin SDK dependencies are now bundled into plugins, so we only need
  // to include packages that the main app uses directly.
  outputFileTracingIncludes: {
    '/*': [
      './node_modules/@openrouter/**/*',
      './node_modules/zod/**/*',
      './node_modules/next-auth/**/*',
      './node_modules/better-sqlite3/**/*',
    ],
  },

  // Experimental features
  experimental: {
    turbopackUseSystemTlsCerts: true,
    serverActions: {
      bodySizeLimit: '100mb',
    },
  },

  // Image optimization configuration
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'lh3.googleusercontent.com',
        port: '',
        pathname: '/**',
      },
    ],
    formats: ['image/avif', 'image/webp'],
    minimumCacheTTL: 60,
  },

  // Production optimizations
  compress: true,
  poweredByHeader: false,

  // Security headers
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'X-DNS-Prefetch-Control',
            value: 'on',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains',
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
        ],
      },
    ];
  },

  // Webpack optimizations
  webpack: (config, { isServer }) => {
    if (!isServer) {
      // Don't resolve 'fs' module on the client to prevent errors
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        'better-sqlite3': false,
      };
    } else {
      // Mark native modules as external on server to prevent bundling
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push(({ context, request }, callback) => {
          // Exclude any requests that point to the plugins/dist directory
          if (request && request.includes('plugins/dist/')) {
            return callback(null, `commonjs ${request}`);
          }
          // Exclude native modules from bundling
          if (request === 'better-sqlite3' || request === 'bcrypt') {
            return callback(null, `commonjs ${request}`);
          }
          callback();
        });
      }
    }

    // Suppress warnings about dynamic requires in plugin loading code
    // These are intentional - plugins are loaded at runtime using require()
    config.ignoreWarnings = config.ignoreWarnings || [];
    config.ignoreWarnings.push({
      module: /lib\/startup\/plugin-initialization\.ts/,
      message: /Can't resolve/,
    });
    config.ignoreWarnings.push({
      module: /lib\/themes\/theme-registry\.ts/,
      message: /Can't resolve/,
    });
    config.ignoreWarnings.push({
      module: /migrations\/lib\/mongodb-utils\.ts/,
      message: /Can't resolve/,
    });

    // Production optimizations
    if (process.env.NODE_ENV === 'production') {
      config.optimization = {
        ...config.optimization,
        moduleIds: 'deterministic',
        runtimeChunk: 'single',
        splitChunks: {
          chunks: 'all',
          cacheGroups: {
            default: false,
            vendors: false,
            // Vendor chunk
            vendor: {
              name: 'vendor',
              chunks: 'all',
              test: /node_modules/,
              priority: 20,
            },
            // Common chunk
            common: {
              name: 'common',
              minChunks: 2,
              chunks: 'all',
              priority: 10,
              reuseExistingChunk: true,
              enforce: true,
            },
          },
        },
      };
    }

    return config;
  },
}

module.exports = nextConfig
