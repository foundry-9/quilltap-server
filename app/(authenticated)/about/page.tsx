'use client'

import Link from 'next/link'
import packageJson from '@/package.json'
import { BrandName } from '@/components/ui/brand-name'

export default function AboutPage() {
  const currentYear = new Date().getFullYear()
  const copyrightYears = currentYear > 2025 ? `2025-${currentYear}` : '2025'

  return (
    <div className="qt-page-container">
      {/* Header */}
      <div className="mb-8">
        <h1 className="qt-heading-1">About <BrandName /></h1>
        <p className="qt-text-muted mt-2">
          Self-hosted AI workspace for writers, worldbuilders, and roleplayers
        </p>
      </div>

      {/* Version & License Card */}
      <div className="qt-card p-6 mb-6">
        <div className="flex flex-wrap items-center gap-4">
          <span className="qt-badge qt-badge-primary text-lg px-4 py-2">
            v{packageJson.version}
          </span>
          <a
            href="https://github.com/foundry-9/quilltap/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
            className="qt-badge qt-badge-secondary text-lg px-4 py-2 hover:opacity-80 transition-opacity"
          >
            MIT License
          </a>
        </div>
      </div>

      {/* About Section */}
      <div className="qt-card p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">What is <BrandName />?</h2>
        <p className="qt-text-primary mb-4">
          <BrandName /> is a self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who wants an
          AI assistant that actually knows what they&apos;re working on. Connect to any LLM provider, organize your work
          into projects with persistent files and context, create characters with real personalities, and build a
          private AI environment that learns and remembers.
        </p>
        <p className="qt-text-primary">
          The platform ships with project-based file organization, multi-character chat, long-term memory with
          semantic search, and a plugin system for themes, providers, templates, and tools.
        </p>
      </div>

      {/* Key Features */}
      <div className="qt-card p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Key Features</h2>
        <ul className="space-y-2 qt-text-primary">
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Projects &amp; files</strong> &ndash; organize work into projects with folders, files, and custom instructions</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>LLM file access</strong> &ndash; AI can read, search, and write your project files with permission</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Long-term memory</strong> &ndash; semantic recall across conversations, not just within them</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Multi-provider support</strong> &ndash; Anthropic, OpenAI, Google Gemini, Grok, Ollama, OpenRouter, and OpenAI-compatible APIs</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Multi-character chats</strong> &ndash; SillyTavern import, turn management, impersonation, swipes</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>LLM tools</strong> &ndash; web search, image generation, MCP connector, custom tool plugins</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Plugin system</strong> &ndash; extend with themes, providers, templates, and tools via npm packages</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Secure by design</strong> &ndash; AES-256-GCM encrypted API keys, all data stays on your infrastructure</span>
          </li>
        </ul>
      </div>

      {/* Tech Stack */}
      <div className="qt-card p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Tech Stack</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 qt-text-primary">
          <div>
            <span className="font-medium">Runtime:</span> Node.js 22+
          </div>
          <div>
            <span className="font-medium">Framework:</span> Next.js 16+
          </div>
          <div>
            <span className="font-medium">Language:</span> TypeScript 5.6+
          </div>
          <div>
            <span className="font-medium">Database:</span> SQLite
          </div>
          <div>
            <span className="font-medium">File Storage:</span> Local filesystem
          </div>
          <div>
            <span className="font-medium">Styling:</span> Tailwind CSS 4+
          </div>
        </div>
      </div>

      {/* Links */}
      <div className="qt-card p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Links</h2>
        <div className="flex flex-wrap gap-4">
          <a
            href="https://quilltap.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="qt-button qt-button-secondary"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            Quilltap Website
          </a>
          <a
            href="https://github.com/foundry-9/quilltap"
            target="_blank"
            rel="noopener noreferrer"
            className="qt-button qt-button-secondary"
          >
            <svg
              className="w-5 h-5"
              fill="currentColor"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z"
                clipRule="evenodd"
              />
            </svg>
            GitHub Repository
          </a>
          <a
            href="https://github.com/foundry-9/quilltap/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="qt-button qt-button-secondary"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Report Issues
          </a>
          <a
            href="https://foundry-9.com"
            target="_blank"
            rel="noopener noreferrer"
            className="qt-button qt-button-secondary"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
            </svg>
            Foundry-9 LLC Website
          </a>
        </div>
      </div>

      {/* Author & Support */}
      <div className="qt-card p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Author & Support</h2>
        <div className="qt-text-primary space-y-2">
          <p><span className="font-medium">Author:</span> Charles Sebold</p>
          <p>
            <span className="font-medium">Email:</span>{' '}
            <a href="mailto:charles.sebold@foundry-9.com" className="qt-link">
              charles.sebold@foundry-9.com
            </a>
          </p>
          <p>
            <span className="font-medium">Website:</span>{' '}
            <a href="https://foundry-9.com" target="_blank" rel="noopener noreferrer" className="qt-link">
              foundry-9.com
            </a>
          </p>
        </div>
      </div>

      {/* Copyright */}
      <div className="qt-card p-6 mb-6">
        <p className="qt-text-primary text-center">
          &copy; {copyrightYears} Foundry-9 LLC. All rights reserved.
        </p>
        <p className="qt-text-muted text-center text-sm mt-2">
          Released under the MIT License. Free software for personal and commercial use.
        </p>
      </div>

      {/* Back Link */}
      <div className="mt-8">
        <Link href="/" className="qt-link">
          &larr; Back to Home
        </Link>
      </div>
    </div>
  )
}
