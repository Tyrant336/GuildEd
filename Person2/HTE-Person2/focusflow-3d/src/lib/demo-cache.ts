/**
 * Demo fallback: read pre-cached JSON responses from public/demo-cache/*.json
 * Supports DEMO_FALLBACK=1 env var, x-demo-fallback: 1 header, or ?demo=1 query param
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';

// Try multiple resolution strategies for Vercel serverless compatibility
function resolveCacheDir(): string {
  const candidates = [
    path.join(process.cwd(), 'public', 'demo-cache'),
    path.join(process.cwd(), '.next', 'server', 'public', 'demo-cache'),
    path.resolve('public', 'demo-cache'),
  ];
  for (const dir of candidates) {
    if (existsSync(dir)) return dir;
  }
  return candidates[0]; // fallback to default
}

const CACHE_DIR = resolveCacheDir();

function isDemoFallbackRequest(headers: Headers, url: string): boolean {
  if (headers.get('x-demo-fallback') === '1') return true;
  try {
    const u = new URL(url);
    return u.searchParams.get('demo') === '1';
  } catch {
    return false;
  }
}

export function wantDemoFallback(headers: Headers, url: string): boolean {
  return process.env.DEMO_FALLBACK === '1' || isDemoFallbackRequest(headers, url);
}

export function readDemoCache<T>(filename: string): T | null {
  const filePath = path.join(CACHE_DIR, filename);
  if (!existsSync(filePath)) return null;
  try {
    const raw = readFileSync(filePath, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export const DEMO_FILES = {
  ingest: 'ingest.json',
  quiz: 'quiz-binary-search-medium.json',
  explain: 'explain-binary-search-step-by-step.json',
  sessionSummary: 'session-summary.json',
} as const;
