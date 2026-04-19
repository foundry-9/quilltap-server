"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
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

  const { data: tagsData, isLoading } = useSWR<{ tags: Array<{ id: string; visualStyle?: TagVisualStyle }> }>(
    status === 'authenticated' ? '/api/v1/tags' : null
  );

  useEffect(() => {
    if (tagsData?.tags) {
      // Build style map from tags that have visualStyle defined
      const styleMap: TagStyleMap = {};
      for (const tag of tagsData.tags) {
        if (tag.visualStyle) {
          styleMap[tag.id] = tag.visualStyle;
        }
      }
      setStyles(styleMap);
    } else if (status !== 'authenticated') {
      setStyles({});
    }
  }, [tagsData, status]);

  const updateStyles = useCallback((next: TagStyleMap) => {
    setStyles(next ?? {});
  }, []);

  const value = useMemo<TagStyleContextValue>(
    () => ({
      styles,
      loading: isLoading,
      refresh: () => Promise.resolve(),
      updateStyles,
      getStyleForTag: (tagId?: string | null) => {
        if (!tagId) {
          return DEFAULT_TAG_STYLE;
        }
        return mergeWithDefaultTagStyle(styles[tagId]);
      },
    }),
    [styles, isLoading, updateStyles]
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
