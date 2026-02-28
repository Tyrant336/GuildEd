/**
 * POST /api/tutor — AI 導師聊天（串流）(Person 2, 12-16h)
 * Body: { messages: Array<{ role: 'user'|'assistant'|'system', content: string }>, learnerState?: LearnerStateSnapshot }
 * 整合學習者模型：弱項、認知狀態、偏好模態
 */
import { NextRequest, NextResponse } from 'next/server';
import { streamText } from 'ai';
import { getModel } from '@/lib/llm';
import type { LearnerStateSnapshot } from '@/lib/types';

export const maxDuration = 60;

const systemPromptFromState = (state?: LearnerStateSnapshot | null): string => {
  if (!state) {
    return `You are a supportive AI tutor in EDU Oasis, an immersive learning environment for neurodivergent students. Be concise, kind, and adaptive. Suggest activities (whiteboard concept, quiz, lab challenge, bookshelf) when relevant.`;
  }
  const weak = state.concepts
    ? Object.entries(state.concepts)
      .filter(([, v]) => v.mastery < 70)
      .map(([id]) => id)
      .slice(0, 5)
    : [];
  const cognitive = state.cognitive_state ?? 'okay';
  let prompt = `You are the AI tutor in EDU Oasis for neurodivergent learners. Be concise and adaptive.
Current cognitive state: ${cognitive}.`;
  if (cognitive === 'focused') prompt += ' Student is focused — suggest deeper content, fewer interruptions.';
  if (cognitive === 'drifting') prompt += ' Student may be drifting — suggest a change of activity (e.g. lab bench, short quiz).';
  if (weak.length) prompt += ` Weak or unmastered concepts to prioritize when relevant: ${weak.join(', ')}.`;
  return prompt;
};

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const messages = body.messages as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
    const learnerState = body.learnerState as LearnerStateSnapshot | undefined;

    if (!Array.isArray(messages) || messages.length === 0) {
      return NextResponse.json({ error: 'messages array required' }, { status: 400 });
    }

    const system = systemPromptFromState(learnerState);
    const history = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role as 'user' | 'assistant' | 'system', content: m.content }));

    const result = streamText({
      model: getModel(true),
      system,
      messages: history,
      maxOutputTokens: 1024,
      maxRetries: 0,
    });

    return result.toTextStreamResponse();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
