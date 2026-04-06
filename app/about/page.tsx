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
          Your AI, your projects, your stories, your partners, your rules.
        </p>
      </div>

      {/* Badges */}
      <div className="qt-card p-6 mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <a
            href="https://github.com/foundry-9/quilltap-server/blob/main/LICENSE"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://img.shields.io/badge/License-MIT-blue.svg"
              alt="License: MIT"
            />
          </a>
          <a
            href="https://github.com/foundry-9/quilltap-server"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src={`https://img.shields.io/badge/version-${packageJson.version.replace(/-/g, '--')}-yellow.svg?logo=github`}
              alt={`Version ${packageJson.version}`}
            />
          </a>
          <a
            href="https://hub.docker.com/r/foundry9/quilltap"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://img.shields.io/docker/v/foundry9/quilltap?logo=docker&label=docker&sort=semver"
              alt="Docker Hub"
            />
          </a>
          <a
            href="https://www.npmjs.com/package/quilltap"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://img.shields.io/npm/v/quilltap?logo=npm"
              alt="npm"
            />
          </a>
          <a
            href="https://discord.com/channels/1476289075152556205/1476290238187049184"
            target="_blank"
            rel="noopener noreferrer"
          >
            <img
              src="https://img.shields.io/badge/Discord-join-5865F2?logo=discord&logoColor=white"
              alt="Discord"
            />
          </a>
        </div>
      </div>

      {/* About Section */}
      <div className="qt-card p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">What is <BrandName />?</h2>
        <p className="qt-text-primary mb-4">
          <BrandName /> is a self-hosted AI workspace for writers, worldbuilders, roleplayers, and anyone who
          finds it deeply unsatisfying that their AI assistant forgets everything the moment they close a tab.
          Connect to any LLM provider, organize your work into projects with persistent files and context,
          create characters with genuine personalities, and build a private AI environment that learns,
          remembers, and &mdash; crucially &mdash; belongs entirely to you.
        </p>
        <p className="qt-text-primary mb-4">
          The platform is organized into named subsystems, each with its own character and purpose &mdash;
          rather like the wings of a well-appointed estate. Aurora (characters), The Salon (chat),
          Prospero (projects), The Commonplace Book (memory), The Lantern (story backgrounds),
          the Concierge (alternative content provision and routing), Pascal the Croupier (gaming &amp; RNG),
          Calliope (themes), and The Foundry (architecture) &mdash;
          all extensible through a plugin system.
        </p>
        <p className="qt-text-primary">
          <BrandName /> runs as a native desktop application on macOS and Windows, powered by a lightweight
          Linux VM behind the scenes. You can also run it via Docker or directly from source, should you
          prefer to take the scenic route. No subscriptions, no data harvested, no landlords.
        </p>
      </div>

      {/* Key Features */}
      <div className="qt-card p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Key Features</h2>
        <ul className="space-y-2 qt-text-primary">
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Native desktop app</strong> &ndash; macOS (Lima/VZ) and Windows (WSL2) installers with branded splash screen, data directory management, and automatic VM lifecycle</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Docker runtime</strong> &ndash; toggle between VM and Docker from the splash screen, or run standalone via Docker Hub</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Aurora &ndash; Characters</strong> &ndash; detailed profiles with pronouns, aliases, clothing records, personalities, and multi-character turn management</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Salon &ndash; Chat</strong> &ndash; chat interface with tool palette, agent mode, server-side rendering, and embedded tool messages</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Prospero &ndash; Projects</strong> &ndash; projects with files, folders, semantic search, agent mode, and custom instructions</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Commonplace Book &ndash; Memory</strong> &ndash; long-term memory with semantic recall, memory gate, proactive recall, and deduplication</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Lantern &ndash; Story Backgrounds</strong> &ndash; AI-generated atmospheric background images derived from chat context</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Concierge &ndash; Alternative Content Provision and Routing</strong> &ndash; content classification with detection, auto-routing to uncensored providers, and quick-hide integration</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Pascal the Croupier &ndash; Gaming</strong> &ndash; persistent chat state, dice rolls, coin flips, inventories, stats, and game tracking</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Calliope &ndash; Themes</strong> &ndash; six bundled themes with live switching and plugin support</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>The Foundry &ndash; Architecture</strong> &ndash; unified settings hub, plugin system for themes, providers, templates, tools, search, and storage</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Multi-provider support</strong> &ndash; Anthropic, OpenAI, Google Gemini, Grok, Ollama, OpenRouter, and OpenAI-compatible APIs</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>LLM tools</strong> &ndash; web search, image generation, file management, agent mode, MCP connector, custom tool plugins</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Database protection</strong> &ndash; automatic integrity checks, WAL checkpoints, and physical backups with tiered retention</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-primary mt-1">&#8226;</span>
            <span><strong>Secure by design</strong> &ndash; AES-256-GCM encrypted API keys, all data stays on your infrastructure, no external dependencies</span>
          </li>
        </ul>
      </div>

      {/* Tech Stack */}
      <div className="qt-card p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">The Machinery Behind the Curtain</h2>
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
            <span className="font-medium">Desktop:</span> Electron
          </div>
          <div>
            <span className="font-medium">Styling:</span> Tailwind CSS 4+
          </div>
          <div>
            <span className="font-medium">macOS VM:</span> Lima / VZ
          </div>
          <div>
            <span className="font-medium">Windows VM:</span> WSL2
          </div>
          <div>
            <span className="font-medium">Containers:</span> Docker
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
            href="https://github.com/foundry-9/quilltap-server/releases"
            target="_blank"
            rel="noopener noreferrer"
            className="qt-button qt-button-secondary"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Download Latest Release
          </a>
          <a
            href="https://github.com/foundry-9/quilltap-server"
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
            href="https://github.com/foundry-9/quilltap-server/issues"
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
            Foundry-9 LLC
          </a>
        </div>
      </div>

      {/* Author & Support */}
      <div className="qt-card p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Author &amp; Support</h2>
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

      {/* Acknowledgments */}
      <div className="qt-card p-6 mb-6">
        <h2 className="text-xl font-semibold mb-4">Acknowledgments</h2>
        <p className="qt-text-primary mb-4">
          <BrandName /> stands on the shoulders of these excellent open source projects, and is grateful for the view.
        </p>
        <div className="qt-text-primary space-y-2 text-sm">
          <p><span className="font-medium">Core:</span> React, Next.js, TypeScript, better-sqlite3, Zod</p>
          <p><span className="font-medium">AI &amp; LLM:</span> OpenAI SDK, Anthropic SDK, Google Generative AI SDK, xAI/Grok SDK, Model Context Protocol SDK</p>
          <p><span className="font-medium">UI:</span> Tailwind CSS, React Markdown, React Syntax Highlighter, PDF.js, sharp, Lucide Icons</p>
          <p><span className="font-medium">Desktop &amp; Infrastructure:</span> Electron, Lima, Docker, AWS SDK</p>
          <p><span className="font-medium">Testing:</span> Jest, Playwright, Storybook, Testing Library</p>
        </div>
        <p className="qt-text-muted text-sm mt-4">
          Special thanks to{' '}
          <a href="https://github.com/SillyTavern/SillyTavern" target="_blank" rel="noopener noreferrer" className="qt-link">
            SillyTavern
          </a>
          {' '}for pioneering this space and inspiring character format compatibility.
          One does not forget those who blazed the trail.
        </p>
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
