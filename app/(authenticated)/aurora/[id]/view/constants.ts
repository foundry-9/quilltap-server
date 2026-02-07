import { Tab } from '@/components/tabs'
import { TabIcons } from './tabIcons'

export const CHARACTER_TABS: Tab[] = [
  {
    id: 'details',
    label: 'Details',
    icon: TabIcons.details,
  },
  {
    id: 'system-prompts',
    label: 'System Prompts',
    icon: TabIcons.systemPrompts,
  },
  {
    id: 'conversations',
    label: 'Conversations',
    icon: TabIcons.conversations,
  },
  {
    id: 'memories',
    label: 'Memories',
    icon: TabIcons.memories,
  },
  {
    id: 'tags',
    label: 'Tags',
    icon: TabIcons.tags,
  },
  {
    id: 'profiles',
    label: 'Associated Profiles',
    icon: TabIcons.profiles,
  },
  {
    id: 'gallery',
    label: 'Photo Gallery',
    icon: TabIcons.gallery,
  },
  {
    id: 'descriptions',
    label: 'Appearance',
    icon: TabIcons.descriptions,
  },
]
