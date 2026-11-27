"use client";

import { createContext, useContext, useMemo } from 'react';
import { useSession } from '@/components/providers/session-provider';
import { useTagsQuery } from '@/lib/hooks/use-tags';
import type { TagStyleMap, TagVisualStyle } from '@/lib/schemas/types';
import { DEFAULT_TAG_STYLE, mergeWithDefaultTagStyle } from '@/lib/tags/styles';

interface TagStyleContextValue {
  styles: TagStyleMap;
  loading: boolean;
  getStyleForTag: (tagId?: string | null) => TagVisualStyle;
}

const TagStyleContext = createContext<TagStyleContextValue | null>(null);

type StyledTag = { id: string; visualStyle?: TagVisualStyle | null };

/** The style map: every tag that has a visual style of its own. */
function toStyleMap(tags: StyledTag[]): TagStyleMap {
  const styleMap: TagStyleMap = {};
  for (const tag of tags) {
    if (tag.visualStyle) {
      styleMap[tag.id] = tag.visualStyle;
    }
  }
  return styleMap;
}

const NO_STYLES: TagStyleMap = {};

export function TagStyleProvider({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const authenticated = status === 'authenticated';
  const { data, isLoading } = useTagsQuery<StyledTag, TagStyleMap>({ enabled: authenticated, select: toStyleMap });
  const styles = (authenticated && data) || NO_STYLES;

  const value = useMemo<TagStyleContextValue>(
    () => ({
      styles,
      loading: isLoading,
      getStyleForTag: (tagId?: string | null) => {
        if (!tagId) {
          return DEFAULT_TAG_STYLE;
        }
        return mergeWithDefaultTagStyle(styles[tagId]);
      },
    }),
    [styles, isLoading]
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
