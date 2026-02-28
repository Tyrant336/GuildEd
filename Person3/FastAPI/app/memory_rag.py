"""
FocusFlow 3D - Person 3: RAG memory layer for bookshelf agent.
Stores and retrieves rules, preferences, and lessons in a vector DB (Chroma).
Uses OpenAI or Bedrock for embeddings. Fails open: no-op if unavailable.
"""
import os
import uuid
from typing import List

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

# Chunk size for long text (chars)
CHUNK_SIZE = 800
COLLECTION_NAME = "person3_memory"


def _embed(texts: List[str]) -> List[List[float]]:
    """Return embeddings for each text. Uses OpenAI if OPENAI_API_KEY set, else Bedrock Titan. Raises on failure."""
    if not texts:
        return []
    # Prefer OpenAI
    if os.environ.get("OPENAI_API_KEY"):
        try:
            from openai import OpenAI
            client = OpenAI()
            resp = client.embeddings.create(model="text-embedding-3-small", input=texts)
            if len(texts) == 1:
                return [resp.data[0].embedding]
            order = sorted(resp.data, key=lambda x: x.index)
            return [order[i].embedding for i in range(len(order))]
        except Exception:
            pass
    # Fallback: Bedrock Titan
    if os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("AWS_PROFILE"):
        try:
            import boto3
            import json
            region = os.environ.get("AWS_REGION", "us-east-1")
            client = boto3.client("bedrock-runtime", region_name=region)
            model_id = os.environ.get("BEDROCK_EMBED_MODEL_ID", "amazon.titan-embed-text-v2:0")
            out = []
            for t in texts:
                body = json.dumps({"inputText": t[:8000]})
                resp = client.invoke_model(
                    modelId=model_id,
                    body=body,
                    contentType="application/json",
                    accept="application/json",
                )
                data = json.loads(resp["body"].read().decode())
                out.append(data.get("embedding", []))
            return out
        except Exception:
            pass
    raise ValueError("No embedding provider: set OPENAI_API_KEY or AWS credentials for Bedrock Titan.")


def _get_collection():
    """Lazy init Chroma persistent collection."""
    import chromadb
    path = os.environ.get("CHROMA_PERSIST_PATH", os.path.join(os.path.dirname(__file__), "..", "chroma_data"))
    client = chromadb.PersistentClient(path=path)
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


def _available() -> bool:
    """True if we can use RAG (embeddings + Chroma)."""
    try:
        _embed(["test"])
        _get_collection()
        return True
    except Exception:
        return False


def add_memory(text: str, type: str = "rule", metadata: dict | None = None) -> None:
    """
    Ingest text into the vector DB. Chunks if long. type: rule, preference, or lesson.
    No-op if embedding or Chroma unavailable.
    """
    if not text or not text.strip():
        return
    metadata = dict(metadata or {})
    metadata["type"] = type
    texts = []
    t = text.strip()
    for i in range(0, len(t), CHUNK_SIZE):
        chunk = t[i : i + CHUNK_SIZE]
        if chunk.strip():
            texts.append(chunk)
    if not texts:
        return
    try:
        embeddings = _embed(texts)
        if len(embeddings) != len(texts):
            return
        coll = _get_collection()
        ids = [str(uuid.uuid4()) for _ in texts]
        metadatas = [dict(metadata) for _ in texts]
        coll.add(ids=ids, embeddings=embeddings, documents=texts, metadatas=metadatas)
    except Exception:
        pass


def get_relevant(query: str, type: str | None = None, top_k: int = 5) -> List[dict]:
    """
    Retrieve chunks most relevant to query. Optional filter by type (rule, preference, lesson).
    Returns list of { "text": str, "metadata": dict }. Empty list if unavailable.
    """
    if not query or not query.strip():
        return []
    try:
        emb = _embed([query.strip()])[0]
        coll = _get_collection()
        where = {"type": type} if type else None
        results = coll.query(
            query_embeddings=[emb],
            n_results=min(top_k, 20),
            where=where,
            include=["documents", "metadatas"],
        )
        out = []
        docs = results.get("documents", [[]])[0] or []
        metadatas = results.get("metadatas", [[]])[0] or []
        for i, doc in enumerate(docs):
            meta = metadatas[i] if i < len(metadatas) else {}
            out.append({"text": doc, "metadata": meta})
        return out
    except Exception:
        return []
