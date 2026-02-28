from dbm import error
from typing import Optional
from fastapi import  Body, FastAPI, Response, status, HTTPException, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from random import randrange
import psycopg2
from psycopg2.extras import RealDictCursor
import time
from sqlalchemy.orm import Session
from app.database import Base ,engine, get_db
from app import models  # ensures Post is registered # ensures Post is registered
import os
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass
# Backend priority: Tavily > Exa > DuckDuckGo (set TAVILY_API_KEY, EXA_API_KEY, or neither)
_SEARCH_BACKEND = "duckduckgo"
try:
    if os.environ.get("TAVILY_API_KEY"):
        from app.search_tavily import search_topic, search_youtube, get_bookshelf_resources, get_cache_stats
        _SEARCH_BACKEND = "tavily"
    elif os.environ.get("EXA_API_KEY"):
        from app.search_exa import search_topic, search_youtube, get_bookshelf_resources, get_cache_stats
        _SEARCH_BACKEND = "exa"
    else:
        from app.search import search_topic, search_youtube, get_bookshelf_resources, get_cache_stats
except ImportError:
    from app.search import search_topic, search_youtube, get_bookshelf_resources, get_cache_stats

try:
    from app.quality_bedrock import apply_curation
except ImportError:
    def apply_curation(resources, **kwargs):
        return resources

try:
    from app.cache_s3 import get as s3_cache_get, set as s3_cache_set
except ImportError:
    def s3_cache_get(*args, **kwargs):
        return None
    def s3_cache_set(*args, **kwargs):
        pass

Base.metadata.create_all(bind=engine)# create the tables in the database, if they do not exist already.

app = FastAPI()

# Allow Next.js frontend (and Vercel preview) to call this API from the browser
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # for hackathon: Next.js (localhost:3000 + Vercel). Restrict in prod.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---- Person 3: Web Scraper Agent (bookshelf) ----
class BookshelfRequest(BaseModel):
    topics: list[str]
    per_topic: int = 3


class SpeechRequest(BaseModel):
    """Text to convert to speech (TTS) for NPC dialogue."""
    text: str
    lang: str = "en"


@app.get("/vibe")
def vibe():
    """Health / vibe check: backend in use, cache stats."""
    cache = get_cache_stats()
    messages = {"tavily": "Tavily is powering the bookshelf.", "exa": "Exa is powering the bookshelf. Cache is saving your quota.", "duckduckgo": "DuckDuckGo fallback is active. Set TAVILY_API_KEY or EXA_API_KEY for enhanced search."}
    message = messages.get(_SEARCH_BACKEND, messages["duckduckgo"])
    return {"status": "chill", "ready": True, "backend": _SEARCH_BACKEND, "cache": cache, "message": message}


@app.get("/search")
def search(
    topic: str = "merge sort algorithm",
    max_results: int = 5,
    content_type: str | None = None,
):
    """Single-topic search. content_type=video for YouTube/videos only."""
    results = search_topic(topic, max_results=max_results)
    if content_type:
        results = [r for r in results if r.get("type") == content_type]
    return {"topic": topic, "results": results}


@app.get("/search/youtube")
def search_youtube_endpoint(topic: str = "quadratic equation tutorial", max_results: int = 5):
    """Search YouTube only."""
    return {"topic": topic, "results": search_youtube(topic, max_results=max_results)}


def _curated_bookshelf_resources(topic_list: list, per_topic: int, skip_cache: bool = False, content_type_filter: str | None = None):
    """Fetch resources (S3 cache first), apply Bedrock scoring, content_type, and AI summaries."""
    if not skip_cache and topic_list:
        cached = s3_cache_get(topic_list, per_topic)
        if cached is not None:
            if content_type_filter:
                cached = [r for r in cached if r.get("content_type") == content_type_filter or r.get("type") == content_type_filter]
            return cached
    resources = get_bookshelf_resources(topic_list, per_topic=per_topic, skip_cache=skip_cache)
    resources = apply_curation(resources, score_with_bedrock=True, add_summaries=True)
    if content_type_filter:
        resources = [r for r in resources if r.get("content_type") == content_type_filter or r.get("type") == content_type_filter]
    if topic_list and resources:
        s3_cache_set(topic_list, per_topic, resources)
    return resources


