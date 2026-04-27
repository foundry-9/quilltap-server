'use client';

/**
 * useCharacterOptimizer Hook
 *
 * State management for the Character Optimizer "Refine from Memories" feature.
 * Handles SSE streaming from the optimize-stream endpoint, suggestion review,
 * and applying accepted changes back to the character.
 */

import { useState, useCallback, useRef } from 'react';
import { randomUUID } from 'crypto';
import type {
  OptimizerPhase,
  SuggestionDecision,
  OptimizerAnalysis,
  OptimizerSuggestion,
  OptimizerFilterOptions,
  OptimizerOutputMode,
  OptimizerSubStep,
} from '../types';

interface UseCharacterOptimizerReturn {
  // Phase state
  phase: OptimizerPhase;
  analysis: OptimizerAnalysis | null;
  suggestions: OptimizerSuggestion[];
  currentIndex: number;
  decisions: Map<string, SuggestionDecision>;
  editedValues: Map<string, string>;
  error: string | null;
  memoryCount: number;
  filteredCount: number;
  loading: boolean;
  progressStep: string | null;
  progressSubStep: OptimizerSubStep | null;
  noSuggestionsMessage: string | null;
  applying: boolean;
  startedAt: number | null;
  suggestionsFilePath: string | null;

  // Actions
  startOptimization: (
    characterId: string,
    connectionProfileId: string,
    filterOptions?: OptimizerFilterOptions,
    outputMode?: OptimizerOutputMode,
  ) => Promise<void>;
  decideSuggestion: (id: string, decision: SuggestionDecision) => void;
  editSuggestion: (id: string, newValue: string) => void;
  goToSuggestion: (index: number) => void;
  nextSuggestion: () => void;
  prevSuggestion: () => void;
  getAcceptedChanges: () => Array<{ suggestion: OptimizerSuggestion; finalValue: string }>;
  applyChanges: (characterId: string) => Promise<void>;
  reset: () => void;
  setPhase: (phase: OptimizerPhase) => void;
}

