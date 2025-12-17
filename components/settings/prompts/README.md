# Prompts Tab Components

This directory contains the refactored components for the Prompts settings tab.

## File Structure

- **types.ts** - TypeScript interfaces and constants for prompt templates
- **hooks/usePrompts.ts** - Custom hook for managing prompt templates data and operations
- **PromptCard.tsx** - Individual prompt card display component
- **PromptList.tsx** - List container for prompt cards with empty state
- **PromptModal.tsx** - Modal for creating/editing prompts
- **PreviewModal.tsx** - Modal for previewing prompt content
- **index.tsx** - Main PromptsTab component that orchestrates all sub-components

## Architecture

The refactored structure follows these principles:

1. **Separation of Concerns**: Each component has a single, focused responsibility
2. **Custom Hook**: `usePrompts` handles all data fetching, state management, and API calls
3. **Presentational Components**: Card, List, and Modal components are purely presentational
4. **Main Component**: `PromptsTab` (index.tsx) orchestrates the sub-components with modal and preview state

## Usage

```tsx
import PromptsTab from '@/components/settings/prompts'

export default function SettingsPage() {
  return <PromptsTab />
}
```

## Component Responsibilities

- **PromptCard**: Renders a single template with actions (preview, copy, edit, delete)
- **PromptList**: Renders a collection of templates with section header and empty state
- **PromptModal**: Form for creating/editing templates with markdown preview
- **PreviewModal**: Display-only modal for viewing template content
- **usePrompts**: Fetching, saving, deleting, and clipboard operations
