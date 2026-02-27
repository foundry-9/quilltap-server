# Tasks Queue Card Component

This directory contains a refactored version of the tasks queue management card split into focused, reusable modules.

## Files

- **types.ts** - TypeScript interfaces and types
  - `QueueStats` - Statistics about the queue
  - `ProcessorStatus` - Status of the queue processor
  - `JobDetail` - Details of a single job
  - `FullJobDetail` - Extended job details with payload
  - `QueueData` - Complete queue data structure

- **hooks/useTasksQueue.ts** - Custom hook for queue management
  - Handles all API calls for fetching and managing jobs
  - Manages loading, error, and job action states
  - Provides auto-refresh functionality

- **TaskItem.tsx** - Individual task list item component
  - Displays job status, metadata, and action buttons
  - Handles pause/resume/view/delete actions
  - Status color and icon rendering

- **TaskFilters.tsx** - Filter and control components
  - Refresh button
  - Queue start/stop controls
  - Auto-refresh toggle
  - Processor status indicator

- **TaskDetails.tsx** - Job details modal dialog
  - Shows complete job information
  - Displays error messages
  - Shows job payload (JSON)
  - Delete button

- **index.tsx** - Main component that orchestrates everything
  - Brings together all subcomponents
  - Manages overall layout and data flow

## Usage

```tsx
import { TasksQueueCard } from '@/components/tools/tasks-queue'

export function DashboardPage() {
  return <TasksQueueCard />
}
```

## Component Hierarchy

```
TasksQueueCard (index.tsx)
├── TaskFilters
├── Stats Display
├── TaskItem[] (mapped from data.jobs)
│   ├── Status Icon & Color
│   ├── Job Metadata
│   └── Action Buttons
└── TaskDetails (when dialog is open)
    ├── Job Metadata Grid
    ├── Error Display
    └── Payload Display
```

## State Management

All state is managed in the `useTasksQueue` hook:
- Queue data and stats
- Loading and error states
- Job selection and dialog state
- Auto-refresh settings
- Action loading states

## API Integration

- `GET /api/v1/system/jobs` - Fetch queue status and jobs
- `POST /api/v1/system/jobs` - Start/stop queue
- `GET /api/v1/system/jobs/{jobId}` - Fetch job details
- `PATCH /api/v1/system/jobs/{jobId}` - Pause/resume job
- `DELETE /api/v1/system/jobs/{jobId}` - Delete job
