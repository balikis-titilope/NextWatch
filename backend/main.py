"""
main.py
FastAPI service wrapping recommend.py's functions behind HTTP endpoints.

Key design decision (spec 0013): the movie catalog and every embedding live in
Postgres (pgvector), not in server memory. The server starts empty and asks the
database for matches. The embedding model loads in a background thread at
startup (EMBEDDING_PRELOAD), so readiness never waits for it; a request that
needs a vector before it is ready gets a 503 with Retry-After.
"""

import os
import threading
from contextlib import asynccontextmanager
from typing import Literal
from fastapi import FastAPI, HTTPException, Depends, Header, Request, Form
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from pydantic import BaseModel, Field
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from auth import (
    sign_up,
    sign_in,
    refresh_access_token,
    verify_signup_code,
    resend_confirmation_code,
    check_email_registered,
    send_password_reset,
    verify_recovery_code,
    finish_password_reset,
    get_current_user_id,
    get_current_active_user_id,
    get_current_user_email,
    get_optional_user_id,
    sign_out_everywhere,
    delete_auth_user,
)
from recommend import (
    CatalogFull,
    TmdbUnavailable,
    build_mood_vector,
    calibrated_score,
    cards_from_ranked,
    combine_vectors,
    get_vector,
    get_watch_providers,
    load_detail,
    mean_vector,
    personal_ceiling_from_rows,
    predict_user_interest,
    resolve_catalog_title,
    resolve_id_to_vector,
    resolve_title_to_vector,
    taste_vector_from_rows,
)
from db.embedder import (
    RETRY_AFTER_SECONDS,
    ModelNotReady,
    preload_enabled,
    start_background_load,
)
from db.engine import (
    browse_titles,
    estimate_movie_count,
    fetch_rated_embeddings,
    filters_match_any,
    rank_titles,
    search_titles,
    trending_titles,
)
from db.details import DEFAULT_COUNTRY, fetch_user_rating
from db.pool import connection
from db.import_data import (
    create_user_profile,
    add_rating,
    delete_rating,
    get_user_ratings,
    get_user_ratings_detailed,
    get_user_profile,
    get_user_country,
    set_onboarding_completed,
    touch_last_active,
    check_recommendations_threshold,
    run_re_engagement_scan,
    get_notifications,
    get_unread_notification_count,
    mark_notification_read,
    mark_all_notifications_read,
    get_notification_prefs,
    update_notification_prefs,
    deactivate_account,
    reactivate_account,
    get_accounts_due_for_purge,
)

# Public routes that can write to the catalog (live resolve) or are cheap to
# hammer are limited per client address (spec 0013, AC-11).
WRITE_RATE_LIMIT = "30/minute"

def check_model_ids():
    """
    Startup check (spec 0013's cross child contract): log a warning if rows were
    embedded with more than one model. Runs in its own thread and never fails
    startup, even when the database is unreachable.
    """
    try:
        with connection() as conn, conn.cursor() as cur:
            cur.execute("SELECT count(DISTINCT embedding_model) FROM movies WHERE embedding_model IS NOT NULL")
            distinct = cur.fetchone()[0]
        if distinct > 1:
            print(f"WARNING: movies holds embeddings from {distinct} different models")
    except Exception as e:
        print(f"model id check skipped: {e}")

