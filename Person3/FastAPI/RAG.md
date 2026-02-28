# Person 3: RAG (Bookshelf Scorer Memory)

## Scope

Person 3’s RAG is **only for bookshelf scoring**. It does not handle user preferences or tutor/conversation memory.

| Endpoint | Purpose |
|----------|---------|
| `POST /memory` | Seed **scorer rules** (e.g. "Prefer .edu for CS topics"). Used when building the bookshelf to guide Bedrock quality scoring. |
| `POST /feedback` | Store **corrections** (e.g. "Down-rank paywalled sites"). Same use: future scoring retrieves these and applies them in the Bedrock prompt. |

- **User preferences** (e.g. "I prefer step-by-step explanations") and **tutor/conversation memory** are **not** Person 3’s responsibility. Those are handled by P2 (AI Backend) in the FocusFlow 3D app.
- P2 may expose its own feedback endpoint for preferences; P3’s `/feedback` and `/memory` are for **bookshelf quality rules** only.

## Use RAG (so scoring follows your rules)

1. **Add a rule** (seed a guideline for the scorer):
   - **POST** `http://localhost:8000/memory`
   - Headers: `Content-Type: application/json`
   - Body example:
     ```json
     { "text": "Prefer .edu and official documentation for computer science topics.", "type": "rule" }
     ```

2. **Add a correction** (e.g. after a bad result):
   - **POST** `http://localhost:8000/feedback`
   - Body example:
     ```json
     { "context": "algorithms", "correction": "Down-rank paywalled sites.", "type": "rule" }
     ```

3. Call **GET /bookshelf** (with Bedrock and embeddings enabled). The scorer retrieves stored rules and injects them into the Bedrock prompt so results follow your guidelines.

Requires `OPENAI_API_KEY` or AWS credentials so embeddings and Chroma can run; otherwise RAG is skipped and scoring uses no rules.

## Tech (P3 only)

- **Vector DB:** Chroma (persistent under `chroma_data/` or `CHROMA_PERSIST_PATH`).
- **Embeddings:** OpenAI `text-embedding-3-small` (if `OPENAI_API_KEY`) or Bedrock Titan (if AWS).
- **Collection:** `person3_memory`. Metadata includes `type`: `rule`, `preference`, or `lesson`.
- Retrieval is used in `quality_bedrock.py` before Bedrock scoring: rules are injected into the prompt as "Use these guidelines when scoring: …".

## Env

See `.env.example`. For RAG you need at least one of: `OPENAI_API_KEY`, or AWS credentials (for Bedrock Titan embed).
