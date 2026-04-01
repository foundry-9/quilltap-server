# Chat Settings Module

A refactored, modular implementation of chat settings management. This module was extracted from the original 560-line `chat-settings-tab.tsx` file into focused, single-responsibility components.

## Module Structure

### Files

```
chat-settings/
├── index.tsx                       # Main component (86 lines)
├── types.ts                        # TypeScript types and constants (93 lines)
├── AvatarSettings.tsx              # Avatar display settings component (92 lines)
├── CheapLLMSettings.tsx            # Cheap LLM configuration component (201 lines)
├── ImageDescriptionSettings.tsx    # Image description profile settings (67 lines)
├── hooks/
│   ├── index.ts                    # Hooks barrel export (5 lines)
│   └── useChatSettings.ts          # Settings state management hook (281 lines)
└── README.md                       # This file
```

## Components

### ChatSettingsTab (index.tsx)
The main container component that orchestrates all child components and state management. It handles:
- Initial data loading via `useChatSettings` hook
- Error and success state display
- Component composition and layout
- API communication coordination

**Responsibilities:**
- UI orchestration
- Error/success feedback
- Data flow management

### AvatarSettings (AvatarSettings.tsx)
Manages avatar display preferences:
- Avatar display mode (ALWAYS, GROUP_ONLY, NEVER)
- Avatar display style (CIRCULAR, RECTANGULAR)

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `onAvatarModeChange`: Callback for mode changes
- `onAvatarStyleChange`: Callback for style changes

### CheapLLMSettings (CheapLLMSettings.tsx)
Manages configuration for background task LLM usage:
- Strategy selection (USER_DEFINED, PROVIDER_CHEAPEST, LOCAL_FIRST)
- User-defined profile selection
- Global default override
- Fallback to local models
- Embedding provider configuration
- Embedding profile selection

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `loadingProfiles`: Profile loading state
- `connectionProfiles`: Available LLM profiles
- `embeddingProfiles`: Available embedding profiles
- `onUpdate`: Callback for settings updates

### ImageDescriptionSettings (ImageDescriptionSettings.tsx)
Manages vision-capable profile selection for image descriptions:
- Selects which profile to use for describing images
- Filters only vision-capable providers (OPENAI, ANTHROPIC, GOOGLE, GROK)

**Props:**
- `settings`: Current chat settings
- `saving`: Loading state indicator
- `loadingProfiles`: Profile loading state
- `connectionProfiles`: Available profiles
- `onProfileChange`: Callback for profile changes

## Hooks

### useChatSettings
Centralized state management hook for all chat settings operations.

**Returns:**
```typescript
{
  settings: ChatSettings | null
  loading: boolean
  error: string | null
  saving: boolean
  success: boolean
  connectionProfiles: ConnectionProfile[]
  embeddingProfiles: EmbeddingProfile[]
  loadingProfiles: boolean
  fetchSettings: () => Promise<void>
  handleAvatarModeChange: (mode: AvatarDisplayMode) => Promise<void>
  handleAvatarStyleChange: (style: AvatarDisplayStyle) => Promise<void>
  handleCheapLLMUpdate: (updates: Partial<CheapLLMSettings>) => Promise<void>
  handleImageDescriptionProfileChange: (profileId: string | null) => Promise<void>
}
```

**Features:**
- Complete separation of state logic from UI
- Full TypeScript typing
- Comprehensive error handling with client logging
- Success feedback with automatic timeout
- API integration for all settings operations
- Automatic profile loading and caching

## Types (types.ts)

### Core Types
- `AvatarDisplayMode`: 'ALWAYS' | 'GROUP_ONLY' | 'NEVER'
- `AvatarDisplayStyle`: 'CIRCULAR' | 'RECTANGULAR'
- `CheapLLMStrategy`: 'USER_DEFINED' | 'PROVIDER_CHEAPEST' | 'LOCAL_FIRST'
- `EmbeddingProvider`: 'SAME_PROVIDER' | 'OPENAI' | 'LOCAL'

### Interfaces
- `CheapLLMSettings`: Configuration for background LLM tasks
- `ChatSettings`: User's complete chat settings
- `ConnectionProfile`: LLM provider connection details
- `EmbeddingProfile`: Embedding model configuration

### Constants
- `AVATAR_MODES`: Array of available avatar display modes with labels
- `AVATAR_STYLES`: Array of available avatar styles with preview symbols
- `VISION_PROVIDERS`: Providers that support vision/image analysis

## API Integration

The module communicates with these endpoints:

- `GET /api/chat-settings` - Fetch current settings
- `PUT /api/chat-settings` - Update settings
- `GET /api/profiles` - Fetch connection profiles
- `GET /api/embedding-profiles` - Fetch embedding profiles

## Logging

All async operations include comprehensive debug logging via `clientLogger`:
- Settings load/update operations
- Profile fetch operations
- Error conditions with context

Example:
```typescript
clientLogger.debug('Updating avatar display mode', { mode })
clientLogger.info('Avatar display mode updated successfully', { mode })
clientLogger.error('Failed to update avatar display mode', { error: errorMsg })
```

## Usage

### Basic Usage
```tsx
import ChatSettingsTab from '@/components/settings/chat-settings'

export function MyPage() {
  return <ChatSettingsTab />
}
```

### Using Individual Components
```tsx
import {
  AvatarSettings,
  CheapLLMSettings,
  ImageDescriptionSettings,
  useChatSettings,
} from '@/components/settings/chat-settings'

export function MyComponent() {
  const { settings, saving, handleAvatarModeChange } = useChatSettings()

  return (
    <AvatarSettings
      settings={settings}
      saving={saving}
      onAvatarModeChange={handleAvatarModeChange}
      onAvatarStyleChange={handleAvatarStyleChange}
    />
  )
}
```

## Backward Compatibility

The original file `chat-settings-tab.tsx` is maintained as a legacy export that re-exports from the new module structure. Existing imports will continue to work:

```tsx
// Old import - still works
import ChatSettingsTab from '@/components/settings/chat-settings-tab'

// New recommended import
import ChatSettingsTab from '@/components/settings/chat-settings'
```

## Line Count Summary

| File | Lines | Purpose |
|------|-------|---------|
| useChatSettings.ts | 281 | State management hook |
| CheapLLMSettings.tsx | 201 | Component |
| types.ts | 93 | Type definitions |
| AvatarSettings.tsx | 92 | Component |
| index.tsx | 86 | Main component |
| ImageDescriptionSettings.tsx | 67 | Component |
| hooks/index.ts | 5 | Barrel export |
| **Total** | **825** | **Previously 560 + overhead** |

Original file: **560 lines**
Refactored structure: **825 lines total** (includes separation and documentation overhead, all files under 300 lines)

## Next Steps

- Monitor actual usage to ensure component boundaries are correct
- Consider extracting constants to separate configuration file if module grows
- Add unit tests for each component and the useChatSettings hook
- Consider extracting form field patterns into reusable components