export function useCharacterOptimizer(): UseCharacterOptimizerReturn {
  const [phase, setPhase] = useState<OptimizerPhase>('preflight');
  const [analysis, setAnalysis] = useState<OptimizerAnalysis | null>(null);
  const [suggestions, setSuggestions] = useState<OptimizerSuggestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [decisions, setDecisions] = useState<Map<string, SuggestionDecision>>(new Map());
  const [editedValues, setEditedValues] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [memoryCount, setMemoryCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [progressStep, setProgressStep] = useState<string | null>(null);
  const [progressSubStep, setProgressSubStep] = useState<OptimizerSubStep | null>(null);
  const [noSuggestionsMessage, setNoSuggestionsMessage] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [filteredCount, setFilteredCount] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [suggestionsFilePath, setSuggestionsFilePath] = useState<string | null>(null);
  const outputModeRef = useRef<OptimizerOutputMode>('apply');

  // Ref to track current suggestions count during async streaming
  const suggestionsRef = useRef<OptimizerSuggestion[]>([]);

  const startOptimization = useCallback(
    async (
      characterId: string,
      connectionProfileId: string,
      filterOptions?: OptimizerFilterOptions,
      outputMode: OptimizerOutputMode = 'apply',
    ) => {
    outputModeRef.current = outputMode;
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setSuggestions([]);
    suggestionsRef.current = [];
    setCurrentIndex(0);
    setDecisions(new Map());
    setEditedValues(new Map());
    setProgressStep(null);
    setProgressSubStep(null);
    setNoSuggestionsMessage(null);
    setFilteredCount(0);
    setStartedAt(Date.now());
    setSuggestionsFilePath(null);
    setPhase('progress');

    try {
      const requestBody: Record<string, unknown> = { connectionProfileId, outputMode };
      if (filterOptions) {
        requestBody.maxMemories = filterOptions.maxMemories;
        requestBody.searchQuery = filterOptions.searchQuery;
        requestBody.useSemanticSearch = filterOptions.useSemanticSearch;
        requestBody.sinceDate = filterOptions.sinceDate;
        requestBody.beforeDate = filterOptions.beforeDate;
      }

      const response = await fetch(`/api/v1/characters/${characterId}?action=optimize-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'The refinement endeavour encountered an unexpected impediment.');
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event = JSON.parse(line.slice(6));

              switch (event.type) {
                case 'start':
                  setLoading(true);
                  setPhase('progress');
                  break;

                case 'step_start':
                  setProgressStep(event.step as string);
                  if (event.step !== 'generating') {
                    setProgressSubStep(null);
                  }
                  break;

                case 'substep_start':
                  if (event.subStep) {
                    setProgressSubStep(event.subStep as OptimizerSubStep);
                  }
                  break;

                case 'substep_complete':
                  // Accumulate suggestions incrementally so the user sees the
                  // count climb as per-item passes finish.
                  if (Array.isArray(event.partialSuggestions)) {
                    const partial = event.partialSuggestions as OptimizerSuggestion[];
                    if (partial.length > 0) {
                      const next = [...suggestionsRef.current, ...partial];
                      suggestionsRef.current = next;
                      setSuggestions(next);
                    }
                  }
                  break;

                case 'step_complete':
                  if (event.step === 'loading') {
                    setMemoryCount((event.memoryCount as number) ?? 0);
                    if (event.filteredCount !== undefined) {
                      setFilteredCount(event.filteredCount as number);
                    }
                  } else if (event.step === 'analyzing') {
                    setAnalysis(event.analysis as OptimizerAnalysis);
                  } else if (event.step === 'generating') {
                    const newSuggestions = event.suggestions as OptimizerSuggestion[];
                    suggestionsRef.current = newSuggestions;
                    setSuggestions(newSuggestions);
                    setProgressSubStep(null);
                  }
                  break;

                case 'suggestions_file_written':
                  setSuggestionsFilePath((event.suggestionsFilePath as string) ?? null);
                  break;

                case 'done': {
                  const doneSuggestions = event.suggestions as OptimizerSuggestion[] | undefined;
                  if (doneSuggestions?.length) {
                    suggestionsRef.current = doneSuggestions;
                    setSuggestions(doneSuggestions);
                  }
                  const filePath = (event.suggestionsFilePath as string | undefined) ?? null;
                  if (filePath) setSuggestionsFilePath(filePath);
                  setLoading(false);
                  setProgressStep(null);
                  setProgressSubStep(null);
                  if (outputModeRef.current === 'suggestions-file' && filePath) {
                    setPhase('suggestions-file-written');
                  } else if (suggestionsRef.current.length > 0) {
                    setPhase('review');
                  } else {
                    setNoSuggestionsMessage(
                      'The memoirs have been consulted most thoroughly, yet your character appears already quite splendidly rendered. No refinements were deemed necessary by our panel of discerning automata.'
                    );
                  }
                  break;
                }

                case 'error':
                  setError(
                    (event.error as string) ??
                      'An unforeseen calamity has befallen the refinement process.'
                  );
                  setLoading(false);
                  break;
              }
            } catch {
              // Ignore parse errors for incomplete JSON fragments
            }
          }
        }
      }

      // Stream ended without a 'done' event — handle gracefully
      setLoading(false);
      if (suggestionsRef.current.length > 0) {
        setPhase('review');
      }
    } catch (err) {
      const errorMessage =
        err instanceof Error
          ? err.message
          : 'The refinement endeavour encountered an unexpected impediment.';
      setError(errorMessage);
      setLoading(false);
    }
  }, []);

  const decideSuggestion = useCallback((id: string, decision: SuggestionDecision) => {
    setDecisions((prev) => {
      const next = new Map(prev);
      next.set(id, decision);
      return next;
    });
  }, []);

  const editSuggestion = useCallback((id: string, newValue: string) => {
    setEditedValues((prev) => {
      const next = new Map(prev);
      next.set(id, newValue);
      return next;
    });
    setDecisions((prev) => {
      const next = new Map(prev);
      next.set(id, 'edited');
      return next;
    });
  }, []);

  const goToSuggestion = useCallback((index: number) => {
    if (index >= 0 && index < suggestionsRef.current.length) {
      setCurrentIndex(index);
    }
  }, []);

  const nextSuggestion = useCallback(() => {
    setCurrentIndex((prev) => Math.min(prev + 1, suggestionsRef.current.length - 1));
  }, []);

  const prevSuggestion = useCallback(() => {
    setCurrentIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  const getAcceptedChanges = useCallback(
    (): Array<{ suggestion: OptimizerSuggestion; finalValue: string }> => {
      return suggestions
        .filter((s) => {
          const decision = decisions.get(s.id);
          return decision === 'accepted' || decision === 'edited';
        })
        .map((s) => ({
          suggestion: s,
          finalValue:
            decisions.get(s.id) === 'edited'
              ? (editedValues.get(s.id) ?? s.proposedValue)
              : s.proposedValue,
        }));
    },
    [suggestions, decisions, editedValues]
  );

  const applyChanges = useCallback(
    async (characterId: string) => {
      const accepted = getAcceptedChanges();
      if (accepted.length === 0) return;

      setApplying(true);
      setError(null);

      try {
        // Fetch current character to get array fields
        const fetchResponse = await fetch(`/api/v1/characters/${characterId}`);
        if (!fetchResponse.ok) {
          throw new Error('Could not retrieve the character dossier for amendment.');
        }
        const characterData = await fetchResponse.json();
        const character =
          (characterData.character ?? characterData.data ?? characterData) as Record<
            string,
            unknown
          >;

        // Build update payload
        const updatePayload: Record<string, unknown> = {};

        // Separate simple fields from array sub-item fields
        const simpleFields = [
          'description',
          'personality',
          'exampleDialogues',
          'talkativeness',
        ];
        const arrayFieldUpdates: Record<
          string,
          Array<{ subId: string | undefined; finalValue: string; title?: string }>
        > = {};

        for (const { suggestion, finalValue } of accepted) {
          if (simpleFields.includes(suggestion.field)) {
            updatePayload[suggestion.field] = finalValue;
          } else if (suggestion.field === 'scenarios') {
            if (!arrayFieldUpdates['scenarios']) {
              arrayFieldUpdates['scenarios'] = [];
            }
            arrayFieldUpdates['scenarios'].push({
              subId: suggestion.subId,
              finalValue,
              title: suggestion.title,
            });
          } else if (suggestion.subId) {
            if (!arrayFieldUpdates[suggestion.field]) {
              arrayFieldUpdates[suggestion.field] = [];
            }
            arrayFieldUpdates[suggestion.field].push({
              subId: suggestion.subId,
              finalValue,
            });
          }
        }

        // Handle scenarios array: update existing or add new
        if (arrayFieldUpdates['scenarios'] && arrayFieldUpdates['scenarios'].length > 0) {
          const existingScenarios =
            (character['scenarios'] as Array<Record<string, unknown>> | undefined) ?? [];
          const now = new Date().toISOString();
          let updatedScenarios = [...existingScenarios];

          for (const { subId, finalValue, title } of arrayFieldUpdates['scenarios']) {
            if (subId) {
              // Update existing scenario
              updatedScenarios = updatedScenarios.map((s) => {
                if (s.id === subId) {
                  return { ...s, content: finalValue, updatedAt: now };
                }
                return s;
              });
            } else {
              // Add new scenario
              updatedScenarios.push({
                id: randomUUID(),
                title: title ?? 'New Scenario',
                content: finalValue,
                createdAt: now,
                updatedAt: now,
              });
            }
          }
          updatePayload['scenarios'] = updatedScenarios;
        }

        // Handle array field updates by merging with existing character data
        // Map singular suggestion field names to plural character property names
        const arrayFieldMapping: Record<string, string> = {
          systemPrompt: 'systemPrompts',
          physicalDescription: 'physicalDescriptions',
          clothingRecord: 'clothingRecords',
        };
        for (const [singularName, pluralName] of Object.entries(arrayFieldMapping)) {
          const updates = arrayFieldUpdates[singularName];
          const fieldName = pluralName;
          if (!updates || updates.length === 0) continue;

          const existingArray =
            (character[fieldName] as Array<Record<string, unknown>> | undefined) ?? [];
          // Determine which property to update based on field type
          const contentField = singularName === 'clothingRecord' ? 'description'
            : singularName === 'physicalDescription' ? 'fullDescription'
            : 'content'; // systemPrompt
          const updatedArray = existingArray.map((item) => {
            const matchingUpdate = updates.find((u) => u.subId === item.id);
            if (matchingUpdate) {
              return { ...item, [contentField]: matchingUpdate.finalValue };
            }
            return item;
          });
          updatePayload[fieldName] = updatedArray;
        }

        // Commit the update
        const putResponse = await fetch(`/api/v1/characters/${characterId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updatePayload),
        });

        if (!putResponse.ok) {
          const errorData = await putResponse.json();
          throw new Error(
            (errorData.error as string | undefined) ??
              'The amendments could not be inscribed into the character record.'
          );
        }
      } catch (err) {
        const errorMessage =
          err instanceof Error
            ? err.message
            : 'The application of refinements met with an unforeseen impediment.';
        setError(errorMessage);
      } finally {
        setApplying(false);
      }
    },
    [getAcceptedChanges]
  );

  const reset = useCallback(() => {
    setPhase('preflight');
    setAnalysis(null);
    setSuggestions([]);
    suggestionsRef.current = [];
    setCurrentIndex(0);
    setDecisions(new Map());
    setEditedValues(new Map());
    setError(null);
    setMemoryCount(0);
    setLoading(false);
    setProgressStep(null);
    setProgressSubStep(null);
    setNoSuggestionsMessage(null);
    setApplying(false);
    setFilteredCount(0);
    setStartedAt(null);
    setSuggestionsFilePath(null);
    outputModeRef.current = 'apply';
  }, []);

  return {
    phase,
    analysis,
    suggestions,
    currentIndex,
    decisions,
    editedValues,
    error,
    memoryCount,
    filteredCount,
    loading,
    progressStep,
    progressSubStep,
    noSuggestionsMessage,
    applying,
    startedAt,
    suggestionsFilePath,
    startOptimization,
    decideSuggestion,
    editSuggestion,
    goToSuggestion,
    nextSuggestion,
    prevSuggestion,
    getAcceptedChanges,
    applyChanges,
    reset,
    setPhase,
  };
}