def run_daily_purge():
    """
    Permanently remove any account whose deactivated_at is more than 30
    days old (spec 0009 AC-7): deletes the Supabase Auth user via the
    Admin API for each candidate, which cascades to users/ratings/
    notifications. A single account's failure is logged and skipped, not
    raised, so it doesn't abort the rest of the run (spec's own
    failure-isolation note, same pattern as the recommendations_ready
    threshold check in POST /ratings).
    """
    for user_id in get_accounts_due_for_purge():
        try:
            delete_auth_user(user_id)
        except Exception as e:
            print(f"account purge failed for user {user_id}: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Runs once, when the server starts. Nothing is loaded here: the catalog is
    # in Postgres, and the embedding model loads in the background so startup
    # never waits for it (spec 0013, AC-1, AC-7).
    if preload_enabled():
        start_background_load()
    threading.Thread(target=check_model_ids, name="model-id-check", daemon=True).start()
    # Daily re-engagement scan (spec 0006 AC-2): finds users inactive 7+
    # days and writes one notification each, skipping anyone already
    # notified in the last 7 days or who has muted the type. In-memory
    # schedule -- fine for a daily job re-derived from DB state each run,
    # no persistence needed (see spec's Consequences). run_re_engagement_scan
    # is a plain sync function; AsyncIOScheduler runs it in a threadpool.
    scheduler = AsyncIOScheduler()
    scheduler.add_job(
        run_re_engagement_scan,
        CronTrigger(hour=9, timezone="UTC"),
        id="re_engagement_scan",
    )
    # Daily account purge (spec 0009 AC-7): hard-deletes any account
    # deactivated more than 30 days ago via Supabase's Admin API, which
    # cascades to users/ratings/notifications. hour=3 UTC, distinct from
    # the re-engagement scan's hour=9 so the two never overlap.
    scheduler.add_job(
        run_daily_purge,
        CronTrigger(hour=3, timezone="UTC"),
        id="account_purge",
    )
    scheduler.start()
    yield
    scheduler.shutdown()

app = FastAPI(title="Movie Discovery API", lifespan=lifespan)

# Per-IP rate limiting (spec 0009 AC-9), applied only to
# POST /legal/delete-account -- the one public endpoint here that checks a
# password, the same shape as a login endpoint.
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# A request that needs a vector right now while the embedding model is still
# loading (mood text, /predict, a title with no embedding yet) is told to come
# back shortly; nothing waits inline (spec 0013, AC-7).
@app.exception_handler(ModelNotReady)
async def model_not_ready_handler(request: Request, exc: ModelNotReady):
    return JSONResponse(
        status_code=503,
        content={"detail": "The recommendation model is still starting up. Try again in a few seconds."},
        headers={"Retry-After": str(RETRY_AFTER_SECONDS)},
    )

# The database is at the hard ceiling: no new title is accepted (AC-11).
@app.exception_handler(CatalogFull)
async def catalog_full_handler(request: Request, exc: CatalogFull):
    return JSONResponse(status_code=503, content={"detail": "The catalog is full, so new titles cannot be added right now."})

@app.exception_handler(TmdbUnavailable)
async def tmdb_unavailable_handler(request: Request, exc: TmdbUnavailable):
    return JSONResponse(status_code=502, content={"detail": "Could not reach TMDB. Try again shortly."})

# The mobile app's web target (Expo Router) calls this API from a browser
# origin (localhost:8081 in dev, an unknown host in prod), which enforces
# CORS; native iOS/Android is unaffected since only browsers send preflight
# requests. Wildcard origins are safe here because auth is a Bearer token
# in the Authorization header, never a cookie (allow_credentials stays
# False, its default) -- there's no session cookie for a wildcard origin
# to steal.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- REQUEST/RESPONSE SHAPES ----------
# Pydantic models describe what a valid request body looks like.
# FastAPI uses these to validate incoming requests automatically.

class RecommendRequest(BaseModel):
    liked_titles: list[str] = []       # ad-hoc/dev use without an account — never persisted
    mood_text: str | None = None
    mood_weight: float = 0.5
    top_n: int = 10
    language: str | None = None
    actor: str | None = None
    start_year: int | None = None
    end_year: int | None = None

class RatingRequest(BaseModel):
    movie_id: int
    media_type: Literal["movie", "tv"]
    rating: int

class PredictRequest(BaseModel):
    liked_titles: list[str]
    candidate_title: str

class ResolveRequest(BaseModel):
    title: str

class SignupRequest(BaseModel):
    email: str
    password: str
    country: str | None = None  # ISO 3166-1 alpha-2, captured from the device locale (spec 0005)

class LoginRequest(BaseModel):
    email: str
    password: str

class RefreshRequest(BaseModel):
    refresh_token: str

class VerifySignupRequest(BaseModel):
    email: str
    token: str
    country: str | None = None  # carried over from the signup attempt that required confirmation (spec 0005)

class ResendConfirmationRequest(BaseModel):
    email: str

class RequestPasswordResetRequest(BaseModel):
    email: str

class ResetPasswordRequest(BaseModel):
    email: str
    token: str
    # AC-5: 8 characters is this project's fixed password policy (matches
    # the Supabase dashboard's minimum) -- enforced here server side as
    # the check that actually holds, mirrored client side for fast feedback.
    new_password: str = Field(min_length=8)

class NotificationPrefs(BaseModel):
    recommendations_ready: bool
    re_engagement: bool

class MeResponse(BaseModel):
    user_id: str
    email: str | None
    onboarding_completed: bool
    notification_prefs: NotificationPrefs
    deactivated_at: str | None = None  # spec 0009: null while active, ISO timestamp during the 30 day grace period

class NotificationPrefsUpdate(BaseModel):
    model_config = {"extra": "forbid"}  # AC-7: an unknown key is a 422, not silently ignored
    recommendations_ready: bool | None = None
    re_engagement: bool | None = None

class DeactivateRequest(BaseModel):
    password: str
    confirm: str  # must equal the literal word "DELETE" (spec 0009 AC-1)

# ---------- ENDPOINTS ----------

@app.get("/")
def root():
    """
    Liveness plus a cheap catalog size from the planner's row estimate (spec
    0013, AC-16). A database outage is reported in the body, not raised, so a
    health check never takes the server down with the database.
    """
    try:
        with connection() as conn, conn.cursor() as cur:
            loaded = estimate_movie_count(cur)
        return {"status": "ok", "movies_loaded": loaded}
    except Exception as e:
        print(f"root: database unavailable: {e}")
        return {"status": "error", "movies_loaded": None, "error": "database unavailable"}

# ---------- LEGAL (spec 0009: legal screens and consent) ----------
# Static HTML, publicly reachable, no login required -- both stores require
# a working privacy policy URL before they'll even accept a submission
# (AC-1, AC-5). Text lives in backend/legal/ under version control, not the
# database, since it changes rarely.
LEGAL_DIR = os.path.join(os.path.dirname(__file__), "legal")

@app.get("/legal/privacy-policy")
def legal_privacy_policy():
    return FileResponse(os.path.join(LEGAL_DIR, "privacy-policy.html"), media_type="text/html")

@app.get("/legal/terms")
def legal_terms():
    return FileResponse(os.path.join(LEGAL_DIR, "terms.html"), media_type="text/html")

@app.get("/legal/support")
def legal_support():
    return FileResponse(os.path.join(LEGAL_DIR, "support.html"), media_type="text/html")

def _split_pipe(value):
    """A pipe-joined column (e.g. genres, director) that may be NULL or empty."""
    return value.split("|") if isinstance(value, str) and value else []

def _taste_for_user(user_id):
    """(taste vector, personal ceiling) from the user's rated titles, or (None, None) with no usable signal."""
    with connection() as conn, conn.cursor() as cur:
        rows = fetch_rated_embeddings(cur, user_id)
    taste = taste_vector_from_rows(rows)
    ceiling = personal_ceiling_from_rows(rows, taste) if taste is not None else None
    return taste, ceiling

# Path-segment disambiguated (spec 0010): media_type is a required path
# segment, not a query param or a default, since a movie and a TV show can
# share the same raw TMDB id -- (id) alone can no longer identify a
# row. The old single-id routes (/movies/{id:int}, /movies/{id:int}/similar)
# are removed rather than kept as an ambiguous fallback, so a caller can't
# silently hit a shape that no longer disambiguates correctly.
# Registered ahead of /movies/{title}/similar for the same route-order
# reason the old comment gave: Starlette matches in registration order,
# and this route's /{id:int} segment only matches a numeric id, so it
# can never swallow /movies/{title}/similar's 2-segment shape (different
# segment count) -- no ambiguity either way, but kept first for clarity.
@app.get("/movies/{media_type}/{id:int}")
def movie_detail(media_type: Literal["movie", "tv"], id: int, user_id: str = Depends(get_current_user_id)):
    """
    Full Movie/TV Detail data (spec 0005 AC-5 through AC-10, extended for TV
    by spec 0010, read from Postgres by spec 0013 AC-5): the movies row joined
    with movie_details, fetched from TMDB once if the title or its details are
    missing. Watch providers come from a per country cache with a 24 hour
    freshness. release_date and director hold first_air_date and creator(s)
    for a TV row (spec 0010's schema decision).
    """
    row, error = load_detail(id, media_type)
    if row is None:
        if error == "not_found":
            raise HTTPException(status_code=404, detail=f"{media_type.capitalize()} {id} could not be found")
        # The TMDB call itself failed outright (network error, timeout, a
        # non-200) -- a clear error, nothing cached (AC-10).
        raise HTTPException(status_code=502, detail=f"Could not reach TMDB for {media_type} {id}")

    # The title's own vector is only needed to score it for a user who has a
    # usable taste signal; a title with no embedding yet is embedded on demand
    # (503 while the model loads).
    taste, ceiling = _taste_for_user(user_id)
    predicted_score = None
    if taste is not None:
        _, vector = get_vector(id, media_type)
        predicted_score = calibrated_score(predict_user_interest(taste, vector), ceiling)

    with connection() as conn, conn.cursor() as cur:
        user_rating = fetch_user_rating(cur, user_id, id, media_type)

    country = get_user_country(user_id) or DEFAULT_COUNTRY
    watch_providers = get_watch_providers(id, media_type, country)

    trailer_keys = _split_pipe(row["trailer_keys"])
    return {
        "id": row["id"],
        "media_type": row["media_type"],
        "title": row["title"],
        "tagline": row["tagline"] or None,
        "overview": row["overview"] or None,
        "genres": _split_pipe(row["genres"]),
        "release_date": row["release_date"].isoformat() if row["release_date"] else None,
        "runtime": row["runtime"],
        "status": row["status"],
        "number_of_seasons": row["number_of_seasons"],
        "number_of_episodes": row["number_of_episodes"],
        "episode_runtime": row["episode_runtime"],
        "original_language": row["original_language"],
        "poster_path": row["poster_path"],
        "backdrop_path": row["backdrop_path"],
        "predicted_score": predicted_score,
        "cast": row["cast_photos"] or [],
        "director": _split_pipe(row["director"]),
        "trailer_key": trailer_keys[0] if trailer_keys else None,
        "watch_providers": watch_providers,
        "user_rating": user_rating,
    }

@app.get("/movies/{media_type}/{id:int}/similar")
def similar_movies_by_id(media_type: Literal["movie", "tv"], id: int, top_n: int = 5, user_id: str = Depends(get_current_user_id)):
    """
    Titles similar to a specific title by id (spec 0005 AC-13, extended
    for TV by spec 0010 AC-6) -- no title search, no fuzzy matching,
    since "Because you liked [X]" already has the exact (movie_id,
    media_type) from GET /me/ratings. Ranks purely by embedding
    closeness across the WHOLE catalog, so a movie's similar list can
    genuinely include a TV show and vice versa -- no media_type filter
    here (AC-6). predicted_score is a plain 0-100 clamp of closeness to
    the SOURCE title, not calibrated to the requesting user -- a
    deliberately different meaning from /recommend and /movies/trending's
    own score (Key invariants).
    """
    source_vector, error = resolve_id_to_vector(id, media_type)
    if source_vector is None:
        if error == "fetch_failed":
            raise HTTPException(status_code=502, detail=f"Could not reach TMDB for {media_type} {id}")
        raise HTTPException(status_code=404, detail=f"{media_type.capitalize()} {id} could not be found")

    with connection() as conn, conn.cursor() as cur:
        ranked = rank_titles(cur, source_vector, top_n=top_n, exclude=[(id, media_type)])
    return cards_from_ranked(ranked, 1.0, score_key="similarity")

@app.get("/movies/{title}/similar")
@limiter.limit(WRITE_RATE_LIMIT)
def similar_movies(request: Request, title: str, top_n: int = 5):
    """
    Legacy title-based similar lookup (not called by the mobile app,
    which uses the id-based route above) -- kept and audited for spec
    0010 rather than deprecated: it already gains TV support for free,
    since a typed title resolves against the catalog with no media type
    hint, and falls back to both TMDB catalogs. Its score is the raw
    similarity rounded to 2 places, not a calibrated percentage. Public and
    able to write (a live resolve), so rate limited per client address.
    """
    movie_id, media_type, target_vector = resolve_title_to_vector(title)
    if target_vector is None:
        raise HTTPException(status_code=404, detail=f"'{title}' could not be found on TMDB")

    with connection() as conn, conn.cursor() as cur:
        ranked = rank_titles(cur, target_vector, top_n=top_n, exclude=[(movie_id, media_type)])
    cards = cards_from_ranked(ranked, 1.0, score_key="similarity")
    for card, row in zip(cards, ranked):
        card["predicted_score"] = round(row["similarity"], 2)  # raw similarity, not a calibrated percentage
    return cards

def _taste_from_liked_titles(liked_titles):
    """
    The average vector of typed liked titles, plus their (id, media_type) keys
    so they can be left out of the results. Titles that cannot be resolved are
    skipped; 404 when none can.
    """
    vectors = []
    keys = []
    for title in liked_titles:
        movie_id, media_type, vector = resolve_title_to_vector(title)
        if vector is not None:
            vectors.append(vector)
            keys.append((movie_id, media_type))
    if not vectors:
        raise HTTPException(status_code=404, detail="None of the liked titles could be found")
    return mean_vector(vectors), keys

@app.post("/recommend")
def recommend(req: RecommendRequest, user_id: str | None = Depends(get_optional_user_id)):
    language = req.language or None
    actor = req.actor or None
    start_year = req.start_year or None
    end_year = req.end_year or None

    # Preferred path: logged in, taste from the user's real ratings. Their rated
    # titles (liked or disliked) are left out of the results by the ranking
    # query itself, whether or not a usable taste vector came out of them.
    taste, ceiling = _taste_for_user(user_id) if user_id is not None else (None, None)
    exclude = []
    exclude_rated_for = user_id

    # Fallback path: ad-hoc liked_titles, for use without an account (e.g. quick testing)
    if taste is None and req.liked_titles:
        taste, exclude = _taste_from_liked_titles(req.liked_titles)
        ceiling = None
        exclude_rated_for = None

    has_mood = req.mood_text is not None and req.mood_text.strip() != ""

    # Cold start: nothing to personalize with at all (no ratings, no usable
    # taste signal, and no mood text) -- AC-3 wants an empty list here, not
    # a popularity fallback (that's what Trending Now is for), so Home can
    # show a "rate a few movies" prompt instead of a row that's secretly
    # just Trending Now again.
    if taste is None and not has_mood:
        return []

    mood = build_mood_vector(req.mood_text) if has_mood else None  # 503 while the model loads
    query = combine_vectors(user_embedding=taste, mood_embedding=mood, mood_weight=req.mood_weight)

    # The DISPLAYED match score (AC-2) is always the result's similarity to the
    # user's own pure taste vector, never the mood-blended query that ranked
    # the list -- a mood-only user simply gets a null score on every row.
    with connection() as conn, conn.cursor() as cur:
        ranked = rank_titles(
            cur, query, top_n=req.top_n, taste_vector=taste, user_id=exclude_rated_for, exclude=exclude,
            language=language, actor=actor, start_year=start_year, end_year=end_year,
        )
        filters_set = bool(language or actor or start_year or end_year)
        no_title_matches = (
            not ranked and filters_set
            and not filters_match_any(cur, language, actor, start_year, end_year)
        )
    # 404 only when the filters alone match nothing; titles that match but are
    # all rated or lack a vector give an empty list.
    if no_title_matches:
        raise HTTPException(
            status_code=404,
            detail=(
                f"No movies match language='{req.language}' actor='{req.actor}' "
                f"start_year={req.start_year} end_year={req.end_year}"
            )
        )
    return cards_from_ranked(ranked, ceiling)

@app.post("/predict")
@limiter.limit(WRITE_RATE_LIMIT)
def predict(request: Request, req: PredictRequest):
    user_embedding, _ = _taste_from_liked_titles(req.liked_titles)
    _, _, candidate_vector = resolve_title_to_vector(req.candidate_title)
    if candidate_vector is None:
        raise HTTPException(status_code=404, detail=f"'{req.candidate_title}' could not be found")

    score = predict_user_interest(user_embedding, candidate_vector)
    return {"candidate": req.candidate_title, "predicted_score": float(score)}

@app.get("/movies/trending")
def trending_movies(top_n: int = 20, user_id: str = Depends(get_current_user_id)):
    """
    Top rated titles with enough votes (Home's "Top Rated Picks", spec 0005
    AC-4), ordered by closeness to the requesting user's taste and leaving out
    what they already rated. Each carries the user's own match score (AC-2) -- null when they have no
    usable taste signal, the same condition /recommend's cold start uses
    (AC-3), so a brand new user sees a real Trending row with no scores
    rather than an error. Never needs the model.
    """
    taste, ceiling = _taste_for_user(user_id)
    with connection() as conn, conn.cursor() as cur:
        ranked = trending_titles(cur, taste_vector=taste, top_n=top_n, user_id=user_id)
    return cards_from_ranked(ranked, ceiling)

@app.get("/movies/search")
def search_movies(q: str, limit: int = 8):
    """
    Local-only typeahead search -- no TMDB calls, so it's cheap enough to
    run live as the user types. Searches the catalog in Postgres (substring
    first, then close spellings); if nothing good comes back, the frontend
    should fall back to POST /movies/resolve to search + fetch from TMDB on
    submit.
    """
    with connection() as conn, conn.cursor() as cur:
        results = search_titles(cur, q, limit=limit)
    for result in results:
        result["release_date"] = result["release_date"].isoformat() if result["release_date"] else None
    return results

@app.post("/movies/resolve")
@limiter.limit(WRITE_RATE_LIMIT)
def resolve_movie(request: Request, req: ResolveRequest):
    """
    Resolve a typed title to a real movie or TV show, ready to rate:
    local match if we have one (either media type), otherwise searched
    against both TMDB catalogs (spec 0010: the fix for titles like "The
    Manipulated" that only ever live in TMDB's TV catalog) and written to
    Postgres (so it survives a restart and can satisfy ratings.movie_id's
    foreign key). Never needs the embedding model: a title written while it
    loads gets its embedding later (spec 0013, AC-6). Public and able to
    write, so rate limited per client address.
    """
    card = resolve_catalog_title(req.title)
    if card is None:
        raise HTTPException(status_code=404, detail=f"'{req.title}' could not be found on TMDB")
    return card

@app.get("/movies")
def browse_movies(
    language: str | None = None,
    actor: str | None = None,
    start_year: int | None = None,
    end_year: int | None = None,
    media_type: Literal["movie", "tv", "both"] = "both",
    limit: int = 20,
    genre: str | None = None,
    personalized: bool = False,
    user_id: str | None = Depends(get_optional_user_id),
):
    """
    Browse/filter across the unified dataset (spec 0010 AC-3). Explicitly
    ordered by popularity descending before limiting -- with no explicit
    order, a merged "both" list would default to load order and silently
    bury every TV result behind movies.

    personalized=true (Home's "Popular Picks") orders the popular pool by
    closeness to the signed in user's taste instead, leaving out what they
    already rated, and adds each row's match score (predicted_score, null when
    it has no embedding); without a token or a usable taste signal it is the
    plain popularity order with no scores. genre filters by substring.
    """
    taste, ceiling = _taste_for_user(user_id) if personalized and user_id is not None else (None, None)
    with connection() as conn, conn.cursor() as cur:
        rows = browse_titles(
            cur, language=language, actor=actor, start_year=start_year, end_year=end_year,
            media_type=media_type, limit=limit, taste_vector=taste, user_id=user_id,
            genre=genre,
        )
    for row in rows:
        if "taste_similarity" in row:
            row["predicted_score"] = calibrated_score(row.pop("taste_similarity"), ceiling)
        row["release_date"] = row["release_date"].isoformat() if row["release_date"] else None
    return rows

@app.get("/me/ratings")
def get_my_ratings(user_id: str = Depends(get_current_user_id)):
    """
    Fetch the logged-in user's full rating history, most recently rated
    first — movie id, title, release date, poster, rating, and when it
    was rated. Used by the Ratings tab list (design.md §6.8). Identity
    comes from the bearer token, not a path param — no way to read
    someone else's ratings by guessing an id.
    """
    ratings = get_user_ratings_detailed(user_id)
    if not ratings:
        return []
    return [
        {
            "movie_id": movie_id,
            "media_type": media_type,
            "title": title,
            "release_date": release_date.isoformat() if release_date else None,
            "poster_path": poster_path,
            "rating": rating,
            "rated_at": rated_at.isoformat(),
        }
        for movie_id, media_type, title, release_date, poster_path, rating, rated_at in ratings
    ]

@app.post("/auth/signup")
def signup(req: SignupRequest):
    """
    Create a real account via Supabase Auth, plus our own profile row.
    Whether a session comes back immediately or a confirmation code has to
    be verified first depends on the Supabase project's "Confirm email"
    setting (spec 0004) -- detected here by whether Supabase's response
    already carries an access_token, not by a separate flag.
    """
    result = sign_up(req.email, req.password)
    if not result.get("access_token"):
        return {"status": "confirmation_required", "email": req.email}
    user = result.get("user") or {}
    user_id = user.get("id")
    if user_id:
        create_user_profile(user_id, country=req.country)
    return {
        "status": "ok",
        "access_token": result.get("access_token"),
        "refresh_token": result.get("refresh_token"),
        "user_id": user_id,
    }

@app.post("/auth/verify-signup")
def verify_signup(req: VerifySignupRequest):
    """Confirm a signup with the code Supabase emailed, completing account
    creation the same way a no-confirmation signup already does (spec 0004).
    This is the only place the profile row (and its country, spec 0005) gets
    created for an account that required email confirmation -- the earlier
    /auth/signup call returned before any user_id existed to create it with."""
    result = verify_signup_code(req.email, req.token)
    user = result.get("user") or {}
    user_id = user.get("id")
    if user_id:
        create_user_profile(user_id, country=req.country)
    return {
        "access_token": result.get("access_token"),
        "refresh_token": result.get("refresh_token"),
        "user_id": user.get("id"),
    }

@app.post("/auth/resend-confirmation")
def resend_confirmation(req: ResendConfirmationRequest):
    """Ask Supabase for a fresh signup confirmation code; always looks the
    same regardless of whether the email is registered (spec 0004)."""
    resend_confirmation_code(req.email)
    return {"status": "ok"}

@app.post("/auth/login")
def login(req: LoginRequest):
    """Log in via Supabase Auth, returning a bearer token for subsequent requests."""
    result = sign_in(req.email, req.password)
    user = result.get("user") or {}
    return {
        "access_token": result.get("access_token"),
        "refresh_token": result.get("refresh_token"),
        "user_id": user.get("id"),
    }

@app.get("/me", response_model=MeResponse)
def get_me(
    user_id: str = Depends(get_current_user_id),
    email: str | None = Depends(get_current_user_email),
):
    """
    Used by the launch/login routing check (spec 0004) to decide between
    onboarding and the main tabs, and by the Profile screen (design.md
    §6.9) to show the signed-in account's email. get_user_profile
    guarantees the profile row exists even if signup's
    create_user_profile call never landed, and touches last_active_at
    as a side effect (spec 0006 AC-9).
    """
    onboarding_completed, notification_prefs, deactivated_at = get_user_profile(user_id)
    return MeResponse(
        user_id=user_id,
        email=email,
        onboarding_completed=onboarding_completed,
        notification_prefs=notification_prefs,
        deactivated_at=deactivated_at.isoformat() if deactivated_at else None,
    )

@app.post("/me/deactivate")
def deactivate_my_account(
    req: DeactivateRequest,
    user_id: str = Depends(get_current_user_id),
    email: str | None = Depends(get_current_user_email),
    authorization: str | None = Header(default=None),
):
    """
    Deactivate the caller's account, starting the 30 day recoverable
    grace period (spec 0009 AC-1, AC-2). Requires reentering the current
    password (verified via sign_in, the same check /auth/login uses) and
    typing the literal word DELETE -- both checked before anything
    changes. Signs the account out everywhere afterward, not just this
    device. Deliberately stays on the plain get_current_user_id, not
    get_current_active_user_id -- an already-deactivated account calling
    this again is harmless (deactivate_account just re-sets the same
    timestamp), and gating it would serve no purpose.
    """
    if req.confirm != "DELETE":
        raise HTTPException(status_code=400, detail="Type DELETE to confirm.")
    if not email:
        raise HTTPException(status_code=401, detail="Could not verify account email.")
    sign_in(email, req.password)  # raises 401 on a wrong password
    deactivate_account(user_id)
    access_token = (authorization or "").removeprefix("Bearer ").strip()
    if access_token:
        sign_out_everywhere(access_token)
    return {"status": "deactivated"}

@app.post("/me/reactivate")
def reactivate_my_account(user_id: str = Depends(get_current_user_id)):
    """
    Clear the caller's deactivated_at, canceling a pending deletion
    (spec 0009 AC-5). 409 if the account isn't currently deactivated --
    reactivating an already-active account isn't a valid transition.
    Stays on the plain get_current_user_id (not get_current_active_user_id)
    since the whole point is to let a deactivated account act, once.
    """
    if not reactivate_account(user_id):
        raise HTTPException(status_code=409, detail="Account is not deactivated.")
    return {"status": "active"}

@app.post("/me/onboarding/complete")
def complete_onboarding(user_id: str = Depends(get_current_active_user_id)):
    """Mark the logged-in user's onboarding as complete. Safe to call more than once."""
    set_onboarding_completed(user_id)
    return {"status": "ok"}

@app.patch("/me/notification-prefs")
def update_my_notification_prefs(req: NotificationPrefsUpdate, user_id: str = Depends(get_current_active_user_id)):
    """
    Partial update of the caller's per-type notification mute settings
    (spec 0006 AC-7). A body with neither key is a no-op that returns
    the current prefs unchanged; an unknown key is already rejected with
    422 by NotificationPrefsUpdate's extra="forbid" before this runs.
    """
    updates = req.model_dump(exclude_none=True)
    if not updates:
        return get_notification_prefs(user_id)
    return update_notification_prefs(user_id, updates)

@app.post("/auth/refresh")
def refresh(req: RefreshRequest):
    """
    Quietly renew a session using the saved refresh credential (spec
    0004) -- no bearer token required here, the refresh token itself is
    the credential, same trust level /auth/login already operates at.
    """
    result = refresh_access_token(req.refresh_token)
    user = result.get("user") or {}
    return {
        "access_token": result.get("access_token"),
        "refresh_token": result.get("refresh_token"),
        "user_id": user.get("id"),
    }

@app.post("/auth/request-password-reset")
def request_password_reset(req: RequestPasswordResetRequest):
    """
    Send a password recovery code by email (spec 0007, AC-2/AC-3).
    Deliberately reveals whether the email is registered -- a conscious
    deviation from resend_confirmation's enumeration-safe pattern (spec
    0007's AC-14 per-IP rate limit on this route was removed at the
    user's request; see the spec for the tradeoff this reopens).
    """
    if not check_email_registered(req.email):
        raise HTTPException(
            status_code=404,
            detail={
                "message": "No account found with that email.",
                "error_code": "email_not_found",
            },
        )
    send_password_reset(req.email)
    return {"status": "ok"}

@app.post("/auth/reset-password")
def reset_password(req: ResetPasswordRequest):
    """
    Verify the emailed recovery code, set the new password, and sign the
    user back in (spec 0007, AC-6/AC-7/AC-12/AC-13) -- same
    access_token/refresh_token/user_id shape /auth/login already returns,
    so the client can complete auth the same way.
    """
    verify_result = verify_recovery_code(req.email, req.token)
    access_token = verify_result.get("access_token")
    user = verify_result.get("user") or {}
    finish_password_reset(access_token, req.new_password)
    return {
        "access_token": access_token,
        "refresh_token": verify_result.get("refresh_token"),
        "user_id": user.get("id"),
    }

@app.post("/ratings")
def rate_movie(req: RatingRequest, user_id: str = Depends(get_current_active_user_id)):
    """
    Insert or update the logged-in user's 1-5 rating for a movie, then
    touch last_active_at and run the recommendations_ready threshold
    check (spec 0006 AC-1, AC-9). The threshold check runs only after
    the rating write has already committed, and any error in it is
    logged, not raised -- a rating is never lost because a notification
    failed to write (spec 0006's failure-isolation invariant).
    """
    if not (1 <= req.rating <= 5):
        raise HTTPException(status_code=400, detail="rating must be between 1 and 5")
    counted = add_rating(user_id, req.movie_id, req.media_type, req.rating)
    touch_last_active(user_id)
    if counted:
        try:
            check_recommendations_threshold(user_id)
        except Exception as e:
            print(f"recommendations_ready threshold check failed for user {user_id}: {e}")
    return {"status": "saved", "user_id": user_id, "movie_id": req.movie_id, "media_type": req.media_type, "rating": req.rating}

@app.delete("/ratings/{movie_id}")
def delete_my_rating(movie_id: int, media_type: Literal["movie", "tv"], user_id: str = Depends(get_current_active_user_id)):
    """
    Remove the logged-in user's rating for a movie or TV show. media_type
    is a required query param, not defaulted (spec 0010) -- a movie and a
    TV show can share the same movie_id, so omitting it would risk
    deleting the wrong row's rating; FastAPI 422s automatically when it's
    missing, matching the id disambiguation rule everywhere else in this
    API. 404 whether the rating never existed or belongs to someone else
    -- ownership is never leaked through the response (spec 0008 AC-4),
    same pattern as mark_my_notification_read. A successful delete still
    touches last_active_at (spec 0008 AC-9) so pruning ratings alone
    doesn't make an active user look inactive to the re-engagement scan.
    """
    deleted = delete_rating(user_id, movie_id, media_type)
    if not deleted:
        raise HTTPException(status_code=404, detail="rating not found")
    touch_last_active(user_id)
    return {"status": "deleted", "movie_id": movie_id}

@app.get("/me/notifications")
def get_my_notifications(user_id: str = Depends(get_current_user_id)):
    """The caller's most recent 50 notifications, newest first (spec 0006 AC-3)."""
    rows = get_notifications(user_id)
    return [
        {
            "id": id_,
            "type": type_,
            "title": title,
            "body": body,
            "read_at": read_at.isoformat() if read_at else None,
            "created_at": created_at.isoformat(),
        }
        for id_, type_, title, body, read_at, created_at in rows
    ]

@app.get("/me/notifications/unread-count")
def get_my_unread_notification_count(user_id: str = Depends(get_current_user_id)):
    """Count of the caller's unread notifications (spec 0006 AC-4)."""
    return {"count": get_unread_notification_count(user_id)}

@app.post("/me/notifications/{id}/read")
def mark_my_notification_read(id: int, user_id: str = Depends(get_current_active_user_id)):
    """
    Mark one of the caller's own notifications read; idempotent if
    already read, 404 if the id doesn't exist or belongs to someone
    else (spec 0006 AC-5).
    """
    found = mark_notification_read(user_id, id)
    if not found:
        raise HTTPException(status_code=404, detail="notification not found")
    return {"status": "ok"}

@app.post("/me/notifications/read-all")
def mark_all_my_notifications_read(user_id: str = Depends(get_current_active_user_id)):
    """Mark every currently-unread notification of the caller's read in one call (spec 0006 AC-6)."""
    marked = mark_all_notifications_read(user_id)
    return {"status": "ok", "marked": marked}

# ---------- ACCOUNT DELETION WEB FORM (spec 0009 AC-6, AC-9) ----------

def _delete_account_page(error: str | None = None, success: bool = False) -> str:
    if success:
        body = (
            "<h1>Account deletion requested</h1>"
            "<p>Your account has been deactivated and signed out everywhere. "
            "It will be permanently deleted in 30 days.</p>"
            "<p>Changed your mind? Just log back into the app before then and "
            "we'll offer to restore it.</p>"
        )
    else:
        error_html = f'<p class="error">{error}</p>' if error else ""
        body = (
            "<h1>Delete your account</h1>"
            "<p>This deactivates your NextWatch account immediately. It's "
            "permanently deleted, along with your ratings and notifications, "
            "30 days later. Log back into the app before then to cancel and "
            "restore it.</p>"
            f"{error_html}"
            '<form method="post" action="/legal/delete-account">'
            '<label>Email<br><input type="email" name="email" required></label><br><br>'
            '<label>Password<br><input type="password" name="password" required></label><br><br>'
            '<button type="submit">Delete my account</button>'
            "</form>"
        )
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>NextWatch — Delete Account</title>
<style>
  body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; max-width: 480px; margin: 0 auto; padding: 32px 20px 64px; line-height: 1.6; color: #1a1612; background: #fdfaf6; }}
  h1 {{ font-size: 1.5rem; }}
  input {{ width: 100%; padding: 10px; border-radius: 6px; border: 1px solid #ccc; font-size: 1rem; box-sizing: border-box; }}
  button {{ padding: 10px 20px; border-radius: 6px; border: none; background: #8a5a3d; color: white; font-size: 1rem; cursor: pointer; }}
  .error {{ color: #b3261e; }}
</style>
</head>
<body>
{body}
</body>
</html>"""

@app.get("/legal/delete-account", response_class=HTMLResponse)
def delete_account_form():
    """The public, no-login web form (spec 0009 AC-6) -- reaches a user
    who no longer has the app installed."""
    return _delete_account_page()

@app.post("/legal/delete-account", response_class=HTMLResponse)
@limiter.limit("5/hour")
def delete_account_submit(request: Request, email: str = Form(...), password: str = Form(...)):
    """
    The web deletion path (spec 0009 AC-6): resolves and verifies the
    account the same way /auth/login does (sign_in), then runs the exact
    same deactivation logic POST /me/deactivate uses -- one deactivation
    path, two entry points. Rate limited per IP (AC-9), the same shape as
    a login endpoint since it also checks a password. Errors render as a
    form error, not a raw HTTP error page, per the spec's Key errors.
    """
    try:
        result = sign_in(email, password)
    except HTTPException as error:
        message = (
            "Incorrect email or password."
            if error.status_code == 401
            else "Something went wrong. Try again."
        )
        return HTMLResponse(content=_delete_account_page(error=message), status_code=error.status_code)
    user = result.get("user") or {}
    user_id = user.get("id")
    if not user_id:
        return HTMLResponse(
            content=_delete_account_page(error="Something went wrong. Try again."), status_code=400
        )
    deactivate_account(user_id)
    access_token = result.get("access_token")
    if access_token:
        sign_out_everywhere(access_token)
    return HTMLResponse(content=_delete_account_page(success=True))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000)