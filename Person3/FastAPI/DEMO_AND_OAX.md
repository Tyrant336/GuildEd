# Person 3: Demo Pre-run & OAX Foundation Submission

## Demo Pre-run

Before the demo, prewarm the bookshelf cache so results load instantly:

1. Start the Person 3 FastAPI server: `uvicorn app.main:app --reload`
2. Run: `python prewarm_demo.py` (or `python prewarm_demo.py http://localhost:8000` if different host/port)
3. Optionally set `S3_BUCKET` and AWS credentials so the cache is written to S3 and shared across runs.

## Content Freshness Angle (OAX Submission)

**FocusFlow 3D — AI-powered resource discovery with content freshness**

- **Problem**: Static curricula and link rot. Learners get outdated or broken links; educators spend time curating by hand.
- **Approach**: The bookshelf agent (Person 3) discovers resources in real time from the web, scores them for **relevance**, **recency**, and **authority** using AWS Bedrock, and caches results in S3 for reliability. When a learner uploads material (Person 2), extracted concepts automatically trigger a fresh scrape so the 3D bookshelf is populated with current, high-quality links and AI-generated summaries.
- **Differentiator**: Content is **live and scored**, not a fixed list. Quality and freshness are first-class; the system improves with feedback (e.g. thumbs down → correction stored for future runs).

## Competitor Landscape (Notes)

| Competitor   | Relevance to FocusFlow 3D |
|-------------|----------------------------|
| **Quizlet** | Flashcards and study sets; we focus on immersive 3D + concept graph + live resource discovery. |
| **Anki**    | Spaced repetition; we complement with adaptive tutoring and bookshelf resources tied to extracted concepts. |
| **Notion AI** | Docs and AI assist; we target neurodivergent learners in a structured 3D classroom with NPCs and concept-based flows. |

## Market Size (Compilation for Submission)

- EdTech and adaptive learning: cite market reports (e.g. global EdTech, adaptive/neurodiverse learning segments) as needed for OAX narrative.
- FocusFlow 3D differentiates on: 3D environment, concept extraction from uploads, and **continuously updated**, AI-scored bookshelf tied to the knowledge graph.
