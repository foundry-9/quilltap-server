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

    // Build search URL - search for packages with qtap-plugin prefix
    const searchUrl = new URL(NPM_REGISTRY_SEARCH_URL);
    // If user provides a query, append it to our prefix search
    const searchText = query.trim()
      ? `qtap-plugin-${query.trim()}`
      : 'qtap-plugin-';
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
      logger.error('npm search request failed', {
        context: 'plugins-search-GET',
        status: response.status,
        statusText: response.statusText,
      });
      return NextResponse.json(
        { error: 'Failed to search npm registry' },
        { status: 502 }
      );
    }

    const data = await response.json();

    // Filter to only qtap-plugin-* packages and transform results
    const plugins: NpmSearchResult[] = (data.objects || [])
      .filter((obj: { package: { name: string } }) =>
        obj.package?.name?.startsWith('qtap-plugin-')
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
