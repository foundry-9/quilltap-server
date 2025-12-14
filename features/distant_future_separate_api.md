# Separate API Server Migration Plan

**Status:** Future / Not Started
**Target Architecture:** Fastify API + Static React SPA
**Deployment Target:** AWS (ECS/Fargate + S3/CloudFront)
**Created:** 2025-12-12

This document outlines a migration plan for splitting Quilltap from a Next.js monolith into a separate Fastify API server and static React frontend. This enables:

1. **Cost-efficient hosting**: Static frontend on S3+CloudFront, API in containers
2. **Mobile clients**: Native iOS/Android apps consuming the same API
3. **Independent scaling**: API and frontend scale separately
4. **Simpler deployments**: CDN for static assets, container orchestration for API

## Current Architecture

```
┌──────────────────────────────────────────────────┐
│              Next.js Monolith                    │
│  ┌────────────────┐  ┌────────────────────────┐  │
│  │  React Pages   │  │   API Routes (106)     │  │
│  │  (SSR + CSR)   │  │   /api/*               │  │
│  └────────────────┘  └────────────────────────┘  │
│  ┌────────────────┐  ┌────────────────────────┐  │
│  │  Plugin System │  │   NextAuth             │  │
│  │  (8 providers) │  │   (Session + OAuth)    │  │
│  └────────────────┘  └────────────────────────┘  │
└──────────────────────────────────────────────────┘
            │                      │
      ┌─────▼─────┐         ┌──────▼──────┐
      │  MongoDB  │         │  S3 Files   │
      └───────────┘         └─────────────┘
```

