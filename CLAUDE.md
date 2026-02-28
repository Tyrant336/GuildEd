# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

EDU Oasis is an immersive 3D adaptive learning platform built for the HKUST Hackathon 2026. Users upload PDFs, which are parsed into a knowledge graph of concepts with prerequisite edges. A 3D classroom (React Three Fiber) provides interactive hotspots that open panel-based learning activities (quizzes, explanations, AI tutor chat). An adaptive engine continuously adjusts difficulty, modality, and pacing based on mastery scores and cognitive state signals.

## Repository Layout

The application lives in `Person2/HTE-Person2/focusflow-3d/`. All commands must be run from that directory.

```
Person2/HTE-Person2/focusflow-3d/
├── src/app/              # Next.js 14 App Router (pages + API routes)
├── src/components/
│   ├── three/            # React Three Fiber scene (ClassroomScene.tsx)
│   ├── panels/           # 7 overlay panels (Upload, Whiteboard, Study, Quiz, Tutor, Bookshelf, EnergyCheckIn)
│   └── ui/               # shadcn/ui primitives (Radix + CVA)
├── src/lib/              # Core logic (adaptive engine, LLM abstraction, ingest, cache, types)
├── src/store/            # Zustand store (useFocusFlowStore.ts)
├── public/models/        # GLB 3D assets (classroom.glb, teacher.glb, character.glb)
├── public/demo-cache/    # Pre-cached JSON for offline demo mode
└── scripts/              # test-api.js, precache-demo.js
```

## Development Commands

```bash
cd Person2/HTE-Person2/focusflow-3d

# Install (--legacy-peer-deps required for Three.js peer dep conflicts)
npm install --legacy-peer-deps

# Dev server → http://localhost:3000
npm run dev

# Demo mode (no API keys needed)
DEMO_FALLBACK=1 npm run dev

# Build
npm run build

# Lint (ESLint + Next.js rules)
npm run lint

# Test API endpoints (requires running dev server)
npm run test:api

# Generate demo cache files from LLM
npm run precache

# LLM connectivity check
# GET http://localhost:3000/api/llm-test
```

There is no unit test framework configured (no Jest/Vitest).

## Tech Stack

- **Next.js 14** (App Router) + **React 18** + **TypeScript 5** (strict mode)
- **React Three Fiber 9** + **Drei 10** for the 3D classroom scene
- **Zustand 5** for client-side state management
- **Vercel AI SDK 6** for multi-LLM abstraction (streaming + structured outputs via Zod)
- **Tailwind CSS 3** + **Radix UI** (shadcn/ui) for panel styling
- **pdf-parse** for PDF text extraction

## Architecture

### State Management (Zustand)

`src/store/useFocusFlowStore.ts` is the single source of truth. Key slices:
- `knowledgeGraph` — concept DAG from `/api/ingest`
- `learnerState` — per-concept mastery, cognitive state, session time
- `conceptRecords` — detailed learner records per concept
- `sessionParams` — adaptive parameters (chunk size, difficulty bias, modality)
- `currentAction` — next recommended learning activity + room commands
- `conceptLocks` — prerequisite lock states
- `activePanel` — which panel overlay is open (or null)
- `pendingEvents` — batched interaction events debounced (1s) to adaptive API

### Adaptive Engine Loop

1. User actions (quiz answers, explanation reads) push `InteractionEvent` to store
2. Debounced flush calls three adaptive endpoints in sequence:
   - `POST /api/adaptive/knowledge-state` — mastery updates + time decay (Ebbinghaus) + prerequisite locks
   - `POST /api/adaptive/cognitive-state` — assess focus/drift from explicit + implicit signals
   - `POST /api/adaptive/next-action` — ZPD-first concept selection + room commands (lighting, locks)
3. Store updates trigger 3D scene reactions (hotspot colors, lighting, lock icons)

Core logic: `src/lib/adaptive.ts` (mastery scoring, time decay, ZPD selection, prerequisite locks)

