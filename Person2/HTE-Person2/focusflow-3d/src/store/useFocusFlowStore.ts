/**
 * EDU Oasis — Zustand store (Person 6: enhanced with full PRD §5.1.1 learner model)
 * Client-side state management matching Supabase PostgreSQL schema.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { KnowledgeGraph, LearnerStateSnapshot, ExplanationMode } from '@/lib/types';
import type {
  InteractionEvent,
  CognitiveState,
  SessionParams,
  NextAction,
  ConceptLockState,
} from '@/lib/adaptive';

// ─── Learner Model (PRD §5.1.1 — matches Supabase PostgreSQL table) ────────

export interface LearnerConceptRecord {
  concept_id: string;
  user_id: string;
  mastery: number;          // 0-100
  attempts: number;
  last_seen: string;        // ISO timestamp
  error_patterns: string[];
  preferred_mode: ExplanationMode;
  prerequisites: string[];
}

// ─── Store Interface ────────────────────────────────────────────────────────

interface FocusFlowState {
  // Knowledge graph (from /api/ingest)
  knowledgeGraph: KnowledgeGraph | null;
  setKnowledgeGraph: (graph: KnowledgeGraph | null) => void;

  // Learner state snapshot (for API calls)
  learnerState: LearnerStateSnapshot;
  setLearnerState: (state: LearnerStateSnapshot) => void;
  updateLearnerConcept: (conceptId: string, mastery: number, lastSeen: string, errorPatterns?: string[]) => void;
  setCognitiveState: (state: CognitiveState) => void;

  // Full learner concept records (PRD §5.1.1 schema)
  conceptRecords: Record<string, LearnerConceptRecord>;
  upsertConceptRecord: (record: Partial<LearnerConceptRecord> & { concept_id: string }) => void;
  initConceptRecordsFromGraph: (graph: KnowledgeGraph, userId?: string) => void;

  // Cognitive session params (from assessCognitiveState)
  sessionParams: SessionParams | null;
  setSessionParams: (params: SessionParams) => void;

  // Next action (from getNextAction)
  currentAction: NextAction | null;
  setCurrentAction: (action: NextAction | null) => void;

  // Prerequisite locks
  conceptLocks: ConceptLockState[];
  setConceptLocks: (locks: ConceptLockState[]) => void;

  // Active panel state (which panel is open above 3D scene)
  activePanel: string | null;
  setActivePanel: (panel: string | null) => void;

  // Selected concept (from 3D whiteboard click)
  selectedConceptId: string | null;
  setSelectedConceptId: (id: string | null) => void;

  // Session tracking
  sessionStartTime: string | null;
  startSession: () => void;
  getSessionMinutes: () => number;

  // Interaction event queue (batch before sending to API)
  pendingEvents: InteractionEvent[];
  pushEvent: (event: InteractionEvent) => void;
  clearEvents: () => void;

  reset: () => void;
}

const defaultLearnerState: LearnerStateSnapshot = {
  concepts: {},
  cognitive_state: 'okay',
  session_minutes: 0,
};

export const useFocusFlowStore = create<FocusFlowState>()(
  persist(
    (set, get) => ({
  // ── Knowledge Graph ───────────────────────────────────
  knowledgeGraph: null,
  setKnowledgeGraph: (knowledgeGraph) => set({ knowledgeGraph }),

  // ── Learner State Snapshot ────────────────────────────
  learnerState: { ...defaultLearnerState },
  setLearnerState: (learnerState) => set({ learnerState }),
  updateLearnerConcept: (conceptId, mastery, lastSeen, errorPatterns = []) =>
    set((s) => {
      const concepts = { ...s.learnerState.concepts };
      concepts[conceptId] = { mastery, last_seen: lastSeen, error_patterns: errorPatterns };
      return { learnerState: { ...s.learnerState, concepts } };
    }),
  setCognitiveState: (cognitive_state) =>
    set((s) => ({
      learnerState: { ...s.learnerState, cognitive_state },
    })),

  // ── Full Concept Records ──────────────────────────────
  conceptRecords: {},
  upsertConceptRecord: (partial) =>
    set((s) => {
      const existing = s.conceptRecords[partial.concept_id] ?? {
        concept_id: partial.concept_id,
        user_id: 'demo-user',
        mastery: 0,
        attempts: 0,
        last_seen: new Date().toISOString(),
        error_patterns: [],
        preferred_mode: 'step-by-step' as ExplanationMode,
        prerequisites: [],
      };
      return {
        conceptRecords: {
          ...s.conceptRecords,
          [partial.concept_id]: { ...existing, ...partial },
        },
      };
    }),
  initConceptRecordsFromGraph: (graph, userId = 'demo-user') =>
    set(() => {
      const records: Record<string, LearnerConceptRecord> = {};
      const concepts: LearnerStateSnapshot['concepts'] = {};
      const now = new Date().toISOString();
      for (const c of graph.concepts) {
        records[c.concept_id] = {
          concept_id: c.concept_id,
          user_id: userId,
          mastery: c.mastery ?? 0,
          attempts: c.attempts ?? 0,
          last_seen: c.last_seen ?? now,
          error_patterns: c.error_patterns ?? [],
          preferred_mode: c.preferred_mode ?? 'step-by-step',
          prerequisites: c.prerequisites ?? [],
        };
        concepts[c.concept_id] = {
          mastery: c.mastery ?? 0,
          last_seen: c.last_seen ?? now,
          error_patterns: c.error_patterns ?? [],
        };
      }
      return {
        conceptRecords: records,
        learnerState: { concepts, cognitive_state: 'okay', session_minutes: 0 },
      };
    }),

  // ── Session Params ────────────────────────────────────
  sessionParams: null,
  setSessionParams: (sessionParams) => set({ sessionParams }),

  // ── Next Action ───────────────────────────────────────
  currentAction: null,
  setCurrentAction: (currentAction) => set({ currentAction }),

  // ── Prerequisite Locks ────────────────────────────────
  conceptLocks: [],
  setConceptLocks: (conceptLocks) => set({ conceptLocks }),

  // ── Active Panel ──────────────────────────────────────
  activePanel: null,
  setActivePanel: (activePanel) => set({ activePanel }),

  // ── Selected Concept ──────────────────────────────────
  selectedConceptId: null,
  setSelectedConceptId: (selectedConceptId) => set({ selectedConceptId }),

  // ── Session Tracking ──────────────────────────────────
  sessionStartTime: null,
  startSession: () => set({ sessionStartTime: new Date().toISOString() }),
  getSessionMinutes: () => {
    const start = get().sessionStartTime;
    if (!start) return 0;
    return Math.round((Date.now() - new Date(start).getTime()) / 60000);
  },

  // ── Event Queue ───────────────────────────────────────
  pendingEvents: [],
  pushEvent: (event) => set((s) => ({ pendingEvents: [...s.pendingEvents, event] })),
  clearEvents: () => set({ pendingEvents: [] }),

  // ── Reset ─────────────────────────────────────────────
  reset: () =>
    set({
      knowledgeGraph: null,
      learnerState: { ...defaultLearnerState },
      conceptRecords: {},
      sessionParams: null,
      currentAction: null,
      conceptLocks: [],
      activePanel: null,
      selectedConceptId: null,
      sessionStartTime: null,
      pendingEvents: [],
    }),
}),
    {
      name: 'edu-oasis-store',
      partialize: (state) => ({
        knowledgeGraph: state.knowledgeGraph,
        learnerState: state.learnerState,
        conceptRecords: state.conceptRecords,
        sessionStartTime: state.sessionStartTime,
      }),
    }
  )
);
