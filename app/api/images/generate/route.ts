/**
 * Image Generation API Route
 * Phase 3: Image Generation Endpoint
 *
 * POST /api/images/generate - Generate images using LLM providers
 */

import { NextResponse } from 'next/server'
import { createAuthenticatedHandler } from '@/lib/api/middleware'
import { decryptApiKey } from '@/lib/encryption'
import { createLLMProvider } from '@/lib/llm'
import { logger } from '@/lib/logger'
import { createHash } from 'crypto'
import { z } from 'zod'
import { uploadFile as uploadS3File } from '@/lib/s3/operations'
import { buildS3Key } from '@/lib/s3/client'
import { getInheritedTags } from '@/lib/files/tag-inheritance'
import type { FileCategory, FileSource } from '@/lib/schemas/types'

const generateImageSchema = z.object({
  prompt: z.string().min(1).max(4000),
  profileId: z.string().uuid(),
  tags: z
    .array(
      z.object({
        tagType: z.enum(['CHARACTER', 'PERSONA', 'CHAT', 'THEME']),
        tagId: z.string(),
      })
    )
    .optional(),
  options: z
    .object({
      n: z.number().int().min(1).max(10).optional(),
      size: z.string().optional(),
      quality: z.enum(['standard', 'hd']).optional(),
      style: z.enum(['vivid', 'natural']).optional(),
      aspectRatio: z.string().optional(),
    })
    .optional(),
})

/**
 * POST /api/images/generate
 * Generate images using a connection profile's configured provider
 *
 * Body: {
 *   prompt: string
 *   profileId: string (uuid of connection profile)
 *   tags?: Array<{ tagType: 'CHARACTER' | 'PERSONA' | 'CHAT' | 'THEME', tagId: string }>
 *   options?: {
 *     n?: number (1-10)
 *     size?: string
 *     quality?: 'standard' | 'hd'
 *     style?: 'vivid' | 'natural'
 *     aspectRatio?: string
 *   }
 * }
 */
export const POST = createAuthenticatedHandler(async (request, { user, repos }) => {
  try {
    // Validate request body
    const body = await request.json()
    const { prompt, profileId, tags, options = {} } = generateImageSchema.parse(body)

    // Load and validate connection profile
    const profile = await repos.connections.findById(profileId)

    if (!profile || profile.userId !== user.id) {
      return NextResponse.json(
        { error: 'Connection profile not found' },
        { status: 404 }
      )
    }

    // Get API key if profile has one
    let decryptedKey = ''
    if (profile.apiKeyId) {
      const apiKey = await repos.connections.findApiKeyById(profile.apiKeyId)
      if (apiKey) {
        decryptedKey = decryptApiKey(
          apiKey.ciphertext,
          apiKey.iv,
          apiKey.authTag,
          user.id
        )
      }
    }

    // Create provider instance
    const provider = await createLLMProvider(profile.provider as any, profile.baseUrl ?? undefined)

    // Verify provider supports image generation
    if (!provider.supportsImageGeneration) {
      return NextResponse.json(
        { error: `${profile.provider} provider does not support image generation` },
        { status: 400 }
      )
    }

    // Debug log: Image generation request
    const imageGenRequest = {
      prompt,
      model: profile.modelName,
      n: options.n,
      size: options.size,
      quality: options.quality,
      style: options.style,
      aspectRatio: options.aspectRatio,
    }
    logger.debug('[Image Generation Request] images/generate/route.ts:POST', {
      context: 'llm-api',
      provider: profile.provider,
      model: profile.modelName,
      promptLength: prompt.length,
      request: JSON.stringify(imageGenRequest),
    })

    // Generate images
    const imageGenResponse = await provider.generateImage(imageGenRequest, decryptedKey)

    // Debug log: Image generation response
    logger.debug('[Image Generation Response] images/generate/route.ts:POST', {
      context: 'llm-api',
      provider: profile.provider,
      model: profile.modelName,
      imageCount: imageGenResponse.images.length,
      imageSizes: imageGenResponse.images.map(img => img.data.length),
    })

    // Save generated images to S3 and create database records
    const savedImages = await Promise.all(
      imageGenResponse.images.map(async (generatedImage, index) => {
        // Decode base64 to buffer
        const imageBuffer = Buffer.from(generatedImage.data, 'base64')

        // Get file extension from mime type
        const mimeTypeParts = generatedImage.mimeType.split('/')
        const ext = mimeTypeParts[1] === 'jpeg' ? 'jpg' : mimeTypeParts[1] || 'png'

        // Generate unique filename and hash
        const sha256 = createHash('sha256').update(new Uint8Array(imageBuffer)).digest('hex')
        const shortHash = sha256.substring(0, 8)
        const filename = `generated_${Date.now()}_${index}_${shortHash}.${ext}`

        // Generate a new file ID
        const fileId = crypto.randomUUID()
        const category: FileCategory = 'IMAGE'
        const source: FileSource = 'GENERATED'

        // Build linkedTo from tags (entity IDs)
        const linkedTo = tags?.map(t => t.tagId) || []

        // Upload to S3
        const s3Key = buildS3Key(user.id, fileId, filename, category)
        await uploadS3File(s3Key, imageBuffer, generatedImage.mimeType, {
          userId: user.id,
          fileId,
          category,
          filename,
          sha256,
        })
        logger.debug('Uploaded generated image to S3', { fileId, s3Key, size: imageBuffer.length })

        // Inherit tags from linked entities
        const inheritedTags = await getInheritedTags(linkedTo, user.id)

        logger.debug('Inherited tags for generated image', {
          context: 'images-generate',
          fileIndex: index,
          linkedTo,
          inheritedTagCount: inheritedTags.length,
        })

        // Create database record using files repository (FileEntry format)
        const file = await repos.files.create({
          sha256,
          userId: user.id,
          originalFilename: filename,
          mimeType: generatedImage.mimeType,
          size: imageBuffer.length,
          source,
          category,
          linkedTo,
          generationPrompt: prompt,
          generationModel: profile.modelName,
          generationRevisedPrompt: generatedImage.revisedPrompt || null,
          tags: inheritedTags,
          s3Key,
        })

        // Use API route for S3-backed files
        const filepath = `/api/files/${file.id}`

        return {
          id: file.id,
          filename: file.originalFilename,
          filepath,
          url: filepath,
          mimeType: file.mimeType,
          size: file.size,
          revisedPrompt: generatedImage.revisedPrompt,
          tags: tags || [],
        }
      })
    )

    return NextResponse.json({
      data: savedImages,
      metadata: {
        prompt,
        provider: profile.provider,
        model: profile.modelName,
        count: savedImages.length,
      },
    })
  } catch (error) {
    logger.error('Error generating images', { endpoint: '/api/images/generate', method: 'POST' }, error instanceof Error ? error : undefined)

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation error', details: error.errors },
        { status: 400 }
      )
    }

    return NextResponse.json(
      {
        error: 'Failed to generate images',
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 }
    )
  }
})
