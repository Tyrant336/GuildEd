/**
 * EDU Oasis - PRD data models (Section 5.1.1)
 * Person 2: AI Backend — shared with Adaptive Engine (P6)
 */

export interface ConceptNode {
  concept_id: string;
  name: string;
  description?: string;
  mastery: number;
  attempts: number;
  last_seen: string; // ISO
  error_patterns: string[];
  preferred_mode: 'visual' | 'analogy' | 'step-by-step' | 'socratic';
  prerequisites: string[];
}

export interface KnowledgeGraph {
  concepts: ConceptNode[];
  edges: { from: string; to: string }[]; // prerequisite links
  source_document_id?: string;
  extracted_at: string; // ISO
}

export type ExplanationMode = 'visual' | 'analogy' | 'step-by-step' | 'socratic';

export interface QuizQuestion {
  concept_id: string;
  question: string;
  options: string[];
  correct_index: number;
  difficulty: 'easy' | 'medium' | 'hard';
  explanation?: string;
}

export interface LearnerStateSnapshot {
  concepts: Record<string, { mastery: number; last_seen: string; error_patterns: string[] }>;
  cognitive_state: 'focused' | 'okay' | 'drifting' | 'done';
  session_minutes?: number;
}
