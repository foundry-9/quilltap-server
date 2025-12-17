# System Prompts Module

This module handles the management of system prompts for characters. It provides a complete UI for creating, editing, importing, previewing, and deleting system prompts.

## Structure

- **types.ts** - TypeScript interfaces and types for system prompts
- **hooks/useSystemPrompts.ts** - Custom hook for data fetching and state management
- **PromptEditor.tsx** - Modal component for creating/editing prompts
- **PromptList.tsx** - Component displaying list of prompts with action buttons
- **ImportModal.tsx** - Modal for importing prompts from templates
- **PreviewModal.tsx** - Modal for previewing prompt content
- **index.tsx** - Main component that orchestrates all subcomponents

## Usage

```tsx
import { SystemPromptsEditor } from '@/components/characters/system-prompts'

export function CharacterSettings() {
  return (
    <SystemPromptsEditor
      characterId="char-123"
      characterName="Alice"
      onUpdate={() => console.log('Updated')}
    />
  )
}
```

## Features

- Create new system prompts
- Edit existing prompts
- Delete prompts (with confirmation)
- Set default prompt
- Preview prompts with markdown rendering
- Import from templates and sample prompts
- Form validation and error handling
- Loading states and success messages
- Debug logging throughout

## API Endpoints Used

- `GET /api/characters/:id/prompts` - Fetch prompts
- `POST /api/characters/:id/prompts` - Create prompt
- `PUT /api/characters/:id/prompts/:promptId` - Update prompt
- `DELETE /api/characters/:id/prompts/:promptId` - Delete prompt
- `GET /api/prompt-templates` - Fetch templates
- `GET /api/sample-prompts` - Fetch sample prompts
