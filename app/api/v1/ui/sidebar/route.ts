/**
 * UI API v1 - Sidebar Data Endpoint
 *
 * GET /api/v1/ui/sidebar?type=characters - Get sidebar characters
 * GET /api/v1/ui/sidebar?type=chats - Get sidebar chats
 * GET /api/v1/ui/sidebar?type=projects - Get sidebar projects
 */

import { NextRequest } from 'next/server';
import { createAuthenticatedHandler } from '@/lib/api/middleware';
import { logger } from '@/lib/logger';
import { badRequest, serverError, successResponse } from '@/lib/api/responses';

// ============================================================================
// GET Handler
// ============================================================================

export const GET = createAuthenticatedHandler(async (req, context) => {
  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type') || 'characters';
  const { repos, user } = context;


  try {
    switch (type) {
      case 'characters':
        return handleCharacters(repos, user.id);
      case 'chats':
        return handleChats(repos, user.id);
      case 'projects':
        return handleProjects(repos, user.id);
      default:
        return badRequest(`Unknown type: ${type}. Valid types: characters, chats, projects`);
    }
  } catch (error) {
    logger.error('[UI Sidebar v1] Error getting sidebar data', { type }, error instanceof Error ? error : undefined);
    return serverError('Failed to fetch sidebar data');
  }
});

// ============================================================================
// Characters Handler
// ============================================================================

async function handleCharacters(repos: any, userId: string) {

  // Get all non-NPC, LLM-controlled characters (exclude user-controlled characters)
  let characters = await repos.characters.findByUserId(userId);
  characters = characters.filter((c: any) => !c.npc && c.controlledBy !== 'user');

  // Get chat counts for each character
  const chats = await repos.chats.findByUserId(userId);

  // Count chats per character
  const chatCounts = new Map<string, number>();
  for (const chat of chats) {
    const participants = chat.participants || [];
    for (const participant of participants) {
      if (participant.characterId) {
        const count = chatCounts.get(participant.characterId) || 0;
        chatCounts.set(participant.characterId, count + 1);
      }
    }
  }

  // Enrich characters with chat count and images
  const enrichedCharacters = await Promise.all(
    characters.map(async (character: any) => {
      // Get default image for character
      let defaultImage: string | null = null;
      if (character.avatarUrl) {
        defaultImage = character.avatarUrl;
      } else {
        // First, try to get the character's default image directly by ID
        let imageToUse = null;
        if (character.defaultImageId) {
          imageToUse = await repos.files.findById(character.defaultImageId);
        }
        // Fallback: search by linkedTo (for avatar tagged images)
        if (!imageToUse) {
          const images = await repos.files.findByLinkedTo(character.id);
          imageToUse = images.find((img: { tags?: string[] }) => img.tags?.includes('avatar'))
            || images[0]
            || null;
        }
        if (imageToUse) {
          defaultImage = `/api/v1/files/${imageToUse.id}`;
        }
      }

      return {
        id: character.id,
        name: character.name,
        avatarUrl: character.avatarUrl,
        defaultImage,
        isFavorite: character.isFavorite || false,
        chatCount: chatCounts.get(character.id) || 0,
        tags: character.tags || [],
      };
    })
  );

  // Sort: favorites first, then by chat count, then alphabetically
  enrichedCharacters.sort((a, b) => {
    // Favorites first
    if (a.isFavorite && !b.isFavorite) return -1;
    if (!a.isFavorite && b.isFavorite) return 1;

    // Then by chat count
    if (a.chatCount !== b.chatCount) {
      return b.chatCount - a.chatCount;
    }

    // Then alphabetically
    return a.name.localeCompare(b.name);
  });

  // Return top 10 characters
  const sidebarCharacters = enrichedCharacters.slice(0, 10);return successResponse({ characters: sidebarCharacters });
}

// ============================================================================
// Chats Handler
// ============================================================================

