import Link from "next/link";
import { getServerSession } from "@/lib/auth/session";
import { getRepositories } from "@/lib/repositories/factory";
import { BrandLogo } from "@/components/ui/brand-logo";
import { FavoriteCharactersSection } from "@/components/dashboard/favorite-characters";
import { getFilePath } from "@/lib/api/middleware/file-path";
import type { FileEntry } from "@/lib/schemas/types";

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

  // Get favorite characters for this user
  const allCharacters = userId
    ? await repos.characters.findByUserId(userId)
    : [];

  // Filter to favorites and add default images
  const favoriteCharacters = await Promise.all(
    allCharacters
      .filter(c => c.isFavorite && !c.npc)
      .slice(0, 10)
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
    <div className="qt-page-container max-w-[800px] mx-auto">
      {/* Welcome section */}
      <div className="text-center py-8">
        <h1 className="text-3xl font-bold mb-2">
          Welcome back, <span className="text-primary">{displayName}</span>!
        </h1>
        <p className="text-muted-foreground">
          What would you like to do today?
        </p>
      </div>

      {/* Start Chat button */}
      <div className="flex justify-center mb-8">
        <Link
          href="/chats/new"
          className="qt-button qt-button-primary qt-button-lg gap-2"
        >
          <svg
            className="w-5 h-5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="10" y1="10" x2="14" y2="10" />
          </svg>
          Start a Chat
        </Link>
      </div>

      {/* Favorite characters */}
      {favoriteCharacters.length > 0 && (
        <FavoriteCharactersSection characters={favoriteCharacters} />
      )}

      {/* Empty state if no favorites */}
      {favoriteCharacters.length === 0 && (
        <div className="qt-card p-8 text-center">
          <h2 className="text-xl font-semibold mb-2">No favorites yet</h2>
          <p className="text-muted-foreground mb-4">
            Mark some characters as favorites to see them here.
          </p>
          <Link
            href="/characters"
            className="qt-button qt-button-secondary"
          >
            Browse Characters
          </Link>
        </div>
      )}
    </div>
  );
}
