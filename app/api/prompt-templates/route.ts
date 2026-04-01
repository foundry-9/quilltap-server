/**
 * Prompt Templates API
 *
 * GET /api/prompt-templates - List all templates (built-in + user's)
 * POST /api/prompt-templates - Create a new user template
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getRepositories } from '@/lib/mongodb/repositories';
import { getServerSession } from '@/lib/auth/session';
import { logger } from '@/lib/logger';

const createTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  content: z.string().min(1),
  description: z.string().max(500).optional(),
  category: z.string().optional(),
  modelHint: z.string().optional(),
});

export async function GET() {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Unauthorized access attempt to GET /api/prompt-templates');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    logger.debug('Fetching prompt templates for user', { userId: session.user.id });

    const repos = getRepositories();
    const templates = await repos.promptTemplates.findAllForUser(session.user.id);

    logger.debug('Retrieved prompt templates', { count: templates.length, userId: session.user.id });
    return NextResponse.json(templates);
  } catch (error) {
    logger.error('Error fetching prompt templates', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to fetch prompt templates' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const session = await getServerSession();
    if (!session?.user?.id) {
      logger.warn('Unauthorized access attempt to POST /api/prompt-templates');
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const validated = createTemplateSchema.parse(body);

    logger.debug('Creating prompt template', {
      userId: session.user.id,
      name: validated.name,
      category: validated.category,
    });

    const repos = getRepositories();
    const template = await repos.promptTemplates.create({
      userId: session.user.id,
      name: validated.name,
      content: validated.content,
      description: validated.description || null,
      isBuiltIn: false,
      category: validated.category || null,
      modelHint: validated.modelHint || null,
      tags: [],
    });

    logger.info('Prompt template created', {
      templateId: template.id,
      userId: session.user.id,
      name: validated.name,
    });

    return NextResponse.json(template, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      logger.warn('Invalid prompt template data', { errors: error.errors });
      return NextResponse.json({ error: error.errors }, { status: 400 });
    }
    logger.error('Error creating prompt template', {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: 'Failed to create prompt template' },
      { status: 500 }
    );
  }
}
