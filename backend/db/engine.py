"""
db/engine.py

The read side of the pgvector catalog (spec 0013): every query the
recommendation engine runs against Postgres. Ranking happens in SQL with
pgvector's cosine distance operator, so no embedding matrix is held in
memory. The taste math itself stays in recommend.py.

Every function here takes an open cursor and leaves the transaction to the
caller (use db.pool.connection). SQL parameters are always bound, and text
that goes into a LIKE pattern is escaped first.

Kept free of side effects on import so a test or a script can use it
without the full app configuration.
"""

import numpy as np

from db.catalog import escape_like, vector_literal

# A typed title resolves to a near match by trigram similarity only when it
# is at least this close (spec 0013, engine child). High on purpose: a lower
# value matches unrelated words ('healer' vs 'shelter').
RESOLVE_TRIGRAM_MIN = 0.8

_LEADING_ARTICLES = ("the ", "a ", "an ")

# ---------- TASTE INPUTS ----------

def fetch_rated_embeddings(cur, user_id):
    """
    (rating, embedding) for every title the user rated that has a vector.
    A rated title without a vector is skipped, the way a missing row was
    skipped before. Reading the vector as a real array avoids parsing its
    text form.
    """
    cur.execute(
        """
        SELECT r.rating, m.embedding::real[]
        FROM ratings r
        JOIN movies m ON m.id = r.movie_id AND m.media_type = r.media_type
        WHERE r.user_id = %(user_id)s::uuid AND m.embedding IS NOT NULL
        """,
        {"user_id": user_id},
    )
    return [(rating, np.array(embedding, dtype=np.float32)) for rating, embedding in cur.fetchall()]

def fetch_embedding(cur, movie_id, media_type):
    """
    (found, vector, combined_text) for one title. found is False when no such
    row exists; vector is None when the row exists but has no embedding yet.
    """
    cur.execute(
        "SELECT embedding::real[], combined_text FROM movies WHERE id = %s AND media_type = %s",
        (movie_id, media_type),
    )
    row = cur.fetchone()
    if row is None:
        return False, None, None
    embedding, combined_text = row
    return True, (None if embedding is None else np.array(embedding, dtype=np.float32)), combined_text

def save_embedding(cur, movie_id, media_type, vector, model_id):
    """Fill in a missing embedding, never overwriting one that is already set."""
    cur.execute(
        """
        UPDATE movies
        SET embedding = %s::extensions.vector, embedding_model = %s
        WHERE id = %s AND media_type = %s AND embedding IS NULL
        """,
        (vector_literal(vector), model_id, movie_id, media_type),
    )

# ---------- RANKING ----------

# One filter clause shared by the ranking query and the filters only check,
# so the two can never disagree about what a filter means.
_FILTERS_SQL = """
  AND (%(language)s::text IS NULL OR m.original_language = %(language)s)
  AND (%(actor)s::text IS NULL OR m.cast_members ILIKE '%%' || %(actor_like)s || '%%')
  AND (%(start_year)s::int IS NULL OR EXTRACT(YEAR FROM m.release_date) >= %(start_year)s)
  AND (%(end_year)s::int IS NULL OR EXTRACT(YEAR FROM m.release_date) <= %(end_year)s)
  AND (%(genre)s::text IS NULL OR m.genres ILIKE '%%' || %(genre_like)s || '%%')
"""

# taste_similarity is the raw similarity to the user's pure taste vector (never
# the mood blended query), computed here so no embedding is read back as text.
_RANK_SQL = f"""
SELECT m.id, m.media_type, m.title, m.release_date, m.poster_path,
       1 - (m.embedding <=> %(q)s::extensions.vector) AS similarity,
       CASE WHEN %(taste)s::extensions.vector IS NULL THEN NULL
            ELSE 1 - (m.embedding <=> %(taste)s::extensions.vector) END AS taste_similarity
FROM movies m
WHERE m.embedding IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM ratings r
                  WHERE r.user_id = %(user_id)s::uuid
                    AND r.movie_id = m.id AND r.media_type = m.media_type)
  AND NOT EXISTS (SELECT 1 FROM unnest(%(ex_ids)s::int[], %(ex_types)s::text[]) AS e(id, media_type)
                  WHERE e.id = m.id AND e.media_type = m.media_type)
  {_FILTERS_SQL}
ORDER BY similarity DESC, m.id, m.media_type
LIMIT %(top_n)s
"""

