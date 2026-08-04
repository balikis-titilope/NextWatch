"""
fetch_movies.py
Fetches up to ~60,000 movies from TMDB and saves them to data/movies.csv

Design decisions (why it's built this way):
1. Token loaded from .env, never hardcoded — safe to push to GitHub
2. Multiple "discover" strategies (sort orders) — TMDB caps each query at
   500 pages (10,000 movies), so one sort order alone can't get us to 60k.
   We combine several sort orders and deduplicate by movie ID.
3. Progress + discovered-movie caching — if your internet drops mid-run,
   you don't lose hours of work. Re-running the script picks up exactly
   where it left off.
4. append_to_response bundles keywords, credits, videos, and watch
   providers into a single API call per movie instead of four.
5. TEST_MODE lets you run a small, cheap trial before committing hours
   to the full 60,000-movie fetch — writes to separate test files so it
   can never contaminate your real dataset.
"""

import os
import time
import csv
import json
import requests
from dotenv import load_dotenv

# ---------- SETUP ----------

load_dotenv()

TMDB_TOKEN = os.getenv("TMDB_TOKEN")
if not TMDB_TOKEN:
    raise ValueError("TMDB_TOKEN not found. Check your .env file.")

BASE = "https://api.themoviedb.org/3"
HEADERS = {
    "accept": "application/json",
    "Authorization": f"Bearer {TMDB_TOKEN}"
}

DATA_DIR = "data"
os.makedirs(DATA_DIR, exist_ok=True)

# ---------- TEST MODE ----------
# Flip TEST_MODE to False for the real 60,000-movie run.
# Test output goes to separate files so it can never mix with real data.
TEST_MODE = True
TARGET_MOVIES = 300 if TEST_MODE else 60000

if TEST_MODE:
    OUT_CSV = os.path.join(DATA_DIR, "movies_test.csv")
    PROGRESS_FILE = os.path.join(DATA_DIR, "fetch_progress_test.json")
    DISCOVERED_FILE = os.path.join(DATA_DIR, "discovered_movies_test.json")
else:
    OUT_CSV = os.path.join(DATA_DIR, "movies.csv")
    PROGRESS_FILE = os.path.join(DATA_DIR, "fetch_progress.json")
    DISCOVERED_FILE = os.path.join(DATA_DIR, "discovered_movies.json")

# ---------- HELPERS ----------

def get_json(endpoint: str, params: dict = None):
    if params is None:
        params = {}
    response = requests.get(f"{BASE}{endpoint}", headers=HEADERS, params=params, timeout=20)
    response.raise_for_status()
    return response.json()

def load_json_file(path, default):
    if os.path.exists(path):
        with open(path, "r") as f:
            return json.load(f)
    return default

def save_json_file(path, data):
    with open(path, "w") as f:
        json.dump(data, f)

# ---------- DISCOVERY (getting the list of movie IDs) ----------

def discover_movies_with_params(sort_by, extra_params=None, max_pages=500, target=None):
    extra_params = extra_params or {}
    movies = []

    for page in range(1, max_pages + 1):
        try:
            data = get_json("/discover/movie", {
                "page": page,
                "sort_by": sort_by,
                "include_adult": False,
                "include_video": False,
                **extra_params
            })
            results = data.get("results", [])
            if not results:
                break
            movies.extend(results)

            if target is not None and len(movies) >= target:
                break  # stop early — no point fetching more pages than needed

            if page % 50 == 0:
                print(f"    ...{len(movies)} movies so far")

        except requests.exceptions.RequestException as e:
            if "400" in str(e):
                break
            print(f"    Page {page} failed: {e}")
            time.sleep(2)

        time.sleep(0.25)

    return movies

def discover_all_movies(target):
    all_movies = {}

    strategies = [
        {"name": "Popularity",                  "sort": "popularity.desc",              "params": {}},
        {"name": "Vote Average (100+ votes)",    "sort": "vote_average.desc",            "params": {"vote_count.gte": 100}},
        {"name": "Vote Count",                   "sort": "vote_count.desc",              "params": {}},
        {"name": "Revenue",                      "sort": "revenue.desc",                 "params": {}},
        {"name": "Release Date (Newest)",        "sort": "primary_release_date.desc",    "params": {}},
        {"name": "Release Date (Oldest)",        "sort": "primary_release_date.asc",     "params": {}},
        {"name": "Original Title (A-Z)",         "sort": "original_title.asc",           "params": {}},
        {"name": "Vote Average (10+ votes)",     "sort": "vote_average.desc",            "params": {"vote_count.gte": 10}},
    ]

    for i, s in enumerate(strategies, 1):
        if len(all_movies) >= target:
            print(f"Target of {target} reached — stopping early.")
            break

        print(f"[{i}/{len(strategies)}] {s['name']} (current total: {len(all_movies)})")
        movies = discover_movies_with_params(s["sort"], s["params"], target=target)

        new_count = 0
        for m in movies:
            if m["id"] not in all_movies:
                all_movies[m["id"]] = m
                new_count += 1
        print(f"    +{new_count} new movies")

    return list(all_movies.values())

# ---------- DETAILS (per-movie data) ----------

