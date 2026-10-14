"""
fetch_movies.py
Fetches up to ~60,000 movies and ~20,000 TV shows from TMDB and saves
them into the same CSV (spec 0010: one unified, media-type-aware dataset,
not a parallel TV system).

Design decisions (why it's built this way):
1. Token loaded from .env, never hardcoded — safe to push to GitHub
2. Multiple "discover" strategies (sort orders) — TMDB caps each query at
   500 pages (10,000 results), so one sort order alone can't reach the
   target for either type. We combine several sort orders and
   deduplicate by id, separately per media type (a movie and a TV show
   can share the same raw TMDB id).
3. Progress + discovered-item caching, kept separate per media type — if
   your internet drops mid-run, you don't lose hours of work, and a
   resumed TV fetch never touches the movie fetch's own progress state.
   Re-running the script picks up exactly where each type left off.
4. append_to_response bundles keywords, credits (aggregate_credits for
   TV), videos, and watch providers into a single API call per item
   instead of four.
5. TEST_MODE lets you run a small, cheap trial before committing hours
   to the full 60,000-movie / 20,000-show fetch — writes to separate
   test files so it can never contaminate your real dataset.
"""

import os
import sys
import time
import csv
import json
import requests

# Windows' console defaults stdout to the system codepage (cp1252 here),
# which can't encode most non-Latin titles (Korean, Japanese, Arabic,
# Cyrillic, ...) -- print() on one crashes the whole run with
# UnicodeEncodeError. Reconfigure to UTF-8, which covers this dataset's
# titles regardless of language, so a foreign-language title never takes
# down an hours-long fetch over something as trivial as a log line.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
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
# Flip TEST_MODE to False for the real 60,000-movie + 20,000-show run.
# Test output goes to separate files so it can never mix with real data.
TEST_MODE = False
TARGET_MOVIES = 300 if TEST_MODE else 60000
TARGET_SHOWS = 100 if TEST_MODE else 20000

if TEST_MODE:
    OUT_CSV = os.path.join(DATA_DIR, "movies_test.csv")
    # Movie progress/discovery filenames are unchanged from before TV
    # support, so an already-in-flight movie fetch resumes correctly.
    MOVIE_PROGRESS_FILE = os.path.join(DATA_DIR, "fetch_progress_test.json")
    MOVIE_DISCOVERED_FILE = os.path.join(DATA_DIR, "discovered_movies_test.json")
    SHOW_PROGRESS_FILE = os.path.join(DATA_DIR, "fetch_progress_tv_test.json")
    SHOW_DISCOVERED_FILE = os.path.join(DATA_DIR, "discovered_tv_test.json")
else:
    OUT_CSV = os.path.join(DATA_DIR, "movies.csv")
    MOVIE_PROGRESS_FILE = os.path.join(DATA_DIR, "fetch_progress.json")
    MOVIE_DISCOVERED_FILE = os.path.join(DATA_DIR, "discovered_movies.json")
    SHOW_PROGRESS_FILE = os.path.join(DATA_DIR, "fetch_progress_tv.json")
    SHOW_DISCOVERED_FILE = os.path.join(DATA_DIR, "discovered_tv.json")

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

# ---------- DISCOVERY (getting the list of ids) ----------

def discover_with_params(endpoint, sort_by, extra_params=None, max_pages=500, target=None):
    extra_params = extra_params or {}
    items = []

    for page in range(1, max_pages + 1):
        try:
            data = get_json(endpoint, {
                "page": page,
                "sort_by": sort_by,
                "include_adult": False,
                **extra_params
            })
            results = data.get("results", [])
            if not results:
                break
            items.extend(results)

            if target is not None and len(items) >= target:
                break  # stop early — no point fetching more pages than needed

            if page % 50 == 0:
                print(f"    ...{len(items)} so far")

        except requests.exceptions.RequestException as e:
            if "400" in str(e):
                break
            print(f"    Page {page} failed: {e}")
            time.sleep(2)

        time.sleep(0.25)

    return items

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
        include_video = {"include_video": False}
        movies = discover_with_params("/discover/movie", s["sort"], {**s["params"], **include_video}, target=target)

        new_count = 0
        for m in movies:
            if m["id"] not in all_movies:
                all_movies[m["id"]] = m
                new_count += 1
        print(f"    +{new_count} new movies")

    return list(all_movies.values())