## Target Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      CloudFront                         │
│  ┌─────────────────┐         ┌─────────────────────┐   │
│  │ S3 (React SPA)  │         │ ALB → ECS (API)     │   │
│  │ Origin: /*      │         │ Origin: /api/*      │   │
│  └─────────────────┘         └─────────────────────┘   │
└─────────────────────────────────────────────────────────┘
         │                              │
         │                    ┌─────────┴─────────┐
         │                    │   Fastify API     │
         │                    │  ┌─────────────┐  │
         │                    │  │ Plugins     │  │
         │                    │  │ Auth        │  │
         │                    │  │ Streaming   │  │
         │                    │  └─────────────┘  │
         │                    └─────────┬─────────┘
         │                              │
         │              ┌───────────────┼───────────────┐
         │              │               │               │
         │        ┌─────▼─────┐  ┌──────▼──────┐ ┌──────▼──────┐
         │        │  MongoDB  │  │  S3 Files   │ │   Mobile    │
         │        │  Atlas    │  │  (uploads)  │ │   Clients   │
         │        └───────────┘  └─────────────┘ └─────────────┘
         │
    ┌────▼────┐
    │   Web   │
    │ Browser │
    └─────────┘
```

## Why Fastify Over Express

| Aspect | Express | Fastify |
|--------|---------|---------|
| Performance | ~15k req/s | ~75k req/s |
| TypeScript | Bolted on | First-class support |
| Validation | Middleware (Zod/Joi) | Built-in JSON Schema |
| Async errors | Manual try/catch | Native async support |
| Streaming | Works | Better stream primitives |
| Plugin system | Middleware chain | True encapsulated plugins |
| AWS Lambda | Needs serverless-http | @fastify/aws-lambda native |
| Schema-based | No | Yes (auto-generates OpenAPI) |

Fastify's plugin architecture maps well to Quilltap's existing plugin system.

## Migration Phases

### Phase 0: Preparation (Before Starting)

**Prerequisites:**
- [ ] All current features stable and tested
- [ ] Comprehensive integration test suite for all 106 API routes
- [ ] API documentation (can be generated from implementation)
- [ ] Decision on monorepo tooling (Turborepo, Nx, or npm workspaces)

**Monorepo Structure:**
```
quilltap/
├── packages/
│   ├── api/                 # Fastify API server
│   │   ├── src/
│   │   │   ├── routes/      # API route handlers
│   │   │   ├── plugins/     # Fastify plugins (auth, etc.)
│   │   │   ├── services/    # Business logic
│   │   │   └── index.ts     # Server entry
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── web/                 # React SPA (Vite)
│   │   ├── src/
│   │   │   ├── components/  # React components
│   │   │   ├── pages/       # Route pages
│   │   │   ├── hooks/       # Custom hooks
│   │   │   └── main.tsx     # Entry point
│   │   ├── package.json
│   │   └── vite.config.ts
│   ├── shared/              # Shared types and utilities
│   │   ├── src/
│   │   │   ├── types/       # Shared TypeScript types
│   │   │   ├── schemas/     # Zod schemas (validation)
│   │   │   └── constants/   # Shared constants
│   │   └── package.json
│   └── plugins/             # LLM/Auth plugins (moved)
│       └── dist/            # Built plugins
├── docker/                  # Docker configs
├── package.json             # Root workspace config
└── turbo.json               # Turborepo config (if using)
```

---

### Phase 1: Fastify API Foundation

**Goal:** Create working Fastify server with core infrastructure.

#### 1.1 Project Setup
- [ ] Initialize `packages/api` with TypeScript
- [ ] Configure Fastify with:
  - `@fastify/cors` - CORS handling
  - `@fastify/helmet` - Security headers
  - `@fastify/rate-limit` - Rate limiting (replaces proxy.ts)
  - `@fastify/cookie` - Cookie parsing
  - `@fastify/multipart` - File uploads
  - `@fastify/swagger` - OpenAPI generation
- [ ] Set up environment config loading (dotenv or similar)
- [ ] Create health check endpoint

#### 1.2 Database Layer Migration
- [ ] Move `lib/mongodb/` to `packages/api/src/db/`
- [ ] Move `lib/repositories/` to `packages/api/src/repositories/`
- [ ] Create Fastify plugin for MongoDB connection pooling
- [ ] Test all repository operations

#### 1.3 Authentication System

**Challenge:** NextAuth is designed for Next.js. Options:

**Option A: NextAuth Standalone (Recommended)**
NextAuth v5 (Auth.js) supports standalone mode:
```typescript
import { Auth } from "@auth/core"
import { FastifyPluginAsync } from "fastify"

const authPlugin: FastifyPluginAsync = async (fastify) => {
  fastify.all('/api/auth/*', async (request, reply) => {
    const response = await Auth(request.raw, authConfig)
    // Convert response to Fastify reply
  })
}
```

**Option B: Custom JWT + Session**
For mobile support, implement:
- Session-based auth for web (existing behavior)
- JWT tokens for mobile clients
- Shared user validation logic

**Tasks:**
- [ ] Evaluate Auth.js standalone vs custom implementation
- [ ] Port auth provider plugin interface
- [ ] Implement session middleware for Fastify
- [ ] Add JWT token endpoint for mobile clients
- [ ] Port 2FA/TOTP logic
- [ ] Test Google OAuth flow

#### 1.4 Rate Limiting Migration

Current `proxy.ts` rate limits:
```typescript
// Port these to @fastify/rate-limit
'/api/*'              → 100 req/min per IP
'/api/auth/*'         → 10 req/min (brute force protection)
'/api/chats/*/messages' → 30 req/min (streaming)
```

- [ ] Configure rate limit plugin with route-specific limits
- [ ] Add rate limit headers to responses
- [ ] Test rate limiting behavior

---

### Phase 2: Plugin System Migration

**Goal:** Port the LLM provider plugin system to Fastify.

#### 2.1 Plugin Architecture

Current plugin loading:
1. Scan `plugins/dist/` for manifest.json files
2. Dynamic import plugin modules
3. Register with provider registry
4. Plugin routes registered with dispatcher

**Fastify Plugin Approach:**
```typescript
// packages/api/src/plugins/llm-providers.ts
import { FastifyPluginAsync } from 'fastify'
import { scanPluginDirectory, loadPluginManifest } from './loader'

