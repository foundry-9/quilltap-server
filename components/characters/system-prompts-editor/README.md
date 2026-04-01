# System Prompts Editor

A modular, refactored component for managing character system prompts in Quilltap.

## Structure

The component has been refactored from a single 681-line file into a well-organized module:

```
system-prompts-editor/
├── index.tsx              # Main component (116 lines)
├── types.ts               # Type definitions (48 lines)
├── PromptList.tsx         # List display component (152 lines)
├── PromptModal.tsx        # Create/Edit modal (132 lines)
├── ImportModal.tsx        # Import from templates modal (115 lines)
├── PreviewModal.tsx       # Preview prompt modal (68 lines)
├── hooks/
│   └── useSystemPrompts.ts # Main hook logic (311 lines)
└── README.md              # This file
```

All files are under 500 lines, making them easy to maintain and test.

## Components

### index.tsx
Main export component that orchestrates the UI using the hook and sub-components.

**Usage:**
```tsx
import { SystemPromptsEditor } from '@/components/characters/SystemPromptsEditor'

<SystemPromptsEditor
  characterId="char-123"
  characterName="Alice"
  onUpdate={() => console.log('Updated')}
/>
```

### PromptList.tsx
Displays the list of system prompts with action buttons (preview, edit, set default, delete).

### PromptModal.tsx
Modal for creating and editing system prompts with markdown preview support.

### ImportModal.tsx
Modal for importing prompts from templates and sample prompts.

### PreviewModal.tsx
Modal for previewing a system prompt with markdown rendering.

## Hook: useSystemPrompts

Located in `hooks/useSystemPrompts.ts`, this custom hook manages all the state and API interactions.

**Features:**
- Fetches character prompts and templates
- Manages modal states
- Handles create, update, delete operations
- Manages form data and preview states
- Provides comprehensive logging via clientLogger

**Return type: UseSystemPromptsReturn**
```tsx
{
  // Data
  prompts: CharacterSystemPrompt[]
  templates: PromptTemplate[]

  // Loading states
  loading: boolean
  loadingTemplates: boolean
  saving: boolean
  error: string | null
  success: string | null

  // Modal states
  isModalOpen: boolean
  editingPrompt: CharacterSystemPrompt | null
  formData: PromptFormData
  showPreview: boolean
  previewPrompt: CharacterSystemPrompt | null
  deleteConfirm: string | null
  showImportModal: boolean

  // Methods for data fetching, modal control, and API operations
}
```

## Types

Located in `types.ts`:

```tsx
interface CharacterSystemPrompt {
  id: string
  name: string
  content: string
  isDefault: boolean
  createdAt: string
  updatedAt: string
}

interface PromptTemplate {
  id: string
  name: string
  content: string
  description: string | null
  isBuiltIn: boolean
  category: string | null
  modelHint: string | null
}

interface SystemPromptsEditorProps {
  characterId: string
  characterName: string
  onUpdate?: () => void
}

interface PromptFormData {
  name: string
  content: string
  isDefault: boolean
}
```

## API Endpoints

- `GET /api/v1/characters/:characterId/prompts` - Fetch character prompts
- `POST /api/v1/characters/:characterId/prompts` - Create prompt
- `PUT /api/v1/characters/:characterId/prompts/:promptId` - Update prompt
- `DELETE /api/v1/characters/:characterId/prompts/:promptId` - Delete prompt
- `GET /api/v1/prompt-templates` - Fetch prompt templates (built-in samples + user-created)

## Logging

The component uses `clientLogger` for comprehensive debugging:

- `debug`: Fetched data
- `info`: Successful operations (create, update, delete)
- `error`: API and operation failures

## Styling

All components use `qt-*` Tailwind utility classes for consistent theming and maintainability. See the qt-utility-classes configuration in the theme system.

## Migration

This component maintains backward compatibility. The old `SystemPromptsEditor.tsx` file now simply re-exports from this module:

```tsx
export { SystemPromptsEditor } from './system-prompts-editor'
```

## Testing

Each component can be tested independently:
- `PromptList` - Test list rendering and interactions
- `PromptModal` - Test form submission and validation
- `ImportModal` - Test template selection
- `PreviewModal` - Test markdown rendering
- `useSystemPrompts` - Test state management and API calls

## Performance Considerations

- Modal components are conditionally rendered only when needed
- Template fetching is lazy-loaded on import modal open
- Form data is managed efficiently through the hook
- All API calls include proper error handling and logging