def discover_all_shows(target):
    """
    /discover/tv's own sort_by options: no revenue/budget sort (TV has no
    single show-level revenue figure the way a movie does), first_air_date
    replaces primary_release_date, name replaces original_title.
    """
    all_shows = {}

    strategies = [
        {"name": "Popularity",                "sort": "popularity.desc",        "params": {}},
        {"name": "Vote Average (100+ votes)",  "sort": "vote_average.desc",      "params": {"vote_count.gte": 100}},
        {"name": "Vote Count",                 "sort": "vote_count.desc",        "params": {}},
        {"name": "First Air Date (Newest)",    "sort": "first_air_date.desc",    "params": {}},
        {"name": "First Air Date (Oldest)",    "sort": "first_air_date.asc",     "params": {}},
        {"name": "Name (A-Z)",                 "sort": "name.asc",               "params": {}},
        {"name": "Vote Average (10+ votes)",   "sort": "vote_average.desc",      "params": {"vote_count.gte": 10}},
    ]

    for i, s in enumerate(strategies, 1):
        if len(all_shows) >= target:
            print(f"Target of {target} reached — stopping early.")
            break

        print(f"[{i}/{len(strategies)}] {s['name']} (current total: {len(all_shows)})")
        shows = discover_with_params("/discover/tv", s["sort"], s["params"], target=target)

        new_count = 0
        for sh in shows:
            if sh["id"] not in all_shows:
                all_shows[sh["id"]] = sh
                new_count += 1
        print(f"    +{new_count} new shows")

    return list(all_shows.values())

# ---------- DETAILS (per-item data) ----------

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
            details["cast_photos"] = [
                {"name": c["name"], "profile_path": c.get("profile_path")} for c in cast[:10]
            ]
            details["director"] = [c["name"] for c in crew if c.get("job") == "Director"]

            videos = details.get("videos", {}).get("results", [])
            details["trailer_keys"] = [
                v["key"] for v in videos
                if v.get("site") == "YouTube" and v.get("type") == "Trailer"
            ]

            # Kept for backward compatibility with the existing pipe
            # separated watch_stream/watch_rent/watch_buy columns below,
            # NG-then-US flattened; watch_providers_json (spec 0005) keeps
            # the full multi-country response so a request can resolve to
            # whichever country the requesting user is actually in.
            providers_data = details.get("watch/providers", {}).get("results", {})
            region = providers_data.get("NG") or providers_data.get("US") or {}
            details["watch_stream"] = [p["provider_name"] for p in region.get("flatrate", [])]
            details["watch_rent"] = [p["provider_name"] for p in region.get("rent", [])]
            details["watch_buy"] = [p["provider_name"] for p in region.get("buy", [])]
            details["watch_providers"] = providers_data

            details["media_type"] = "movie"
            return details
        except requests.exceptions.RequestException as e:
            print(f"    Attempt {attempt + 1} failed for movie {movie_id}: {e}")
            time.sleep(wait)
    print(f"    Giving up on movie {movie_id} after {retries} attempts")
    return None

def fetch_show_details(show_id, retries=3, wait=2):
    """
    TV's /tv/{id} shape differs from /movie/{id} in three ways this
    pipeline needs to handle (spec 0010): aggregate_credits (full series
    cast across seasons) instead of credits; the crew has no "Director"
    job the way movie crew does, so director holds created_by's names
    instead; and the keywords response nests results under "results",
    not "keywords" like the movie endpoint.
    """
    for attempt in range(retries):
        try:
            details = get_json(f"/tv/{show_id}", {
                "append_to_response": "aggregate_credits,keywords,videos,watch/providers"
            })

            details["keywords"] = [k["name"] for k in details.get("keywords", {}).get("results", [])]

            cast = details.get("aggregate_credits", {}).get("cast", [])
            details["cast"] = [c["name"] for c in cast[:10]]
            details["cast_photos"] = [
                {"name": c["name"], "profile_path": c.get("profile_path")} for c in cast[:10]
            ]
            details["director"] = [c["name"] for c in details.get("created_by", [])]

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
            details["watch_providers"] = providers_data

            details["media_type"] = "tv"
            return details
        except requests.exceptions.RequestException as e:
            print(f"    Attempt {attempt + 1} failed for show {show_id}: {e}")
            time.sleep(wait)
    print(f"    Giving up on show {show_id} after {retries} attempts")
    return None

