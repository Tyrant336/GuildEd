"""
FocusFlow 3D - Person 3: S3 cache for bookshelf resources.
Cache key: bookshelf/{hash(topics+per_topic)}. Value: JSON list of resources.
Fails open: if S3 is unavailable, returns None for get and no-op for set.
"""
import hashlib
import json
import os
from typing import Any

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

S3_PREFIX = os.environ.get("S3_PREFIX", "bookshelf")
S3_BUCKET = os.environ.get("S3_BUCKET", "")


def _bucket_available() -> bool:
    return bool(S3_BUCKET and (os.environ.get("AWS_ACCESS_KEY_ID") or os.environ.get("AWS_PROFILE")))


def _cache_key(topics: list, per_topic: int) -> str:
    """Stable key for topic list + per_topic."""
    payload = json.dumps({"topics": sorted(t.strip().lower() for t in topics if t and str(t).strip()), "per_topic": per_topic}, sort_keys=True)
    h = hashlib.sha256(payload.encode()).hexdigest()[:24]
    return f"{S3_PREFIX}/{h}.json"


def get(topics: list, per_topic: int) -> list | None:
    """Return cached list of resources if present, else None."""
    if not _bucket_available():
        return None
    try:
        import boto3
        key = _cache_key(topics, per_topic)
        s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
        obj = s3.get_object(Bucket=S3_BUCKET, Key=key)
        data = json.loads(obj["Body"].read().decode())
        return data if isinstance(data, list) else data.get("resources", data)
    except Exception:
        return None


def set(topics: list, per_topic: int, resources: list) -> None:
    """Write resources to S3 cache. No-op if S3 unavailable."""
    if not _bucket_available():
        return
    try:
        import boto3
        key = _cache_key(topics, per_topic)
        s3 = boto3.client("s3", region_name=os.environ.get("AWS_REGION", "us-east-1"))
        body = json.dumps(resources, ensure_ascii=False).encode("utf-8")
        s3.put_object(Bucket=S3_BUCKET, Key=key, Body=body, ContentType="application/json")
    except Exception:
        pass
