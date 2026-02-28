"""
FocusFlow 3D - Person 3: Bedrock quality scoring for bookshelf resources.
Scores each resource on relevance, recency, authority; combines into single score for sorting.
Requires boto3 and AWS credentials (or env) with Bedrock access. Fails open: returns unchanged scores on error.
"""
import json
import os
import re
from typing import List

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    from app.memory_rag import get_relevant as rag_get_relevant
except ImportError:
    def rag_get_relevant(*args, **kwargs):
        return []

DEFAULT_MODEL_ID = "anthropic.claude-3-haiku-20240307-v1:0"


def _bedrock_available() -> bool:
    """Return True if Bedrock can be used (env or config)."""
    return bool(os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("AWS_PROFILE") or os.environ.get("AWS_REGION"))


def score_resources(topic: str, resources: List[dict], model_id: str | None = None) -> List[dict]:
    """
    Score a list of resources for the given topic using Bedrock.
    Updates each resource's "score" (0-1) and optionally adds relevance, recency, authority.
    If Bedrock is unavailable or errors, returns resources with existing scores unchanged.
    """
    if not resources:
        return resources
    if not _bedrock_available():
        return resources
    model_id = model_id or os.environ.get("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID)
    region = os.environ.get("AWS_REGION", "us-east-1")

    lines = []
    for i, r in enumerate(resources):
        title = (r.get("title") or "")[:200]
        url = (r.get("url") or "")[:300]
        snippet = (r.get("snippet") or "")[:400]
        lines.append(f"[{i}] Title: {title}\nURL: {url}\nSnippet: {snippet}")

    # RAG: retrieve relevant rules to guide scoring
    guidelines = ""
    try:
        chunks = rag_get_relevant(f"{topic} quality guidelines for educational resources", type="rule", top_k=3)
        if chunks:
            guideline_texts = [c.get("text", "").strip() for c in chunks if c.get("text")]
            if guideline_texts:
                guidelines = "\nUse these guidelines when scoring (apply if relevant):\n" + "\n".join(f"- {g}" for g in guideline_texts) + "\n\n"
    except Exception:
        pass

    prompt = f"""You are a quality rater for educational web resources. For the learning topic "{topic}", rate each resource below.
{guidelines}For each resource, output a single line: index,relevance,recency,authority
- relevance: 0.0-1.0 (how well it matches the topic)
- recency: 0.0-1.0 (how up-to-date it seems from URL/snippet)
- authority: 0.0-1.0 (trustworthiness of source)

Output ONLY the comma-separated lines, one per resource, no other text. Example:
0,0.9,0.8,0.95
1,0.7,0.6,0.7

Resources:
---
"""
    prompt += "\n---\n".join(lines)

    try:
        import boto3
        client = boto3.client("bedrock-runtime", region_name=region)
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 1024,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0,
        }
        response = client.invoke_model(
            modelId=model_id,
            body=json.dumps(body).encode("utf-8"),
            contentType="application/json",
            accept="application/json",
        )
        result = json.loads(response["body"].read().decode())
        content = result.get("content", [])
        text = ""
        for block in content:
            if block.get("type") == "text":
                text = block.get("text", "")
                break
        out = list(resources)
        for line in text.strip().splitlines():
            line = line.strip()
            if not line or not re.match(r"^\d+,[\d.]+,[\d.]+,[\d.]+", line):
                continue
            parts = line.split(",", 4)
            try:
                idx = int(parts[0])
                rel, rec, auth = float(parts[1]), float(parts[2]), float(parts[3])
                if 0 <= idx < len(out):
                    combined = 0.5 * rel + 0.25 * rec + 0.25 * auth
                    out[idx]["score"] = max(0, min(1, combined))
                    out[idx]["relevance"] = rel
                    out[idx]["recency"] = rec
                    out[idx]["authority"] = auth
            except (ValueError, IndexError):
                continue
        out.sort(key=lambda r: r.get("score", 0), reverse=True)
        return out
    except Exception:
        return resources


def summarize_resource(topic: str, resource: dict, model_id: str | None = None) -> str:
    """Generate a short AI summary for one resource via Bedrock. Returns existing snippet on failure."""
    if not _bedrock_available():
        return (resource.get("snippet") or "")[:500]
    model_id = model_id or os.environ.get("BEDROCK_MODEL_ID", DEFAULT_MODEL_ID)
    region = os.environ.get("AWS_REGION", "us-east-1")
    title = (resource.get("title") or "")[:200]
    snippet = (resource.get("snippet") or "")[:600]
    prompt = f"""Topic: {topic}. Resource: "{title}". Snippet: {snippet}
In one sentence (max 25 words), summarize why this resource is useful for learning this topic. Output only the sentence, no quotes."""

    try:
        import boto3
        client = boto3.client("bedrock-runtime", region_name=region)
        body = {
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": 80,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": 0.2,
        }
        response = client.invoke_model(
            modelId=model_id,
            body=json.dumps(body).encode("utf-8"),
            contentType="application/json",
            accept="application/json",
        )
        result = json.loads(response["body"].read().decode())
        for block in result.get("content", []):
            if block.get("type") == "text":
                return (block.get("text", "").strip() or snippet)[:500]
    except Exception:
        pass
    return (snippet or "")[:500]


def _content_type(resource: dict) -> str:
    """Map resource to P2 content_type: article, video, or book (URL rules)."""
    url = (resource.get("url") or "").lower()
    if "youtube.com" in url or "youtu.be" in url or "vimeo.com" in url:
        return "video"
    if "books.google" in url or ("amazon.com" in url and "/dp/" in url) or "oreilly.com" in url or "mitpress.mit.edu" in url:
        return "book"
    return "article"


def apply_curation(
    resources: List[dict],
    topic_key: str = "topic",
    score_with_bedrock: bool = True,
    add_summaries: bool = True,
) -> List[dict]:
    """
    Apply Bedrock scoring, content_type, and optional AI summaries to bookshelf resources.
    Groups by topic, scores each group, flattens, adds content_type and summary. Fails open.
    """
    if not resources:
        return resources
    by_topic: dict[str, List[dict]] = {}
    for r in resources:
        t = r.get(topic_key, "")
        by_topic.setdefault(t, []).append(dict(r))
    scored = []
    for topic, group in by_topic.items():
        if score_with_bedrock and _bedrock_available():
            group = score_resources(topic, group)
        scored.extend(group)
    for r in scored:
        r["content_type"] = _content_type(r)
        if "type" not in r:
            r["type"] = r["content_type"]
    if add_summaries and _bedrock_available() and len(scored) <= 30:
        for r in scored[:20]:
            r["summary"] = summarize_resource(r.get(topic_key, ""), r)
    else:
        for r in scored:
            r["summary"] = (r.get("snippet") or "")[:500]
    scored.sort(key=lambda x: x.get("score", 0), reverse=True)
    return scored