def save_to_csv(details_batch, path=None):
    if path is None:
        path = OUT_CSV

    fields = [
        "id", "media_type", "imdb_id", "title", "original_title", "tagline", "overview",
        "genres", "keywords", "cast", "director",
        "release_date", "status", "runtime",
        "number_of_seasons", "number_of_episodes", "episode_runtime",
        "original_language", "spoken_languages", "origin_country",
        "production_countries", "production_companies",
        "budget", "revenue",
        "popularity", "vote_average", "vote_count",
        "poster_path", "backdrop_path", "homepage",
        "adult", "belongs_to_collection",
        "trailer_keys", "watch_stream", "watch_rent", "watch_buy",
        "cast_photos_json", "watch_providers_json",
    ]
    file_exists = os.path.exists(path)

    with open(path, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        if not file_exists:
            writer.writeheader()
        for d in details_batch:
            media_type = d.get("media_type", "movie")
            is_tv = media_type == "tv"
            collection = d.get("belongs_to_collection")
            episode_run_times = d.get("episode_run_time") or []

            # Field renames a TV payload needs (spec 0010): name -> title,
            # first_air_date -> release_date, episode_run_time's first
            # value -> episode_runtime, origin_country -> production_countries
            # (TV has no production_countries field of its own), runtime
            # left null (TV has no single total runtime).
            writer.writerow({
                "id": d.get("id"),
                "media_type": media_type,
                "imdb_id": d.get("imdb_id"),
                "title": d.get("name") if is_tv else d.get("title"),
                "original_title": d.get("original_name") if is_tv else d.get("original_title"),
                "tagline": d.get("tagline"),
                "overview": d.get("overview"),
                "genres": "|".join(g["name"] for g in d.get("genres", [])),
                "keywords": "|".join(d.get("keywords", [])),
                "cast": "|".join(d.get("cast", [])),
                "director": "|".join(d.get("director", [])),
                "release_date": d.get("first_air_date") if is_tv else d.get("release_date"),
                "status": d.get("status"),
                "runtime": None if is_tv else d.get("runtime"),
                "number_of_seasons": d.get("number_of_seasons") if is_tv else None,
                "number_of_episodes": d.get("number_of_episodes") if is_tv else None,
                "episode_runtime": (episode_run_times[0] if episode_run_times else None) if is_tv else None,
                "original_language": d.get("original_language"),
                "spoken_languages": "|".join(l.get("english_name", "") for l in d.get("spoken_languages", [])),
                "origin_country": "|".join(d.get("origin_country", [])),
                "production_countries": (
                    "|".join(d.get("origin_country", [])) if is_tv
                    else "|".join(c.get("iso_3166_1", "") for c in d.get("production_countries", []))
                ),
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
                "cast_photos_json": json.dumps(d.get("cast_photos", [])),
                "watch_providers_json": json.dumps(d.get("watch_providers", {})),
            })

# ---------- MAIN ----------

def run_fetch(label, target, discover_fn, detail_fn, progress_file, discovered_file):
    """
    Shared discover -> fetch-details -> save loop for one media type.
    Movies and TV shows each get their own progress/discovered files (an
    id can collide across types) but append into the same OUT_CSV.
    """
    print("=" * 60)
    mode_label = f"TEST MODE ({target} {label})" if TEST_MODE else f"FULL RUN ({target} {label})"
    print(f"TMDB {label.capitalize()} Fetcher — {mode_label}")
    print("=" * 60)

    progress = load_json_file(progress_file, {"fetched_ids": []})
    fetched_ids = set(progress["fetched_ids"])
    if fetched_ids:
        print(f"Resuming: {len(fetched_ids)} {label} already have details saved.")

    items = load_json_file(discovered_file, None)
    if items:
        print(f"Using cached discovery list: {len(items)} {label} (skipping discovery phase).")
    else:
        print("\nRunning discovery phase...")
        items = discover_fn(target=target)
        save_json_file(discovered_file, items)
        print(f"Discovered {len(items)} unique {label}. Saved for future resumes.")

    remaining = [m for m in items if m["id"] not in fetched_ids]
    print(f"\n{label.capitalize()} remaining to fetch details for: {len(remaining)}")

    if not remaining:
        print(f"Nothing left to do. All {label} already fetched.")
        return

    batch = []
    total_done = len(fetched_ids)

    for i, m in enumerate(remaining, 1):
        print(f"[{i}/{len(remaining)}] {m.get('title') or m.get('name', 'Unknown')}")
        details = detail_fn(m["id"])
        if details:
            batch.append(details)
            fetched_ids.add(m["id"])
            total_done += 1

        if len(batch) >= 50:
            save_to_csv(batch)
            save_json_file(progress_file, {"fetched_ids": list(fetched_ids)})
            print(f"  Saved batch. Total done: {total_done}")
            batch = []

        time.sleep(0.25)

    if batch:
        save_to_csv(batch)
        save_json_file(progress_file, {"fetched_ids": list(fetched_ids)})

    print(f"\nDone. {total_done} {label} saved to {OUT_CSV}")

def main():
    run_fetch("movies", TARGET_MOVIES, discover_all_movies, fetch_movie_details,
               MOVIE_PROGRESS_FILE, MOVIE_DISCOVERED_FILE)
    run_fetch("shows", TARGET_SHOWS, discover_all_shows, fetch_show_details,
               SHOW_PROGRESS_FILE, SHOW_DISCOVERED_FILE)

if __name__ == "__main__":
    main()
