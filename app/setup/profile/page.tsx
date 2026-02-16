'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Archetype {
  id: string;
  label: string;
  description: string;
  personality: string;
}

const ARCHETYPES: Archetype[] = [
  {
    id: 'proprietor',
    label: 'The Proprietor',
    description: 'The owner and operator of this workspace, focused on getting things done efficiently.',
    personality: 'Direct, professional, and detail-oriented. Prefers clear communication and practical solutions.',
  },
  {
    id: 'resident',
    label: 'The Resident',
    description: 'A regular presence in this space, here to connect and converse with the characters who live here.',
    personality: 'Curious, engaged, and sociable. Enjoys getting to know people and building relationships.',
  },
  {
    id: 'author',
    label: 'The Author',
    description: 'A creative mind who shapes worlds and breathes life into characters.',
    personality: 'Imaginative, thoughtful, and expressive. Approaches characters with a storyteller\'s eye.',
  },
];

export default function ProfileSetupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [selectedArchetype, setSelectedArchetype] = useState<string>('resident');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError('Please enter a name.');
      return;
    }

    const archetype = ARCHETYPES.find((a) => a.id === selectedArchetype);
    if (!archetype) {
      setError('Please select an archetype.');
      return;
    }

    setError('');
    setLoading(true);

    try {
      // Create the user-controlled character
      const createRes = await fetch('/api/v1/characters', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          description: archetype.description,
          personality: archetype.personality,
          controlledBy: 'user',
        }),
      });

      if (!createRes.ok) {
        const data = await createRes.json();
        setError(data.error || 'Failed to create your profile.');
        return;
      }

      const { character } = await createRes.json();
      const userCharacterId = character.id;

      // Set this user character as the default partner for all existing LLM-controlled characters
      const charsRes = await fetch('/api/v1/characters?controlledBy=llm');
      if (charsRes.ok) {
        const charsData = await charsRes.json();
        const llmCharacters = charsData.characters || [];

        // Fire these in parallel — failures are non-critical
        await Promise.allSettled(
          llmCharacters.map((c: { id: string }) =>
            fetch(`/api/v1/characters/${c.id}?action=set-default-partner`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ partnerId: userCharacterId }),
            })
          )
        );
      }

      // Full page load to re-initialize session provider and all client state
      window.location.href = '/';
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="qt-auth-page flex items-center justify-center min-h-screen p-4">
      <div className="qt-card max-w-lg w-full p-6 space-y-6">
        <div>
          <h1 className="qt-heading-2">Set Up Your Profile</h1>
          <p className="qt-text-muted mt-1">
            Tell us a bit about yourself so your characters know who they&apos;re talking to.
          </p>
        </div>

        {/* Name input */}
        <div>
          <label htmlFor="profile-name" className="qt-text-label block mb-1">
            What should we call you?
          </label>
          <input
            id="profile-name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Enter your name"
            className="qt-input w-full p-2"
            disabled={loading}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            autoFocus
          />
        </div>

        {/* Archetype selection */}
        <div>
          <label className="qt-text-label block mb-2">How would you describe your role?</label>
          <div className="space-y-2">
            {ARCHETYPES.map((archetype) => (
              <button
                key={archetype.id}
                onClick={() => setSelectedArchetype(archetype.id)}
                disabled={loading}
                className={`qt-card w-full p-4 text-left transition-all ${
                  selectedArchetype === archetype.id
                    ? 'ring-2 ring-[var(--qt-color-primary)] qt-bg-active'
                    : 'hover:qt-bg-hover'
                }`}
              >
                <div className="font-medium">{archetype.label}</div>
                <p className="qt-text-muted qt-text-small mt-1">{archetype.description}</p>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="qt-alert qt-alert-error text-sm">{error}</p>}

        <button
          onClick={handleSubmit}
          disabled={loading || !name.trim()}
          className="qt-btn w-full py-2"
        >
          {loading ? 'Setting up...' : 'Continue'}
        </button>

        <p className="qt-text-xs qt-text-muted text-center">
          You can change your name, avatar, and details anytime from Aurora.
        </p>
      </div>
    </div>
  );
}