@app.get("/bookshelf")
def bookshelf(
    topics: str = "merge sort,binary search,divide and conquer",
    per_topic: int = 3,
    content_type: str | None = None,
):
    """Resources for 3D bookshelf. content_type=video for YouTube only."""
    topic_list = [t.strip() for t in topics.split(",") if t.strip()]
    return {"resources": _curated_bookshelf_resources(topic_list, per_topic, content_type_filter=content_type)}


@app.post("/bookshelf")
def bookshelf_post(body: BookshelfRequest, content_type: str | None = None):
    """Same as GET but topics in body. Add ?content_type=video for YouTube only."""
    return {"resources": _curated_bookshelf_resources(body.topics, body.per_topic, content_type_filter=content_type)}


@app.post("/bookshelf/refresh")
def bookshelf_refresh(body: BookshelfRequest):
    """Re-fetch resources (bypass cache)."""
    return {"resources": _curated_bookshelf_resources(body.topics, body.per_topic, skip_cache=True)}


DEMO_TOPICS = ["binary search", "sorting algorithms", "recursion", "arrays", "linked lists"]


@app.post("/bookshelf/prewarm")
def bookshelf_prewarm(body: BookshelfRequest | None = Body(None)):
    """
    Pre-warm cache for given topics (or demo topics). P2 can call this after ingest to fill cache.
    Body: { "topics": ["concept1", "concept2"], "per_topic": 3 }. Omit body to use demo topic list.
    """
    if not body or not body.topics:
        body = BookshelfRequest(topics=DEMO_TOPICS, per_topic=3)
    return {"resources": _curated_bookshelf_resources(body.topics, body.per_topic, skip_cache=False)}


# ---- Person 3: NPC speech (TTS) ----
@app.post("/speech", response_class=Response)
def speech(body: SpeechRequest):
    """Text-to-speech: send text, get back audio (MP3). Uses gTTS. Body: {"text": "...", "lang": "en"}."""
    try:
        from gtts import gTTS
    except ImportError:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="gTTS not installed. pip install gtts")
    text = (body.text or "").strip()
    if not text:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="text is required and cannot be empty")
    if len(text) > 2000:
        text = text[:2000] + "."
    tts = gTTS(text=text, lang=body.lang, slow=False)
    import io
    buf = io.BytesIO()
    tts.write_to_fp(buf)
    buf.seek(0)
    return Response(content=buf.read(), media_type="audio/mpeg")


# title string content string, we can use pydantic to create a model for the post, and then use that model to validate the data that is sent to the server. This way we can ensure that the data is in the correct format and that it contains all the required fields.
class Post(BaseModel):
    title: str = "Jane Doe"
    content: str
    published: bool = True # default value is true, if the user does not provide a value for published, it will be set to true by default.
    #rating: Optional[int] = None

while True:
    try :
        conn = psycopg2.connect(host='localhost', database='Fastapi', user='postgres',
                             password='52236385', cursor_factory=RealDictCursor)
        cursor = conn.cursor() # cursor is used to execute SQL commands and fetch data from the database. 
        print("Database connection successful")
        break
    except Exception as error:
        print("Database connection failed")
        print("Error: ",error)
        time.sleep(2)

my_posts = [{"title": "post1", "content": "content1", "published": True, "rating": 5, "id": 1},
            {"title": "post2", "content": "content2", "published": False, "rating": 4, "id": 2}]
# get method is used to read data from the server, it is the most common method used in RESTful APIs. It is used to retrieve data from the server and does not modify any data on the server. The get method is idempotent, which means that it can be called multiple times without changing the state of the server.

def find_post(id):
    for post in my_posts:
        if post['id'] == id:
            return post

