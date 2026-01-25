import Link from "next/link";
import { getServerSession } from "@/lib/auth/session";
import { getRepositories } from "@/lib/repositories/factory";
import { BrandLogo } from "@/components/ui/brand-logo";
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

  // Show landing page for unauthenticated users
  if (!session) {
    return (
      <main className="qt-auth-page p-24">
        <div className="text-center">
          <h1 className="text-white mb-4 flex flex-col items-center">
            <span className="sr-only">Welcome to Quilltap</span>
            <span className="text-2xl font-medium mb-2 qt-font-brand">Welcome to</span>
            <BrandLogo size="xl" />
          </h1>
          <p className="text-xl mb-8 qt-font-brand">
            AI-powered roleplay chat platform with multi-provider support
          </p>
          <div className="flex gap-4 justify-center">
            <Link
              href="/auth/signin"
              className="qt-button qt-button-primary qt-button-lg shadow-lg"
            >
              Get Started
            </Link>
            <a
              href="https://github.com/foundry-9/quilltap"
              target="_blank"
              rel="noopener noreferrer"
              className="qt-button qt-button-secondary qt-button-lg shadow-lg"
            >
              Learn More
            </a>
          </div>
        </div>
      </main>
    );
  }

  // Authenticated user home page
  const userId = session.user?.id;
  const repos = getRepositories();

  // Get the user from the repository
  const user = userId
    ? await repos.users.findById(userId)
    : null;

  // Fetch data in parallel for the homepage sections
  const [allChatsRaw, allProjects, allCharacters] = await Promise.all([
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
  ]);

  // Enrich chats with participant data using the enrichment service
  const enrichedChats = await enrichChatsForList(allChatsRaw, repos);
  const cleanedChats = cleanEnrichedChats(enrichedChats);

  // Get the 4 most recent chats
  const recentEnrichedChats = cleanedChats.slice(0, 4);

  // Get the last chat ID for "Continue Last" button
  const lastChatId = recentEnrichedChats.length > 0 ? recentEnrichedChats[0].id : null;

  // Transform enriched chats to the homepage format
  const recentChats: RecentChat[] = recentEnrichedChats.map(chat => ({
    id: chat.id,
    title: chat.title,
    updatedAt: chat.updatedAt,
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

  // Compute chat counts and most recent chat activity per project
  const projectChatStats = new Map<string, { count: number; lastActivity: Date }>();
  for (const chat of allChatsRaw) {
    if (chat.projectId) {
      const existing = projectChatStats.get(chat.projectId);
      const chatUpdated = new Date(chat.updatedAt);
      if (existing) {
        existing.count++;
        if (chatUpdated > existing.lastActivity) {
          existing.lastActivity = chatUpdated;
        }
      } else {
        projectChatStats.set(chat.projectId, { count: 1, lastActivity: chatUpdated });
      }
    }
  }

  // Transform projects to the homepage format, sorted by most recent chat activity
  const sortedProjects = [...allProjects]
    .sort((a, b) => {
      const aStats = projectChatStats.get(a.id);
      const bStats = projectChatStats.get(b.id);
      // Projects with chat activity come first, sorted by last activity
      // Projects without chats fall back to their updatedAt
      const aTime = aStats?.lastActivity?.getTime() ?? new Date(a.updatedAt).getTime();
      const bTime = bStats?.lastActivity?.getTime() ?? new Date(b.updatedAt).getTime();
      return bTime - aTime;
    })
    .slice(0, 4);

  const projects: HomepageProject[] = sortedProjects.map(project => ({
    id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    icon: project.icon,
    chatCount: projectChatStats.get(project.id)?.count ?? 0,
    updatedAt: project.updatedAt,
  }));

  // Filter to favorites and add default images
  const favoriteCharacters: HomepageCharacter[] = await Promise.all(
    allCharacters
      .filter(c => c.isFavorite && !c.npc)
      .slice(0, 4)
      .map(async (char) => {
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
        };
      })
  );

  const displayName = user?.name || session.user?.name || 'there';

  return (
    <div className="qt-page-container max-w-6xl mx-auto">
      {/* Welcome section */}
      <WelcomeSection displayName={displayName} />

      {/* Quick action buttons */}
      <QuickActionsRow lastChatId={lastChatId} />

      {/* Three-column grid */}
      <div className="qt-homepage-grid">
        {/* Recent Chats */}
        <RecentChatsSection chats={recentChats} />

        {/* Active Projects */}
        <ProjectsSection projects={projects} />

        {/* Favorite Characters */}
        <CharactersSection characters={favoriteCharacters} />
      </div>
    </div>
  );
}