def fetch_movie_details(movie_id, retries=3, wait=2):
    for attempt in range(retries):
        try:
            details = get_json(f"/movie/{movie_id}", {
                "append_to_response": "keywords,credits,videos,watch/providers"
            })

            details["keywords"] = [k["name"] for k in details.get("keywords", {}).get("keywords", [])]

            cast = details.get("credits", {}).get("cast", [])
            crew = details.get("credits", {}).get("crew", [])
            details["cast"] = [c["name"] for c in cast[:10]]
            details["director"] = [c["name"] for c in crew if c.get("job") == "Director"]

            videos = details.get("videos", {}).get("results", [])
            details["trailer_keys"] = [
                v["key"] for v in videos
                if v.get("site") == "YouTube" and v.get("type") == "Trailer"
            ]

            providers_data = details.get("watch/providers", {}).get("results", {})
            region = providers_data.get("NG") or providers_data.get("US") or {}
            details["watch_stream"] = [p["provider_name"] for p in region.get("flatrate", [])]
            details["watch_rent"] = [p["provider_name"] for p in region.get("rent", [])]
            details["watch_buy"] = [p["provider_name"] for p in region.get("buy", [])]

            return details
        except requests.exceptions.RequestException as e:
            print(f"    Attempt {attempt + 1} failed for movie {movie_id}: {e}")
            time.sleep(wait)
    print(f"    Giving up on movie {movie_id} after {retries} attempts")
    return None

def save_to_csv(details_batch, path=None):
    if path is None:
        path = OUT_CSV

    fields = [
        "id", "imdb_id", "title", "original_title", "tagline", "overview",
        "genres", "keywords", "cast", "director",
        "release_date", "status", "runtime",
        "original_language", "spoken_languages", "origin_country",
        "production_countries", "production_companies",
        "budget", "revenue",
        "popularity", "vote_average", "vote_count",
        "poster_path", "backdrop_path", "homepage",
        "adult", "belongs_to_collection",
        "trailer_keys", "watch_stream", "watch_rent", "watch_buy",
    ]
    file_exists = os.path.exists(path)

    with open(path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        if not file_exists:
            writer.writeheader()
        for d in details_batch:
            collection = d.get("belongs_to_collection")
            writer.writerow({
                "id": d.get("id"),
                "imdb_id": d.get("imdb_id"),
                "title": d.get("title"),
                "original_title": d.get("original_title"),
                "tagline": d.get("tagline"),
                "overview": d.get("overview"),
                "genres": "|".join(g["name"] for g in d.get("genres", [])),
                "keywords": "|".join(d.get("keywords", [])),
                "cast": "|".join(d.get("cast", [])),
                "director": "|".join(d.get("director", [])),
                "release_date": d.get("release_date"),
                "status": d.get("status"),
                "runtime": d.get("runtime"),
                "original_language": d.get("original_language"),
                "spoken_languages": "|".join(l.get("english_name", "") for l in d.get("spoken_languages", [])),
                "origin_country": "|".join(d.get("origin_country", [])),
                "production_countries": "|".join(c.get("iso_3166_1", "") for c in d.get("production_countries", [])),
                "production_companies": "|".join(c.get("name", "") for c in d.get("production_companies", [])),
                "budget": d.get("budget"),
                "revenue": d.get("revenue"),
                "popularity": d.get("popularity"),
                "vote_average": d.get("vote_average"),
                "vote_count": d.get("vote_count"),
                "poster_path": d.get("poster_path"),
                "backdrop_path": d.get("backdrop_path"),
                "homepage": d.get("homepage"),
                "adult": d.get("adult"),
                "belongs_to_collection": collection.get("name") if collection else "",
                "trailer_keys": "|".join(d.get("trailer_keys", [])),
                "watch_stream": "|".join(d.get("watch_stream", [])),
                "watch_rent": "|".join(d.get("watch_rent", [])),
                "watch_buy": "|".join(d.get("watch_buy", [])),
            })

# ---------- MAIN ----------

def main():
    print("=" * 60)
    mode_label = f"TEST MODE ({TARGET_MOVIES} movies)" if TEST_MODE else f"FULL RUN ({TARGET_MOVIES} movies)"
    print(f"TMDB Movie Fetcher — {mode_label}")
    print("=" * 60)

    progress = load_json_file(PROGRESS_FILE, {"fetched_ids": []})
    fetched_ids = set(progress["fetched_ids"])
    if fetched_ids:
        print(f"Resuming: {len(fetched_ids)} movies already have details saved.")

    movies = load_json_file(DISCOVERED_FILE, None)
    if movies:
        print(f"Using cached discovery list: {len(movies)} movies (skipping discovery phase).")
    else:
        print("\nRunning discovery phase...")
        movies = discover_all_movies(target=TARGET_MOVIES)
        save_json_file(DISCOVERED_FILE, movies)
        print(f"Discovered {len(movies)} unique movies. Saved for future resumes.")

    remaining = [m for m in movies if m["id"] not in fetched_ids]
    print(f"\nMovies remaining to fetch details for: {len(remaining)}")

    if not remaining:
        print("Nothing left to do. All movies already fetched.")
        return

    batch = []
    total_done = len(fetched_ids)

    for i, m in enumerate(remaining, 1):
        print(f"[{i}/{len(remaining)}] {m.get('title', 'Unknown')}")
        details = fetch_movie_details(m["id"])
        if details:
            batch.append(details)
            fetched_ids.add(m["id"])
            total_done += 1

        if len(batch) >= 50:
            save_to_csv(batch)
            save_json_file(PROGRESS_FILE, {"fetched_ids": list(fetched_ids)})
            print(f"  ✓ Saved batch. Total done: {total_done}")
            batch = []

        time.sleep(0.25)

    if batch:
        save_to_csv(batch)
        save_json_file(PROGRESS_FILE, {"fetched_ids": list(fetched_ids)})

    print(f"\nDone. {total_done} movies saved to {OUT_CSV}")

if __name__ == "__main__":
    main()