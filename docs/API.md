# Quilltap API Documentation

Complete API reference for Quilltap v2.7.

## Table of Contents

- [API Versioning](#api-versioning)
- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Error Handling](#error-handling)
- [Providers](#providers)
- [Endpoints](#endpoints)
  - [Health](#health)
  - [User Profile](#user-profile)
  - [API Keys](#api-keys)
  - [Connection Profiles](#connection-profiles)
  - [Embedding Profiles](#embedding-profiles)
  - [Image Profiles](#image-profiles)
  - [Characters](#characters)
  - [NPCs](#npcs)
  - [Chats](#chats)
  - [Messages](#messages)
  - [Memories](#memories)
  - [Tags](#tags)
  - [Files & Images](#files--images)
  - [Folders](#folders)
  - [Templates](#templates)
  - [System & Backup](#system--backup)
  - [LLM Logs](#llm-logs)
  - [Themes](#themes)
  - [Search](#search)
  - [Plugins](#plugins)

## API Versioning

As of v2.7, all core API endpoints use the `/api/v1/` prefix. This enables future versioning as the API evolves.

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

### Backwards Compatibility

Legacy routes (without `/v1/` prefix) are deprecated but still functional. They return:
- `Deprecation` header with sunset date
- `Link` header pointing to migration docs

Legacy routes will be removed after 2026-04-15.

## Authentication

All API endpoints (except `/api/health`) require authentication via session cookies.

### Session Cookie

Authentication is handled through custom JWT session cookies, which support:

- **Google OAuth** (if Google plugin is enabled and `OAUTH_DISABLED=false`)
- **Email/password login** (local accounts)
- **No-auth mode** (`AUTH_DISABLED=true` for local/offline deployments, auto-logs in as unauthenticatedLocalUser)
- **Credentials-only mode** (`OAUTH_DISABLED=true` hides OAuth buttons, credentials login still works)

Include credentials in requests:

```javascript
fetch('/api/characters', {
  credentials: 'include',
  headers: {
    'Content-Type': 'application/json',
  },
});
```

### Unauthorized Response

```json
{
  "error": "Unauthorized",
  "message": "You must be signed in to access this resource"
}
```

## Rate Limiting

Rate limits are enforced on all endpoints:

| Endpoint Type | Limit | Window |
|--------------|-------|--------|
| Auth endpoints | 5 requests | 60 seconds |
| Chat streaming | 20 messages | 60 seconds |
| Settings endpoints | 30 requests | 60 seconds |
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

#### `GET /api/user/profile`

Get current user's profile information.

**Response**: `200 OK`

```json
{
  "id": "user-uuid",
  "username": "johndoe",
  "email": "john@example.com",
  "name": "John Doe",
  "image": "/api/files/avatar-uuid",
  "emailVerified": "2025-01-15T12:00:00.000Z",
  "createdAt": "2025-01-15T12:00:00.000Z",
  "updatedAt": "2025-01-19T10:00:00.000Z",
  "totpEnabled": true
}
```

#### `PUT /api/user/profile`

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

#### `PATCH /api/user/profile/avatar`

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

Test an API key connection with the provider.

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

---

### Embedding Profiles

#### `GET /api/embedding-profiles`

List embedding profiles.

#### `POST /api/embedding-profiles`

Create an embedding profile.

**Supported Providers**: `OPENAI`, `OLLAMA`, `OPENROUTER`

#### `GET /api/embedding-profiles/[id]`

Get a specific embedding profile.

#### `PUT /api/embedding-profiles/[id]`

Update an embedding profile.

#### `DELETE /api/embedding-profiles/[id]`

Delete an embedding profile.

#### `GET /api/embedding-profiles/models`

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
        "filepath": "/api/files/file-uuid",
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
      "filepath": "/api/files/file-uuid",
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

Export character as SillyTavern-compatible JSON.

**Query Parameters**:
- `format=json|png` - Export format (PNG not yet implemented)

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

### NPCs

NPCs are characters with `npc: true`. They appear in Settings > NPCs and can be created directly from chat.

#### `GET /api/characters?npc=true`

List all NPCs.

#### `POST /api/characters` with `npc: true`

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

Update turn state for multi-character chat.

**Request Body**:

```json
{
  "action": "nudge" | "queue" | "dequeue" | "continue",
  "participantId": "participant-uuid"
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

#### `GET /api/tags`

List all tags.

#### `POST /api/tags`

Create a tag.

**Request Body**:

```json
{
  "name": "Fantasy",
  "color": "#ff6b6b",
  "quickHide": false
}
```

#### `GET /api/tags/[id]`

Get a specific tag.

#### `PUT /api/tags/[id]`

Update a tag.

#### `DELETE /api/tags/[id]`

Delete a tag.

---

### Files & Images

#### `GET /api/files/[id]`

Download a file by ID.

#### `GET /api/images`

List user's images.

#### `POST /api/images`

Upload an image.

**Request**: `multipart/form-data`

#### `GET /api/images/[id]`

Get image metadata.

#### `DELETE /api/images/[id]`

Delete an image.

#### `POST /api/images/generate`

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

#### `GET /api/files/folders`

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

#### `POST /api/files/folders`

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

#### `PATCH /api/files/folders`

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

#### `DELETE /api/files/folders`

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

- `GET /api/prompt-templates` - List templates
- `POST /api/prompt-templates` - Create template
- `GET /api/prompt-templates/[id]` - Get template
- `PUT /api/prompt-templates/[id]` - Update template
- `DELETE /api/prompt-templates/[id]` - Delete template

#### `GET /api/sample-prompts`

Get built-in sample prompts (read-only, can be imported).

#### Roleplay Templates

Per-chat roleplay formatting templates.

- `GET /api/roleplay-templates` - List templates
- `POST /api/roleplay-templates` - Create template
- `GET /api/roleplay-templates/[id]` - Get template
- `PUT /api/roleplay-templates/[id]` - Update template
- `DELETE /api/roleplay-templates/[id]` - Delete template

---

### Tools & Backup

#### `POST /api/tools/backup/create`

Create a full backup.

**Request Body**:

```json
{
  "destination": "local" | "cloud",
  "includeImages": true
}
```

#### `GET /api/tools/backup/list`

List cloud backups.

#### `GET /api/tools/backup/preview`

Preview backup contents.

#### `POST /api/tools/backup/restore`

Restore from backup.

#### `GET /api/tools/backup/download`

Download a backup file.

#### `DELETE /api/tools/backup/delete`

Delete a cloud backup.

#### `POST /api/tools/delete-data`

Delete all user data.

**Request Body**:

```json
{
  "confirmed": true
}
```

#### `POST /api/tools/capabilities-report/generate`

Generate a capabilities report.

#### `GET /api/tools/capabilities-report/list`

List generated reports.

#### `GET /api/tools/capabilities-report/[id]`

Download a report.

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

#### `GET /api/search?q=query`

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

#### `GET /api/tools/tasks-queue`

Get tasks queue status (UI endpoint).

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
  "packageName": "qtap-plugin-example",
  "scope": "user"
}
```

- `scope` - Installation scope: `"user"` (personal) or `"site"` (shared across all users)

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
  "packageName": "qtap-plugin-example",
  "scope": "user"
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
- Site-wide plugins require admin privileges (TODO)

#### `GET /api/plugins/installed`

Get all installed plugins with metadata.

**Query Parameters:**
- `scope` - Filter by scope: `"all"`, `"bundled"`, `"site"`, `"user"` (default: `"all"`)
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

Current API version: **v2.7**

All core endpoints now use the `/api/v1/` prefix. Legacy routes (without prefix) are deprecated and will be removed after 2026-04-15.

The API follows semantic versioning. Breaking changes are avoided where possible.

## Support

- Report issues: https://github.com/foundry-9/quilltap/issues
- Documentation: https://github.com/foundry-9/quilltap/tree/main/docs
