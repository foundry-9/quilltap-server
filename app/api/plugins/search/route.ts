import { NextResponse } from 'next/server';
import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

const NPM_REGISTRY_SEARCH_URL = 'https://registry.npmjs.org/-/v1/search';

interface NpmSearchResult {
  name: string;
  version: string;
  description: string;
  author?: string;
  keywords?: string[];
  updated: string;
  score: number;
  links?: {
    npm?: string;
    homepage?: string;
    repository?: string;
  };
}

/**
 * Check if a package name is a valid Quilltap plugin
 * Matches both unscoped (qtap-plugin-*) and scoped (@org/qtap-plugin-*) packages
 */
function isQuilltapPlugin(name: string): boolean {
  // Unscoped: qtap-plugin-openai
  if (name.startsWith('qtap-plugin-')) {
    return true;
  }
  // Scoped: @quilltap/qtap-plugin-gab-ai, @myorg/qtap-plugin-custom
  if (name.startsWith('@') && name.includes('/qtap-plugin-')) {
    return true;
  }
  return false;
}

/**
 * Perform a single npm search query
 */
async function searchNpm(searchText: string): Promise<any[]> {
  const searchUrl = new URL(NPM_REGISTRY_SEARCH_URL);
  searchUrl.searchParams.set('text', searchText);
  searchUrl.searchParams.set('size', '50');

  const response = await fetch(searchUrl.toString(), {
    headers: {
      'Accept': 'application/json',
    },
    // Cache for 5 minutes to reduce npm requests
    next: { revalidate: 300 },
  });

  if (!response.ok) {
    logger.warn('npm search request failed', {
      context: 'plugins-search-npm',
      searchText,
      status: response.status,
    });
    return [];
  }

  const data = await response.json();
  return data.objects || [];
}

/**
 * GET /api/plugins/search
 * Search npm registry for Quilltap plugins
 */
export async function GET(req: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const query = searchParams.get('q') || '';

    logger.debug('Searching npm for plugins', {
      context: 'plugins-search-GET',
      query,
    });

    // Perform multiple searches to find both scoped and unscoped plugins
    // npm's search API does fuzzy matching, so we need specific queries
    const searchQueries = query.trim()
      ? [
          // Search for unscoped plugins with user query
          `qtap-plugin-${query.trim()}`,
          // Search for @quilltap scoped plugins with user query
          `@quilltap/ ${query.trim()}`,
        ]
      : [
          // Default: search for @quilltap scope (finds scoped plugins reliably)
          '@quilltap/',
          // Also search for unscoped plugins (qtap-plugin- prefix)
          'qtap-plugin-',
        ];

    // Run searches in parallel
    const searchPromises = searchQueries.map(q => searchNpm(q));
    const results = await Promise.all(searchPromises);

    // Combine and deduplicate results
    const allObjects = results.flat();
    const seenNames = new Set<string>();
    const uniqueObjects = allObjects.filter(obj => {
      const name = obj.package?.name;
      if (!name || seenNames.has(name)) return false;
      seenNames.add(name);
      return true;
    });

    // Filter to only qtap-plugin-* packages (both scoped and unscoped) and transform results
    const plugins: NpmSearchResult[] = uniqueObjects
      .filter((obj: { package: { name: string } }) =>
        obj.package?.name && isQuilltapPlugin(obj.package.name)
      )
      .map((obj: {
        package: {
          name: string;
          version: string;
          description?: string;
          author?: { name?: string } | string;
          publisher?: { username?: string };
          keywords?: string[];
          date?: string;
          links?: {
            npm?: string;
            homepage?: string;
            repository?: string;
          };
        };
        score?: { final?: number };
      }) => ({
        name: obj.package.name,
        version: obj.package.version,
        description: obj.package.description || 'No description available',
        author: typeof obj.package.author === 'string'
          ? obj.package.author
          : obj.package.author?.name || obj.package.publisher?.username || 'Unknown',
        keywords: obj.package.keywords || [],
        updated: obj.package.date || '',
        score: obj.score?.final || 0,
        links: obj.package.links,
      }));

    logger.info('npm search completed', {
      context: 'plugins-search-GET',
      query,
      resultCount: plugins.length,
    });

    return NextResponse.json({ plugins });

  } catch (error) {
    logger.error(
      'Plugin search failed',
      { context: 'plugins-search-GET' },
      error instanceof Error ? error : new Error(String(error))
    );
    return NextResponse.json(
      { error: 'Failed to search for plugins' },
      { status: 500 }
    );
  }
}
