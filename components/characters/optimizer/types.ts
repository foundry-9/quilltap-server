export interface OptimizerConnectionProfile {
  id: string;
  name: string;
}

export interface BehavioralPattern {
  pattern: string;
  evidence: string;
  frequency: string;
}

export interface OptimizerAnalysis {
  behavioralPatterns: BehavioralPattern[];
  summary: string;
}

export interface OptimizerSuggestion {
  id: string;
  field: string;
  subId?: string;
  subName?: string;
  title?: string;
  currentValue: string;
  proposedValue: string;
  rationale: string;
  significance: number;
  memoryExcerpts: string[];
}

export type OptimizerPhase = 'preflight' | 'progress' | 'review' | 'apply';

export type SuggestionDecision = 'accepted' | 'rejected' | 'edited';

export interface OptimizerState {
  phase: OptimizerPhase;
  analysis: OptimizerAnalysis | null;
  suggestions: OptimizerSuggestion[];
  currentIndex: number;
  decisions: Map<string, SuggestionDecision>;
  editedValues: Map<string, string>;
  error: string | null;
  memoryCount: number;
  loading: boolean;
}

export interface OptimizerFilterOptions {
  maxMemories: number;
  searchQuery: string;
  useSemanticSearch: boolean;
  sinceDate: string | null;
  beforeDate: string | null;
}

export interface CharacterOptimizerModalProps {
  characterId: string;
  characterName: string;
  profiles: OptimizerConnectionProfile[];
  defaultConnectionProfileId?: string;
  onClose: () => void;
  onApplied: () => void;
}
