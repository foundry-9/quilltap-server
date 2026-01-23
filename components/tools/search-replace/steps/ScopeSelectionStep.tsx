'use client';

/**
 * ScopeSelectionStep Component
 *
 * Step 1: Select the scope for search and replace operation.
 */

import { useEffect, useState } from 'react';
import type { SearchReplaceScope } from '../types';

interface ScopeSelectionStepProps {
  scope: SearchReplaceScope | null;
  onScopeChange: (scope: SearchReplaceScope) => void;
  currentChatId?: string;
  chatTitle?: string;
  characterName?: string;
}

interface Character {
  id: string;
  name: string;
  controlledBy?: 'llm' | 'user';
}

type ScopeType = 'chat' | 'character';

export function ScopeSelectionStep({
  scope,
  onScopeChange,
  currentChatId,
  chatTitle,
  characterName,
}: ScopeSelectionStepProps) {
  const [scopeType, setScopeType] = useState<ScopeType>(
    scope?.type === 'chat' || scope?.type === 'character'
      ? scope.type
      : (currentChatId ? 'chat' : 'character')
  );
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string>(
    scope?.type === 'character' ? scope.characterId : ''
  );
  const [loading, setLoading] = useState(false);

  // Fetch characters (includes former personas with controlledBy: 'user')
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const charsRes = await fetch('/api/v1/characters');

        if (charsRes.ok) {
          const data = await charsRes.json();
          setCharacters(data.characters || data || []);
        }
      } catch (error) {
        console.error('[ScopeSelectionStep] Error fetching data', { error });
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // Update scope when selection changes
  useEffect(() => {
    if (scopeType === 'chat' && currentChatId) {
      onScopeChange({ type: 'chat', chatId: currentChatId });
    } else if (scopeType === 'character' && selectedCharacterId) {
      onScopeChange({ type: 'character', characterId: selectedCharacterId });
    }
  }, [scopeType, currentChatId, selectedCharacterId, onScopeChange]);

  const handleScopeTypeChange = (type: ScopeType) => {
    setScopeType(type);
  };

  // Separate characters by controlledBy for display
  const llmCharacters = characters.filter(c => c.controlledBy !== 'user');
  const userCharacters = characters.filter(c => c.controlledBy === 'user');

  return (
    <div className="space-y-6">
      <div>
        <h3 className="qt-text-primary text-lg font-medium mb-2">
          Select Scope
        </h3>
        <p className="qt-text-secondary text-sm">
          Choose where to search and replace text.
        </p>
      </div>

      <div className="space-y-3">
        {/* Chat scope option */}
        {currentChatId && (
          <label className={`
            flex items-center p-4 rounded-lg border-2 cursor-pointer transition-colors
            ${scopeType === 'chat'
              ? 'border-primary bg-accent'
              : 'border-border bg-background hover:border-primary/50'
            }
          `}>
            <input
              type="radio"
              name="scopeType"
              value="chat"
              checked={scopeType === 'chat'}
              onChange={() => handleScopeTypeChange('chat')}
              className="mr-3"
            />
            <div>
              <div className="font-medium qt-text-primary">Current Chat</div>
              <div className="text-sm qt-text-secondary">
                {chatTitle || 'This conversation only'}
              </div>
            </div>
          </label>
        )}

        {/* Character scope option */}
        <label className={`
          flex items-center p-4 rounded-lg border-2 cursor-pointer transition-colors
          ${scopeType === 'character'
            ? 'border-primary bg-accent'
            : 'border-border bg-background hover:border-primary/50'
          }
        `}>
          <input
            type="radio"
            name="scopeType"
            value="character"
            checked={scopeType === 'character'}
            onChange={() => handleScopeTypeChange('character')}
            className="mr-3"
          />
          <div className="flex-1">
            <div className="font-medium qt-text-primary">All Chats for Character</div>
            <div className="text-sm qt-text-secondary">
              Search across all conversations with a specific character
            </div>
          </div>
        </label>

        {/* Character selector */}
        {scopeType === 'character' && (
          <div className="ml-8 mt-2">
            <select
              value={selectedCharacterId}
              onChange={(e) => setSelectedCharacterId(e.target.value)}
              className="qt-input w-full"
              disabled={loading}
            >
              <option value="">Select a character...</option>
              {llmCharacters.length > 0 && (
                <optgroup label="LLM Characters">
                  {llmCharacters.map((char) => (
                    <option key={char.id} value={char.id}>
                      {char.name}
                    </option>
                  ))}
                </optgroup>
              )}
              {userCharacters.length > 0 && (
                <optgroup label="Your Characters">
                  {userCharacters.map((char) => (
                    <option key={char.id} value={char.id}>
                      {char.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </div>
        )}
      </div>

      {loading && (
        <div className="text-sm qt-text-secondary">
          Loading...
        </div>
      )}
    </div>
  );
}
