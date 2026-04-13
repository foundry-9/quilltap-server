#!/usr/bin/env tsx
/**
 * Build Help Index Script (DEPRECATED)
 *
 * @deprecated As of v2.15.0, help documentation is embedded at runtime using the
 * user's chosen embedding profile. Help docs are synced from disk to the database
 * via lib/help/help-doc-sync.ts and embedded through the background job system.
 * This script is retained for development/testing purposes only.
 *
 * Creates a gzipped MessagePack bundle of help documentation with embeddings.
 * Uses OpenAI's text-embedding-3-small model for generating embeddings.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-xxx tsx scripts/build-help-index.ts
 *
 * Output:
 *   public/help-bundle.msgpack.gz (~3-4MB compressed)
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import { gzipSync } from 'node:zlib'
import { encode } from '@msgpack/msgpack'
import OpenAI from 'openai'
import type { HelpBundle, HelpDocument } from '../lib/help-search.types'

// Configuration
const EMBEDDING_MODEL = 'text-embedding-3-small'
const HELP_DIR = join(process.cwd(), 'help')
const OUTPUT_FILE = join(process.cwd(), 'public', 'help-bundle.msgpack.gz')
const BUNDLE_VERSION = '3.0.0'

/**
 * Find all Markdown files in a directory recursively
 */
function findMarkdownFiles(dir: string): string[] {
  const files: string[] = []

  try {
    const entries = readdirSync(dir)

    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)

      if (stat.isDirectory()) {
        files.push(...findMarkdownFiles(fullPath))
      } else if (entry.endsWith('.md')) {
        files.push(fullPath)
      }
    }
  } catch (err) {
    console.error(`Error reading directory ${dir}:`, err)
  }

  return files
}

/**
 * Parse YAML frontmatter from Markdown content
 *
 * Extracts the `url` field and returns the content without the frontmatter block.
 * Uses simple regex parsing — no external dependencies needed.
 */
function parseFrontmatter(content: string, filePath: string): { url: string; content: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!match) {
    console.warn(`  Warning: ${filePath} has no YAML frontmatter`)
    return { url: '', content }
  }

  const frontmatter = match[1]
  const urlMatch = frontmatter.match(/^url:\s*(.+)$/m)
  const url = urlMatch ? urlMatch[1].trim() : ''

  if (!url) {
    console.warn(`  Warning: ${filePath} frontmatter is missing 'url' field`)
  }

  // Strip frontmatter from content
  const strippedContent = content.slice(match[0].length)
  return { url, content: strippedContent }
}

/**
 * Extract title from Markdown content (first H1) or fallback to filename
 */
function extractTitle(content: string, filePath: string): string {
  // Look for first H1 heading
  const h1Match = content.match(/^#\s+(.+)$/m)
  if (h1Match) {
    return h1Match[1].trim()
  }

  // Fallback to filename without extension, converted to title case
  const filename = filePath.split('/').pop()?.replace('.md', '') || 'Unknown'
  return filename
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

/**
 * Generate document ID from file path
 */
function generateDocumentId(filePath: string): string {
  return filePath
    .replace(/^help\//, '')
    .replace(/\.md$/, '')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .toLowerCase()
}

/**
 * Get embeddings from OpenAI in batches with retry logic
 */
async function getEmbeddings(
  client: OpenAI,
  texts: string[]
): Promise<number[][]> {
  if (texts.length === 0) {
    return []
  }

  const batchSize = 100
  const allEmbeddings: number[][] = []
  const maxRetries = 3

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize)
    const batchNum = Math.floor(i / batchSize) + 1
    const totalBatches = Math.ceil(texts.length / batchSize)

    console.log(`  Embedding batch ${batchNum}/${totalBatches} (${batch.length} documents)...`)

    let lastError: Error | null = null
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await client.embeddings.create({
          model: EMBEDDING_MODEL,
          input: batch,
        })

        for (const item of response.data) {
          allEmbeddings.push(item.embedding)
        }
        break
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err))
        if (attempt < maxRetries) {
          const delay = Math.pow(2, attempt) * 1000 // Exponential backoff
          console.log(`    Attempt ${attempt} failed, retrying in ${delay / 1000}s...`)
          await new Promise(resolve => setTimeout(resolve, delay))
        }
      }
    }

    if (lastError && allEmbeddings.length < i + batch.length) {
      console.error(`    Failed to embed batch after ${maxRetries} attempts:`, lastError.message)
      // Continue with remaining batches rather than failing completely
    }
  }

  return allEmbeddings
}

