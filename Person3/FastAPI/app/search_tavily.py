"""
FocusFlow 3D - Person 3: Web Scraper Agent (Tavily API).
Uses Tavily for web search. Set TAVILY_API_KEY in env or .env.
Same interface as search.py: search_topic(), search_youtube(), get_bookshelf_resources(), get_cache_stats().
"""
import os
import re
from typing import List

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

_cache: dict = {}
CACHE_MAX = 200


def _safe_str(s: str) -> str:
    """Strip problematic chars for Windows/JSON (e.g. emoji)."""
    if not s:
        return ""
    return re.sub(r"[^\x00-\x7F]+", " ", s).strip()[:500]


def _get_tavily_client():
    """Lazy init Tavily client (requires tavily-python and TAVILY_API_KEY)."""
    from tavily import TavilyClient
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        raise ValueError("TAVILY_API_KEY is not set. Add it to .env or environment.")
    return TavilyClient(api_key=api_key)


def get_cache_stats() -> dict:
    """Return cache stats for /vibe."""
    return {"cached_queries": len(_cache), "max": CACHE_MAX}


def search_topic(topic: str, max_results: int = 5, skip_cache: bool = False) -> List[dict]:
    """
    Search web for a topic using Tavily.
    Returns list of {title, url, snippet, score, type} for bookshelf display.
    """
    key = (topic.strip().lower(), max_results)
    if not skip_cache and key in _cache:
        return _cache[key]
    try:
        client = _get_tavily_client()
        response = client.search(query=topic, max_results=max_results, search_depth="basic")
        results = getattr(response, "results", None) or (response.get("results", []) if isinstance(response, dict) else [])
        out = []
        for i, r in enumerate(results):
            url = r.get("url", r.get("link", "")) if isinstance(r, dict) else getattr(r, "url", getattr(r, "link", ""))
            title = _safe_str(r.get("title", "") if isinstance(r, dict) else getattr(r, "title", ""))
            content = r.get("content", r.get("snippet", r.get("body", ""))) if isinstance(r, dict) else getattr(r, "content", getattr(r, "snippet", getattr(r, "body", "")))
            snippet = _safe_str(str(content or ""))[:500]
            out.append({
                "title": title,
                "url": url,
                "snippet": snippet,
                "score": 1.0 - (i * 0.1),
                "type": "video" if url and ("youtube.com" in url or "youtu.be" in url) else "article",
            })
        if not skip_cache and len(_cache) < CACHE_MAX:
            _cache[key] = out
        return out
    except Exception as e:
        return [{"title": "Error", "url": "", "snippet": str(e), "score": 0, "type": "article"}]


def search_youtube(topic: str, max_results: int = 5) -> List[dict]:
    """Search YouTube only (Tavily with query biased to YouTube)."""
    key = ("youtube:" + topic.strip().lower(), max_results)
    if key in _cache:
        return _cache[key]
    try:
        client = _get_tavily_client()
        response = client.search(
            query=f"{topic} site:youtube.com",
            max_results=max_results,
            search_depth="basic",
        )
        results = getattr(response, "results", None) or (response.get("results", []) if isinstance(response, dict) else [])
        out = []
        for i, r in enumerate(results):
            url = r.get("url", r.get("link", "")) if isinstance(r, dict) else getattr(r, "url", getattr(r, "link", ""))
            if "youtube.com" not in url and "youtu.be" not in url:
                continue
            title = _safe_str(r.get("title", "") if isinstance(r, dict) else getattr(r, "title", ""))
            content = r.get("content", r.get("snippet", "")) if isinstance(r, dict) else getattr(r, "content", getattr(r, "snippet", ""))
            snippet = _safe_str(str(content or ""))[:500]
            out.append({
                "title": title,
                "url": url,
                "snippet": snippet,
                "score": 1.0 - (i * 0.1),
                "type": "video",
            })
            if len(out) >= max_results:
                break
        if len(_cache) < CACHE_MAX:
            _cache[key] = out
        return out
    except Exception as e:
        return [{"title": "Error", "url": "", "snippet": str(e), "score": 0, "type": "video"}]


def get_bookshelf_resources(topics: List[str], per_topic: int = 3, skip_cache: bool = False) -> List[dict]:
    """For each topic, fetch resources and tag with topic. Frontend can show on bookshelf."""
    resources = []
    for t in topics:
        if not t or not t.strip():
            continue
        t = t.strip()
        for item in search_topic(t, max_results=per_topic, skip_cache=skip_cache):
            item["topic"] = t
            resources.append(item)
    return resources
