/**
 * EDU Oasis — Adaptive Engine Core Logic (Person 6)
 * Spaced repetition, prerequisite locking, mastery updates, cognitive assessment.
 */

import type { ConceptNode, ExplanationMode, LearnerStateSnapshot } from './types';

// ─── Mastery Update Rules (PRD §5.1.2) ──────────────────────────────────────

const DIFFICULTY_BONUS: Record<string, number> = {
  easy: 10,
  medium: 12,
  hard: 15,
};

export type InteractionEvent =
  | { type: 'quiz_correct'; concept_id: string; difficulty: 'easy' | 'medium' | 'hard' }
  | { type: 'quiz_incorrect'; concept_id: string; error_pattern?: string }
  | { type: 'explanation_read'; concept_id: string }
  | { type: 'explain_differently'; concept_id: string; new_mode: ExplanationMode }
  | { type: 'challenge_complete'; concept_id: string; difficulty: 'easy' | 'medium' | 'hard' };

export interface MasteryDelta {
  concept_id: string;
  mastery_change: number;
  new_mastery: number;
  error_pattern_added?: string;
  preferred_mode_update?: ExplanationMode;
}

export function computeMasteryUpdate(
  event: InteractionEvent,
  currentMastery: number,
): MasteryDelta {
  const clamped = (v: number) => Math.max(0, Math.min(100, v));
  const base: MasteryDelta = {
    concept_id: event.concept_id,
    mastery_change: 0,
    new_mastery: currentMastery,
  };

  switch (event.type) {
    case 'quiz_correct': {
      const gain = DIFFICULTY_BONUS[event.difficulty] ?? 12;
      base.mastery_change = gain;
      base.new_mastery = clamped(currentMastery + gain);
      break;
    }
    case 'quiz_incorrect': {
      base.mastery_change = -5;
      base.new_mastery = clamped(currentMastery - 5);
      if (event.error_pattern) base.error_pattern_added = event.error_pattern;
      break;
    }
    case 'explanation_read': {
      base.mastery_change = 5;
      base.new_mastery = clamped(currentMastery + 5);
      break;
    }
    case 'explain_differently': {
      base.mastery_change = 0;
      base.new_mastery = currentMastery;
      base.preferred_mode_update = event.new_mode;
      break;
    }
    case 'challenge_complete': {
      const gain = event.difficulty === 'hard' ? 20 : event.difficulty === 'medium' ? 17 : 15;
      base.mastery_change = gain;
      base.new_mastery = clamped(currentMastery + gain);
      break;
    }
  }
  return base;
}

// ─── Spaced Repetition (PRD §5.3.3) ─────────────────────────────────────────

/**
 * Applies time-decay to mastery. Returns adjusted mastery (never below 0).
 * Uses simplified Ebbinghaus curve: decay = days_since * (1 - mastery/150)
 * High-mastery concepts decay slower.
 */
export function applyTimeDecay(mastery: number, lastSeenIso: string): number {
  const daysSince = (Date.now() - new Date(lastSeenIso).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince < 0.04) return mastery; // < 1 hour — no decay
  const decayRate = Math.max(0, 1 - mastery / 150); // higher mastery → slower decay
  const decayed = mastery - daysSince * decayRate * 3;
  return Math.max(0, Math.round(decayed * 10) / 10);
}

// ─── Prerequisite Locking (PRD §5.3.1) ──────────────────────────────────────

const PREREQUISITE_THRESHOLD = 70;

export interface ConceptLockState {
  concept_id: string;
  locked: boolean;
  unmet_prerequisites: string[];
}

export function computePrerequisiteLocks(
  concepts: ConceptNode[],
  masteryMap: Record<string, number>,
): ConceptLockState[] {
  return concepts.map((c) => {
    const unmet = (c.prerequisites ?? []).filter(
      (preReqId) => (masteryMap[preReqId] ?? 0) < PREREQUISITE_THRESHOLD,
    );
    return { concept_id: c.concept_id, locked: unmet.length > 0, unmet_prerequisites: unmet };
  });
}

// ─── Cognitive State Assessment (PRD §5.2) ───────────────────────────────────

export type CognitiveState = 'focused' | 'okay' | 'drifting' | 'done';

export interface BehavioralSignals {
  avg_time_on_chunk_ms?: number;
  current_chunk_time_ms?: number;
  explain_differently_count?: number;
  recent_quiz_speed_ms?: number;
  recent_quiz_correct?: boolean;
}

export interface SessionParams {
  cognitive_state: CognitiveState;
  chunk_size: 'short' | 'medium' | 'long';
  difficulty_bias: 'easier' | 'normal' | 'harder';
  preferred_modality: ExplanationMode;
  suggest_break: boolean;
}

export function assessCognitive(
  explicit_checkin: CognitiveState | null,
  signals: BehavioralSignals,
  currentModalityPref: ExplanationMode,
): SessionParams {
  let state: CognitiveState = explicit_checkin ?? 'okay';

  // Implicit signals override if no explicit check-in
  if (!explicit_checkin) {
    const { avg_time_on_chunk_ms, current_chunk_time_ms, explain_differently_count } = signals;
    if (avg_time_on_chunk_ms && current_chunk_time_ms) {
      const ratio = current_chunk_time_ms / avg_time_on_chunk_ms;
      if (ratio < 0.3) state = 'focused'; // zipping through → focused
      if (ratio > 2.0) state = 'drifting'; // stuck → drifting
    }
    if ((explain_differently_count ?? 0) >= 3) state = 'drifting';
  }

  // Quiz speed+accuracy signals (PRD §5.2.2)
  if (signals.recent_quiz_speed_ms !== undefined && signals.recent_quiz_correct !== undefined) {
    const fast = signals.recent_quiz_speed_ms < 5000;
    if (fast && signals.recent_quiz_correct && state === 'okay') state = 'focused';
    if (fast && !signals.recent_quiz_correct && state !== 'done') state = 'drifting';
  }

  const params: SessionParams = {
    cognitive_state: state,
    chunk_size: state === 'focused' ? 'long' : state === 'drifting' ? 'short' : 'medium',
    difficulty_bias: state === 'focused' ? 'harder' : state === 'drifting' ? 'easier' : 'normal',
    preferred_modality: currentModalityPref,
    suggest_break: state === 'done',
  };

  // Drifting → prefer visual or interactive content
  if (state === 'drifting' && currentModalityPref === 'step-by-step') {
    params.preferred_modality = 'visual';
  }

  return params;
}

