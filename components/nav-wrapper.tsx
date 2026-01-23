'use client';

import { useSession } from '@/components/providers/session-provider';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';
import DashboardNav from './dashboard/nav';
import { ChatProvider } from './providers/chat-context';
import type { Tag } from './tags/tag-editor';

export default function NavWrapper() {
  const { data: session } = useSession();
  const pathname = usePathname();
  const [tags, setTags] = useState<Tag[]>([]);
  const [tagsLoading, setTagsLoading] = useState(false);
  const [tagsFetched, setTagsFetched] = useState(false);
  const [chatId, setChatId] = useState<string | null>(null);

  // Check if we're on an auth page - hide nav on these routes regardless of session state
  const isAuthPage = pathname?.startsWith('/auth/');

  // Extract chat ID from pathname
  useEffect(() => {
    const chatMatch = pathname?.match(/^\/chats\/([^/]+)$/);
    if (chatMatch?.[1]) {
      setChatId(chatMatch[1]);
    } else {
      setChatId(null);
    }
  }, [pathname]);

  // Fetch tags when chat ID changes
  useEffect(() => {
    if (!chatId) {
      setTags([]);
      setTagsFetched(true);
      setTagsLoading(false);
      return;
    }

    const fetchTags = async () => {
      setTagsFetched(false);
      setTagsLoading(true);
      try {
        const res = await fetch(`/api/v1/chats/${chatId}`);
        if (res.ok) {
          const data = await res.json();
          setTags(data.chat?.tags || []);
        }
      } catch (err) {
        console.error('Error loading tags:', { error: err instanceof Error ? err.message : String(err) });
      } finally {
        setTagsLoading(false);
        setTagsFetched(true);
      }
    };

    fetchTags();
  }, [chatId]);

  const handleTagAdd = async (tagName: string) => {
    if (tagsLoading || !tagName.trim() || !chatId) return;
    setTagsLoading(true);
    try {
      const tagRes = await fetch('/api/v1/tags', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: tagName.trim() }),
      });
      if (!tagRes.ok) throw new Error('Failed to create tag');
      const { tag } = await tagRes.json();

      const attachRes = await fetch(`/api/v1/chats/${chatId}?action=add-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId: tag.id }),
      });
      if (!attachRes.ok) throw new Error('Failed to attach tag');

      setTags([...tags, tag]);
    } catch (err) {
      console.error('Error adding tag:', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTagsLoading(false);
    }
  };

  const handleTagRemove = async (tagId: string) => {
    if (tagsLoading || !chatId) return;
    setTagsLoading(true);
    try {
      const res = await fetch(`/api/v1/chats/${chatId}?action=remove-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tagId }),
      });
      if (!res.ok) throw new Error('Failed to remove tag');
      setTags(tags.filter((t) => t.id !== tagId));
    } catch (err) {
      console.error('Error removing tag:', { error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTagsLoading(false);
    }
  };

  // Hide nav on auth pages or if no session
  if (isAuthPage || !session) {
    return null;
  }

  const chatContextValue = {
    chatId,
    chatTitle: null,
    tags,
    tagsLoading,
    tagsFetched,
    onTagAdd: handleTagAdd,
    onTagRemove: handleTagRemove,
  };

  return (
    <ChatProvider value={chatContextValue}>
      <DashboardNav user={session.user} />
    </ChatProvider>
  );
}