def find_index_post(id):
    for index, post in enumerate(my_posts):
        if post['id'] == id:
            return index

@app.get("/posts") #read
def read_root():
    cursor.execute("SELECT * FROM post")
    posts = cursor.fetchall()
    return {"data": posts}

@app.get("/sqlalchemy") #read
def test_post(db: Session = Depends(get_db)):
    posts = db.query(models.Post).all()
    return {"data": posts}

@app.post("/posts", status_code=status.HTTP_201_CREATED)#Create
#By default, FastAPI will return a 200 status code for successful requests,
#but we can specify a different status code using the status_code parameter in the decorator.
#In this case, we are specifying that the status code should be 201 Created
def create_post(new_post: Post ):
    #print(new_post)
    #print(new_post.dict())
    #new_post_dict = new_post.dict()
    #new_post_dict['id'] = randrange(0, 1000000)
    #my_posts.append(new_post_dict)
    
    new_post  = cursor.execute("INSERT INTO post (title, content, published) VALUES (%s, %s, %s)" \
    " RETURNING *", (new_post.title, new_post.content, new_post.published) )
    created_post = cursor.fetchone()
    conn.commit()#commit the changes to the database, if we do not commit the changes, they will not be saved to the database.
    return {"data": created_post}

@app.get("/posts/{id}")#get the id, Read
def getpost(id: int, response: Response): # you can also use path parameters to get the id of the post, and then use that id to find the post in the list of posts.
    # if there is a route that has a string parameter, it will catch that route instead of this one,
    # to avoid this, we can use the type hinting to specify that the id should be an integer, 
    # and then FastAPI will automatically convert the id to an integer before passing it to the function. 
    post = find_post(int(id))# it will return a string, we need to convert it to an integer
    if not post:
        raise HTTPException(status_code=status.HTTP_418_IM_A_TEAPOT, 
                            detail=f"post with id {id} not found")
    #   response.status_code = status.HTTP_404_NOT_FOUND
    #   return {"message": f"post with id {id} not found"}
    return {"post details": post}


#def create_post(payload: dict = Body(...)):
#print(payload)
#     return {"message": f"title: {payload['title']} content: {payload['content']}"}

     

@app.get("/items/{item_id}")
def read_item(item_id: int, q: str | None = None):
    #need to be int because the id in the database is stored as an integer, 
    #and we need to match the data type of the id in the database with the data 
    # type of the item_id that we are passing to the function.
    cursor.execute("SELECT * FROM post WHERE id = %s", (str(item_id),))
    # we need to convert the item_id to a string because the id in the database is stored as a string,
    # and we need to match the data type of the id in the database with the data type of the item_id that we are passing to the function.
    return {"item_id": item_id, "q": q}

@app.delete("/posts/{id}", status_code=status.HTTP_204_NO_CONTENT)#delete
def delete_post(id: int):
    #deleting a post
    #
    cursor.execute("DELETE FROM post WHERE id = %s RETURNING *", (str(id),))
    deleted_post = cursor.fetchone()
    conn.commit()

    if deleted_post == None:
        raise HTTPException(status_code=status.HTTP_418_IM_A_TEAPOT, 
                            detail=f"post with id {id} not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)

@app.put("/posts/{id}")#update
def update_post(id: int, post: Post):
    #index = find_index_post(id)
    #if index == None:
    #    raise HTTPException(status_code=status.HTTP_418_IM_A_TEAPOT, 
    #                        detail=f"post with id {id} not found")
    #post_dict = post.dict()
    #post_dict['id'] = id
    #my_posts[index] = post_dict
    cursor.execute("UPDATE post SET title = %s, content = %s, published = %s WHERE id = %s RETURNING *", 
                   (post.title, post.content, post.published, str(id)))
    updated_post = cursor.fetchone()
    conn.commit()
    if updated_post == None:
        raise HTTPException(status_code=status.HTTP_418_IM_A_TEAPOT, 
                            detail=f"post with id {id} not found")
    return {"data": updated_post}