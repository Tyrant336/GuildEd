"""
Pre-run the bookshelf scraper for demo topics and (if configured) populate S3 cache.
Run before demo so the bookshelf loads quickly. Requires the FastAPI server to be running.

  python prewarm_demo.py [BASE_URL]

Example:
  python prewarm_demo.py
  python prewarm_demo.py http://localhost:8000
"""
import sys
import requests

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8000"
DEMO_TOPICS = ["binary search", "sorting algorithms", "recursion", "arrays", "linked lists"]


def main():
    print("Prewarming bookshelf cache for demo topics:", DEMO_TOPICS)
    try:
        r = requests.post(
            f"{BASE}/bookshelf/prewarm",
            json={"topics": DEMO_TOPICS, "per_topic": 3},
            timeout=120,
        )
        r.raise_for_status()
        data = r.json()
        resources = data.get("resources", [])
        print(f"OK: {len(resources)} resources cached.")
        if resources:
            print("Sample:", resources[0].get("title", "")[:60], "...")
    except requests.exceptions.RequestException as e:
        print("Error:", e)
        sys.exit(1)


if __name__ == "__main__":
    main()
