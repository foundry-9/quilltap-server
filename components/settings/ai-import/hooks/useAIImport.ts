'use client';

/**
 * useAIImport Hook
 *
 * State management for the AI character import wizard.
 * Handles file uploads, SSE streaming, and import execution.
 */

import { useState, useCallback, useEffect, useMemo } from 'react';
import type { ConnectionProfile } from '@/lib/schemas/types';
import type { QuilltapExport } from '@/lib/export/types';
import type {
  WizardUIStep,
  AIImportStepName,
  StepProgress,
  AIImportOptions,
  UploadedSourceFile,
  AIImportGenerationState,
} from '../types';

const INITIAL_STEPS: Record<AIImportStepName, StepProgress> = {
  analyzing: { status: 'pending' },
  character_basics: { status: 'pending' },
  first_message: { status: 'pending' },
  system_prompts: { status: 'pending' },
  physical_descriptions: { status: 'pending' },
  wardrobe_items: { status: 'pending' },
  pronouns: { status: 'pending' },
  memories: { status: 'pending' },
  chats: { status: 'pending' },
  assembly: { status: 'pending' },
  validation: { status: 'pending' },
  repair: { status: 'pending' },
};

export function useAIImport() {
  // Wizard navigation
  const [currentStep, setCurrentStep] = useState<WizardUIStep>(1);

  // Step 1: Source material
  const [uploadedFiles, setUploadedFiles] = useState<UploadedSourceFile[]>([]);
  const [sourceText, setSourceText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Step 2: Configuration
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [loadingProfiles, setLoadingProfiles] = useState(true);
  const [profileId, setProfileId] = useState('');
  const [includeMemories, setIncludeMemories] = useState(true);
  const [includeChats, setIncludeChats] = useState(false);

  // Step 3 & 4: Generation
  const [generation, setGeneration] = useState<AIImportGenerationState>({
    generating: false,
    steps: { ...INITIAL_STEPS },
    result: null,
    stepResults: null,
    errors: {},
  });
  const [error, setError] = useState<string | null>(null);

  // Import state
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    importedCount: number;
    warnings: string[];
  } | null>(null);

  // Fetch connection profiles on mount
  useEffect(() => {
    const fetchProfiles = async () => {
      try {
        setLoadingProfiles(true);
        const response = await fetch('/api/v1/connection-profiles');
        if (!response.ok) {
          throw new Error('Failed to fetch connection profiles');
        }
        const data = await response.json();
        const profileList = data.profiles || [];
        setProfiles(profileList);

        // Auto-select default profile
        const defaultProfile = profileList.find((p: ConnectionProfile) => p.isDefault);
        if (defaultProfile) {
          setProfileId(defaultProfile.id);
        } else if (profileList.length > 0) {
          setProfileId(profileList[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch profiles for AI import', {
          error: err instanceof Error ? err.message : String(err),
        });
        setError('Failed to load connection profiles');
      } finally {
        setLoadingProfiles(false);
      }
    };

    fetchProfiles();
  }, []);

  // Computed: Can proceed to next step?
  const canProceed = useMemo(() => {
    switch (currentStep) {
      case 1:
        return uploadedFiles.length > 0 || sourceText.trim().length > 0;
      case 2:
        return !!profileId;
      case 3:
        return !generation.generating;
      case 4:
        return !!generation.result;
      default:
        return false;
    }
  }, [currentStep, uploadedFiles.length, sourceText, profileId, generation.generating, generation.result]);

  // Computed: Character name from results
  const characterName = useMemo(() => {
    if (!generation.stepResults) return null;
    const basics = generation.stepResults.character_basics as { name?: string } | undefined;
    return basics?.name || null;
  }, [generation.stepResults]);

  // Navigation
  const nextStep = useCallback(() => {
    if (currentStep < 4) {
      setCurrentStep((prev) => (prev + 1) as WizardUIStep);
      setError(null);
    }
  }, [currentStep]);

  const prevStep = useCallback(() => {
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as WizardUIStep);
      setError(null);
    }
  }, [currentStep]);

  const goToStep = useCallback((step: WizardUIStep) => {
    setCurrentStep(step);
    setError(null);
  }, []);

  // File upload
  const uploadFiles = useCallback(async (files: File[]) => {
    setUploading(true);
    setUploadError(null);

    try {
      const newFiles: UploadedSourceFile[] = [];

      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);

        const response = await fetch('/api/v1/files?action=upload', {
          method: 'POST',
          body: formData,
        });

        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || `Failed to upload ${file.name}`);
        }

        newFiles.push({
          id: data.data.id,
          name: file.name,
          size: file.size,
        });
      }

      setUploadedFiles((prev) => [...prev, ...newFiles]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }, []);

  const removeFile = useCallback((fileId: string) => {
    setUploadedFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  // Generation
  const startGeneration = useCallback(
    async (regenerateSteps?: AIImportStepName[]) => {
      setGeneration((prev) => ({
        ...prev,
        generating: true,
        steps: { ...INITIAL_STEPS },
        errors: {},
      }));
      setError(null);

      // Auto-advance to step 3 if not already there
      setCurrentStep(3);

      try {
        const body = {
          profileId,
          sourceFileIds: uploadedFiles.map((f) => f.id),
          sourceText,
          includeMemories,
          includeChats,
          existingResult: regenerateSteps ? generation.stepResults : undefined,
          regenerateSteps,
        };

        const response = await fetch('/api/v1/system/tools?action=ai-import-stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Generation failed');
        }

        // Parse SSE stream
        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('No response stream');
        }

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
                  case 'step_start':
                    setGeneration((prev) => ({
                      ...prev,
                      steps: {
                        ...prev.steps,
                        [event.step as AIImportStepName]: { status: 'in_progress' },
                      },
                    }));
                    break;

                  case 'step_complete':
                    setGeneration((prev) => ({
                      ...prev,
                      steps: {
                        ...prev.steps,
                        [event.step as AIImportStepName]: {
                          status: 'complete',
                          snippet: event.snippet,
                        },
                      },
                    }));
                    break;

                  case 'step_error':
                    setGeneration((prev) => ({
                      ...prev,
                      steps: {
                        ...prev.steps,
                        [event.step as AIImportStepName]: {
                          status: 'error',
                          error: event.error,
                        },
                      },
                      errors: {
                        ...prev.errors,
                        [event.step]: event.error || 'Step failed',
                      },
                    }));
                    break;

                  case 'done':
                    setGeneration((prev) => ({
                      ...prev,
                      generating: false,
                      result: event.result || prev.result,
                      stepResults: event.stepResults || prev.stepResults,
                      errors: event.errors || prev.errors,
                    }));
                    if (event.result) {
                      // Auto-advance to review step
                      setCurrentStep(4);
                    }
                    if (event.error) {
                      setError(event.error);
                    }
                    break;
                }
              } catch {
                // Ignore parse errors for incomplete JSON
              }
            }
          }
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Generation failed';
        setError(errorMessage);
        setGeneration((prev) => ({ ...prev, generating: false }));
        console.error('AI Import generation failed', { error: errorMessage });
      }
    },
    [profileId, uploadedFiles, sourceText, includeMemories, includeChats, generation.stepResults]
  );

  // Import the generated .qtap data
  const importCharacter = useCallback(async () => {
    if (!generation.result) return;

    setImporting(true);
    setError(null);

    try {
      const response = await fetch('/api/v1/system/tools?action=import-execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          exportData: generation.result,
          options: {
            conflictStrategy: 'duplicate',
            importMemories: true,
          },
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Import failed');
      }

      setImportResult({
        success: data.success,
        importedCount: data.imported || 0,
        warnings: data.warnings || [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }, [generation.result]);

  // Reset wizard completely
  const reset = useCallback(() => {
    setCurrentStep(1);
    setUploadedFiles([]);
    setSourceText('');
    setUploadError(null);
    setGeneration({
      generating: false,
      steps: { ...INITIAL_STEPS },
      result: null,
      stepResults: null,
      errors: {},
    });
    setError(null);
    setImportResult(null);
  }, []);

  // Go back to add more material (preserves existing results)
  const addMoreMaterial = useCallback(() => {
    setCurrentStep(1);
    setError(null);
    setImportResult(null);
  }, []);

  return {
    // Wizard state
    currentStep,
    canProceed,
    characterName,
    error,

    // Step 1: Source material
    uploadedFiles,
    sourceText,
    uploading,
    uploadError,
    setSourceText,
    uploadFiles,
    removeFile,

    // Step 2: Configuration
    profiles,
    loadingProfiles,
    profileId,
    includeMemories,
    includeChats,
    setProfileId,
    setIncludeMemories,
    setIncludeChats,

    // Step 3 & 4: Generation
    generation,
    startGeneration,

    // Import
    importing,
    importResult,
    importCharacter,

    // Navigation
    nextStep,
    prevStep,
    goToStep,

    // Actions
    reset,
    addMoreMaterial,
  };
}
