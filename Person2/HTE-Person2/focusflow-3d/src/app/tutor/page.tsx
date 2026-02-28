'use client';

/**
 * AI 導師聊天 — useChat 風格串流 + learnerState 從 Zustand 傳入（新需求 12-16h）
 */
import { useState, useCallback } from 'react';
import { useFocusFlowStore } from '@/store/useFocusFlowStore';

type Message = { role: 'user' | 'assistant'; content: string };

export default function TutorPage() {
  const learnerState = useFocusFlowStore((s) => s.learnerState);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput('');
    const userMessage: Message = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMessage]);
    setLoading(true);

    try {
      const res = await fetch('/api/tutor', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [...messages, userMessage].map((m) => ({ role: m.role, content: m.content })),
          learnerState: learnerState ?? undefined,
        }),
      });
      if (!res.ok || !res.body) throw new Error(res.statusText);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantContent = '';
      setMessages((prev) => [...prev, { role: 'assistant', content: '' }]);
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        assistantContent += decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === 'assistant') next[next.length - 1] = { ...last, content: assistantContent };
          return next;
        });
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : 'Unknown error';
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${err}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, learnerState]);

  return (
    <div className="mx-auto max-w-2xl p-4">
      <h1 className="mb-4 text-xl font-semibold">EDU Oasis — AI Tutor</h1>
      <p className="mb-2 text-sm text-gray-600">
        學習者狀態已從 Zustand 傳入（cognitive_state: {learnerState?.cognitive_state ?? '—'}）
      </p>
      <div className="mb-4 space-y-2 rounded border border-gray-200 bg-gray-50 p-3">
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : ''}>
            <span className="text-xs text-gray-500">{m.role}</span>
            <div className="whitespace-pre-wrap rounded px-2 py-1">{m.content || '…'}</div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <input
          className="flex-1 rounded border border-gray-300 px-3 py-2"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder="輸入訊息..."
          disabled={loading}
        />
        <button
          type="button"
          onClick={send}
          disabled={loading}
          className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {loading ? '送出中…' : '送出'}
        </button>
      </div>
    </div>
  );
}
