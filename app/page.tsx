import { getServerSession } from "@/lib/auth/session";
import { getRepositories } from "@/lib/repositories/factory";
import { getFilePath } from "@/lib/api/middleware/file-path";
import {
  WelcomeSection,
  QuickActionsRow,
  RecentChatsSection,
  ProjectsSection,
  CharactersSection,
} from "@/components/homepage";
import { enrichChatsForList, cleanEnrichedChats } from "@/lib/services/chat-enrichment.service";
import type { FileEntry } from "@/lib/schemas/types";
import type {
  RecentChat,
  HomepageProject,
  HomepageCharacter,
} from "@/components/homepage";

// Revalidate on every request
export const revalidate = 0;

export default async function Home() {
  const session = await getServerSession();

  // In single-user mode, session is always available
  const userId = session?.user?.id;
  const repos = getRepositories();

  // Get the user from the repository
  const user = userId
    ? await repos.users.findById(userId)
    : null;

  // Fetch data in parallel for the homepage sections
  const [allChatsRaw, allProjects, allCharacters, allFiles] = await Promise.all([
    // Recent chats - fetch all, will slice later
    userId
      ? repos.chats.findByUserId(userId)
      : [],
    // Projects - fetch all, will sort and slice later
    userId
      ? repos.projects.findByUserId(userId)
      : [],
    // Characters - all, will filter to favorites
    userId
      ? repos.characters.findByUserId(userId)
      : [],
    // Files - for project activity tracking
    userId
      ? repos.files.findAll()
      : [],
  ]);

  // Enrich chats with participant data using the enrichment service
  const enrichedChats = await enrichChatsForList(allChatsRaw, repos);
  const cleanedChats = cleanEnrichedChats(enrichedChats);

  // Get more chats than we'll display to account for quick-hide filtering
  // The component will limit display to 4 after filtering
  const recentEnrichedChats = cleanedChats.slice(0, 12);

  // Get the last chat ID for "Continue Last" button
  const lastChatId = recentEnrichedChats.length > 0 ? recentEnrichedChats[0].id : null;

  // Transform enriched chats to the homepage format
  const recentChats: RecentChat[] = recentEnrichedChats.map(chat => ({
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
    lastMessageAt: chat.lastMessageAt,
    storyBackgroundUrl: chat.storyBackground?.filepath || null,
    participants: chat.participants.map(p => ({
      id: p.id,
      type: p.type,
      isActive: p.isActive,
      displayOrder: p.displayOrder,
      character: p.character ? {
        id: p.character.id,
        name: p.character.name,
        avatarUrl: p.character.avatarUrl || undefined,
        defaultImageId: p.character.defaultImageId || undefined,
        defaultImage: p.character.defaultImage ? {
          id: p.character.defaultImage.id,
          filepath: p.character.defaultImage.filepath,
          url: p.character.defaultImage.url || undefined,
        } : null,
        tags: p.character.tags || [],
      } : null,
      persona: null, // Personas are now handled as user-controlled characters
    })),
    _count: {
      messages: chat._count.messages,
    },
  }));

  // Compute chat counts and most recent chat activity per project (using lastMessageAt)
  const projectChatStats = new Map<string, { count: number; lastMessageAt: Date | null }>();
  for (const chat of allChatsRaw) {
    if (chat.projectId) {
      const existing = projectChatStats.get(chat.projectId);
      // Use lastMessageAt for actual message activity, not metadata changes
      const chatLastMessage = chat.lastMessageAt ? new Date(chat.lastMessageAt) : null;
      if (existing) {
        existing.count++;
        if (chatLastMessage && (!existing.lastMessageAt || chatLastMessage > existing.lastMessageAt)) {
          existing.lastMessageAt = chatLastMessage;
        }
      } else {
        projectChatStats.set(chat.projectId, { count: 1, lastMessageAt: chatLastMessage });
      }
    }
  }

  // Compute most recent file activity per project
  const projectFileStats = new Map<string, { lastFileActivity: Date }>();
  for (const file of allFiles) {
    if (file.projectId) {
      const existing = projectFileStats.get(file.projectId);
      const fileUpdated = new Date(file.updatedAt);
      if (existing) {
        if (fileUpdated > existing.lastFileActivity) {
          existing.lastFileActivity = fileUpdated;
        }
      } else {
        projectFileStats.set(file.projectId, { lastFileActivity: fileUpdated });
      }
    }
  }

  // Transform projects to the homepage format, sorted by most recent activity
  // Activity = max of: file updatedAt, chat lastMessageAt, project updatedAt
  // Pass more than needed to account for variable card height
  const sortedProjects = [...allProjects]
    .sort((a, b) => {
      const aChatStats = projectChatStats.get(a.id);
      const aFileStats = projectFileStats.get(a.id);
      const bChatStats = projectChatStats.get(b.id);
      const bFileStats = projectFileStats.get(b.id);

      // Get the most recent activity timestamp for each project
      const aProjectTime = new Date(a.updatedAt).getTime();
      const aChatTime = aChatStats?.lastMessageAt?.getTime() ?? 0;
      const aFileTime = aFileStats?.lastFileActivity?.getTime() ?? 0;
      const aTime = Math.max(aProjectTime, aChatTime, aFileTime);

      const bProjectTime = new Date(b.updatedAt).getTime();
      const bChatTime = bChatStats?.lastMessageAt?.getTime() ?? 0;
      const bFileTime = bFileStats?.lastFileActivity?.getTime() ?? 0;
      const bTime = Math.max(bProjectTime, bChatTime, bFileTime);

      return bTime - aTime;
    })
    .slice(0, 12);

  const projects: HomepageProject[] = sortedProjects.map(project => {
    // Compute the last activity timestamp (same logic as sorting)
    const chatStats = projectChatStats.get(project.id);
    const fileStats = projectFileStats.get(project.id);
    const projectTime = new Date(project.updatedAt).getTime();
    const chatTime = chatStats?.lastMessageAt?.getTime() ?? 0;
    const fileTime = fileStats?.lastFileActivity?.getTime() ?? 0;
    const lastActivityTime = Math.max(projectTime, chatTime, fileTime);

    return {
      id: project.id,
      name: project.name,
      description: project.description,
      color: project.color,
      icon: project.icon,
      chatCount: chatStats?.count ?? 0,
      lastActivity: new Date(lastActivityTime).toISOString(),
    };
  });

  // Compute chat counts per character from existing chat data
  const characterChatCounts = new Map<string, number>();
  for (const chat of allChatsRaw) {
    for (const participant of chat.participants) {
      if (participant.characterId) {
        const current = characterChatCounts.get(participant.characterId) ?? 0;
        characterChatCounts.set(participant.characterId, current + 1);
      }
    }
  }

  // Get AI-controlled characters only (exclude NPCs and user-controlled characters)
  // Sorted like the /characters page:
  // 1. Favorites first
  // 2. Chat count descending
  // 3. Alphabetically by name
  const sortedCharacters = allCharacters
    .filter(c => !c.npc && c.controlledBy !== 'user')
    .sort((a, b) => {
      // Favorites first
      if (a.isFavorite !== b.isFavorite) {
        return a.isFavorite ? -1 : 1;
      }
      // Then by chat count (descending)
      const aChats = characterChatCounts.get(a.id) ?? 0;
      const bChats = characterChatCounts.get(b.id) ?? 0;
      if (aChats !== bChats) {
        return bChats - aChats;
      }
      // Then alphabetically
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    })
    .slice(0, 24);

  // Add default images to sorted characters
  const homepageCharacters: HomepageCharacter[] = await Promise.all(
    sortedCharacters.map(async (char) => {
      // Get the default image for this character
      let defaultImage = null;
      let defaultImageId = null;

      // First, try to get the character's default image directly by ID
      let defaultImg: FileEntry | null = null;
      if (char.defaultImageId) {
        defaultImg = await repos.files.findById(char.defaultImageId);
      }

      // Fallback: search by linkedTo (for avatar tagged images)
      if (!defaultImg) {
        const images = await repos.files.findByLinkedTo(char.id);
        defaultImg = images.find((img: FileEntry) => img.tags?.includes('avatar'))
          || images[0]
          || null;
      }

      if (defaultImg) {
        defaultImageId = defaultImg.id;
        defaultImage = {
          id: defaultImg.id,
          filepath: getFilePath(defaultImg),
          url: null,
        };
      }

      return {
        id: char.id,
        name: char.name,
        title: char.title || null,
        avatarUrl: char.avatarUrl || null,
        defaultImageId,
        defaultImage,
        tags: char.tags || [],
        isFavorite: char.isFavorite ?? false,
        npc: char.npc ?? false,
        chatCount: characterChatCounts.get(char.id) ?? 0,
      };
    })
  );

  const displayName = user?.name || session?.user?.name || 'there';

  return (
    <div className="qt-homepage-container">
      {/* Welcome section */}
      <WelcomeSection displayName={displayName} />

      {/* Quick action buttons */}
      <QuickActionsRow lastChatId={lastChatId} />

      {/* Three-column grid - fills remaining space */}
      <div className="qt-homepage-grid">
        {/* Recent Chats */}
        <RecentChatsSection chats={recentChats} />

        {/* Active Projects */}
        <ProjectsSection projects={projects} />

        {/* Characters */}
        <CharactersSection characters={homepageCharacters} />
      </div>
    </div>
  );
}