_FILTERS_ONLY_SQL = f"""
SELECT EXISTS (SELECT 1 FROM movies m WHERE TRUE {_FILTERS_SQL})
"""

_RANK_KEYS = ("id", "media_type", "title", "release_date", "poster_path", "similarity", "taste_similarity")

def _filter_params(language, actor, start_year, end_year, genre=None):
    return {
        "language": language,
        "actor": actor,
        "actor_like": escape_like(actor) if actor else None,
        "start_year": start_year,
        "end_year": end_year,
        "genre": genre,
        "genre_like": escape_like(genre) if genre else None,
    }

def rank_titles(cur, query_vector, top_n=10, taste_vector=None, user_id=None, exclude=(),
                language=None, actor=None, start_year=None, end_year=None):
    """
    The titles closest to query_vector by cosine similarity, best first (ties
    broken by id then media_type, so the order is stable). Only rows with an
    embedding are considered. A signed in user's rated titles are left out
    when user_id is given, and any (id, media_type) pairs in exclude are left
    out as well. Returns a list of dicts with the ranked columns, plus
    similarity to the query and taste_similarity to taste_vector (None when
    there is none).
    """
    exclude = list(exclude)
    params = {
        "q": vector_literal(query_vector),
        "taste": None if taste_vector is None else vector_literal(taste_vector),
        "user_id": user_id,
        "ex_ids": [movie_id for movie_id, _ in exclude],
        "ex_types": [media_type for _, media_type in exclude],
        "top_n": max(int(top_n), 0),
        **_filter_params(language, actor, start_year, end_year),
    }
    cur.execute(_RANK_SQL, params)
    return [dict(zip(_RANK_KEYS, row)) for row in cur.fetchall()]

def filters_match_any(cur, language=None, actor=None, start_year=None, end_year=None):
    """True when at least one title passes the filters, ignoring everything else."""
    cur.execute(_FILTERS_ONLY_SQL, _filter_params(language, actor, start_year, end_year))
    return cur.fetchone()[0]

# ---------- TITLE LOOKUP ----------

def find_title_local(cur, title):
    """
    Resolve a typed title against the catalog, with no media type hint.
    Order of rules, same as before: an exact lowercase match, then the same
    title with a leading article dropped ('the titanic' finds 'Titanic'),
    then a close trigram match. A title shared by a movie and a TV show goes
    to the more popular one, then the one with more votes.
    Returns (id, media_type), or (None, None) when nothing matches.
    """
    key = title.lower().strip()
    if not key:
        return None, None

    keys = [key]
    for article in _LEADING_ARTICLES:
        if key.startswith(article) and key[len(article):]:
            keys.append(key[len(article):])

    cur.execute(
        """
        SELECT id, media_type FROM movies
        WHERE lower(title) = ANY(%(keys)s::text[])
        ORDER BY array_position(%(keys)s::text[], lower(title)),
                 popularity DESC NULLS LAST, vote_count DESC NULLS LAST, id, media_type
        LIMIT 1
        """,
        {"keys": keys},
    )
    row = cur.fetchone()
    if row:
        return row

    cur.execute(
        """
        SELECT id, media_type FROM movies
        WHERE lower(title) %% %(key)s AND similarity(lower(title), %(key)s) >= %(min)s
        ORDER BY similarity(lower(title), %(key)s) DESC,
                 popularity DESC NULLS LAST, vote_count DESC NULLS LAST, id, media_type
        LIMIT 1
        """,
        {"key": key, "min": RESOLVE_TRIGRAM_MIN},
    )
    row = cur.fetchone()
    return row if row else (None, None)

# ---------- BROWSE (trending, browse, search, row count) ----------

# Trending only counts titles with at least this many votes (spec 0013, AC-4).
TRENDING_MIN_VOTES = 50

# Both Home rows (Top Rated Picks, Popular Picks) take a pool of the best
# candidates by their own measure, then order the pool by how close each title
# is to the user's taste. With no taste vector every similarity is NULL, so the
# order falls back to the pool's own (rating or popularity) order.
PERSONALIZE_POOL = 200

_RATED_BY_USER_SQL = """
  AND NOT EXISTS (SELECT 1 FROM ratings r
                  WHERE r.user_id = %(user_id)s::uuid
                    AND r.movie_id = m.id AND r.media_type = m.media_type)
"""

