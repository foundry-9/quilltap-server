# Quilltap API Documentation

Complete API reference for Quilltap v2.4.

## Table of Contents

- [Authentication](#authentication)
- [Rate Limiting](#rate-limiting)
- [Error Handling](#error-handling)
- [Providers](#providers)
- [Endpoints](#endpoints)
  - [Health](#health)
  - [API Keys](#api-keys)
  - [Connection Profiles](#connection-profiles)
  - [Embedding Profiles](#embedding-profiles)
  - [Image Profiles](#image-profiles)
  - [Characters](#characters)
  - [NPCs](#npcs)
  - [Personas](#personas)
  - [Chats](#chats)
  - [Messages](#messages)
  - [Memories](#memories)
  - [Tags](#tags)
  - [Files & Images](#files--images)
  - [Templates](#templates)
  - [Tools & Backup](#tools--backup)
  - [Themes](#themes)
  - [Search](#search)
  - [Background Jobs](#background-jobs)

## Authentication

All API endpoints (except `/api/health`) require authentication via session cookies.

### Session Cookie

Authentication is handled through custom JWT session cookies, which support:

- **Google OAuth** (if Google plugin is enabled)
- **Email/password login** (local accounts)
- **No-auth mode** (`AUTH_DISABLED=true` for local/offline deployments)

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
| `GAB_AI` | qtap-plugin-gab-ai | Chat (OpenAI-compatible) |
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

### API Keys

#### `GET /api/keys`

List all API keys for authenticated user.

**Response**: `200 OK`

```json
[
  {
    "id": "key-uuid",
    "provider": "OPENAI",
    "label": "My OpenAI Key",
    "keyMasked": "sk-...1234",
    "isActive": true,
    "lastUsed": "2025-01-19T10:00:00.000Z",
    "createdAt": "2025-01-15T12:00:00.000Z"
  }
]
```

#### `POST /api/keys`

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

#### `GET /api/keys/[id]`

Get a specific API key (masked).

#### `PUT /api/keys/[id]`

Update an API key's label or active status.

#### `DELETE /api/keys/[id]`

Delete an API key.

#### `POST /api/keys/[id]/test`

Test an API key connection with the provider.

---

### Connection Profiles

#### `GET /api/profiles`

List all LLM connection profiles.

**Response**: `200 OK`

```json
[
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
    "createdAt": "2025-01-15T12:00:00.000Z"
  }
]
```

#### `POST /api/profiles`

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
  "isCheap": false
}
```

#### `GET /api/profiles/[id]`

Get a specific profile.

#### `PUT /api/profiles/[id]`

Update a profile.

#### `DELETE /api/profiles/[id]`

Delete a profile.

#### `POST /api/profiles/test-connection`

Test a profile connection.

#### `POST /api/profiles/test-message`

Send a test message using a profile.

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

#### `GET /api/image-profiles`

List image generation profiles.

#### `POST /api/image-profiles`

Create an image profile.

**Request Body**:

```json
{
  "name": "DALL-E Profile",
  "provider": "OPENAI",
  "apiKeyId": "key-uuid",
  "model": "gpt-image-1.5",
  "settings": {
    "size": "1024x1024",
    "quality": "high"
  }
}
```

#### `GET /api/image-profiles/[id]`

Get a specific image profile.

#### `PUT /api/image-profiles/[id]`

Update an image profile.

#### `DELETE /api/image-profiles/[id]`

Delete an image profile.

#### `POST /api/image-profiles/[id]/generate`

Generate an image using a profile.

#### `GET /api/image-profiles/models`

Get available image generation models for a provider.

---

### Characters

#### `GET /api/characters`

List all characters.

**Query Parameters**:
- `npc=true|false` - Filter by NPC status (omit for regular characters)

**Response**: `200 OK`

```json
[
  {
    "id": "char-uuid",
    "name": "Alice",
    "title": "The Curious",
    "description": "A friendly AI assistant",
    "npc": false,
    "isFavorite": true,
    "chatCount": 5,
    "avatarUrl": "/api/files/avatar-uuid",
    "createdAt": "2025-01-15T12:00:00.000Z"
  }
]
```

#### `POST /api/characters`

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

#### `GET /api/characters/[id]`

Get a character with linked personas.

#### `PUT /api/characters/[id]`

Update a character.

#### `DELETE /api/characters/[id]`

Delete a character.

**Query Parameters**:
- `deleteChats=true` - Also delete related chats
- `deleteImages=true` - Also delete related images

#### `POST /api/characters/[id]/favorite`

Toggle character favorite status.

#### `POST /api/characters/[id]/rename`

Rename character and update references.

**Request Body**:

```json
{
  "newName": "Alice Updated",
  "searchReplace": true
}
```

#### `GET /api/characters/[id]/cascade-preview`

Preview what will be deleted when cascading.

#### `POST /api/characters/import`

Import a SillyTavern character (JSON format only).

**Request**: `multipart/form-data`

```
file: <character.json>
```

**Note**: PNG character card format (JSON embedded in PNG) is not supported. Use JSON export format.

#### `GET /api/characters/[id]/export`

Export character as SillyTavern-compatible JSON.

#### `POST /api/characters/quick-create`

Quick-create a minimal character.

---

### NPCs

NPCs are characters with `npc: true`. They appear in Settings > NPCs and can be created directly from chat.

#### `GET /api/characters?npc=true`

List all NPCs.

#### `POST /api/characters` with `npc: true`

Create an NPC character.

---

### Personas

#### `GET /api/personas`

List all personas.

#### `POST /api/personas`

Create a persona.

**Request Body**:

```json
{
  "name": "My Persona",
  "displayName": "Display Name",
  "title": "Optional Title",
  "description": "Persona description",
  "personalityTraits": "Curious, friendly"
}
```

#### `GET /api/personas/[id]`

Get a specific persona.

#### `PUT /api/personas/[id]`

Update a persona.

#### `DELETE /api/personas/[id]`

Delete a persona.

#### `POST /api/personas/import`

Import a SillyTavern persona.

#### `GET /api/personas/[id]/export`

Export persona as SillyTavern JSON.

#### `POST /api/personas/quick-create`

Quick-create a minimal persona.

---

### Chats

#### `GET /api/chats`

List all chats for authenticated user.

**Response**: `200 OK`

```json
[
  {
    "id": "chat-uuid",
    "title": "Chat with Alice",
    "characterId": "char-uuid",
    "personaId": "persona-uuid",
    "connectionProfileId": "profile-uuid",
    "participants": [],
    "createdAt": "2025-01-19T10:00:00.000Z",
    "updatedAt": "2025-01-19T12:00:00.000Z"
  }
]
```

#### `POST /api/chats`

Create a new chat.

**Request Body**:

```json
{
  "characterId": "char-uuid",
  "personaId": "persona-uuid",
  "connectionProfileId": "profile-uuid",
  "title": "Chat with Alice",
  "scenario": "Optional custom scenario"
}
```

#### `GET /api/chats/[id]`

Get a chat with full message history.

#### `PUT /api/chats/[id]`

Update chat metadata.

#### `DELETE /api/chats/[id]`

Delete a chat (cascades to messages).

#### `POST /api/chats/import`

Import a SillyTavern chat (JSONL format).

**Request**: `multipart/form-data`

```
file: <chat.jsonl>
characterId: <char-uuid>
connectionProfileId: <profile-uuid>
```

#### `GET /api/chats/[id]/export`

Export chat as SillyTavern JSONL format.

#### `GET /api/chats/[id]/participants`

Get/manage multi-character chat participants.

#### `PATCH /api/chats/[id]/turn`

Update turn state for multi-character chat.

#### `POST /api/chats/[id]/queue-memories`

Queue memory extraction as background job.

---

### Messages

#### `POST /api/chats/[id]/messages`

Send a message and get streaming response.

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

#### `PUT /api/messages/[id]`

Edit a message.

#### `DELETE /api/messages/[id]`

Delete a message.

#### `POST /api/messages/[id]/swipe`

Generate alternative response (swipe).

---

### Memories

#### `GET /api/characters/[id]/memories`

Get all memories for a character.

#### `POST /api/characters/[id]/memories`

Create a memory.

**Request Body**:

```json
{
  "content": "Alice likes tea",
  "importance": 0.8,
  "tags": ["preference"]
}
```

#### `PUT /api/characters/[id]/memories/[memoryId]`

Update a memory.

#### `DELETE /api/characters/[id]/memories/[memoryId]`

Delete a memory.

#### `POST /api/characters/[id]/memories/search`

Search memories (uses embeddings if available, falls back to keyword).

**Request Body**:

```json
{
  "query": "what does Alice like",
  "limit": 5
}
```

#### `POST /api/characters/[id]/memories/housekeep`

Run housekeeping (deduplication, summarization) on memories.

#### `POST /api/characters/[id]/memories/embeddings`

Generate embeddings for memories.

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

Global search across characters, personas, chats.

**Query Parameters**:
- `q` - Search query (required)
- `type` - Filter by type: `characters`, `personas`, `chats`

---

### Background Jobs

#### `GET /api/background-jobs`

Get queue status and jobs.

#### `POST /api/background-jobs/process`

Trigger job processing.

#### `GET /api/background-jobs/[id]`

Get job details.

#### `DELETE /api/background-jobs/[id]`

Delete a job.

#### `GET /api/tools/tasks-queue`

Get tasks queue status (UI endpoint).

---

## SDK Examples

### JavaScript/TypeScript

```typescript
// Send message with streaming
async function sendMessage(chatId: string, content: string) {
  const response = await fetch(`/api/chats/${chatId}/messages`, {
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
```

### Python

```python
import requests

# List characters
response = requests.get(
    'https://yourdomain.com/api/characters',
    cookies={'quilltap-session': 'your-session-cookie'}
)
characters = response.json()
```

## Versioning

Current API version: **v2.4**

The API follows semantic versioning. Breaking changes are avoided where possible.

## Support

- Report issues: https://github.com/foundry-9/quilltap/issues
- Documentation: https://github.com/foundry-9/quilltap/tree/main/docs
