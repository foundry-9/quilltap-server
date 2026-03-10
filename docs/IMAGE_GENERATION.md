# Image Generation - Complete Documentation

Complete guide to using and developing with image generation features in Quilltap.

---

## 📖 Quick Navigation

- **[For Users](#for-users)** - Getting started and using image generation
- **[For Developers](#for-developers)** - API reference and integration
- **[Feature Architecture](#feature-architecture)** - How it works internally
- **[Troubleshooting](#troubleshooting)** - Solutions to common issues

---

## For Users

### Quick Start (5 Minutes)

#### Step 1: Choose Your Provider

Pick one of these image generation services:

- **OpenAI (DALL-E)** - Best for photorealism and detail
  - Sign up: https://platform.openai.com/signup
  - Get API key: https://platform.openai.com/api-keys

- **Google Imagen** - Great for diverse styles and landscapes
  - Sign up: https://cloud.google.com
  - Enable Imagen API in Google Cloud Console

- **Grok (xAI)** - Best for creative and experimental
  - Sign up: https://console.x.ai
  - Get API key from dashboard

#### Step 2: Add Your API Key

1. Go to **Settings** → **API Keys**
2. Click **New API Key**
3. Select your provider
4. Paste the key you got from step 1
5. Give it a label (e.g., "My OpenAI Key")
6. Click **Save**

#### Step 3: Create an Image Profile

1. Go to **Settings** → **Image Generation Profiles**
2. Click **New Profile**
3. Fill in the form:
   - **Name**: "DALL-E 3" or something descriptive
   - **Provider**: Select your provider
   - **API Key**: Select the key you just added
   - Click **Validate** (shows ✓ if valid)
   - **Model**: Select from dropdown
   - **Parameters**: Keep defaults or adjust if desired
   - Check "Set as default profile" if you want
4. Click **Create Profile**

#### Step 4: Use in Your Chat

1. Open a chat (or create a new one)
2. In chat settings, select your image profile
3. Type: "Generate an image of a sunset"
4. The AI will create the image for you! 🎨

**Done! You're ready to use image generation.**

---

### Supported Providers

| Provider | Best For | Models | Key Parameters |
|----------|----------|--------|---|
| **OpenAI** | Photo-realistic, detailed | dall-e-3, dall-e-2, gpt-image-1 | Quality, Style, Size |
| **Google Imagen** | Natural, diverse | imagen-4.0, imagen-3.0 | Aspect Ratio, Negative Prompt |
| **Grok (xAI)** | Creative, experimental | grok-imagine-image, grok-imagine-image-pro | Aspect Ratio |

---

### Provider Configuration Details

#### OpenAI (DALL-E)

**Supported Models**:
- `gpt-image-1` - Latest, most capable
- `dall-e-3` - High quality, follows prompts closely
- `dall-e-2` - Faster, earlier generation

**Parameters**:

| Parameter | Options | Effect |
|-----------|---------|--------|
| **Quality** | standard, hd | HD produces finer details and better consistency |
| **Style** | vivid, natural | Vivid is dramatic and hyper-real; Natural is realistic and less exaggerated |
| **Size** | 1024x1024, 1792x1024, 1024x1792 | Image dimensions (square, landscape, portrait) |

**Example Profile**:
```
Name: DALL-E 3 HD
Provider: OpenAI
Model: dall-e-3
Quality: hd
Style: vivid
Size: 1024x1024
```

#### Google Imagen

**Supported Models**:
- `imagen-4.0-generate-001` - Latest
- `imagen-3.0-generate-002` - Stable
- `imagen-3.0-fast-generate-001` - Faster generation

**Parameters**:

| Parameter | Options | Effect |
|-----------|---------|--------|
| **Aspect Ratio** | 1:1, 16:9, 9:16, 4:3, 3:2 | Image proportions |
| **Negative Prompt** | Text | Things to avoid in the image |

**Example Profile**:
```
Name: Imagen 4 Fast
Provider: Google Imagen
Model: imagen-3.0-fast-generate-001
Aspect Ratio: 16:9
Negative Prompt: blurry, low quality, distorted
```

#### Grok (xAI)

**Supported Models**:
- `grok-imagine-image` - xAI's standard image generation model
- `grok-imagine-image-pro` - Higher quality output at 2K resolution
- `grok-2-image` - Legacy model (deprecated)

**Parameters**:
- **Aspect Ratio**: 1:1, 4:3, 3:4, 16:9, 9:16, 3:2, 2:3, 2:1, 1:2, 19.5:9, 9:19.5, 20:9, 9:20
- Prompts up to ~8000 characters supported

**Example Profile**:
```
Name: Grok Image Gen
Provider: Grok
Model: grok-imagine-image
```

---

### Using Image Generation in Chats

#### Select a Profile for Your Chat

When creating or editing a chat:

1. Look for **Image Generation Profile** in chat settings
2. Click the dropdown to see available profiles
3. Select a profile or leave it unset to disable image generation
4. The selected profile shows:
   - Profile name
   - Model being used
   - Provider icon

#### Default vs. Per-Chat Profiles

- **Default Profile**: Set in Settings → Image Generation Profiles
  - Used automatically if no profile selected for chat
  - Good for consistent style across most conversations

- **Per-Chat Profile**: Selected in individual chat settings
  - Overrides default for that specific chat
  - Useful for experimenting or context-specific requirements

---

### How to Request Images

The AI will recognize when you want to generate images and automatically use the selected profile. Here are effective ways to request images:

#### Clear Requests
```
"Generate an image of a sunset over the ocean"
"Create a portrait of a woman with red hair"
"Make an illustration of a futuristic robot"
"Draw a landscape of mountains and forests"
```

#### Detailed Descriptions
```
"Generate an oil painting of a medieval castle at night,
with torches lighting the walls and a full moon in the sky,
in the style of classic fantasy art"
```

#### Style-Specific Requests
```
"Create a photo-realistic image of a modern living room"
"Generate a cartoon illustration of a funny cat"
"Make a watercolor painting of wildflowers"
"Draw a steampunk-style airship"
```

#### Abstract Concepts
```
"Create an image representing 'growth and change'"
"Generate a visual of 'peaceful meditation'"
"Make an image showing 'technological advancement'"
```

---

### Prompting Tips

| Goal | How To |
|------|--------|
| Clear request | "Generate an image of X" |
| Detailed | Include style, color, mood, composition |
| Specific | Name the art style (oil painting, watercolor, digital art) |
| Quality | Use adjectives (beautiful, detailed, professional) |
| Variety | Change the prompt each time or try different models |

---

### Understanding the Generation Process

#### What Happens When You Request an Image

1. **Detection**: The AI recognizes your image request
2. **Tool Call**: The AI calls the `generate_image` tool with your prompt
3. **Execution**:
   - System loads your selected profile
   - Validates the API key
   - Sends request to the provider
   - Provider generates the image (usually 10-60 seconds)
4. **Storage**: Image is saved to your chat history
5. **Display**: Image appears in the chat
6. **Response**: AI provides context or commentary about the image

#### Typical Timeline

```
0s     - You send request
1s     - AI recognizes and calls tool
2-5s   - API call sent to provider
5-60s  - Provider generates image
60s+   - Image received and displayed
61s+   - AI responds about the image
```

---

### Troubleshooting

#### "API key not found" or "Unauthorized"

**Solution**:
1. Check that you have at least one API key added in Settings
2. Verify the key is for the correct provider
3. Try validating the key again

#### "Failed to generate image" or Provider Error

**Solutions**:
1. Check that your API key is valid and has sufficient credits
2. Try with a simpler prompt
3. Try a different model
4. Check provider status page for outages

#### Image Generation Not Working in Chat

**Solutions**:
1. Make sure you've selected an image generation profile for the chat
2. Try creating a new chat with the profile selected
3. Check that the profile's API key is valid (click "Edit Profile" → "Validate")
4. Try rephrasing your request more clearly

#### Same Image Generated Repeatedly

**This is normal!** If you use the exact same prompt and parameters, you'll get similar results. To get variety:
- Modify your prompt
- Try a different model
- Change quality/style parameters
- Use different aspect ratios

---

### Best Practices

#### 1. Create Multiple Profiles for Different Purposes

```
- DALL-E 3 HD (high quality, detailed)
- DALL-E 2 Fast (quick, experimental)
- Imagen 4 Widescreen (for landscapes)
```

#### 2. Set Default Profile Wisely

Choose one that works well for your most common use case:
- Detail-oriented work → DALL-E 3 HD
- Experimentation → Faster model
- Variety → Alternate between profiles

#### 3. Use Detailed Prompts

❌ Bad: "Generate an image"
✅ Good: "Generate a digital painting of an astronaut floating in space with colorful nebulae in the background"

#### 4. Understand Provider Strengths

- **OpenAI (DALL-E)**: Best for photorealism and detailed renderings
- **Google Imagen**: Great for natural-looking images and diverse styles
- **Grok**: Creative and experimental, good for unique interpretations

#### 5. Monitor API Usage

- Check your provider's dashboard regularly
- Be aware of costs (API credits used per image)
- Consider usage limits if on free tier

#### 6. Iterate and Refine

```
Round 1: "Create a dragon"
Result: Generic dragon

Round 2: "Create a blue dragon with golden wings,
         standing on a mountain peak, in fantasy art style"
Result: Much better!
```

---

### Common Use Cases

#### Character Design
```
"Create a fantasy character design: a ranger with silver hair,
leather armor, and a bow. Include a forest background."
```

#### Concept Art
```
"Design a futuristic city with flying vehicles,
holographic signs, and tall buildings"
```

#### Storytelling
```
"Illustrate a scene from a story: a person sitting by a
campfire under the stars, with mountains in the distance"
```

#### Visual Brainstorming
```
"Generate 3 different logo concepts for a tech startup
[Ask in separate messages for variety]"
```

---

### Image Privacy & Management

**Are my images private?**
Yes, they're stored in your chat history. They're only visible to you unless you share the chat.

**Can I download generated images?**
Yes, you can right-click and save images from the chat.

**Where are images stored?**
Generated images are saved to your private database and are backed by your user account.

---

## For Developers

### API Reference

#### Generate Images: POST `/api/v1/images?action=generate`

Generate images using your configured LLM providers.

**Authentication**: Requires valid session cookie (automatically included in browser requests).

**Request Body**:

```typescript
{
  // Required: The image description
  prompt: string (1-4000 characters)

  // Required: UUID of the image profile to use
  profileId: string

  // Optional: Tags to apply to generated images
  tags?: Array<{
    tagType: 'CHARACTER' | 'CHAT' | 'THEME'
    tagId: string (UUID of character/chat/theme)
  }>

  // Optional: Generation options (provider-dependent)
  options?: {
    n?: number              // Number of images (1-10, default 1)
    size?: string           // e.g., "1024x1024", "1024x1792", "16:9"
    quality?: 'standard'    // 'standard' or 'hd' (DALL-E only)
    style?: 'vivid'         // 'vivid' or 'natural' (DALL-E only)
    aspectRatio?: string    // "16:9", "4:3", "3:2" etc (Gemini only)
  }
}
```

**Response: Success (200 OK)**:

```typescript
{
  data: Array<{
    id: string                    // Database image ID
    filename: string              // Generated filename
    filepath: string              // Relative path (uploads/generated/...)
    url: string                   // Public URL (/uploads/generated/...)
    mimeType: string              // e.g., "image/png"
    size: number                  // File size in bytes
    revisedPrompt?: string        // Revised prompt from provider (if applicable)
    tags: Array<{
      id: string                  // Tag ID
      imageId: string
      tagType: 'CHARACTER' | 'CHAT' | 'THEME'
      tagId: string
      createdAt: string           // ISO datetime
    }>
  }>

  metadata: {
    prompt: string                // Original prompt
    provider: string              // Provider name
    model: string                 // Model name
    count: number                 // Number of images generated
  }
}
```

**Response: Error Cases**:

### 401 Unauthorized
```json
{
  "error": "Unauthorized"
}
```
No authenticated user. Check NextAuth session.

### 400 Bad Request - Validation Error
```json
{
  "error": "Validation error",
  "details": [
    {
      "code": "too_small",
      "message": "String must contain at least 1 character(s)",
      "path": ["prompt"]
    }
  ]
}
```
Request validation failed. Check prompt, profileId, and options.

### 400 Bad Request - Provider Not Supported
```json
{
  "error": "ANTHROPIC provider does not support image generation"
}
```
The selected profile's provider doesn't support image generation.

### 404 Not Found
```json
{
  "error": "Connection profile not found"
}
```
The specified profileId doesn't exist or doesn't belong to the user.

### 500 Internal Server Error
```json
{
  "error": "Failed to generate images",
  "details": "Rate limit exceeded"
}
```
An error occurred during image generation or file saving.

---

#### Image Profiles: CRUD Operations

### List Profiles: GET `/api/v1/image-profiles`

List all image profiles for the current user.

**Query Parameters**:
- `sortByCharacter` (optional): Character ID for tag-based sorting

**Response**: Array of image profiles

```bash
curl http://localhost:3000/api/v1/image-profiles \
  -H "Cookie: __Secure-next-auth.session-token=..."
```

---

### Create Profile: POST `/api/v1/image-profiles`

Create a new image profile.

**Body**:
```json
{
  "name": "My DALL-E Profile",
  "provider": "OPENAI",
  "apiKeyId": "uuid-of-api-key",
  "modelName": "dall-e-3",
  "parameters": {
    "quality": "hd",
    "style": "vivid"
  },
  "isDefault": true
}
```

**Required Fields**:
- `name` (string, non-empty, unique per user)
- `provider` (OPENAI | GROK | GOOGLE_IMAGEN)
- `modelName` (string)

**Optional Fields**:
- `apiKeyId` (string): UUID of stored API key
- `baseUrl` (string): Custom endpoint URL
- `parameters` (object): Provider-specific settings
- `isDefault` (boolean): Set as default profile

**Response**: Created profile object (201)

```bash
curl -X POST http://localhost:3000/api/v1/image-profiles \
  -H "Content-Type: application/json" \
  -H "Cookie: __Secure-next-auth.session-token=..." \
  -d '{
    "name": "DALL-E 3",
    "provider": "OPENAI",
    "modelName": "dall-e-3",
    "apiKeyId": "abc123",
    "parameters": {"quality": "hd", "style": "vivid"},
    "isDefault": true
  }'
```

---

### Get Profile: GET `/api/v1/image-profiles/[id]`

Get a specific profile by ID.

**Path Parameters**:
- `id` (string): Profile UUID

**Response**: Profile object with full details

```bash
curl http://localhost:3000/api/v1/image-profiles/abc123 \
  -H "Cookie: __Secure-next-auth.session-token=..."
```

---

### Update Profile: PUT `/api/v1/image-profiles/[id]`

Update a profile.

**Path Parameters**:
- `id` (string): Profile UUID

**Body**: All fields optional
```json
{
  "name": "Updated Name",
  "provider": "OPENAI",
  "modelName": "gpt-image-1",
  "apiKeyId": "new-api-key-id",
  "parameters": { "quality": "hd" },
  "isDefault": false
}
```

**Response**: Updated profile object

```bash
curl -X PUT http://localhost:3000/api/v1/image-profiles/abc123 \
  -H "Content-Type: application/json" \
  -H "Cookie: __Secure-next-auth.session-token=..." \
  -d '{"parameters": {"quality": "hd"}}'
```

---

### Delete Profile: DELETE `/api/v1/image-profiles/[id]`

Delete a profile.

**Path Parameters**:
- `id` (string): Profile UUID

**Response**: Success message (200)

```bash
curl -X DELETE http://localhost:3000/api/v1/image-profiles/abc123 \
  -H "Cookie: __Secure-next-auth.session-token=..."
```

---

#### Available Models: GET `/api/v1/image-profiles?action=list-models`

Get available models for a provider.

**Query Parameters**:
- `provider` (required): OPENAI | GROK | GOOGLE_IMAGEN
- `apiKeyId` (optional): API key UUID (uses stored key)

**Response**:
```json
{
  "provider": "OPENAI",
  "models": ["gpt-image-1", "dall-e-3", "dall-e-2"],
  "supportedModels": ["gpt-image-1", "dall-e-3", "dall-e-2"]
}
```

```bash
# Without API key (returns defaults)
curl "http://localhost:3000/api/v1/image-profiles?action=list-models&provider=OPENAI" \
  -H "Cookie: __Secure-next-auth.session-token=..."

# With API key (validates and returns actual models)
curl "http://localhost:3000/api/v1/image-profiles?action=list-models&provider=OPENAI&apiKeyId=abc123" \
  -H "Cookie: __Secure-next-auth.session-token=..."
```

---

#### Validate API Key: POST `/api/v1/image-profiles?action=validate-key`

Validate an API key for image generation.

**Body**:
```json
{
  "provider": "OPENAI",
  "apiKeyId": "uuid-of-stored-key"
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

```bash
# Validate stored key
curl -X POST http://localhost:3000/api/v1/image-profiles?action=validate-key \
  -H "Content-Type: application/json" \
  -H "Cookie: __Secure-next-auth.session-token=..." \
  -d '{"provider": "OPENAI", "apiKeyId": "abc123"}'
```

---

### JavaScript/TypeScript Example

```typescript
async function generateImage(
  prompt: string,
  profileId: string,
  options?: {
    size?: string
    quality?: 'standard' | 'hd'
    style?: 'vivid' | 'natural'
  }
) {
  const response = await fetch('/api/v1/images?action=generate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt,
      profileId,
      options,
    }),
  })

  if (!response.ok) {
    const error = await response.json()
    throw new Error(error.error)
  }

  const { data, metadata } = await response.json()

  return {
    images: data,
    metadata,
  }
}

// Usage
const result = await generateImage(
  'A majestic phoenix rising from flames',
  '550e8400-e29b-41d4-a716-446655440000',
  {
    size: '1024x1024',
    quality: 'hd',
    style: 'vivid',
  }
)

console.log('Generated images:', result.images)
result.images.forEach((img) => {
  console.log(`Image URL: ${img.url}`)
})
```

---

### Common API Error Solutions

| Error | Cause | Solution |
|-------|-------|----------|
| "Unauthorized" | No session | Ensure user is logged in |
| "Validation error" | Invalid input | Check prompt (1-4000 chars), profileId is valid UUID |
| "Connection profile not found" | Wrong profileId | Use correct profile UUID |
| "Provider does not support" | Wrong provider | Use an image-capable provider (OpenAI, Google, Grok) |
| "Rate limit exceeded" | Too many requests | Wait before retrying |
| "Invalid API key" | Decryption failed | Check provider API key configuration |

---

## Feature Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────┐
│                  Image Generation System                │
├────────────────┬──────────────────────────────────────┤
│  Database      │ Models: ImageProfile, ImageProfileTag │
├────────────────┼──────────────────────────────────────┤
│  Providers     │ OpenAI, Google Imagen, Grok          │
├────────────────┼──────────────────────────────────────┤
│  Tool System   │ generate_image tool + registry       │
├────────────────┼──────────────────────────────────────┤
│  Chat Integ.   │ Tool detection & execution           │
├────────────────┼──────────────────────────────────────┤
│  REST API      │ Profile CRUD, model discovery        │
├────────────────┼──────────────────────────────────────┤
│  UI Components │ Forms, pickers, settings             │
└─────────────────────────────────────────────────────────┘
```

---

### Database Schema

The image profile data is stored in SQLite with the following structure:

**ImageProfile Table**:
- `id` (TEXT PRIMARY KEY) - UUID identifier
- `userId` (TEXT NOT NULL) - User ID (foreign key)
- `name` (TEXT NOT NULL) - Profile name
- `provider` (TEXT NOT NULL) - Provider type (OPENAI | GROK | GOOGLE_IMAGEN)
- `apiKeyId` (TEXT) - Optional reference to stored API key
- `baseUrl` (TEXT) - Optional custom endpoint URL
- `modelName` (TEXT NOT NULL) - Model identifier (e.g., "dall-e-3", "imagen-4")
- `parameters` (TEXT) - JSON object with provider-specific defaults
- `isDefault` (BOOLEAN) - Whether this is the default profile
- `isDangerousCompatible` (BOOLEAN) - Whether this provider supports uncensored content
- `createdAt` (TEXT) - ISO timestamp
- `updatedAt` (TEXT) - ISO timestamp
- **Constraints**: UNIQUE(userId, name), INDEX on (userId, isDefault)

**ImageProfileTag Table** (if applicable):
- `id` (TEXT PRIMARY KEY) - UUID identifier
- `imageProfileId` (TEXT NOT NULL) - Reference to ImageProfile
- `tagId` (TEXT NOT NULL) - Reference to Tag
- `createdAt` (TEXT) - ISO timestamp
- **Constraints**: UNIQUE(imageProfileId, tagId)

Data is validated using Zod schemas and accessed through repository interfaces.

---

### Provider Abstraction

The system uses an abstract provider interface that allows plugging in different image generation services. Providers are implemented as plugins that conform to the following interface:

```typescript
// Provider interface (implemented by plugin providers)

export interface ImageGenParams {
  prompt: string;
  negativePrompt?: string;
  model: string;
  n?: number;                    // Number of images
  size?: string;                 // e.g., "1024x1024"
  aspectRatio?: string;          // e.g., "16:9"
  quality?: 'standard' | 'hd';
  style?: 'vivid' | 'natural';
  seed?: number;
  guidanceScale?: number;
  steps?: number;
}

export abstract class ImageGenProvider {
  abstract readonly provider: string;
  abstract readonly supportedModels: string[];

  abstract generateImage(params: ImageGenParams, apiKey: string): Promise<ImageGenResponse>;
  abstract validateApiKey(apiKey: string): Promise<boolean>;
  abstract getAvailableModels(apiKey: string): Promise<string[]>;
}
```

**Implementations**:
Image generation providers are implemented through the plugin system. Provider implementations are accessed via `lib/llm/plugin-factory.ts` using the `createImageProvider()` factory function, which loads provider plugins from the registry.

---

### Tool Integration

Image generation is available as a tool to LLMs through a standardized tool definition:

```typescript
// lib/tools/image-generation-tool.ts

export const imageGenerationToolDefinition = {
  name: "generate_image",
  description: "Generate an image based on a text description.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "A detailed description of the image to generate."
      },
      size: {
        type: "string",
        enum: ["1024x1024", "1792x1024", "1024x1792"],
        description: "Image dimensions."
      },
      style: {
        type: "string",
        enum: ["vivid", "natural"],
        description: "Image style."
      },
      quality: {
        type: "string",
        enum: ["standard", "hd"],
        description: "Image quality."
      },
      count: {
        type: "integer",
        minimum: 1,
        maximum: 4,
        description: "Number of images to generate."
      }
    },
    required: ["prompt"]
  }
};
```

---

### Chat Integration

Chats can have an associated image profile that's automatically used when the LLM detects an image generation request:

```typescript
// Database: Chat model
model Chat {
  // ... other fields ...
  imageProfileId  String?
  imageProfile    ImageProfile?  @relation(fields: [imageProfileId], references: [id], onDelete: SetNull)
}
```

When a chat is used:
1. The image profile is loaded from the chat settings
2. When the LLM calls the `generate_image` tool, the tool executor uses that profile
3. The generated images are saved and displayed in the chat

---

### File Storage

Generated images are stored using the centralized file storage manager (`lib/file-storage/manager.ts`):

- Images are uploaded via `fileStorageManager.uploadFile()` with content-type and filename
- Files are stored in the system's designated data directory based on the OS:
  - Linux: `~/.quilltap/files/`
  - macOS: `~/Library/Application Support/Quilltap/files/`
  - Windows: `%APPDATA%\Quilltap\files\`
- Images are indexed in the database with metadata (size, mime type, sha256 hash)
- Accessible via the API route: `/api/v1/files/{fileId}`

---

### Security Features

✅ **User Isolation** - All data filtered by userId
✅ **API Key Encryption** - AES-256-GCM encryption for stored keys
✅ **Access Control** - Ownership verification on all operations
✅ **Input Validation** - All inputs validated before processing
✅ **Private Images** - Generated images visible only to user
✅ **Audit Logging** - Comprehensive error and usage logging

---

### Context-Aware Appearance Resolution

When generating images involving characters (via `{{CharacterName}}` placeholders), Quilltap now analyzes chat context to determine what each character currently looks like and is wearing, rather than always using the first stored description.

#### How It Works

1. **Placeholder Detection**: When an image prompt contains `{{CharacterName}}` placeholders, the system loads all physical descriptions and clothing records for each character.

2. **Appearance Resolution** (`resolveCharacterAppearances()`): A cheap LLM call analyzes recent chat messages and the image prompt to determine:
   - Which physical description best matches the current scene (by usageContext)
   - What the character is currently wearing

3. **Clothing Priority** (highest to lowest):
   - **Narrative**: If the conversation explicitly describes what a character changed into, that takes priority
   - **Image prompt**: If the image prompt specifies clothing, that is used
   - **Stored record**: The best-matching clothing record by usageContext
   - **Default**: The first stored clothing record, or empty if none exist

4. **Concierge Sanitization** (`sanitizeAppearancesIfNeeded()`): Resolved appearances are classified for safety. If dangerous and no uncensored image provider is available, a cheap LLM rewrites the appearance descriptions to be safe for standard providers.

5. **Prompt Crafting**: The resolved (and possibly sanitized) appearances are injected into the expansion context, giving the prompt crafter focused, context-accurate data instead of raw dumps of all descriptions and clothing.

#### Skip Optimization

If all characters have at most 1 physical description and 0-1 clothing records, AND there is no chat context, the LLM call is skipped and defaults are used directly.

#### Integration Points

- **Chat image generation** (`generate_image` tool): Fetches last 20 chat messages, resolves appearances, sanitizes, then expands prompt
- **Story backgrounds**: Runs appearance resolution in parallel with scene context derivation
- **Front page**: No appearance resolution (no chat context), but now includes Concierge prompt classification and AUTO_ROUTE provider rerouting

#### Fail-Safe Behavior

All appearance resolution and sanitization calls are wrapped in try/catch blocks. If any step fails, the system falls back to the previous behavior (all descriptions/clothing passed raw to the prompt crafter). Image generation is never blocked by resolution errors.

---

## Troubleshooting

### Setup Issues

**"I can't find Settings"**
- Look for a gear icon ⚙️ or "Settings" link in the main menu
- Or check Dashboard → Settings

**"I don't see Image Generation Profiles tab"**
- Make sure you're on the Settings page (not a chat settings)
- Check if you need to scroll tabs (on mobile)
- Tab should appear after Chat Settings tab

**"The dropdown doesn't show any profiles"**
- You need to create a profile first
- Go to Settings → Image Generation Profiles
- Click New Profile and configure it

**"I can't add an API key"**
- Make sure you have a valid key from the provider
- Try validating it in the form
- Check provider's documentation for key format

### Generation Issues

**"API key not found"**
- Add an API key in Settings → API Keys

**"Failed to generate image"**
- Check that your API key is valid
- Make sure you have credits left
- Try a different prompt or model

**"Image not showing in chat"**
- Make sure you selected a profile in chat settings
- Try asking more clearly: "Please generate an image of..."

**"Same image twice"**
- Add variation to prompt or try different model
- Change quality/style parameters

### Performance

**"Generation is taking too long"**
- This is normal (10-60 seconds depending on model)
- Try using a faster model if available
- Consider image size and quality settings

---

## Key Concepts Reference

### API Keys
**What**: Authentication credentials for image providers
**Where to add**: Settings → API Keys
**More info**: See Setup section above

### Image Profile
**What**: Configuration for image generation (model, parameters, etc.)
**Where to manage**: Settings → Image Generation Profiles
**More info**: See Provider Configuration section above

### Provider
**What**: Image generation service (OpenAI, Google, Grok)
**Supported**: OpenAI, Google Imagen, Grok (xAI)

### Per-Chat Profile
**What**: Profile selected for specific chat
**Where to select**: Chat settings → Image Generation Profile
**More info**: See Chat Integration section above

### Default Profile
**What**: Profile used if no per-chat profile selected
**Where to set**: Settings → Image Generation Profiles
**More info**: See Using Image Generation section above

---

## Status

| Aspect | Status |
|--------|--------|
| Implementation | ✅ Complete (7 phases) |
| Testing | ✅ 570/570 tests passing |
| TypeScript | ✅ Zero errors |
| Build | ✅ Successful |
| Documentation | ✅ Comprehensive |
| Production Ready | ✅ Yes |

---

## Rate Limiting

Currently unlimited (depends on provider rate limits):
- **OpenAI**: Check your account limits
- **Google**: Check your API quota
- **xAI**: Check your API limits

---

## Cost Considerations

🔹 Each image costs API credits (varies by provider)
🔹 Models with higher quality/detail cost more
🔹 Monitor your usage on provider's dashboard
🔹 Set up usage alerts if available

**Typical Costs**:
- OpenAI DALL-E 3 HD: ~$0.08 per 1024x1024 image
- Google Imagen: ~$0.02-0.03 per image
- Grok: Pricing varies (check with xAI)

---

## Related Resources

- **API Endpoints**: See `app/api/v1/images/` and `app/api/v1/image-profiles/`
- **Image Generation Tool**: Check `lib/tools/image-generation-tool.ts` and `lib/tools/handlers/image-generation-handler.ts`
- **Tool Integration**: Review how tools are executed in chat contexts
- **Provider Factory**: See `lib/llm/plugin-factory.ts` for provider instantiation
- **File Storage**: Check `lib/file-storage/manager.ts` for file operations
- **Tests**: Check `__tests__/` directory

---

## Quick Reference

### 3-Step Setup
1. **Settings** → **API Keys** → Add your provider's API key
2. **Settings** → **Image Generation Profiles** → Create profile with key
3. **Chat Settings** → Select profile → Ask for image

### Providers at a Glance
| Provider | Best For | Models |
|----------|----------|--------|
| OpenAI | Photo-realistic | dall-e-3, dall-e-2 |
| Google Imagen | Natural, diverse | imagen-4.0, imagen-3.0 |
| Grok | Creative | grok-imagine-image, grok-imagine-image-pro |

### Common Workflows
- **Change Profile**: Chat settings → Select different profile
- **Edit Profile**: Settings → Image Profiles → Edit
- **Delete Profile**: Settings → Image Profiles → Delete
- **Validate Key**: Profile form → Click Validate button

---

**Last Updated**: February 2026 (API and architecture fixes)
**Status**: ✅ Production Ready

For more detailed information, see the individual sections above.
