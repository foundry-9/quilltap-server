import { getServerSession } from "@/lib/auth/session";
import { getUserRepositories, getRepositories } from "@/lib/repositories/factory";
import Link from "next/link";
import { RecentChatsSection } from "@/components/dashboard/recent-chats";
import { FavoriteCharactersSection } from "@/components/dashboard/favorite-characters";
import { TwoFactorPrompt } from "@/components/auth/TwoFactorPrompt";
import type { FileEntry } from "@/lib/schemas/types";

/**
 * Get the filepath for a file based on storage type
 */
function getFilePath(file: FileEntry): string {
  if (file.s3Key) {
    return `/api/files/${file.id}`;
  }
  const ext = file.originalFilename.includes('.')
    ? file.originalFilename.substring(file.originalFilename.lastIndexOf('.'))
    : '';
  return `data/files/storage/${file.id}${ext}`;
}

// Revalidate dashboard on every request to show latest character data
export const revalidate = 0;

export default async function Dashboard() {
  const session = await getServerSession();
  const userId = session?.user?.id;

  // Use user-scoped repositories for automatic userId filtering
  const repos = userId ? getUserRepositories(userId) : null;
  // Keep base repos for user lookup (users aren't scoped)
  const baseRepos = getRepositories();

  // Get the user from the repository
  const user = userId
    ? await baseRepos.users.findById(userId)
    : null;

  // Get all characters, chats, and personas for counts (automatically scoped to user)
  const [allCharacters, allChats, allPersonas] = await Promise.all([
    repos ? repos.characters.findAll() : Promise.resolve([]),
    repos ? repos.chats.findAll() : Promise.resolve([]),
    repos ? repos.personas.findAll() : Promise.resolve([]),
  ]);

  // Count items (now properly filtered by user)
  const charactersCount = allCharacters.length;
  const chatsCount = allChats.length;
  const personasCount = allPersonas.length;

  // Get favorite characters
  const favoriteCharacters = repos
    ? await Promise.all(
        allCharacters
          .filter((c) => c.isFavorite)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .map(async (character) => {
            // Get default image from repository if exists
            let defaultImage = null;
            if (character.defaultImageId) {
              const fileEntry = await repos.files.findById(character.defaultImageId);
              if (fileEntry) {
                defaultImage = {
                  id: fileEntry.id,
                  filepath: getFilePath(fileEntry),
                  url: null,
                };
              }
            }
            return {
              id: character.id,
              name: character.name,
              title: character.title ?? null,
              avatarUrl: character.avatarUrl ?? null,
              defaultImageId: character.defaultImageId ?? null,
              defaultImage,
              tags: character.tags ?? [],
            };
          })
      )
    : [];

  // Get recent chats (5 most recent, ordered by updatedAt)
  const allRecentChats: Array<{
    id: string
    title: string
    updatedAt: string
    messageCount: number
    characters: Array<{
      id: string
      name: string
      avatarUrl: string | null
      defaultImageId: string | null
      defaultImage: { id: string; filepath: string; url: null } | null
    }>
    persona: { id: string; name: string; title?: string | null } | null
    tags: Array<{ tag: { id: string; name: string } }>
  } | null> = repos
    ? await Promise.all(
        [...allChats]
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
          .slice(0, 5)
          .map(async (chat) => {
            // Get all active character participants, sorted by displayOrder
            const characterParticipants = chat.participants
              .filter(p => p.type === 'CHARACTER' && p.characterId && p.isActive !== false)
              .sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));

            if (characterParticipants.length === 0) return null;

            // Fetch all characters with their images
            const characters = await Promise.all(
              characterParticipants.map(async (participant) => {
                const character = await repos.characters.findById(participant.characterId!);
                if (!character) return null;

                let defaultImage = null;
                if (character.defaultImageId) {
                  const fileEntry = await repos.files.findById(character.defaultImageId);
                  if (fileEntry) {
                    defaultImage = {
                      id: fileEntry.id,
                      filepath: getFilePath(fileEntry),
                      url: null,
                    };
                  }
                }

                return {
                  id: character.id,
                  name: character.name,
                  avatarUrl: character.avatarUrl ?? null,
                  defaultImageId: character.defaultImageId ?? null,
                  defaultImage,
                };
              })
            );

            const validCharacters = characters.filter((c): c is NonNullable<typeof c> => c !== null);
            if (validCharacters.length === 0) return null;

            // Get persona data from participants if present
            let persona = null;
            const personaParticipant = chat.participants.find(
              p => p.type === 'PERSONA' && p.personaId
            );
            if (personaParticipant?.personaId) {
              const personaData = await repos.personas.findById(personaParticipant.personaId);
              if (personaData) {
                persona = {
                  id: personaData.id,
                  name: personaData.name,
                  title: personaData.title ?? null,
                };
              }
            }

            // Get tags
            const tagData = await Promise.all(
              chat.tags.map(async (tagId) => {
                const tag = await repos.tags.findById(tagId);
                return tag ? { tag: { id: tag.id, name: tag.name } } : null;
              })
            );

            return {
              id: chat.id,
              title: chat.title,
              updatedAt: chat.updatedAt,
              messageCount: chat.messageCount || 0,
              characters: validCharacters,
              persona,
              tags: tagData.filter((tag): tag is { tag: { id: string; name: string } } => tag !== null),
            };
          })
      )
    : [];

  const recentChats = allRecentChats.filter((chat) => chat !== null);

  return (
    <div className="container mx-auto px-4 pt-4 pb-4 flex flex-col max-w-[800px] h-full overflow-hidden">
      <div className="flex-1 flex flex-col min-h-0">
        {/* 2FA Setup Prompt */}
        <TwoFactorPrompt />

        {/* Show favorite characters section if there are any favorites */}
        {favoriteCharacters.length > 0 ? (
          <FavoriteCharactersSection characters={favoriteCharacters} />
        ) : (
          <div className="mb-8">
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Welcome, {session?.user?.name || "User"}!
            </h1>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              Your AI-powered roleplay chat platform
            </p>
          </div>
        )}

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mt-8">
        {/* Characters Card */}
        <Link href="/characters">
          <div className="dashboard-card h-full flex flex-col rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm dark:shadow-lg hover:border-blue-500 hover:shadow-md dark:hover:border-blue-500 dark:hover:shadow-md transition-all cursor-pointer">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Characters</h2>
              <span className="dashboard-badge rounded-full bg-blue-100 dark:bg-blue-900 px-3 py-1 text-sm font-medium text-blue-800 dark:text-blue-200">
                {charactersCount}
              </span>
            </div>
            <p className="flex-1 text-sm text-gray-600 dark:text-gray-400">
              Create and manage your AI characters
            </p>
          </div>
        </Link>

        {/* Chats Card */}
        <Link href="/chats">
          <div className="dashboard-card h-full flex flex-col rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm dark:shadow-lg hover:border-green-500 hover:shadow-md dark:hover:border-green-500 dark:hover:shadow-md transition-all cursor-pointer">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Chats</h2>
              <span className="dashboard-badge rounded-full bg-green-100 dark:bg-green-900 px-3 py-1 text-sm font-medium text-green-800 dark:text-green-200">
                {chatsCount}
              </span>
            </div>
            <p className="flex-1 text-sm text-gray-600 dark:text-gray-400">
              Start conversations with your characters
            </p>
          </div>
        </Link>

        {/* Personas Card */}
        <Link href="/personas">
          <div className="dashboard-card h-full flex flex-col rounded-lg border border-gray-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-6 shadow-sm dark:shadow-lg hover:border-purple-500 hover:shadow-md dark:hover:border-purple-500 dark:hover:shadow-md transition-all cursor-pointer">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Personas</h2>
              <span className="dashboard-badge rounded-full bg-purple-100 dark:bg-purple-900 px-3 py-1 text-sm font-medium text-purple-800 dark:text-purple-200">
                {personasCount}
              </span>
            </div>
            <p className="flex-1 text-sm text-gray-600 dark:text-gray-400">
              Manage your user personas
            </p>
          </div>
        </Link>
      </div>

        {/* Recent Chats */}
        <RecentChatsSection chats={recentChats} />
      </div>
    </div>
  );
}