### Multi-LLM Provider Chain

`src/lib/llm.ts` provides `getModel(isChat)` which auto-selects provider by priority:
1. Explicit `LLM_PROVIDER` env var
2. `MINIMAX_API_KEY` (cheapest)
3. `OPENAI_API_KEY`
4. `ANTHROPIC_API_KEY`
5. Ollama (local)
6. AWS Bedrock

All LLM calls use Vercel AI SDK's `generateObject` (Zod-validated) or `streamText` (tutor chat).

### 3D Scene

`src/components/three/ClassroomScene.tsx` — R3F Canvas with:
- GLB model loading with fallback geometry if models fail
- 6 interactive hotspots (raycaster detection, mastery color coding, lock icons)
- Animated characters (teacher + student) via Three.js AnimationMixer
- Room lighting responds to cognitive state (dim for focus, bright for drift)
- Dynamic import with `ssr: false` (WebGL is client-only)

### Panel System

Main page (`src/app/page.tsx`) renders the 3D scene + a modal overlay. Clicking a hotspot sets `activePanel` in Zustand, which conditionally renders one of 7 panel components in `src/components/panels/`.

### Demo Fallback

Pre-cached JSON in `public/demo-cache/` activates via `DEMO_FALLBACK=1` env var or `x-demo-fallback: 1` header. Pattern used in API routes:
```ts
if (wantDemoFallback(request.headers, request.url)) {
  const cached = readDemoCache<T>(DEMO_FILES.key);
  if (cached) return NextResponse.json(cached);
}
```

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/ingest` | POST | PDF/text → knowledge graph extraction |
| `/api/quiz` | POST | Generate difficulty-scaled quiz questions |
| `/api/explain` | POST | Multi-modal concept explanations (visual/analogy/step-by-step/socratic) |
| `/api/tutor` | POST | Streaming AI tutor chat |
| `/api/search` | POST | Resource bookshelf search |
| `/api/upload` | POST | PDF storage (Vercel Blob / S3 / base64 fallback) |
| `/api/session-summary` | POST | Session analytics summary |
| `/api/llm-test` | GET | LLM provider connectivity diagnostic |
| `/api/adaptive/knowledge-state` | POST | Mastery updates from interaction events |
| `/api/adaptive/cognitive-state` | POST | Cognitive state assessment |
| `/api/adaptive/next-action` | POST | Next learning action recommendation |

## Key Types

Defined in `src/lib/types.ts`:
- `KnowledgeGraph` — concepts (with mastery, prerequisites) + edges
- `ConceptNode` — id, name, mastery, attempts, error_patterns, preferred_mode
- `ExplanationMode` — `'visual' | 'analogy' | 'step-by-step' | 'socratic'`
- `QuizQuestion` — question, 4 options, correct_index, difficulty
- `InteractionEvent` — union type for quiz_correct/incorrect, explanation_read, etc.
- `SessionParams` — cognitive_state, chunk_size, difficulty_bias, preferred_modality
- `NextAction` — next concept, difficulty, modality, activity, room_commands
- `RoomCommand` — deep_focus, drift_mode, neutral, session_end, lock/unlock_concept

## Environment Setup

Copy `.env.example` to `.env.local`. Only one LLM provider key is required:

```bash
# Cheapest option
MINIMAX_API_KEY=your-key

# Or: OPENAI_API_KEY, ANTHROPIC_API_KEY, LLM_PROVIDER=ollama, or AWS Bedrock

# Optional: PDF storage
# BLOB_READ_WRITE_TOKEN=  (Vercel Blob)
# NEXT_PUBLIC_S3_BUCKET=  (AWS S3)

# Optional: offline demo mode
# DEMO_FALLBACK=1
```

## Path Alias

TypeScript and Next.js are configured with `@/*` → `./src/*`. Always use `@/` imports.

## Deployment

Vercel-ready. Install command must use `npm install --legacy-peer-deps`. Node.js 20.x required.
