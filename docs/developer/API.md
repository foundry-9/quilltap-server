# Quilltap API Documentation

Complete API reference for Quilltap v3.2.

## Table of Contents

- [API Versioning](#api-versioning)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Error Handling](#error-handling)
- [Providers](#providers)
- [Endpoints](#endpoints)
  - [Providers (Endpoint)](#providers-endpoint)
  - [Health](#health)
  - [User Profile](#user-profile)
  - [Chat Settings](#chat-settings)
  - [API Keys](#api-keys)
  - [Connection Profiles](#connection-profiles)
  - [Embedding Profiles](#embedding-profiles)
  - [Image Profiles](#image-profiles)
  - [Models](#models)
  - [Characters](#characters)
  - [NPCs](#npcs)
  - [Chats](#chats)
  - [Messages](#messages)
  - [Memories](#memories)
  - [Tags](#tags)
  - [Files](#files)
  - [Files & Images (Legacy)](#files--images)
  - [Folders](#folders)
  - [Templates](#templates)
  - [System Backup & Restore](#system-backup--restore)
  - [System Data Directory](#system-data-directory)
  - [System Unlock](#system-unlock)
  - [System Migration Warnings](#system-migration-warnings)
  - [Tools & Backup (Legacy)](#tools--backup)
  - [LLM Logs](#llm-logs)
  - [Themes](#themes)
  - [Search](#search)
  - [LLM Tools](#llm-tools)
  - [Plugins](#plugins)
  - [Projects](#projects)

## API Versioning

As of v2.7+, all core API endpoints use the `/api/v1/` prefix. This enables future versioning as the API evolves.

### Route Structure

The API follows a clean REST pattern:
- **Collection endpoints**: `/api/v1/[entity]` (GET list, POST create)
- **Individual endpoints**: `/api/v1/[entity]/[id]` (GET, PUT, DELETE)
- **Actions via query param**: `POST /api/v1/[entity]/[id]?action=name`

### Action Parameters

Non-CRUD operations use the `?action=` query parameter:

```
POST /api/v1/characters/[id]?action=favorite  # Toggle favorite
POST /api/v1/chats/[id]?action=regenerate-title  # Regenerate title
GET /api/v1/characters/[id]?action=export  # Export character
```

### Legacy Routes Removed

As of v2.8, legacy routes (without `/v1/` prefix) have been removed. Only `/api/v1/` routes are supported.

A few non-v1 routes remain for specific purposes:
- `/api/health` - Health check endpoint
- `/api/plugin-routes/[...path]` - Plugin route dispatcher
- `/api/themes/*` - Theme asset serving

## Authentication

Quilltap operates in **single-user mode**. All API endpoints automatically use the single local user account - no login is required.

### Session Endpoint

#### `GET /api/v1/session`

Returns the current user session.

**Response**: `200 OK`

```json
{
  "user": {
    "id": "ffffffff-ffff-ffff-ffff-ffffffffffff",
    "email": "user@localhost.localdomain",
    "name": "Local User"
  },
  "expires": "2025-02-19T10:00:00.000Z"
}
```

### Including Credentials

For consistency, include credentials in requests:

```javascript
fetch('/api/characters', {
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
  },
});
```

## Rate Limiting

Rate limits are enforced on all endpoints:

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Chat streaming | 20 messages | 60 seconds |
| API endpoints | 100 requests | 10 seconds |
| General | 100 requests | 60 seconds |

### Rate Limit Headers

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642584000
```

### Rate Limit Exceeded Response

```json
{
  "error": "Too many requests",
  "message": "Rate limit exceeded. Please try again later."
}
```

Status code: `429 Too Many Requests`

## Error Handling

### Error Response Format

```json
{
  "error": "Error Type",
  "message": "Human-readable error message",
  "details": {}
}
```

### Common HTTP Status Codes

- `200` - Success
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error
- `503` - Service Unavailable

## Providers

Quilltap uses a plugin-based provider system. Available providers depend on which plugins are enabled via `SITE_PLUGINS_ENABLED`:

| Provider ID | Plugin | Capabilities |
|-------------|--------|--------------|
| `OPENAI` | qtap-plugin-openai | Chat, embeddings, image generation, tool calling |
| `ANTHROPIC` | qtap-plugin-anthropic | Chat, image understanding, tool calling, prompt caching |
| `GOOGLE` | qtap-plugin-google | Chat, image generation (Imagen 4), multimodal inputs |
| `GROK` | qtap-plugin-grok | Chat, image generation, web search, multimodal |
| `OLLAMA` | qtap-plugin-ollama | Chat, embeddings (local models) |
| `OPENROUTER` | qtap-plugin-openrouter | Chat, embeddings, image generation (200+ models) |
| `OPENAI_COMPATIBLE` | qtap-plugin-openai-compatible | Chat (any OpenAI-format API) |

## Endpoints

### Providers (Endpoint)

#### `GET /api/v1/providers`

List all available providers, including both LLM providers and search providers. The response combines both provider types into a single list, distinguished by the `type` field.

**Response**: `200 OK`

```json
{
  "providers": [
    {
      "id": "OPENAI",
      "name": "OPENAI",
      "displayName": "OpenAI",
      "description": "OpenAI LLM and image generation provider",
      "abbreviation": "OAI",
      "colors": {
        "bg": "bg-green-100",
        "text": "text-green-800",
        "icon": "text-green-600"
      },
      "type": "llm",
      "capabilities": {
        "chat": true,
        "embeddings": true,
        "imageGeneration": true,
        "toolCalling": true
      },
      "configRequirements": {
        "requiresApiKey": true,
        "requiresBaseUrl": false
      }
    },
    {
      "id": "SERPER",
      "name": "SERPER",
      "displayName": "Serper Web Search",
      "description": "Google search results via the Serper.dev API",
      "abbreviation": "SRP",
      "colors": {
        "bg": "bg-orange-100",
        "text": "text-orange-800",
        "icon": "text-orange-600"
      },
      "type": "search",
      "configRequirements": {
        "requiresApiKey": true,
        "requiresBaseUrl": false,
        "apiKeyLabel": "Serper API Key"
      }
    }
  ],
  "count": 2
}
```

**Provider Types:**

| Type | Description |
|------|-------------|
| `llm` | LLM providers for chat, embeddings, and image generation. Include `capabilities` describing supported features. |
| `search` | Search providers that power the `search_web` tool. Include `configRequirements` with `requiresApiKey`, `requiresBaseUrl`, and `apiKeyLabel`. |

---

### Health

#### `GET /api/health`

Check application health status.

**Authentication**: Not required

**Response**: `200 OK`

```json
{
  "status": "healthy",
  "timestamp": "2025-01-19T12:00:00.000Z",
  "uptime": 86400,
  "environment": "production",
  "database": "connected"
}
```

---

### User Profile

#### `GET /api/v1/user/profile`

Get current user's profile information.

**Response**: `200 OK`

```json
{
  "id": "user-uuid",
  "username": "localUser",
  "email": "user@localhost.localdomain",
  "name": "Local User",
  "image": "/api/v1/files/avatar-uuid",
  "createdAt": "2025-01-15T12:00:00.000Z",
  "updatedAt": "2025-01-19T10:00:00.000Z"
}
```

#### `PUT /api/v1/user/profile`

Update current user's profile.

**Request Body**:

```json
{
  "email": "newemail@example.com",
  "name": "New Name"
}
```

**Response**: `200 OK`

Returns updated profile (same format as GET).

#### `PATCH /api/v1/user/profile/avatar`

Set or clear user's profile avatar.

**Request Body**:

```json
{
  "imageId": "file-uuid-from-file-manager"
}
```

To clear avatar, set `imageId` to `null`.

**Response**: `200 OK`

Returns updated profile with avatar URL.

---

### Chat Settings

User-specific chat and UI settings.

#### `GET /api/v1/settings/chat`

Get chat settings for the current user.

**Response**: `200 OK`

```json
{
  "avatarDisplayMode": "ALWAYS",
  "avatarDisplayStyle": "CIRCULAR",
  "tagStyles": {},
  "cheapLLMSettings": {
    "strategy": "PROVIDER_CHEAPEST",
    "fallbackToLocal": true,
    "embeddingProvider": "OPENAI"
  },
  "imageDescriptionProfileId": null,
  "themePreference": {
    "activeThemeId": null,
    "colorMode": "system",
    "showNavThemeSelector": false
  },
  "defaultRoleplayTemplateId": null,
  "sidebarWidth": 320,
  "tokenDisplaySettings": {},
  "memoryCascadePreferences": {},
  "llmLoggingSettings": {},
  "autoDetectRng": true
}
```

#### `PUT /api/v1/settings/chat`

Update chat settings.

**Request Body** (all fields optional):

```json
{
  "avatarDisplayMode": "ALWAYS" | "GROUP_ONLY" | "NEVER",
  "avatarDisplayStyle": "CIRCULAR" | "RECTANGULAR",
  "tagStyles": {},
  "cheapLLMSettings": {
    "strategy": "USER_DEFINED" | "PROVIDER_CHEAPEST" | "LOCAL_FIRST",
    "fallbackToLocal": true,
    "embeddingProvider": "SAME_PROVIDER" | "OPENAI" | "LOCAL"
  },
  "imageDescriptionProfileId": "profile-uuid" | null,
  "themePreference": {
    "activeThemeId": "theme-id" | null,
    "colorMode": "light" | "dark" | "system"
  },
  "defaultRoleplayTemplateId": "template-uuid" | null,
  "sidebarWidth": 320,
  "memoryCascadePreferences": {
    "onMessageDelete": "DELETE_MEMORIES" | "KEEP_MEMORIES" | "ASK_EVERY_TIME",
    "onSwipeRegenerate": "DELETE_MEMORIES" | "KEEP_MEMORIES" | "REGENERATE_MEMORIES"
  },
  "llmLoggingSettings": {},
  "autoDetectRng": true
}
```

---

### API Keys

#### `GET /api/v1/api-keys`

List all API keys for authenticated user.

**Response**: `200 OK`

```json
{
  "apiKeys": [
    {
      "id": "key-uuid",
      "provider": "OPENAI",
      "label": "My OpenAI Key",
      "keyMasked": "sk-...1234",
      "isActive": true,
      "lastUsed": "2025-01-19T10:00:00.000Z",
      "createdAt": "2025-01-15T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/api-keys`

Create a new API key.

**Request Body**:

```json
{
  "provider": "OPENAI",
  "label": "My OpenAI Key",
  "apiKey": "sk-..."
}
```

**Validation**:
- `provider`: Required, provider ID from enabled plugins
- `label`: Required, 1-100 characters
- `apiKey`: Required, will be encrypted with AES-256-GCM

**Response**: `201 Created`

#### `GET /api/v1/api-keys/[id]`

Get a specific API key (masked).

#### `PUT /api/v1/api-keys/[id]`

Update an API key's label or active status.

#### `DELETE /api/v1/api-keys/[id]`

Delete an API key.

#### `POST /api/v1/api-keys/[id]?action=test`

Test an API key connection with the provider. Supports both LLM providers and search providers -- the endpoint automatically detects the provider type from the key's associated provider and routes the validation accordingly. For LLM providers, it calls the provider's `validateApiKey` method. For search providers, it calls the search provider's `validateApiKey` method (e.g., making a minimal test query to the search API).

**Request Body** (optional):

```json
{
  "baseUrl": "https://custom-endpoint.example.com"
}
```

**Response (valid)**: `200 OK`

```json
{
  "valid": true,
  "provider": "OPENAI",
  "message": "API key is valid"
}
```

**Response (invalid)**: `400 Bad Request`

```json
{
  "valid": false,
  "provider": "SERPER",
  "error": "API key validation failed"
}
```

#### `POST /api/v1/api-keys?action=auto-associate`

Auto-associate API keys with connection profiles based on provider.

#### `POST /api/v1/api-keys?action=export`

Export all API keys (encrypted bundle for backup/transfer).

#### `POST /api/v1/api-keys?action=import`

Import API keys from an encrypted bundle.

#### `POST /api/v1/api-keys?action=import-preview`

Preview what keys would be imported without applying changes.

---

### Connection Profiles

#### `GET /api/v1/connection-profiles`

List all LLM connection profiles.

**Query Parameters**:
- `sortByCharacter` - Sort profiles by matching tags with character
- `imageCapable=true` - Filter to image-capable providers only

**Response**: `200 OK`

```json
{
  "profiles": [
    {
      "id": "profile-uuid",
      "name": "GPT-4 Profile",
      "provider": "OPENAI",
      "apiKeyId": "key-uuid",
      "modelName": "gpt-4o",
      "parameters": {
        "temperature": 0.7,
        "max_tokens": 4096
      },
      "isDefault": true,
      "isCheap": false,
      "allowWebSearch": false,
      "useNativeWebSearch": false,
      "apiKey": {
        "id": "key-uuid",
        "label": "My OpenAI Key",
        "provider": "OPENAI",
        "isActive": true
      },
      "tags": [],
      "createdAt": "2025-01-15T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/connection-profiles`

Create a connection profile.

**Request Body**:

```json
{
  "name": "Claude Profile",
  "provider": "ANTHROPIC",
  "apiKeyId": "key-uuid",
  "modelName": "claude-sonnet-4-20250514",
  "parameters": {
    "temperature": 0.7,
    "max_tokens": 4096
  },
  "isDefault": false,
  "isCheap": false,
  "allowWebSearch": false,
  "useNativeWebSearch": false
}
```

#### `GET /api/v1/connection-profiles/[id]`

Get a specific profile.

#### `PUT /api/v1/connection-profiles/[id]`

Update a profile.

#### `DELETE /api/v1/connection-profiles/[id]`

Delete a profile.

#### `POST /api/v1/connection-profiles?action=test-connection`

Test a profile connection.

**Request Body**:

```json
{
  "provider": "OPENAI",
  "apiKeyId": "key-uuid",
  "baseUrl": "https://api.openai.com/v1"
}
```

#### `POST /api/v1/connection-profiles?action=test-message`

Send a test message using a profile.

**Request Body**:

```json
{
  "provider": "OPENAI",
  "apiKeyId": "key-uuid",
  "baseUrl": "https://api.openai.com/v1",
  "modelName": "gpt-4o",
  "parameters": {
    "temperature": 0.7,
    "max_tokens": 50
  }
}
```

#### `POST /api/v1/connection-profiles?action=reorder`

Bulk-update profile sort indices for custom ordering.

**Request Body**:

```json
{
  "order": [
    { "id": "profile-uuid-1", "sortIndex": 0 },
    { "id": "profile-uuid-2", "sortIndex": 1 },
    { "id": "profile-uuid-3", "sortIndex": 2 }
  ]
}
```

#### `POST /api/v1/connection-profiles?action=reset-sort`

Reset all profile sort indices to the default algorithm: default profile first, then non-cheap profiles alphabetically, then cheap profiles alphabetically.

**Request Body**: `{}`

---

### Embedding Profiles

#### `GET /api/v1/embedding-profiles`

List embedding profiles.

#### `POST /api/v1/embedding-profiles`

Create an embedding profile.

**Supported Providers**: `OPENAI`, `OLLAMA`, `OPENROUTER`

#### `GET /api/v1/embedding-profiles/[id]`

Get a specific embedding profile.

#### `PUT /api/v1/embedding-profiles/[id]`

Update an embedding profile.

#### `DELETE /api/v1/embedding-profiles/[id]`

Delete an embedding profile.

#### `GET /api/v1/embedding-profiles/models`

Get available embedding models for a provider.

---

### Image Profiles

#### `GET /api/v1/image-profiles`

List image generation profiles.

#### `POST /api/v1/image-profiles`

Create an image profile.

**Request Body**:

```json
{
  "name": "DALL-E Profile",
  "provider": "OPENAI",
  "apiKeyId": "key-uuid",
  "modelName": "gpt-image-1",
  "parameters": {
    "size": "1024x1024",
    "quality": "hd"
  },
  "isDefault": false
}
```

#### `GET /api/v1/image-profiles?action=list-providers`

List available image generation providers from the plugin registry.

**Response**:

```json
{
  "providers": [
    {
      "value": "OPENAI",
      "label": "OpenAI (DALL-E / GPT Image)",
      "defaultModels": ["gpt-image-1", "dall-e-3", "dall-e-2"],
      "apiKeyProvider": "OPENAI"
    },
    {
      "value": "ETERNAL_AI",
      "label": "Eternal AI",
      "defaultModels": ["black-forest-labs/FLUX.1-dev", "black-forest-labs/FLUX.1-schnell"],
      "apiKeyProvider": "ETERNAL_AI"
    }
  ],
  "count": 2
}
```

#### `GET /api/v1/image-profiles?action=list-models`

Get available image generation models for a provider.

**Query Parameters**:
- `provider` (required) - Provider name (e.g., "OPENAI", "ETERNAL_AI")
- `apiKeyId` - API key ID to fetch models dynamically (optional)

**Response**:

```json
{
  "provider": "OPENAI",
  "models": ["gpt-image-1", "dall-e-3", "dall-e-2"],
  "supportedModels": ["gpt-image-1", "dall-e-3", "dall-e-2"]
}
```

#### `POST /api/v1/image-profiles?action=validate-key`

Validate an API key for image generation.

**Request Body**:

```json
{
  "provider": "OPENAI",
  "apiKeyId": "key-uuid"
}
```

**Response**:

```json
{
  "valid": true,
  "message": "API key is valid",
  "modelCount": 3
}
```

#### `GET /api/v1/image-profiles/[id]`

Get a specific image profile.

#### `PUT /api/v1/image-profiles/[id]`

Update an image profile.

#### `DELETE /api/v1/image-profiles/[id]`

Delete an image profile.

---

### Models

Retrieve available LLM models from providers.

#### `GET /api/v1/models`

List cached models from the database.

**Query Parameters**:
- `provider` - Filter by provider (e.g., `openai`, `anthropic`)
- `hasVision` - Filter to vision-capable models (`true`)
- `hasStreaming` - Filter to streaming-capable models (`true`)

**Response**: `200 OK`

```json
{
  "models": [
    {
      "id": "model-uuid",
      "provider": "OPENAI",
      "modelId": "gpt-4o",
      "displayName": "GPT-4o",
      "contextWindow": 128000,
      "maxOutputTokens": 4096,
      "deprecated": false,
      "experimental": false
    }
  ],
  "count": 25,
  "filters": {
    "provider": "openai",
    "hasVision": false,
    "hasStreaming": false
  },
  "cached": true
}
```

#### `POST /api/v1/models`

Fetch models directly from a provider (live query, not cached).

**Request Body**:

```json
{
  "provider": "OPENAI",
  "apiKeyId": "key-uuid",
  "baseUrl": "https://api.openai.com/v1"
}
```

**Response**: `200 OK`

```json
{
  "provider": "OPENAI",
  "models": ["gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo"],
  "modelsWithInfo": [
    {
      "id": "gpt-4o",
      "displayName": "GPT-4o",
      "deprecated": false,
      "experimental": false,
      "maxOutputTokens": 4096,
      "contextWindow": 128000
    }
  ],
  "count": 3
}
```

---

### Characters

#### `GET /api/v1/characters`

List all characters.

**Query Parameters**:
- `npc=true|false` - Filter by NPC status (omit for regular characters)
- `controlledBy=llm|user` - Filter by control mode (LLM-controlled or user-controlled)
- `tagId` - Filter by tag

**Response**: `200 OK`

```json
{
  "characters": [
    {
      "id": "char-uuid",
      "name": "Alice",
      "title": "The Curious",
      "description": "A friendly AI assistant",
      "controlledBy": "llm",
      "npc": false,
      "isFavorite": true,
      "defaultImage": {
        "id": "file-uuid",
        "filepath": "/api/v1/files/file-uuid",
        "url": null
      },
      "_count": {
        "chats": 5
      },
      "createdAt": "2025-01-15T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/characters`

Create a character.

**Request Body**:

```json
{
  "name": "Alice",
  "title": "The Curious",
  "description": "A friendly AI assistant",
  "personality": "Helpful and kind",
  "scenario": "You're chatting with Alice",
  "firstMessage": "Hello! How can I help?",
  "exampleDialogues": "<START>\nUser: Hi\nAlice: Hello!\n<END>",
  "controlledBy": "llm",
  "systemPrompts": [
    {
      "name": "Default",
      "content": "You are Alice, a helpful assistant.",
      "isActive": true,
      "isDefault": true
    }
  ]
}
```

**Note**: Set `controlledBy` to `"user"` for user-controlled characters (replaces the legacy persona system).

#### `POST /api/v1/characters?action=import`

Import a SillyTavern character (JSON format only).

**Request**: `multipart/form-data`

```
file: <character.json>
```

**Note**: PNG character card format (JSON embedded in PNG) is not supported. Use JSON export format.

#### `POST /api/v1/characters?action=ai-wizard`

Use AI to generate character details from a brief description.

#### `POST /api/v1/characters?action=quick-create`

Quick-create a minimal character.

#### `GET /api/v1/characters/[id]`

Get a character with enriched data.

**Response**: `200 OK`

```json
{
  "character": {
    "id": "char-uuid",
    "name": "Alice",
    "defaultImage": {
      "id": "file-uuid",
      "filepath": "/api/v1/files/file-uuid",
      "url": null
    },
    "_count": {
      "chats": 5
    }
  }
}
```

#### `PUT /api/v1/characters/[id]`

Update a character.

#### `DELETE /api/v1/characters/[id]`

Delete a character.

**Query Parameters**:
- `cascadeChats=true` - Also delete exclusive chats
- `cascadeImages=true` - Also delete exclusive images

#### `GET /api/v1/characters/[id]?action=export`

Export character in SillyTavern-compatible format.

**Query Parameters**:
- `format=json|png` - Export format (JSON for data, PNG for character card image)

#### `POST /api/v1/characters/[id]?action=favorite`

Toggle character favorite status.

#### `POST /api/v1/characters/[id]?action=avatar`

Set or clear character avatar.

**Request Body**:

```json
{
  "imageId": "file-uuid"
}
```

To clear avatar, set `imageId` to `null`.

#### `POST /api/v1/characters/[id]?action=add-tag`

Add a tag to a character.

**Request Body**:

```json
{
  "tagId": "tag-uuid"
}
```

#### `POST /api/v1/characters/[id]?action=remove-tag`

Remove a tag from a character.

**Request Body**:

```json
{
  "tagId": "tag-uuid"
}
```

---

#### Character Clothing Records

Clothing records describe what a character wears in different contexts. They are embedded in the character document as a JSON array and used for system prompts and image generation.

##### `GET /api/v1/characters/[id]/clothing`

Returns all clothing records for a character.

**Response:**
```json
{
  "clothingRecords": [
    {
      "id": "uuid",
      "name": "Battle Armor",
      "usageContext": "in combat situations",
      "description": "Heavy plate armor with dragon motifs...",
      "createdAt": "ISO timestamp",
      "updatedAt": "ISO timestamp"
    }
  ]
}
```

##### `POST /api/v1/characters/[id]/clothing`

Creates a new clothing record.

**Body:**
```json
{
  "name": "Battle Armor",
  "usageContext": "in combat situations",
  "description": "Heavy plate armor with dragon motifs..."
}
```

**Response:** `201 Created` with `{ clothingRecord: {...} }`

##### `GET /api/v1/characters/[id]/clothing/[recordId]`

Returns a single clothing record.

##### `PUT /api/v1/characters/[id]/clothing/[recordId]`

Updates a clothing record. All fields are optional.

**Body:**
```json
{
  "name": "Updated Name",
  "usageContext": "updated context",
  "description": "Updated description..."
}
```

##### `DELETE /api/v1/characters/[id]/clothing/[recordId]`

Deletes a clothing record. Returns `{ success: true }`.

---

### NPCs

NPCs are characters with `npc: true`. They appear in Settings > NPCs and can be created directly from chat.

#### `GET /api/v1/characters?npc=true`

List all NPCs.

#### `POST /api/v1/characters` with `npc: true`

Create an NPC character.

---

### Chats

#### `GET /api/v1/chats`

List all chats for authenticated user.

**Query Parameters**:
- `tagId` - Filter by tag

**Response**: `200 OK`

```json
{
  "chats": [
    {
      "id": "chat-uuid",
      "title": "Chat with Alice",
      "characterId": "char-uuid",
      "connectionProfileId": "profile-uuid",
      "participants": [
        {
          "id": "participant-uuid",
          "type": "CHARACTER",
          "characterId": "char-uuid",
          "controlledBy": "llm",
          "connectionProfileId": "profile-uuid"
        }
      ],
      "impersonatingParticipantIds": [],
      "activeTypingParticipantId": null,
      "allLLMPauseTurnCount": 0,
      "tags": [],
      "createdAt": "2025-01-19T10:00:00.000Z",
      "updatedAt": "2025-01-19T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/chats`

Create a new chat.

**Request Body**:

```json
{
  "characterId": "char-uuid",
  "connectionProfileId": "profile-uuid",
  "userCharacterId": "user-char-uuid",
  "title": "Chat with Alice",
  "scenario": "Optional custom scenario"
}
```

**Note**: `userCharacterId` is optional - provide a user-controlled character ID to "play as" that character in the chat.

#### `POST /api/v1/chats?action=import`

Import a SillyTavern chat (JSONL format).

**Request Body**:

```json
{
  "chatData": {
    "messages": [],
    "chat_metadata": {},
    "character_name": "Alice",
    "user_name": "User",
    "create_date": 1234567890
  },
  "mappings": [],
  "defaultConnectionProfileId": "profile-uuid",
  "triggerTitleGeneration": true,
  "createMemories": false
}
```

#### `GET /api/v1/chats/[id]`

Get a chat with full message history.

#### `PUT /api/v1/chats/[id]`

Update chat metadata.

#### `DELETE /api/v1/chats/[id]`

Delete a chat (cascades to messages).

#### `GET /api/v1/chats/[id]?action=export`

Export chat as SillyTavern JSONL format.

#### `GET /api/v1/chats/[id]?action=cost`

Get detailed cost breakdown for a chat.

**Response**: `200 OK`

```json
{
  "chatId": "chat-uuid",
  "costs": [
    {
      "participantId": "participant-uuid",
      "characterId": "char-uuid",
      "characterName": "Alice",
      "provider": "ANTHROPIC",
      "modelName": "claude-sonnet-4-20250514",
      "totalPromptTokens": 15000,
      "totalCompletionTokens": 5000,
      "messageCount": 25
    }
  ],
  "totalMessages": 50,
  "totalPromptTokens": 30000,
  "totalCompletionTokens": 10000
}
```

#### `POST /api/v1/chats/[id]?action=regenerate-title`

Regenerate chat title using AI.

#### `POST /api/v1/chats/[id]?action=add-tag`

Add a tag to a chat.

**Request Body**:

```json
{
  "tagId": "tag-uuid"
}
```

#### `POST /api/v1/chats/[id]?action=remove-tag`

Remove a tag from a chat.

**Request Body**:

```json
{
  "tagId": "tag-uuid"
}
```

#### `POST /api/v1/chats/[id]?action=add-participant`

Add a character to the chat.

**Request Body**:

```json
{
  "characterId": "char-uuid",
  "connectionProfileId": "profile-uuid"
}
```

#### `POST /api/v1/chats/[id]?action=update-participant`

Update a participant's settings.

**Request Body**:

```json
{
  "participantId": "participant-uuid",
  "connectionProfileId": "profile-uuid",
  "imageProfileId": "image-profile-uuid",
  "embeddingProfileId": "embedding-profile-uuid"
}
```

#### `POST /api/v1/chats/[id]?action=remove-participant`

Remove a participant from the chat.

**Request Body**:

```json
{
  "participantId": "participant-uuid"
}
```

#### `POST /api/v1/chats/[id]?action=bulk-reattribute`

Re-attribute multiple messages from one participant to another in a single operation. All memories associated with the affected messages are permanently deleted.

**Request Body**:

```json
{
  "sourceParticipantId": "participant-uuid" | null,  // null = unassigned messages
  "targetParticipantId": "participant-uuid",
  "roleFilter": "ASSISTANT" | "USER" | "both"  // Default: "both"
}
```

**Response**: `200 OK`

```json
{
  "success": true,
  "messagesUpdated": 42,
  "memoriesDeleted": 7
}
```

#### `POST /api/v1/chats/[id]?action=turn`

Update turn state for multi-character chat, or query the next speaker.

**Request Body** (for `nudge`, `queue`, `dequeue`):

```json
{
  "action": "nudge" | "queue" | "dequeue",
  "participantId": "participant-uuid"
}
```

**Request Body** (for `query` — read-only, does not modify state):

```json
{
  "action": "query"
}
```

**Response**: `200 OK`

```json
{
  "success": true,
  "action": "queue",
  "turn": {
    "nextSpeakerId": "participant-uuid" | null,
    "nextSpeakerName": "Alice" | null,
    "nextSpeakerControlledBy": "llm" | "user" | null,
    "reason": "queue" | "weighted_selection" | "only_character" | "user_turn" | "cycle_complete",
    "explanation": "Selected from queue",
    "cycleComplete": false,
    "isUsersTurn": false
  },
  "state": {
    "queue": ["participant-uuid-1", "participant-uuid-2"]
  },
  "participant": {
    "id": "participant-uuid",
    "name": "Alice",
    "queuePosition": 1
  }
}
```

---

### Impersonation

Impersonation allows users to take control of LLM-controlled characters mid-chat.

#### `POST /api/v1/chats/[id]?action=impersonate`

Start impersonating a character in the chat.

**Request Body**:

```json
{
  "participantId": "participant-uuid"
}
```

**Response**: `200 OK`

Returns updated chat metadata with `impersonatingParticipantIds` including the new participant.

#### `POST /api/v1/chats/[id]?action=stop-impersonate`

Stop impersonating a character.

**Request Body**:

```json
{
  "participantId": "participant-uuid",
  "newConnectionProfileId": "profile-uuid"
}
```

**Note**: `newConnectionProfileId` is required when the character doesn't have a default connection profile. This assigns the LLM profile that will control the character after you stop impersonating.

#### `POST /api/v1/chats/[id]?action=set-active-speaker`

Set the active speaker when impersonating multiple characters.

**Request Body**:

```json
{
  "participantId": "participant-uuid"
}
```

---

### Messages

#### `GET /api/v1/messages?chatId=[id]`

Get messages for a chat.

**Query Parameters**:
- `chatId` (required) - Chat ID

**Response**: `200 OK`

```json
{
  "messages": [
    {
      "id": "msg-uuid",
      "chatId": "chat-uuid",
      "role": "assistant",
      "content": "Hello! How can I help?",
      "participantId": "participant-uuid",
      "attachments": [],
      "createdAt": "2025-01-19T10:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/messages?chatId=[id]`

Send a message and get streaming response.

**Query Parameters**:
- `chatId` (required) - Chat ID

**Request Body**:

```json
{
  "content": "Hello, how are you?",
  "attachments": []
}
```

**Response**: Server-Sent Events (text/event-stream)

```
data: {"type":"start"}

data: {"type":"token","content":"I"}

data: {"type":"token","content":"'m doing well"}

data: {"type":"done","messageId":"msg-uuid"}
```

**Tool Calls**:

When tools are called (image generation, memory search, web search):

```
data: {"type":"tool_call","name":"generate_image","arguments":{...}}

data: {"type":"tool_result","name":"generate_image","result":{...}}
```

#### `GET /api/v1/messages/[id]`

Get a specific message.

#### `PUT /api/v1/messages/[id]`

Edit a message.

**Request Body**:

```json
{
  "content": "Updated message content"
}
```

#### `DELETE /api/v1/messages/[id]`

Delete a message.

**Query Parameters**:
- `deleteMemories=true` - Also delete associated memories

#### `POST /api/v1/messages/[id]?action=swipe`

Generate alternative response (swipe).

#### `POST /api/v1/messages/[id]?action=reattribute`

Reattribute a message to a different participant.

**Request Body**:

```json
{
  "newParticipantId": "participant-uuid"
}
```

---

### Memories

Memories are accessed via query parameters to filter by character, chat, or message.

#### `GET /api/v1/memories`

Get memories with filtering.

**Query Parameters** (at least one required):
- `characterId` - Filter by character
- `chatId` - Filter by chat
- `messageId` - Filter by message

**Response**: `200 OK`

```json
{
  "memories": [
    {
      "id": "memory-uuid",
      "characterId": "char-uuid",
      "content": "Alice likes tea",
      "summary": "Preference for tea",
      "importance": 0.8,
      "hasEmbedding": true,
      "createdAt": "2025-01-19T10:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/memories`

Create a memory.

**Query Parameters**:
- `characterId` (required) - Character to create memory for

**Request Body**:

```json
{
  "content": "Alice likes tea",
  "summary": "Preference for tea",
  "importance": 0.8
}
```

#### `GET /api/v1/memories/[id]`

Get a specific memory.

#### `PUT /api/v1/memories/[id]`

Update a memory.

**Request Body**:

```json
{
  "content": "Alice loves tea",
  "summary": "Strong preference for tea",
  "importance": 0.9
}
```

#### `DELETE /api/v1/memories/[id]`

Delete a memory.

#### `POST /api/v1/memories?action=search`

Search memories (uses embeddings if available, falls back to keyword).

**Query Parameters**:
- `characterId` (required) - Character to search memories for

**Request Body**:

```json
{
  "query": "what does Alice like",
  "limit": 5
}
```

**Response**: `200 OK`

```json
{
  "results": [
    {
      "memory": { ... },
      "score": 0.95
    }
  ]
}
```

#### `GET /api/v1/memories?action=housekeep`

Preview housekeeping actions (dry run).

**Query Parameters**:
- `characterId` (required) - Character to preview housekeeping for
- `maxMemories` - Maximum memories to keep (default: 1000)
- `maxAgeMonths` - Maximum age in months (default: 6)
- `minImportance` - Minimum importance threshold (default: 0.3)
- `mergeSimilar` - Whether to merge similar memories (default: false)

#### `POST /api/v1/memories?action=housekeep`

Run housekeeping (deduplication, summarization) on memories.

**Query Parameters**:
- `characterId` (required) - Character to housekeep memories for

**Request Body**:

```json
{
  "maxMemories": 1000,
  "maxAgeMonths": 6,
  "minImportance": 0.3,
  "mergeSimilar": true
}
```

#### `POST /api/v1/memories?action=embeddings`

Generate embeddings for memories missing them.

**Query Parameters**:
- `characterId` (required) - Character to generate embeddings for

---

### Tags

#### `GET /api/v1/tags`

List all tags.

#### `POST /api/v1/tags`

Create a tag.

**Request Body**:

```json
{
  "name": "Fantasy",
  "color": "#ff6b6b",
  "quickHide": false
}
```

#### `GET /api/v1/tags/[id]`

Get a specific tag.

#### `PUT /api/v1/tags/[id]`

Update a tag.

#### `DELETE /api/v1/tags/[id]`

Delete a tag.

---

### Files

Modern file management API (v1).

#### `GET /api/v1/files`

List files for the authenticated user.

**Query Parameters**:
- `projectId` - Filter by project ID
- `folderPath` - Filter by folder path
- `filter=general` - Return only files without a project

**Response**: `200 OK`

```json
{
  "files": [
    {
      "id": "file-uuid",
      "userId": "user-uuid",
      "originalFilename": "document.pdf",
      "filename": "document.pdf",
      "filepath": "/api/v1/files/file-uuid",
      "mimeType": "application/pdf",
      "size": 12345,
      "category": "DOCUMENT",
      "description": null,
      "projectId": "project-uuid",
      "folderPath": "/documents/",
      "width": null,
      "height": null,
      "createdAt": "2026-01-15T12:00:00.000Z",
      "updatedAt": "2026-01-15T12:00:00.000Z"
    }
  ]
}
```

#### `POST /api/v1/files?action=write`

Create a file from text content. Requires file write permission. If a file with the same name already exists in the same scope (user + project + folder), the existing file is overwritten and the original file ID is preserved.

**Request Body**:

```json
{
  "filename": "notes.txt",
  "content": "File content here",
  "mimeType": "text/plain",
  "projectId": "project-uuid",
  "folderPath": "/documents/"
}
```

**Response**: `201 Created` (new file) or `200 OK` (overwrite)

#### `POST /api/v1/files?action=upload`

Upload a file via multipart/form-data. If a file with the same name already exists in the same scope (user + project + folder), the existing file is overwritten and the original file ID is preserved.

**Request**: `multipart/form-data`
- `file` (required) - The file to upload
- `projectId` (optional) - Project to associate with
- `folderPath` (optional) - Folder path within project
- `tags` (optional) - JSON array of tag associations

**Response**: `201 Created` (new file) or `200 OK` (overwrite)

#### `POST /api/v1/files?action=generate-thumbnails`

Batch pre-generate thumbnails for image files. Processes with bounded concurrency (3 concurrent Sharp operations) to avoid overwhelming the server.

**Request Body**:

```json
{
  "fileIds": ["file-uuid-1", "file-uuid-2"],
  "size": 150
}
```

- `fileIds` (required) - Array of file UUIDs (max 100)
- `size` (optional) - Thumbnail size in pixels (default 150, max 300)

**Response**: `200 OK`

```json
{
  "total": 10,
  "generated": 7,
  "cached": 2,
  "errors": 1
}
```

#### `POST /api/v1/files?action=cleanup-orphaned`

Scan for and optionally delete stale file records — database entries whose backing files no longer exist in storage. Defaults to dry-run mode for safety.

**Request Body**:

```json
{
  "dryRun": true
}
```

- `dryRun` (optional) - If `true` (default), only report stale records without deleting. Set to `false` to delete stale DB records and clean up their cached thumbnails.

**Response**: `200 OK`

```json
{
  "total": 50,
  "stale": 3,
  "deleted": 0,
  "dryRun": true,
  "staleFiles": [
    { "id": "file-uuid-1", "filename": "lost-image.png" },
    { "id": "file-uuid-2", "filename": "missing-doc.pdf" }
  ]
}
```

#### `GET /api/v1/files/[id]`

Download a file by ID. Returns the file content with appropriate headers.

**Query Parameters**:
- `action=thumbnail` - Get thumbnail for images
- `size` - Thumbnail size (default 150, max 300)

**Response**: File binary with `Content-Type` and `Content-Disposition` headers.

#### `DELETE /api/v1/files/[id]`

Delete a file.

**Query Parameters**:
- `force=true` - Delete even if file is linked to other entities
- `dissociate=true` - Remove all associations before deleting

**Response**: `200 OK`

```json
{
  "success": true
}
```

**Error Response** (if file has associations):

```json
{
  "error": "Bad Request",
  "message": "File is linked to other items",
  "details": {
    "code": "FILE_HAS_ASSOCIATIONS",
    "associations": {
      "characters": [...],
      "messages": [...]
    }
  }
}
```

#### `POST /api/v1/files/[id]?action=move`

Move or rename a file.

**Request Body**:

```json
{
  "folderPath": "/new-folder/",
  "filename": "new-name.txt",
  "projectId": "project-uuid"
}
```

#### `POST /api/v1/files/[id]?action=promote`

Promote an attachment to general or project files.

**Request Body**:

```json
{
  "targetProjectId": "project-uuid",
  "folderPath": "/documents/"
}
```

#### `POST /api/v1/files?action=sync`

Trigger filesystem reconciliation — scans the file storage directory and synchronizes the database to match what's on disk.

**Response**:

```json
{
  "success": true,
  "data": {
    "message": "Filesystem sync completed"
  }
}
```

---

### Files & Images (Legacy)

#### `GET /api/v1/files/[id]`

Download a file by ID.

#### `GET /api/v1/images`

List user's images.

#### `POST /api/v1/images`

Upload an image.

**Request**: `multipart/form-data`

#### `GET /api/v1/images/[id]`

Get image metadata.

#### `DELETE /api/v1/images/[id]`

Delete an image.

#### `POST /api/v1/images?action=generate`

Generate an image using configured profile.

**Request Body**:

```json
{
  "profileId": "image-profile-uuid",
  "prompt": "A serene mountain landscape",
  "chatId": "chat-uuid",
  "characterId": "char-uuid"
}
```

#### Folders

Manage folder entities for file organization. Folders are first-class entities stored in the database.

#### `GET /api/v1/files/folders`

List all folders for the authenticated user.

**Query Parameters**:
- `projectId` (optional) - Filter by project ID, or omit for general files

**Response**:

```json
{
  "folders": [
    {
      "id": "folder-uuid",
      "path": "/documents/reports/",
      "name": "reports",
      "parentFolderId": "parent-folder-uuid",
      "projectId": "project-uuid",
      "createdAt": "2025-01-10T12:00:00.000Z",
      "updatedAt": "2025-01-10T12:00:00.000Z"
    }
  ],
  "count": 1
}
```

#### `POST /api/v1/files/folders`

Create a new folder.

**Request Body**:

```json
{
  "path": "/documents/reports/",
  "projectId": "project-uuid"
}
```

**Response**:

```json
{
  "success": true,
  "folder": {
    "id": "folder-uuid",
    "path": "/documents/reports/",
    "name": "reports",
    "parentFolderId": "parent-folder-uuid",
    "projectId": "project-uuid"
  },
  "alreadyExists": false,
  "message": "Folder created successfully"
}
```

#### `PATCH /api/v1/files/folders`

Rename a folder. Updates the folder entity and all affected file paths.

**Request Body**:

```json
{
  "path": "/documents/reports/",
  "newName": "archived-reports",
  "projectId": "project-uuid"
}
```

**Response**:

```json
{
  "success": true,
  "oldPath": "/documents/reports/",
  "newPath": "/documents/archived-reports/",
  "foldersUpdated": 3,
  "filesUpdated": 15
}
```

#### `DELETE /api/v1/files/folders`

Delete an empty folder. Returns error if folder contains files or subfolders.

**Query Parameters**:
- `path` (required) - Folder path to delete
- `projectId` (optional) - Project ID if folder is in a project

**Response**:

```json
{
  "success": true,
  "message": "Folder deleted successfully",
  "path": "/documents/reports/"
}
```

**Error Response** (if folder not empty):

```json
{
  "error": "Bad Request",
  "message": "Folder contains 5 file(s) and cannot be deleted"
}
```

---

### Templates

#### Prompt Templates

User-created system prompt templates.

- `GET /api/v1/prompt-templates` - List templates
- `POST /api/v1/prompt-templates` - Create template
- `GET /api/v1/prompt-templates/[id]` - Get template
- `PUT /api/v1/prompt-templates/[id]` - Update template
- `DELETE /api/v1/prompt-templates/[id]` - Delete template

#### `GET /api/v1/sample-prompts`

Get built-in sample prompts (read-only, can be imported).

#### Roleplay Templates

Per-chat roleplay formatting templates.

- `GET /api/v1/roleplay-templates` - List templates
- `POST /api/v1/roleplay-templates` - Create template
- `GET /api/v1/roleplay-templates/[id]` - Get template
- `PUT /api/v1/roleplay-templates/[id]` - Update template
- `DELETE /api/v1/roleplay-templates/[id]` - Delete template

---

### System Backup & Restore

Modern backup and restore API (v1).

#### `POST /api/v1/system/backup`

Create a new backup for download. Returns a temporary backup ID.

**Response**: `201 Created`

```json
{
  "success": true,
  "backupId": "uuid",
  "manifest": {
    "version": "2.9.0",
    "createdAt": "2026-01-15T12:00:00.000Z",
    "counts": {
      "characters": 10,
      "chats": 25,
      "messages": 500,
      "memories": 100,
      "files": 50
    }
  }
}
```

#### `GET /api/v1/system/backup/[id]`

Download a temporary backup by ID. The backup is a ZIP file containing all user data.

**Response**: `200 OK` (application/zip)

Returns the backup ZIP file for download. Backup expires after 30 minutes.

#### `POST /api/v1/system/restore`

Restore data from a backup file.

**Request**: `multipart/form-data`
- `file` (required) - The backup ZIP file
- `mode` (required) - `"replace"` (overwrite existing data) or `"new-account"` (import as new)
- `preview` (optional) - Set to `"true"` for preview mode

**Response**: `200 OK`

```json
{
  "success": true,
  "summary": {
    "characters": 10,
    "chats": 25,
    "messages": 500,
    "memories": 100,
    "files": 50,
    "tags": 5,
    "warnings": []
  }
}
```

#### `POST /api/v1/system/restore?action=preview`

Preview backup contents without restoring.

**Request**: `multipart/form-data`
- `file` (required) - The backup ZIP file

**Response**: `200 OK`

```json
{
  "success": true,
  "preview": {
    "version": "2.9.0",
    "counts": {
      "characters": 10,
      "chats": 25,
      "files": 50
    }
  }
}
```

---

### System Data Directory

Information about the Quilltap data directory location.

#### `GET /api/v1/system/data-dir`

Get data directory information.

**Response**: `200 OK`

```json
{
  "path": "/Users/user/Library/Application Support/Quilltap",
  "source": "platform-default",
  "sourceDescription": "Using macOS default location",
  "platform": "darwin",
  "isDocker": false,
  "canOpen": true
}
```

| Field | Description |
|-------|-------------|
| `path` | Absolute path to the data directory |
| `source` | `"environment"` (from env var) or `"platform-default"` |
| `platform` | `"darwin"`, `"linux"`, `"win32"` |
| `isDocker` | Whether running in Docker container |
| `canOpen` | Whether "open" action is supported |

#### `POST /api/v1/system/data-dir?action=open`

Open the data directory in the system file browser (not available in Docker).

**Response**: `200 OK`

```json
{
  "message": "Data directory opened in file browser",
  "path": "/Users/user/Library/Application Support/Quilltap"
}
```

---

### System Unlock

Database encryption key management. These endpoints are unauthenticated because they must be accessible before the app is fully operational (during locked mode and initial setup).

#### `GET /api/v1/system/unlock`

Returns the current database key state.

**Response**: `200 OK`

```json
{
  "state": "resolved"
}
```

| State | Description |
|-------|-------------|
| `needs-setup` | No encryption key exists yet (first run) |
| `needs-passphrase` | Key file is passphrase-protected and locked |
| `needs-vault-storage` | Env var pepper needs to be stored in .dbkey file |
| `resolved` | Key is available, database is accessible |

#### `POST /api/v1/system/unlock?action=setup`

First-run setup: generates encryption pepper, writes `.dbkey` file, and encrypts any existing plaintext databases.

**Request Body**:

```json
{
  "passphrase": "optional-passphrase"
}
```

**Response**: `200 OK`

```json
{
  "success": true,
  "pepper": "hex-encoded-pepper-value",
  "message": "Encryption key generated and stored. Save this value — it will not be displayed again."
}
```

#### `POST /api/v1/system/unlock?action=unlock`

Unlock database with passphrase. Supports both current `.dbkey` format and legacy pepper vault migration.

**Request Body**:

```json
{
  "passphrase": "your-passphrase"
}
```

**Response**: `200 OK`

```json
{
  "success": true
}
```

#### `POST /api/v1/system/unlock?action=store`

Store an existing environment variable pepper into the `.dbkey` file.

**Request Body**:

```json
{
  "passphrase": "optional-passphrase"
}
```

**Response**: `200 OK`

```json
{
  "success": true
}
```

#### `POST /api/v1/system/unlock?action=change-passphrase`

Change the passphrase protecting the `.dbkey` file. Requires the app to be in `resolved` state.

**Request Body**:

```json
{
  "oldPassphrase": "current-passphrase",
  "newPassphrase": "new-passphrase"
}
```

**Response**: `200 OK`

```json
{
  "success": true
}
```

---

### System Migration Warnings

Migration warning notifications generated during server startup (e.g., unrecoverable API keys after column migration). Unauthenticated as it runs during startup.

#### `GET /api/v1/system/migration-warnings`

Returns pending migration warning notifications. Returns empty array if already notified or none occurred.

**Response**: `200 OK`

```json
{
  "success": true,
  "ready": true,
  "warnings": [
    {
      "type": "unrecoverable-api-keys",
      "message": "Some API keys could not be decrypted after migration",
      "details": {}
    }
  ]
}
```

#### `POST /api/v1/system/migration-warnings`

Marks migration warnings as acknowledged. Call after displaying notifications to prevent re-notification.

**Response**: `200 OK`

```json
{
  "success": true,
  "message": "Migration warnings marked as notified"
}
```

---

### Tools & Backup (Legacy)

#### `POST /api/v1/system/backup`

Create a full backup.

**Request Body**:

```json
{
  "destination": "local" | "cloud",
  "includeImages": true
}
```

#### `GET /api/v1/system/backup`

List backups.

#### `GET /api/v1/system/backup/[id]?action=preview`

Preview backup contents.

#### `POST /api/v1/system/restore`

Restore from backup.

#### `GET /api/v1/system/backup/[id]?action=download`

Download a backup file.

#### `DELETE /api/v1/system/backup/[id]`

Delete a backup.

#### `POST /api/v1/system/tools?action=delete-data`

Delete all user data.

**Request Body**:

```json
{
  "confirmed": true
}
```

#### `POST /api/v1/system/tools?action=capabilities-report-generate`

Generate a capabilities report.

#### `GET /api/v1/system/tools?action=capabilities-report-list`

List generated reports.

#### `GET /api/v1/system/tools?action=capabilities-report-get`

Get a specific report.

---

### LLM Logs

#### `GET /api/v1/llm-logs`

List LLM logs with filters.

**Query Parameters**:
- `messageId` - Filter by message ID
- `chatId` - Filter by chat ID
- `characterId` - Filter by character ID
- `type` - Filter by log type (CHAT_MESSAGE, TOOL_CONTINUATION, MEMORY_EXTRACTION, CHARACTER_WIZARD, etc.)
- `standalone` - Set to 'true' for logs without entity associations
- `limit` - Max results (default 50, max 100)
- `offset` - Pagination offset

**Response**: `200 OK`

```json
{
  "logs": [
    {
      "id": "log-uuid",
      "type": "CHAT_MESSAGE",
      "messageId": "msg-uuid",
      "chatId": "chat-uuid",
      "characterId": "char-uuid",
      "request": {
        "model": "gpt-4",
        "messages": [...],
        "temperature": 0.8
      },
      "response": {
        "choices": [
          {
            "message": {
              "role": "assistant",
              "content": "Response text"
            }
          }
        ],
        "usage": {
          "prompt_tokens": 100,
          "completion_tokens": 50,
          "total_tokens": 150
        }
      },
      "timestamp": "2026-01-23T10:00:00.000Z",
      "durationMs": 1500
    }
  ],
  "count": 1,
  "total": 50,
  "limit": 50,
  "offset": 0
}
```

#### `GET /api/v1/llm-logs/[id]`

Get a single log entry by ID.

**Response**: `200 OK`

```json
{
  "id": "log-uuid",
  "type": "CHAT_MESSAGE",
  "messageId": "msg-uuid",
  "chatId": "chat-uuid",
  "characterId": "char-uuid",
  "request": {...},
  "response": {...},
  "timestamp": "2026-01-23T10:00:00.000Z",
  "durationMs": 1500
}
```

#### `DELETE /api/v1/llm-logs/[id]`

Delete a log entry by ID.

**Response**: `200 OK`

```json
{
  "message": "Log deleted"
}
```

---

### Themes

#### `GET /api/themes`

List available themes.

#### `GET /api/themes/[themeId]/tokens`

Get theme CSS tokens.

#### `GET /api/themes/assets/[...path]`

Serve theme assets.

#### `GET /api/themes/fonts/[...path]`

Serve theme fonts.

#### `GET /api/theme-preference`

Get user's theme preference.

#### `PUT /api/theme-preference`

Update theme preference.

---

### Search

#### `GET /api/v1/ui/search?q=query`

Global search across characters and chats.

**Query Parameters**:
- `q` - Search query (required)
- `type` - Filter by type: `characters`, `chats`

---

### Background Jobs

#### `GET /api/v1/system/jobs`

Get queue status and jobs.

**Response**: `200 OK`

```json
{
  "stats": {
    "pending": 5,
    "processing": 1,
    "completed": 100,
    "failed": 2,
    "activeTotal": 6
  },
  "jobs": [
    {
      "id": "job-uuid",
      "type": "MEMORY_EXTRACTION",
      "status": "pending",
      "priority": 1,
      "estimatedTokens": 1500,
      "createdAt": "2025-01-19T10:00:00.000Z"
    }
  ],
  "totalEstimatedTokens": 15000
}
```

#### `GET /api/v1/system/jobs/[id]`

Get job details.

#### `DELETE /api/v1/system/jobs/[id]`

Delete a job.

#### `POST /api/v1/system/jobs/[id]?action=pause`

Pause a job.

#### `POST /api/v1/system/jobs/[id]?action=resume`

Resume a paused job.

#### `GET /api/v1/system/tools?action=tasks-queue`

Get tasks queue status.

---

### LLM Tools

Endpoints for managing LLM tools available during chat conversations.

#### `GET /api/v1/tools`

List all available LLM tools that can be enabled/disabled per chat.

**Query Parameters:**
- `chatId` (optional) - Chat ID to check tool availability in context

**Response:**
```json
{
  "tools": [
    {
      "id": "generate_image",
      "name": "Generate Image",
      "description": "Generate images using AI image generation providers",
      "source": "built-in",
      "category": "media",
      "available": true
    },
    {
      "id": "search_memories",
      "name": "Search Memories",
      "description": "Search through character memories and past conversations",
      "source": "built-in",
      "category": "memory",
      "available": true
    },
    {
      "id": "search_web",
      "name": "Search Web",
      "description": "Search the web for current information",
      "source": "built-in",
      "category": "search",
      "available": false,
      "unavailableReason": "Web search must be enabled in the connection profile"
    },
    {
      "id": "project_info",
      "name": "Project Info",
      "description": "Access project information and files",
      "source": "built-in",
      "category": "project",
      "available": false,
      "unavailableReason": "Chat must be associated with a project"
    },
    {
      "id": "file_management",
      "name": "File Management",
      "description": "Read, write, and manage files in the file system",
      "source": "built-in",
      "category": "files",
      "available": true
    },
    {
      "id": "search_help",
      "name": "Search Help",
      "description": "Search Quilltap help documentation for features, settings, and usage guidance",
      "source": "built-in",
      "category": "help",
      "available": true
    }
  ],
  "count": 6
}
```

**Built-in Tools:**

| Tool ID | Name | Description | Context Requirements |
|---------|------|-------------|---------------------|
| `generate_image` | Generate Image | AI image generation | Requires image profile on character |
| `search_memories` | Search Memories | Search character memories | Always available |
| `search_web` | Search Web | Web search for current info | Requires web search enabled in connection profile |
| `project_info` | Project Info | Access project files | Chat must be in a project |
| `file_management` | File Management | File system operations | Always available |
| `search_help` | Search Help | Search Quilltap documentation | Always available |

**Notes:**
- When `chatId` is provided, the response includes `available` and `unavailableReason` fields
- Plugin-provided tools are also included with `source: "plugin"`
- The `request_full_context` tool is intentionally excluded (always available when context compression is enabled)

---

### Plugins

Plugin management endpoints for npm-based plugin installation.

#### `GET /api/plugins`

Get all registered plugins and system status.

**Response:**
```json
{
  "plugins": [
    {
      "name": "qtap-plugin-openai",
      "title": "OpenAI Provider",
      "version": "1.0.5",
      "enabled": true,
      "capabilities": ["LLM_PROVIDER", "IMAGE_PROVIDER"],
      "path": "/app/plugins/dist/qtap-plugin-openai",
      "source": "included"
    }
  ],
  "stats": {
    "total": 15,
    "enabled": 14,
    "disabled": 1,
    "errors": 0,
    "initialized": true
  },
  "errors": []
}
```

#### `PUT /api/plugins/[name]`

Enable or disable a plugin.

**Request Body:**
```json
{
  "enabled": true
}
```

#### `GET /api/plugins/search`

Search npm registry for Quilltap plugins.

**Query Parameters:**
- `q` - Search query (appended to "qtap-plugin-" prefix)

**Response:**
```json
{
  "plugins": [
    {
      "name": "qtap-plugin-example",
      "version": "1.0.0",
      "description": "Example Quilltap plugin",
      "author": "Author Name",
      "keywords": ["quilltap", "plugin"],
      "updated": "2024-01-15T10:30:00Z",
      "score": 0.85
    }
  ]
}
```

#### `POST /api/plugins/install`

Install a plugin from npm.

**Request Body:**
```json
{
  "packageName": "qtap-plugin-example"
}
```

**Response:**
```json
{
  "success": true,
  "plugin": {
    "name": "qtap-plugin-example",
    "title": "Example Plugin",
    "version": "1.0.0",
    "description": "An example plugin",
    "capabilities": ["LLM_PROVIDER"]
  },
  "message": "Plugin installed successfully. Restart Quilltap to activate the plugin."
}
```

#### `POST /api/plugins/uninstall`

Uninstall an installed plugin.

**Request Body:**
```json
{
  "packageName": "qtap-plugin-example"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Plugin uninstalled successfully. Restart Quilltap to complete removal."
}
```

**Notes:**
- Bundled plugins cannot be uninstalled

#### `GET /api/plugins/installed`

Get all installed plugins with metadata.

**Query Parameters:**
- `scope` - Filter by scope: `"all"`, `"bundled"`, `"site"` (default: `"all"`)
- `check` - Package name to check installation status

**Response:**
```json
{
  "plugins": [
    {
      "name": "qtap-plugin-openai",
      "title": "OpenAI Provider",
      "version": "1.0.5",
      "description": "OpenAI LLM and image generation provider",
      "source": "bundled",
      "capabilities": ["LLM_PROVIDER", "IMAGE_PROVIDER"],
      "installedAt": null
    }
  ],
  "counts": {
    "total": 15,
    "bundled": 12,
    "site": 2,
    "user": 1
  }
}
```

---

### Projects

Project management endpoints for organizing chats, files, and characters.

#### `GET /api/v1/projects`

List all projects for the current user.

#### `POST /api/v1/projects`

Create a new project.

**Request Body:**
```json
{
  "name": "My Project",
  "description": "Optional description",
  "instructions": "Optional system prompt instructions",
  "allowAnyCharacter": false
}
```

#### `GET /api/v1/projects/[id]`

Get project details with enriched character roster and counts.

#### `PUT /api/v1/projects/[id]`

Update project properties.

**Request Body:**
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "instructions": "Updated instructions",
  "allowAnyCharacter": true,
  "color": "#3b82f6",
  "icon": "folder"
}
```

#### `DELETE /api/v1/projects/[id]`

Delete a project. Chats and files are disassociated (not deleted).

#### `POST /api/v1/projects/[id]?action=add-character`

Add a character to the project roster.

**Request Body:**
```json
{
  "characterId": "uuid"
}
```

#### `DELETE /api/v1/projects/[id]?action=remove-character`

Remove a character from the project roster.

**Request Body:**
```json
{
  "characterId": "uuid"
}
```

#### `GET /api/v1/projects/[id]?action=list-chats`

List chats in the project with pagination.

**Query Parameters:**
- `limit` - Number of chats to return (default: 20)
- `offset` - Offset for pagination (default: 0)

#### `POST /api/v1/projects/[id]?action=add-chat`

Associate a chat with the project.

**Request Body:**
```json
{
  "chatId": "uuid"
}
```

#### `DELETE /api/v1/projects/[id]?action=remove-chat`

Remove a chat from the project.

**Request Body:**
```json
{
  "chatId": "uuid"
}
```

#### `POST /api/v1/projects/[id]?action=update-tool-settings`

Update default tool settings for new chats in the project.

**Request Body:**
```json
{
  "defaultDisabledTools": ["tool_id_1", "tool_id_2"],
  "defaultDisabledToolGroups": ["plugin:mcp"]
}
```

**Response:**
```json
{
  "success": true,
  "defaultDisabledTools": ["tool_id_1", "tool_id_2"],
  "defaultDisabledToolGroups": ["plugin:mcp"]
}
```

When a new chat is created within a project, it inherits these default tool settings. Existing chats are not affected.

---

## SDK Examples

### JavaScript/TypeScript

```typescript
// Send message with streaming
async function sendMessage(chatId: string, content: string) {
  const response = await fetch(`/api/v1/messages?chatId=${chatId}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content }),
  });

  const reader = response.body?.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader!.read();
    if (done) break;

    const chunk = decoder.decode(value);
    const lines = chunk.split('\n\n');

    for (const line of lines) {
      if (line.startsWith('data: ')) {
        const data = JSON.parse(line.slice(6));

        if (data.type === 'token') {
          process.stdout.write(data.content);
        } else if (data.type === 'tool_call') {
          console.log('Tool called:', data.name);
        } else if (data.type === 'done') {
          console.log('\nMessage ID:', data.messageId);
        }
      }
    }
  }
}

// Toggle character favorite
async function toggleFavorite(characterId: string) {
  const response = await fetch(`/api/v1/characters/${characterId}?action=favorite`, {
    method: 'POST',
    credentials: 'include',
  });
  return response.json();
}
```

### Python

```python
import requests

# List characters
response = requests.get(
    'https://yourdomain.com/api/v1/characters',
    cookies={'quilltap-session': 'your-session-cookie'}
)
data = response.json()
characters = data['characters']
```

## Versioning

Current API version: **v2.10**

All core endpoints use the `/api/v1/` prefix. Legacy routes (without prefix) were removed in v2.8.

The API follows semantic versioning. Breaking changes are avoided where possible.

## Support

- Report issues: https://github.com/foundry-9/quilltap/issues
- Documentation: https://github.com/foundry-9/quilltap/tree/main/docs