_TRENDING_SQL = f"""
WITH pool AS (
    SELECT m.id, m.media_type, m.title, m.release_date, m.poster_path,
           m.vote_average, m.popularity,
           CASE WHEN %(taste)s::extensions.vector IS NULL OR m.embedding IS NULL THEN NULL
                ELSE 1 - (m.embedding <=> %(taste)s::extensions.vector) END AS taste_similarity,
           d.backdrop_path
    FROM movies m
    LEFT JOIN movie_details d ON d.id = m.id AND d.media_type = m.media_type
    WHERE m.vote_count >= %(min_votes)s
      {_RATED_BY_USER_SQL}
    ORDER BY m.vote_average DESC NULLS LAST, m.popularity DESC NULLS LAST, m.id, m.media_type
    LIMIT %(pool)s
)
SELECT id, media_type, title, release_date, poster_path, taste_similarity, backdrop_path
FROM pool
ORDER BY taste_similarity DESC NULLS LAST, vote_average DESC NULLS LAST,
         popularity DESC NULLS LAST, id, media_type
LIMIT %(top_n)s
"""

def trending_titles(cur, taste_vector=None, top_n=20, user_id=None):
    """
    The best rated titles with enough votes, ordered by closeness to the
    user's taste (rating order when there is no taste vector), and leaving out
    titles the user has already rated. Same card shape rank_titles returns
    (taste_similarity is None without a taste vector, or for a row that has no
    embedding yet), plus backdrop_path (None until the title's details are
    loaded) for Home's hero carousel.
    """
    top_n = max(int(top_n), 0)
    cur.execute(_TRENDING_SQL, {
        "taste": None if taste_vector is None else vector_literal(taste_vector),
        "user_id": user_id,
        "min_votes": TRENDING_MIN_VOTES,
        "pool": max(top_n, PERSONALIZE_POOL),
        "top_n": top_n,
    })
    keys = ("id", "media_type", "title", "release_date", "poster_path", "taste_similarity", "backdrop_path")
    return [dict(zip(keys, row)) for row in cur.fetchall()]

_BROWSE_SQL = f"""
SELECT m.id, m.media_type, m.title, m.original_language, m.release_date, m.genres, m.poster_path
FROM movies m
WHERE (%(media_type)s::text IS NULL OR m.media_type = %(media_type)s)
  {_FILTERS_SQL}
ORDER BY m.popularity DESC NULLS LAST, m.id, m.media_type
LIMIT %(limit)s
"""

_BROWSE_PERSONAL_SQL = f"""
WITH pool AS (
    SELECT m.id, m.media_type, m.title, m.original_language, m.release_date, m.genres,
           m.poster_path, m.popularity,
           CASE WHEN m.embedding IS NULL THEN NULL
                ELSE 1 - (m.embedding <=> %(taste)s::extensions.vector) END AS taste_similarity
    FROM movies m
    WHERE (%(media_type)s::text IS NULL OR m.media_type = %(media_type)s)
      {_FILTERS_SQL}
      {_RATED_BY_USER_SQL}
    ORDER BY m.popularity DESC NULLS LAST, m.id, m.media_type
    LIMIT %(pool)s
)
SELECT id, media_type, title, original_language, release_date, genres, poster_path, taste_similarity
FROM pool
ORDER BY taste_similarity DESC NULLS LAST, popularity DESC NULLS LAST, id, media_type
LIMIT %(limit)s
"""

def browse_titles(cur, language=None, actor=None, start_year=None, end_year=None,
                  media_type=None, limit=20, taste_vector=None, user_id=None, genre=None):
    """
    Titles passing the filters, most popular first. media_type None or 'both'
    means either kind. With a taste_vector, the most popular pool is instead
    ordered by closeness to that taste, leaving out titles user_id has rated,
    and each row also carries taste_similarity (None without an embedding).
    genre matches any of a title's genres by substring.
    """
    params = _filter_params(language, actor, start_year, end_year, genre)
    params["media_type"] = None if media_type in (None, "both") else media_type
    params["limit"] = max(int(limit), 0)
    keys = ("id", "media_type", "title", "original_language", "release_date", "genres", "poster_path")
    if taste_vector is None:
        cur.execute(_BROWSE_SQL, params)
    else:
        keys += ("taste_similarity",)
        params["taste"] = vector_literal(taste_vector)
        params["user_id"] = user_id
        params["pool"] = max(params["limit"], PERSONALIZE_POOL)
        cur.execute(_BROWSE_PERSONAL_SQL, params)
    return [dict(zip(keys, row)) for row in cur.fetchall()]

