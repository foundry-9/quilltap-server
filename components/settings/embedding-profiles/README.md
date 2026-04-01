# Embedding Profiles Module

This module provides a refactored implementation of the embedding profiles settings tab, split into focused, maintainable components.

## Structure

```
embedding-profiles/
├── types.ts                 # TypeScript interfaces and constants
├── hooks/
│   ├── index.ts            # Hook barrel exports
│   └── useEmbeddingProfiles.ts  # Data fetching hook
├── ProviderBadge.tsx        # Provider display component
├── ProfileForm.tsx          # Form component (deprecated, use ProfileModal)
├── ProfileList.tsx          # List display component
├── ProfileModal.tsx         # Modal form component (create/edit)
└── index.tsx               # Main tab component
```

## Components

### types.ts
Defines all TypeScript interfaces and types used throughout the module:
- `ApiKey` - API key configuration
- `EmbeddingModel` - Model metadata
- `EmbeddingProfile` - Profile configuration
- `EmbeddingProfileFormData` - Form state shape
- `PROVIDER_COLORS` - Provider styling constants

### useEmbeddingProfiles Hook
A custom hook that manages embedding profile data fetching and state:
- Loads profiles, API keys, and available models
- Provides methods to fetch and refetch profiles
- Handles loading and error states
- Follows the existing async operation pattern

### ProviderBadge Component
Simple presentational component that displays provider information with provider-specific styling.

### ProfileForm Component (Deprecated)
Legacy form component. Use ProfileModal instead for new implementations.

### ProfileModal Component
Modal-based form for creating and editing embedding profiles:
- Manages form state using `useFormState` hook
- Handles provider-specific fields (API key for OpenAI, base URL for Ollama)
- Auto-fills model dimensions when available
- Submits to the API and refetches profiles on success
- Prompts to re-embed memories when switching default profile

### ProfileList Component
Displays all embedding profiles with interactive features:
- Shows profile details in a card layout
- Provides edit and delete actions
- Manages delete confirmation state
- Handles profile deletion with error handling

### EmbeddingProfilesTab Component
The main tab component that orchestrates everything:
- Loads initial data on mount
- Manages UI state (showing form vs. list)
- Delegates form and list logic to sub-components
- Under 200 lines of code

## Usage

### Basic Import (for backward compatibility)
```tsx
import EmbeddingProfilesTab from '@/components/settings/embedding-profiles-tab'
```

### New Import Path
```tsx
import EmbeddingProfilesTab from '@/components/settings/embedding-profiles'

// Or import specific exports
import {
  type EmbeddingProfile,
  type ApiKey,
  useEmbeddingProfiles,
  ProfileModal,
  ProfileList,
  ProviderBadge,
} from '@/components/settings/embedding-profiles'
```

## File Size Metrics

| File | Lines | Purpose |
|------|-------|---------|
| types.ts | 81 | Type definitions and constants |
| useEmbeddingProfiles.ts | 157 | Data fetching hook |
| ProviderBadge.tsx | 23 | Provider badge display |
| ProfileForm.tsx | 389 | Legacy form component (deprecated) |
| ProfileModal.tsx | 392 | Modal form for create/edit |
| ProfileList.tsx | 238 | List display with edit/delete |
| index.tsx | 133 | Main tab component |
| **Total** | **1,413** | **Combined implementation** |

Note: ProfileForm and ProfileModal provide overlapping functionality with different UX patterns. ProfileModal is the current implementation used by the main tab component.

## Key Improvements

1. **Separation of Concerns**: Each file has a single, clear responsibility
2. **Reusability**: Components and hooks can be imported and used independently
3. **Testability**: Smaller, focused files are easier to unit test
4. **Maintainability**: Clear file organization and naming conventions
5. **TypeScript**: Full type safety throughout the module
6. **Backward Compatibility**: Original import path still works via wrapper export

## Dependencies

All components use the existing codebase patterns:
- `useFormState` hook for form management
- `useAsyncOperation` hook for async state handling
- `clientLogger` for debug logging
- Standard UI components from `@/components/ui`

## Logging

The module maintains comprehensive debug logging:
- Initial data loading
- Profile form submissions
- Profile edits and deletions
- Form cancellation and state changes

These logs can be viewed in `logs/combined.log` and are helpful for debugging during development.