// ─── Next Action Decision Engine (PRD §5.4) ─────────────────────────────────

export type RoomCommand =
  | { type: 'deep_focus'; dimLevel: number }
  | { type: 'drift_mode'; glowIntensity: number }
  | { type: 'neutral' }
  | { type: 'session_end' }
  | { type: 'unlock_concept'; concept_id: string }
  | { type: 'lock_concept'; concept_id: string };

export interface NextAction {
  next_concept_id: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  modality: ExplanationMode;
  chunk_size: 'short' | 'medium' | 'long';
  activity: 'explanation' | 'quiz' | 'challenge' | 'review' | 'break';
  room_commands: RoomCommand[];
  reasoning: string;
}

export function decideNextAction(
  concepts: ConceptNode[],
  learnerState: LearnerStateSnapshot,
  sessionParams: SessionParams,
  locks: ConceptLockState[],
): NextAction {
  const lockedIds = new Set(locks.filter((l) => l.locked).map((l) => l.concept_id));
  const now = new Date().toISOString();

  // Build mastery-annotated concept list (with time decay)
  const annotated = concepts.map((c) => {
    const stateData = learnerState.concepts[c.concept_id];
    const rawMastery = stateData?.mastery ?? c.mastery;
    const lastSeen = stateData?.last_seen ?? c.last_seen ?? now;
    const decayedMastery = applyTimeDecay(rawMastery, lastSeen);
    return { ...c, decayedMastery, locked: lockedIds.has(c.concept_id), lastSeen };
  });

  // Filter unlocked, sort by zone of proximal development (30-70% priority)
  const available = annotated.filter((c) => !c.locked);
  const zpd = available.filter((c) => c.decayedMastery >= 30 && c.decayedMastery < 70);
  const needsReview = available.filter((c) => c.decayedMastery > 0 && c.decayedMastery < 30);
  const fresh = available.filter((c) => c.decayedMastery === 0);

  // Handle session end
  if (sessionParams.cognitive_state === 'done') {
    return {
      next_concept_id: null,
      difficulty: 'easy',
      modality: sessionParams.preferred_modality,
      chunk_size: 'short',
      activity: 'break',
      room_commands: [{ type: 'session_end' }],
      reasoning: 'Student indicated they are done. Generate session summary.',
    };
  }

  // Pick next concept: ZPD first, then needs-review, then fresh
  const pool = zpd.length > 0 ? zpd : needsReview.length > 0 ? needsReview : fresh;
  // Sort: lowest mastery first (most benefit from study)
  pool.sort((a, b) => a.decayedMastery - b.decayedMastery);
  const nextConcept = pool[0] ?? available[0] ?? null;

  // Decide activity based on mastery + cognitive state
  let activity: NextAction['activity'] = 'explanation';
  if (nextConcept) {
    if (nextConcept.decayedMastery >= 50 && sessionParams.cognitive_state !== 'drifting') {
      activity = 'quiz'; // test what they partially know
    } else if (nextConcept.decayedMastery >= 30 && sessionParams.cognitive_state === 'drifting') {
      activity = 'challenge'; // hands-on for engagement
    } else if (nextConcept.decayedMastery > 0 && nextConcept.decayedMastery < 30) {
      activity = 'review';
    }
  }

  // Decide difficulty
  let difficulty: 'easy' | 'medium' | 'hard' = 'medium';
  if (sessionParams.difficulty_bias === 'easier') difficulty = 'easy';
  if (sessionParams.difficulty_bias === 'harder') difficulty = 'hard';

  // Room commands
  const roomCommands: RoomCommand[] = [];
  if (sessionParams.cognitive_state === 'focused') {
    roomCommands.push({ type: 'deep_focus', dimLevel: 0.7 });
  } else if (sessionParams.cognitive_state === 'drifting') {
    roomCommands.push({ type: 'drift_mode', glowIntensity: 0.8 });
  } else {
    roomCommands.push({ type: 'neutral' });
  }

  // Add lock/unlock commands for concepts that changed
  locks.forEach((l) => {
    if (l.locked) {
      roomCommands.push({ type: 'lock_concept', concept_id: l.concept_id });
    } else {
      roomCommands.push({ type: 'unlock_concept', concept_id: l.concept_id });
    }
  });

  return {
    next_concept_id: nextConcept?.concept_id ?? null,
    difficulty,
    modality: sessionParams.preferred_modality,
    chunk_size: sessionParams.chunk_size,
    activity,
    room_commands: roomCommands,
    reasoning: nextConcept
      ? `Selected "${nextConcept.name}" (mastery: ${nextConcept.decayedMastery.toFixed(0)}%) from ${pool === zpd ? 'ZPD zone' : pool === needsReview ? 'review needed' : 'fresh concepts'}. Cognitive state: ${sessionParams.cognitive_state}.`
      : 'No available concepts. All may be locked or mastered.',
  };
}