# Typeahead search (spec 0013, AC-12).
SEARCH_MIN_CHARS = 2
SEARCH_TYPO_MIN_CHARS = 4      # a one letter typo is tolerated from this length
SEARCH_TYPO_MAX_CHARS = 32     # longer than this the variant list gets silly; trigram still applies
SEARCH_TRIGRAM_MIN = 0.5       # tuned so 'interstelar' finds 'Interstellar' and 'healer' does not find 'shelter'
_TYPO_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789 "

def one_edit_variants(text):
    """
    Every string one letter away from text (one letter deleted, replaced,
    inserted, or two neighbours swapped), text itself excluded. Used to find a
    title with a one letter typo by plain equality, which needs no extension.
    """
    splits = [(text[:i], text[i:]) for i in range(len(text) + 1)]
    variants = set()
    for left, right in splits:
        if right:
            variants.add(left + right[1:])
            for c in _TYPO_ALPHABET:
                variants.add(left + c + right[1:])
        if len(right) > 1:
            variants.add(left + right[1] + right[0] + right[2:])
        for c in _TYPO_ALPHABET:
            variants.add(left + c + right)
    variants.discard(text)
    return sorted(variants)

_SEARCH_SUBSTRING_SQL = """
SELECT id, media_type, title, release_date, poster_path
FROM movies
WHERE lower(title) LIKE '%%' || %(like)s || '%%'
ORDER BY CASE WHEN lower(title) = %(q)s THEN 0
              WHEN lower(title) LIKE %(like)s || '%%' THEN 1
              ELSE 2 END,
         popularity DESC NULLS LAST, id, media_type
LIMIT %(limit)s
"""

_SEARCH_FUZZY_SQL = """
SELECT id, media_type, title, release_date, poster_path
FROM movies
WHERE (%(typo)s::boolean AND lower(title) = ANY(%(variants)s::text[]))
   OR lower(title) %% %(q)s
ORDER BY similarity(lower(title), %(q)s) DESC, popularity DESC NULLS LAST, id, media_type
LIMIT %(limit)s
"""

def search_titles(cur, query, limit=8):
    """
    Titles for live typing: substring matches first (exact, then prefix, then
    anywhere, popular first), then, only if there is room, close matches (one
    letter typos, near spellings). One row per (id, media_type). Needs a query
    of at least 2 characters. % and _ in the query are plain text.
    """
    q = (query or "").lower().strip()
    limit = max(int(limit), 0)
    if len(q) < SEARCH_MIN_CHARS or limit == 0:
        return []

    keys = ("id", "media_type", "title", "release_date", "poster_path")
    cur.execute(_SEARCH_SUBSTRING_SQL, {"q": q, "like": escape_like(q), "limit": limit})
    results = [dict(zip(keys, row)) for row in cur.fetchall()]
    if len(results) >= limit:
        return results

    seen = {(row["id"], row["media_type"]) for row in results}
    typo = SEARCH_TYPO_MIN_CHARS <= len(q) <= SEARCH_TYPO_MAX_CHARS
    # The % operator reads this setting; local to this transaction.
    cur.execute("SELECT set_config('pg_trgm.similarity_threshold', %s, true)", (str(SEARCH_TRIGRAM_MIN),))
    cur.execute(_SEARCH_FUZZY_SQL, {
        "q": q, "typo": typo, "variants": one_edit_variants(q) if typo else [], "limit": limit,
    })
    for row in cur.fetchall():
        item = dict(zip(keys, row))
        if (item["id"], item["media_type"]) not in seen:
            seen.add((item["id"], item["media_type"]))
            results.append(item)
            if len(results) >= limit:
                break
    return results

def estimate_movie_count(cur):
    """A cheap row count from the planner's estimate (never a full count of the table)."""
    cur.execute("SELECT GREATEST(reltuples, 0)::bigint FROM pg_class WHERE oid = 'movies'::regclass")
    return int(cur.fetchone()[0])

def fetch_card(cur, movie_id, media_type):
    """The resolve response for one stored title, or None when it is not in the catalog."""
    cur.execute(
        "SELECT id, media_type, title, release_date, poster_path FROM movies WHERE id = %s AND media_type = %s",
        (movie_id, media_type),
    )
    row = cur.fetchone()
    if row is None:
        return None
    return {
        "movie_id": row[0],
        "media_type": row[1],
        "title": row[2],
        "release_date": row[3].isoformat() if row[3] else None,
        "poster_path": row[4],
    }
