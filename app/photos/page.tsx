'use client';

/**
 * "My Photos" gallery page — the human user's parallel to the per-character
 * vault album from Phase 1. Shows every image the user has saved to their
 * gallery (`<userUploads>/photos/`) with a link-count badge, a linker list,
 * and a detail modal that surfaces the original generation prompt, scene
 * state snapshot, caption, and tags.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';

interface PhotoLinker {
  linkId: string;
  mountPointId: string;
  mountPointName: string;
  mountStoreType: 'character' | 'documents';
  relativePath: string;
  isPhotoAlbum: boolean;
  linkedAt: string;
  linkedBy: string | null;
  linkedById: string | null;
  caption: string | null;
  tags: string[];
}

interface PhotoLinkSummary {
  count: number;
  linkers: PhotoLinker[];
}

interface GalleryEntry {
  linkId: string;
  mountPointId: string;
  relativePath: string;
  fileName: string;
  blobUrl: string;
  mimeType: string;
  sha256: string;
  fileSizeBytes: number;
  keptAt: string;
  caption: string | null;
  tags: string[];
  generationPromptExcerpt: string;
  relevanceScore?: number;
  linkSummary: PhotoLinkSummary;
}

interface ListResponse {
  data: {
    entries: GalleryEntry[];
    total: number;
    hasMore: boolean;
  };
}

export default function PhotosPage() {
  const [entries, setEntries] = useState<GalleryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [selected, setSelected] = useState<GalleryEntry | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const fetchEntries = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (appliedQuery.trim()) params.set('q', appliedQuery.trim());
        params.set('limit', '60');
        const res = await fetch(`/api/v1/photos?${params.toString()}`);
        if (!res.ok) {
          throw new Error(`Failed to load gallery (${res.status})`);
        }
        const json: ListResponse = await res.json();
        if (cancelled) return;
        setEntries(json.data?.entries ?? []);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to load gallery');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchEntries();
    return () => {
      cancelled = true;
    };
  }, [appliedQuery]);

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setAppliedQuery(query);
    },
    [query]
  );

  const handleDelete = useCallback(
    async (linkId: string) => {
      if (!window.confirm('Remove this photo from your gallery?')) return;
      setDeleting(linkId);
      try {
        const res = await fetch(`/api/v1/photos/${linkId}`, { method: 'DELETE' });
        if (!res.ok) {
          const json = await res.json().catch(() => ({}));
          throw new Error(json?.error || `Failed to delete (${res.status})`);
        }
        setEntries(prev => prev.filter(e => e.linkId !== linkId));
        if (selected?.linkId === linkId) setSelected(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete');
      } finally {
        setDeleting(null);
      }
    },
    [selected]
  );

  const emptyState = entries.length === 0 && !loading && !error;

  return (
    <main className="qt-page qt-page-padded">
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h1 className="qt-text-heading">My Photos</h1>
          <p className="qt-text-muted mt-1">
            Images you&rsquo;ve saved from chats — yours to keep, search, and re-share.
          </p>
        </div>
        <Link href="/salon" className="qt-link text-sm">
          ← Back to the Salon
        </Link>
      </header>

      <form onSubmit={handleSearch} className="mb-6 flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by prompt, caption, scene, or tag…"
          className="qt-input flex-1"
        />
        <button type="submit" className="qt-button-primary">Search</button>
        {appliedQuery && (
          <button
            type="button"
            className="qt-button-secondary"
            onClick={() => { setQuery(''); setAppliedQuery(''); }}
          >
            Clear
          </button>
        )}
      </form>

      {loading && <p className="qt-text-muted">Loading your gallery…</p>}
      {error && <p className="qt-text-error">{error}</p>}
      {emptyState && (
        <p className="qt-text-muted">
          Your gallery is empty. Save an image from any chat via the &ldquo;Save to my gallery&rdquo; option and it&rsquo;ll show up here.
        </p>
      )}

      <ul className="qt-grid qt-grid-photos">
        {entries.map((entry) => (
          <li key={entry.linkId} className="qt-card qt-card-photo">
            <button
              type="button"
              onClick={() => setSelected(entry)}
              className="qt-card-photo-thumb"
              aria-label={entry.caption || entry.fileName}
            >
              <img
                src={entry.blobUrl}
                alt={entry.caption || entry.fileName}
                loading="lazy"
              />
            </button>
            <div className="qt-card-photo-meta">
              <p className="qt-card-photo-caption" title={entry.caption ?? entry.fileName}>
                {entry.caption || entry.generationPromptExcerpt || entry.fileName}
              </p>
              <LinkCountBadge summary={entry.linkSummary} />
            </div>
          </li>
        ))}
      </ul>

      {selected && (
        <PhotoDetailModal
          entry={selected}
          deleting={deleting === selected.linkId}
          onClose={() => setSelected(null)}
          onDelete={() => handleDelete(selected.linkId)}
        />
      )}
    </main>
  );
}

function LinkCountBadge({ summary }: { summary: PhotoLinkSummary }) {
  if (summary.count <= 1) {
    return <span className="qt-badge qt-badge-muted">1 link</span>;
  }
  return (
    <span className="qt-badge qt-badge-info" title={`Hard-linked in ${summary.count} places`}>
      {summary.count} links
    </span>
  );
}

function PhotoDetailModal({
  entry,
  deleting,
  onClose,
  onDelete,
}: {
  entry: GalleryEntry;
  deleting: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="qt-modal-backdrop" onClick={onClose}>
      <div
        className="qt-modal qt-modal-wide"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="qt-modal-header">
          <h2 className="qt-text-heading-sm">
            {entry.caption || entry.fileName}
          </h2>
          <button type="button" className="qt-modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </header>
        <div className="qt-modal-body grid gap-4 md:grid-cols-2">
          <div>
            <img src={entry.blobUrl} alt={entry.caption || entry.fileName} className="qt-photo-detail-image" />
          </div>
          <div className="space-y-3">
            <Section title="Saved">
              <p className="qt-text-muted">{new Date(entry.keptAt).toLocaleString()}</p>
            </Section>
            {entry.generationPromptExcerpt && (
              <Section title="Original prompt">
                <p>{entry.generationPromptExcerpt}</p>
              </Section>
            )}
            {entry.tags.length > 0 && (
              <Section title="Tags">
                <div className="flex flex-wrap gap-1">
                  {entry.tags.map((t) => (
                    <span key={t} className="qt-badge qt-badge-muted">{t}</span>
                  ))}
                </div>
              </Section>
            )}
            <Section title={`Hard-linked in ${entry.linkSummary.count} place${entry.linkSummary.count === 1 ? '' : 's'}`}>
              <ul className="space-y-1 text-sm">
                {entry.linkSummary.linkers.map((linker) => (
                  <li key={linker.linkId} className="qt-text-muted">
                    <span className="qt-text-strong">
                      {linker.linkedBy ?? linker.mountPointName}
                    </span>{' '}
                    — <code>{linker.relativePath}</code>
                  </li>
                ))}
              </ul>
            </Section>
            <Section title="Identity">
              <p className="qt-text-mono text-xs break-all">sha256: {entry.sha256}</p>
              <p className="qt-text-mono text-xs break-all">linkId: {entry.linkId}</p>
            </Section>
          </div>
        </div>
        <footer className="qt-modal-footer flex justify-between">
          <button
            type="button"
            className="qt-button-danger"
            onClick={onDelete}
            disabled={deleting}
          >
            {deleting ? 'Removing…' : 'Remove from gallery'}
          </button>
          <button type="button" className="qt-button-secondary" onClick={onClose}>
            Close
          </button>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="qt-text-label mb-1">{title}</h3>
      {children}
    </div>
  );
}
