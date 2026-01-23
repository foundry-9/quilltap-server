"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useSession } from '@/components/providers/session-provider';
import type { TagStyleMap, TagVisualStyle } from '@/lib/schemas/types';
import { DEFAULT_TAG_STYLE, mergeWithDefaultTagStyle } from '@/lib/tags/styles';

interface TagStyleContextValue {
  styles: TagStyleMap;
  loading: boolean;
  refresh: () => Promise<void>;
  updateStyles: (styles: TagStyleMap) => void;
  getStyleForTag: (tagId?: string | null) => TagVisualStyle;
}

const TagStyleContext = createContext<TagStyleContextValue | null>(null);

export function TagStyleProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const [styles, setStyles] = useState<TagStyleMap>({});
  const [loading, setLoading] = useState(true);

  const fetchStyles = useCallback(async () => {
    // Don't fetch if not authenticated
    if (status !== 'authenticated') {
      setStyles({});
      setLoading(false);
      return;
    }

    try {
      // Fetch tags directly - visual styles are now stored on the tag entities
      const res = await fetch('/api/v1/tags', { cache: 'no-store' });
      if (res.status === 401) {
        setStyles({});
      } else if (!res.ok) {
        throw new Error('Failed to fetch tags');
      } else {
        const data = await res.json();
        // Build style map from tags that have visualStyle defined
        const styleMap: TagStyleMap = {};
        for (const tag of data.tags ?? []) {
          if (tag.visualStyle) {
            styleMap[tag.id] = tag.visualStyle;
          }
        }
        setStyles(styleMap);
      }
    } catch (error) {
      console.warn('Unable to load tag styles:', { error: error instanceof Error ? error.message : String(error) });
      setStyles({});
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    // Only fetch when session status is determined (not 'loading')
    if (status !== 'loading') {
      fetchStyles();
    }
  }, [fetchStyles, status]);

  const updateStyles = useCallback((next: TagStyleMap) => {
    setStyles(next ?? {});
  }, []);

  const value = useMemo<TagStyleContextValue>(
    () => ({
      styles,
      loading,
      refresh: fetchStyles,
      updateStyles,
      getStyleForTag: (tagId?: string | null) => {
        if (!tagId) {
          return DEFAULT_TAG_STYLE;
        }
        return mergeWithDefaultTagStyle(styles[tagId]);
      },
    }),
    [styles, loading, fetchStyles, updateStyles]
  );

  return <TagStyleContext.Provider value={value}>{children}</TagStyleContext.Provider>;
}

export function useTagStyles() {
  const ctx = useContext(TagStyleContext);
  if (!ctx) {
    throw new Error('useTagStyles must be used within a TagStyleProvider');
  }
  return ctx;
}