async function handleChats(repos: any, userId: string) {

  // Get all chats
  const chats = await repos.chats.findByUserId(userId);

  // Sort by updatedAt descending (most recent first)
  chats.sort((a: any, b: any) => {
    const aDate = new Date(a.updatedAt || a.createdAt).getTime();
    const bDate = new Date(b.updatedAt || b.createdAt).getTime();
    return bDate - aDate;
  });

  // Separate non-project and project chats BEFORE truncating
  // This ensures the chats section gets enough non-project chats
  // and the projects section gets enough project chats
  const nonProjectChats = chats.filter((c: any) => !c.projectId);
  const projectChats = chats.filter((c: any) => c.projectId);

  // Take top 15 non-project chats (chats section shows up to 10)
  // Take top 25 project chats (projects section shows ~5 projects × 5 chats)
  const selectedNonProjectChats = nonProjectChats.slice(0, 15);
  const selectedProjectChats = projectChats.slice(0, 25);

  // Combine for processing - non-project chats first to maintain sort order expectation
  const selectedChats = [...selectedNonProjectChats, ...selectedProjectChats];// Get character info for participants
  const characterIds = new Set<string>();
  for (const chat of selectedChats) {
    for (const participant of (chat.participants || [])) {
      if (participant.characterId) {
        characterIds.add(participant.characterId);
      }
    }
  }

  // Fetch all needed characters in one go
  const characterMap = new Map<string, { name: string; avatarUrl?: string | null; tags: string[] }>();
  for (const characterId of characterIds) {
    try {
      const character = await repos.characters.findById(characterId);
      if (character) {
        // Get avatar
        let avatarUrl = character.avatarUrl;
        if (!avatarUrl) {
          const images = await repos.files.findByLinkedTo(characterId);
          const avatarImage = images.find((img: { tags?: string[] }) => img.tags?.includes('avatar'));
          const anyImage = images[0];
          const imageToUse = avatarImage || anyImage;
          if (imageToUse) {
            avatarUrl = `/api/v1/files/${imageToUse.id}`;
          }
        }

        characterMap.set(characterId, {
          name: character.name,
          avatarUrl,
          tags: character.tags || [],
        });
      }
    } catch {
      // Character might have been deleted
    }
  }

  // Collect project IDs and fetch project info
  const projectIds = new Set<string>();
  for (const chat of selectedChats) {
    if (chat.projectId) {
      projectIds.add(chat.projectId);
    }
  }

  // Fetch all needed projects
  const projectMap = new Map<string, { name: string; color?: string | null }>();
  for (const projectId of projectIds) {
    try {
      const project = await repos.projects.findById(projectId);
      if (project) {
        projectMap.set(projectId, {
          name: project.name,
          color: project.color,
        });
      }
    } catch {
      // Project might have been deleted
    }
  }

  // Enrich chats with participant info
  const enrichedChats = selectedChats.map((chat: any) => {
    const participants = (chat.participants || [])
      .filter((p: any) => p.characterId && characterMap.has(p.characterId))
      .map((p: any) => {
        const character = characterMap.get(p.characterId!)!;
        return {
          id: p.characterId!,
          name: character.name,
          avatarUrl: character.avatarUrl,
        };
      });

    // Collect all tags from all character participants for quick-hide filtering
    const characterTags: string[] = [];
    for (const participant of (chat.participants || [])) {
      if (participant.characterId && characterMap.has(participant.characterId)) {
        const character = characterMap.get(participant.characterId)!;
        characterTags.push(...character.tags);
      }
    }

    // Get project info if chat belongs to a project
    const project = chat.projectId ? projectMap.get(chat.projectId) : null;

    return {
      id: chat.id,
      title: chat.title,
      updatedAt: chat.updatedAt || chat.createdAt,
      participants,
      characterTags: [...new Set(characterTags)], // Deduplicate
      messageCount: chat.messageCount || 0,
      projectId: chat.projectId || null,
      projectName: project?.name || null,
      projectColor: project?.color || null,
    };
  });return successResponse({ chats: enrichedChats });
}

// ============================================================================
// Projects Handler
// ============================================================================

async function handleProjects(repos: any, userId: string) {

  const projects = await repos.projects.findByUserId(userId);

  // Get counts for each project
  const allChats = await repos.chats.findByUserId(userId);
  const allFiles = await repos.files.findAll();
  const userFiles = allFiles.filter((f: any) => f.userId === userId);

  const enrichedProjects = projects.map((project: any) => {
    const chatCount = allChats.filter((c: any) => c.projectId === project.id).length;
    const fileCount = userFiles.filter((f: any) => f.projectId === project.id).length;

    return {
      id: project.id,
      name: project.name,
      color: project.color,
      icon: project.icon,
      chatCount,
      fileCount,
      characterCount: project.characterRoster?.length || 0,
      updatedAt: project.updatedAt,
    };
  });

  // Sort by most recently updated
  enrichedProjects.sort((a: any, b: any) => {
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });return successResponse({ projects: enrichedProjects });
}