/**
 * Main function
 */
async function main() {
  console.log('Building Help Documentation Index\n')

  // Check for API key
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    console.error('Error: OPENAI_API_KEY environment variable is required')
    console.error('Set it with: export OPENAI_API_KEY=sk-your-key')
    process.exit(1)
  }

  // Verify help directory exists
  if (!existsSync(HELP_DIR)) {
    console.error(`Error: Help directory not found: ${HELP_DIR}`)
    process.exit(1)
  }

  // Initialize OpenAI client
  const client = new OpenAI({ apiKey })

  // Find all Markdown files
  console.log(`Scanning ${HELP_DIR} for Markdown files...\n`)
  const files = findMarkdownFiles(HELP_DIR)

  if (files.length === 0) {
    console.log('No Markdown files found in help/ directory')
    process.exit(0)
  }

  console.log(`Found ${files.length} Markdown file(s):\n`)

  // Parse files and collect documents
  const documents: Array<Omit<HelpDocument, 'embedding'>> = []
  const skipped: string[] = []

  for (const filePath of files) {
    const relPath = relative(process.cwd(), filePath)
    const rawContent = readFileSync(filePath, 'utf-8').trim()

    // Skip empty files
    if (!rawContent) {
      console.log(`  ${relPath}: (empty, skipping)`)
      skipped.push(relPath)
      continue
    }

    // Parse frontmatter and strip it from content
    const { url, content } = parseFrontmatter(rawContent, relPath)

    const title = extractTitle(content, relPath)
    const id = generateDocumentId(relPath)

    documents.push({
      id,
      title,
      path: relPath,
      url,
      content,
    })

    console.log(`  ${relPath}: "${title}" (url: ${url || '(none)'})`)
  }

  console.log(`\nTotal: ${documents.length} document(s) to embed`)
  if (skipped.length > 0) {
    console.log(`Skipped: ${skipped.length} empty file(s)`)
  }

  if (documents.length === 0) {
    console.log('\nNo content to embed. All files are empty.')
    process.exit(0)
  }

  // Generate embeddings
  console.log('\nGenerating embeddings with OpenAI...\n')
  const texts = documents.map(doc => `${doc.title}\n\n${doc.content}`)

  let embeddings: number[][]
  try {
    embeddings = await getEmbeddings(client, texts)
  } catch (err) {
    console.error('\nError generating embeddings:', err)
    process.exit(1)
  }

  // Verify we got embeddings for all documents
  if (embeddings.length !== documents.length) {
    console.error(`\nError: Expected ${documents.length} embeddings but got ${embeddings.length}`)
    process.exit(1)
  }

  // Build the bundle
  console.log('\nBuilding bundle...')
  const dimensions = embeddings[0]?.length || 1536

  const bundle: HelpBundle = {
    version: BUNDLE_VERSION,
    generated: new Date().toISOString(),
    embeddingModel: EMBEDDING_MODEL,
    embeddingDimensions: dimensions,
    documents: documents.map((doc, i) => ({
      ...doc,
      embedding: embeddings[i],
    })),
  }

  // Encode with MessagePack
  console.log('Encoding with MessagePack...')
  const encoded = encode(bundle)

  // Compress with gzip
  console.log('Compressing with gzip...')
  const compressed = gzipSync(Buffer.from(encoded))

  // Write output file
  writeFileSync(OUTPUT_FILE, compressed)

  const stats = statSync(OUTPUT_FILE)
  const sizeMB = (stats.size / (1024 * 1024)).toFixed(2)
  const uncompressedMB = (encoded.length / (1024 * 1024)).toFixed(2)

  console.log('\nSuccess!')
  console.log(`  Documents embedded: ${documents.length}`)
  console.log(`  Vector dimensions: ${dimensions}`)
  console.log(`  Output file: ${relative(process.cwd(), OUTPUT_FILE)}`)
  console.log(`  Uncompressed size: ${uncompressedMB} MB`)
  console.log(`  Compressed size: ${sizeMB} MB`)
  console.log(`  Compression ratio: ${((1 - stats.size / encoded.length) * 100).toFixed(1)}%`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