const llmProvidersPlugin: FastifyPluginAsync = async (fastify) => {
  const manifests = await scanPluginDirectory('plugins/dist')

  for (const manifest of manifests) {
    if (manifest.capabilities.includes('LLM_PROVIDER')) {
      const plugin = await import(manifest.entryPoint)
      fastify.decorate(`provider:${manifest.providerConfig.type}`, plugin)
    }
  }
}
```

**Tasks:**
- [ ] Create Fastify plugin for plugin loading
- [ ] Port `lib/plugins/registry.ts`
- [ ] Port `lib/plugins/provider-registry.ts`
- [ ] Port `lib/plugins/auth-provider-registry.ts`
- [ ] Update plugin manifests if needed (should be minimal)
- [ ] Test all 8 LLM providers load correctly

#### 2.2 Plugin Route Dispatcher

Current: `app/api/plugin-routes/[...path]/route.ts`

Fastify equivalent:
```typescript
fastify.all('/api/plugin-routes/*', async (request, reply) => {
  const path = request.params['*']
  const handler = pluginRouteRegistry.match(path, request.method)
  if (!handler) return reply.code(404).send({ error: 'Not found' })
  return handler(request, reply)
})
```

- [ ] Create plugin route registry
- [ ] Implement wildcard route dispatcher
- [ ] Test plugin-defined routes

---

### Phase 3: API Route Migration

**Goal:** Port all 106 API routes to Fastify handlers.

#### Route Categories and Priority

**Priority 1: Core Chat (Critical Path)**
- [ ] `POST /api/chats` - Create chat
- [ ] `GET /api/chats` - List chats
- [ ] `GET /api/chats/:id` - Get chat
- [ ] `DELETE /api/chats/:id` - Delete chat
- [ ] `POST /api/chats/:id/messages` - **STREAMING** - Send message
- [ ] `GET /api/chats/:id/messages` - Get messages
- [ ] `PUT /api/messages/:id` - Edit message
- [ ] `DELETE /api/messages/:id` - Delete message
- [ ] `POST /api/messages/:id/swipe` - Regenerate

**Priority 2: Authentication**
- [ ] `GET/POST /api/auth/*` - NextAuth handlers
- [ ] `POST /api/auth/signup` - Registration
- [ ] `POST /api/auth/change-password` - Password change
- [ ] `GET/POST /api/auth/2fa/*` - 2FA endpoints (6 routes)

**Priority 3: Characters & Personas**
- [ ] `GET/POST /api/characters` - List/create
- [ ] `GET/PUT/DELETE /api/characters/:id` - CRUD
- [ ] `POST /api/characters/import` - Import
- [ ] `GET /api/characters/:id/export` - Export
- [ ] `GET/PUT /api/characters/:id/memories` - Memories
- [ ] `GET/PUT /api/characters/:id/descriptions` - Descriptions
- [ ] Similar for personas (8 routes)

**Priority 4: Profiles & Configuration**
- [ ] `/api/profiles/*` - Connection profiles (5 routes)
- [ ] `/api/embedding-profiles/*` - Embedding profiles (4 routes)
- [ ] `/api/image-profiles/*` - Image profiles (4 routes)
- [ ] `/api/keys/*` - API keys (5 routes)
- [ ] `/api/providers` - Provider list

**Priority 5: Files & Images**
- [ ] `/api/files/*` - File management (4 routes)
- [ ] `/api/images/*` - Image gallery (5 routes)
- [ ] `/api/images/generate` - Image generation

**Priority 6: Tools & Admin**
- [ ] `/api/tools/backup/*` - Backup/restore (5 routes)
- [ ] `/api/tools/capabilities-report/*` - Diagnostics
- [ ] `/api/tools/delete-data` - Data purge

**Priority 7: Miscellaneous**
- [ ] `/api/search` - Global search
- [ ] `/api/tags/*` - Tag management
- [ ] `/api/themes/*` - Theme assets
- [ ] `/api/logs` - Log queries
- [ ] `/api/health` - Health check
- [ ] `/api/plugins` - Plugin management

#### Streaming Implementation

**Critical:** The chat message endpoint streams LLM responses.

Current Next.js implementation:
```typescript
// Returns ReadableStream with JSON chunks
return new Response(stream, {
  headers: { 'Content-Type': 'text/event-stream' }
})
```

Fastify equivalent:
```typescript
fastify.post('/api/chats/:id/messages', async (request, reply) => {
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  })

  const llmStream = await provider.streamChat(messages)

  for await (const chunk of llmStream) {
    reply.raw.write(`data: ${JSON.stringify(chunk)}\n\n`)
  }

  reply.raw.end()
})
```

- [ ] Implement streaming response helper
- [ ] Test with all LLM providers
- [ ] Verify chunk format matches current implementation
- [ ] Test client-side streaming parser compatibility

---

### Phase 4: React SPA Extraction

**Goal:** Convert frontend to static Vite + React SPA.

#### 4.1 Vite Setup
- [ ] Initialize `packages/web` with Vite + React + TypeScript
- [ ] Configure path aliases to match Next.js (`@/`)
- [ ] Set up Tailwind CSS 4 (matching current config)
- [ ] Copy `globals.css` and theme system

#### 4.2 Routing Migration

Current Next.js App Router → React Router:

| Next.js | React Router |
|---------|--------------|
| `app/(authenticated)/chats/[id]/page.tsx` | `<Route path="/chats/:id" element={<ChatPage />} />` |
| `app/(authenticated)/layout.tsx` | `<AuthenticatedLayout>` wrapper component |
| `useParams()` from next/navigation | `useParams()` from react-router-dom |
| `useRouter()` | `useNavigate()` |
| `redirect()` | `<Navigate to="..." />` |

- [ ] Install react-router-dom v6
- [ ] Create route configuration
- [ ] Port layout components
- [ ] Update navigation hooks throughout

#### 4.3 Component Migration

Most components should work with minimal changes:

- [ ] Copy `components/` directory
- [ ] Update Next.js-specific imports:
  - `next/image` → standard `<img>` (already using in many places)
  - `next/link` → react-router `<Link>`
  - `next/navigation` → react-router hooks
- [ ] Update `fetch()` calls to use API base URL from env
- [ ] Port session provider to use API-based auth

#### 4.4 Authentication in SPA

```typescript
// packages/web/src/providers/AuthProvider.tsx
const AuthProvider: React.FC = ({ children }) => {
  const [session, setSession] = useState<Session | null>(null)

  useEffect(() => {
    // Fetch session from API
    fetch(`${API_URL}/api/auth/session`, { credentials: 'include' })
      .then(res => res.json())
      .then(setSession)
  }, [])

  return (
    <AuthContext.Provider value={{ session }}>
      {children}
    </AuthContext.Provider>
  )
}
```

- [ ] Create auth context and provider
- [ ] Implement login/logout flows via API
- [ ] Handle session refresh
- [ ] Protected route wrapper component

#### 4.5 Environment Configuration

```typescript
// packages/web/src/config.ts
export const config = {
  apiUrl: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  // Other config...
}
```

- [ ] Create environment variable schema
- [ ] Update all API calls to use config
- [ ] Document required env vars

---

### Phase 5: Theme Plugin Migration

**Goal:** Ensure theme plugins work with static SPA.

Current theme loading:
1. Plugin provides CSS and font files
2. Next.js serves from `/api/themes/[name]/[file]`
3. ThemeProvider injects CSS dynamically

SPA approach:
1. Build step extracts theme assets to `packages/web/public/themes/`
2. Or: API serves theme assets (keeps current pattern)

- [ ] Decide on theme asset serving strategy
- [ ] Update ThemeProvider for SPA context
- [ ] Test theme switching
- [ ] Verify font loading

---

### Phase 6: Mobile API Considerations

**Goal:** Prepare API for mobile client consumption.

#### 6.1 Authentication for Mobile

Mobile clients can't use HTTP-only cookies effectively. Add:

```typescript
// POST /api/auth/token
// Returns JWT for mobile clients
{
  "access_token": "eyJ...",
  "refresh_token": "...",
  "expires_in": 3600
}
```

- [ ] Implement JWT token endpoint
- [ ] Add refresh token flow
- [ ] Bearer token validation middleware
- [ ] Document mobile auth flow

#### 6.2 API Versioning

```typescript
// Future-proof the API
fastify.register(v1Routes, { prefix: '/api/v1' })

// Legacy compatibility
fastify.register(v1Routes, { prefix: '/api' })
```

- [ ] Add version prefix support
- [ ] Document versioning strategy

#### 6.3 OpenAPI Documentation

Fastify can auto-generate OpenAPI specs:

```typescript
await fastify.register(fastifySwagger, {
  openapi: {
    info: { title: 'Quilltap API', version: '1.0.0' }
  }
})
```

- [ ] Add OpenAPI schema to all routes
- [ ] Generate API documentation
- [ ] Publish documentation for mobile developers

---

### Phase 7: AWS Deployment

**Goal:** Deploy to target AWS architecture.

#### 7.1 Infrastructure (Terraform/CDK)

```hcl
# High-level resources needed:
- CloudFront distribution
- S3 bucket (frontend)
- Application Load Balancer
- ECS Cluster + Service + Task Definition
- ECR Repository (API container)
- VPC, Subnets, Security Groups
- Route53 DNS records
- ACM certificates
```

- [ ] Create infrastructure as code
- [ ] Set up CI/CD pipeline for deployments
- [ ] Configure CloudFront behaviors:
  - `/api/*` → ALB origin
  - `/*` → S3 origin

#### 7.2 Container Configuration

```dockerfile
# packages/api/Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY dist ./dist
COPY plugins ./plugins
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

- [ ] Create optimized Dockerfile
- [ ] Configure ECS task definition
- [ ] Set up auto-scaling policies
- [ ] Configure health checks

#### 7.3 Frontend Deployment

```yaml
# GitHub Actions for frontend
- npm run build
- aws s3 sync dist/ s3://quilltap-frontend/
- aws cloudfront create-invalidation --distribution-id XXX
```

- [ ] S3 bucket with static website hosting
- [ ] CloudFront distribution with S3 origin
- [ ] CI/CD for frontend deployments
- [ ] Cache invalidation on deploy

---

## Risk Areas and Mitigations

### 1. Streaming Chat Responses
**Risk:** Different streaming behavior between Next.js and Fastify
**Mitigation:** Comprehensive integration tests, verify chunk format byte-for-byte

### 2. Plugin System Compatibility
**Risk:** Plugins assume Next.js runtime
**Mitigation:** Abstract runtime-specific code, test each plugin individually

### 3. Authentication Flow Changes
**Risk:** Session handling differences break login
**Mitigation:** Run both systems in parallel during transition, feature flag

### 4. Mobile Auth Complexity
**Risk:** Adding JWT creates two auth systems to maintain
**Mitigation:** Share validation logic, clear documentation

### 5. Theme Asset Loading
**Risk:** Theme plugins break in SPA context
**Mitigation:** Test early, have fallback to API-served assets

---

## Testing Strategy

### Unit Tests
- Port existing Jest tests to packages/api and packages/web
- Maintain >80% coverage on API routes

### Integration Tests
- Test each API route against Fastify implementation
- Verify response format matches Next.js exactly
- Streaming endpoint tests with mock LLM responses

### End-to-End Tests
- Playwright tests for web SPA
- Test critical paths: login → create character → chat → logout

### Parallel Running
During migration, run both systems:
- Next.js on port 3000
- Fastify on port 3001
- Compare responses programmatically

---

## Rollback Plan

If issues arise post-migration:

1. **DNS Rollback:** Point CloudFront back to Next.js container
2. **Code Rollback:** Next.js monolith remains in repo, can redeploy
3. **Data:** No data migration needed, same MongoDB/S3

Keep Next.js deployment working for at least 1 month post-migration.

---

## Success Criteria

Migration is complete when:

- [ ] All 106 API routes respond identically to Next.js version
- [ ] Streaming chat works with all 8 LLM providers
- [ ] Authentication (session + 2FA) works correctly
- [ ] Plugin system loads all providers
- [ ] Theme switching works in SPA
- [ ] Mobile client can authenticate and chat
- [ ] Deployed to AWS (ECS + S3/CloudFront)
- [ ] Cost is lower than equivalent Next.js container deployment
- [ ] Performance meets or exceeds current system

---

## Estimated Effort

| Phase | Effort | Dependencies |
|-------|--------|--------------|
| Phase 0: Preparation | 1 week | None |
| Phase 1: Fastify Foundation | 2-3 weeks | Phase 0 |
| Phase 2: Plugin System | 2 weeks | Phase 1 |
| Phase 3: Route Migration | 3-4 weeks | Phase 1, 2 |
| Phase 4: React SPA | 2 weeks | Can parallel Phase 3 |
| Phase 5: Theme Migration | 1 week | Phase 4 |
| Phase 6: Mobile Prep | 1 week | Phase 3 |
| Phase 7: AWS Deployment | 2 weeks | All phases |

**Total: 10-14 weeks** for a small team (1-2 developers)

---

## References

- [Fastify Documentation](https://www.fastify.io/docs/latest/)
- [Auth.js (NextAuth v5)](https://authjs.dev/)
- [Vite](https://vitejs.dev/)
- [React Router v6](https://reactrouter.com/)
- [AWS ECS](https://docs.aws.amazon.com/ecs/)
- [CloudFront + S3](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html)
