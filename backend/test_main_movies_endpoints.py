"""
test_main_movies_endpoints.py
Integration tests for the movies endpoints on Postgres (spec 0013, on top of
specs 0005 and 0010): detail, similar, trending, search, browse, resolve,
recommend, predict, the root route, and the removed /admin/reload.

They run the real app (TestClient) against the real catalog in the database
named by DATABASE_URL, read only: ratings, the user's country, their rating of
a title, and the watch provider cache are stubbed at the boundary, since a
bearer token here is not a real Supabase user and the provider cache would
otherwise write to the real database. The embedding model is a fake one (no
download); what it returns only matters for mood text.

Skipped when there is no DATABASE_URL or the catalog has no "Interstellar".

Run: .venv\\Scripts\\python.exe -m unittest test_main_movies_endpoints -v
"""

import os
import time
import unittest
from unittest.mock import patch

import numpy as np
from dotenv import load_dotenv

load_dotenv()
os.environ.setdefault("TMDB_TOKEN", "test-unused")  # recommend.py insists on one at import
os.environ["EMBEDDING_PRELOAD"] = "false"           # the app never starts a real model load

from starlette.testclient import TestClient  # noqa: E402

import main  # noqa: E402
import recommend  # noqa: E402
from db import embedder  # noqa: E402
from db.catalog import EMBEDDING_DIM  # noqa: E402
from db.pool import connection  # noqa: E402

FAKE_USER_ID = "00000000-0000-0000-0000-000000000000"
KNOWN_LOCAL_TITLE = "Interstellar"
MOVIE_DETAIL_KEYS = {
    "id", "media_type", "title", "tagline", "overview", "genres", "release_date",
    "runtime", "status", "number_of_seasons", "number_of_episodes", "episode_runtime",
    "original_language", "poster_path", "backdrop_path",
    "predicted_score", "cast", "director", "trailer_key",
    "watch_providers", "user_rating",
}
CARD_KEYS = {"id", "media_type", "title", "release_date", "poster_path", "predicted_score"}


class FakeModel:
    """Stands in for the embedding model: the same unit vector for any text."""
    def encode(self, texts):
        vector = np.zeros(EMBEDDING_DIM, dtype=np.float32)
        vector[0] = 1.0
        return np.array([vector for _ in texts])


class FailingFactory:
    def __call__(self):
        raise RuntimeError("model download failed")


def wait_until(condition, seconds=5):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if condition():
            return True
        time.sleep(0.02)
    return False


def load_fake_model():
    embedder.reset_for_tests()
    embedder._factory = FakeModel
    embedder.start_background_load()
    assert wait_until(embedder.is_ready)


@unittest.skipUnless(os.getenv("DATABASE_URL"), "needs DATABASE_URL with the pgvector catalog")
class MovieEndpointsTestCase(unittest.TestCase):
    """Boots the real app once, finds a known title, and overrides auth for the class."""

    @classmethod
    def setUpClass(cls):
        with connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM movies WHERE title = %s AND media_type = 'movie' AND embedding IS NOT NULL "
                "ORDER BY popularity DESC NULLS LAST LIMIT 1",
                (KNOWN_LOCAL_TITLE,),
            )
            row = cur.fetchone()
        if row is None:
            raise unittest.SkipTest(f"the catalog has no {KNOWN_LOCAL_TITLE}")
        cls.known_id = row[0]

        main.app.dependency_overrides[main.get_current_user_id] = lambda: FAKE_USER_ID
        main.app.dependency_overrides[main.get_optional_user_id] = lambda: FAKE_USER_ID
        cls.client = TestClient(main.app)
        cls.client.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.client.__exit__(None, None, None)
        main.app.dependency_overrides.clear()
        embedder.reset_for_tests()
        embedder._factory = embedder.Embedder

    def setUp(self):
        load_fake_model()
        main.limiter.reset()
        self.patches = [
            patch.object(main, "fetch_rated_embeddings", return_value=[]),
            patch.object(main, "get_user_country", return_value=None),
            patch.object(main, "fetch_user_rating", return_value=None),
            patch.object(main, "get_watch_providers", side_effect=lambda i, t, c: recommend.providers_response({})),
            # A title with no details row or no catalog row never reaches the real TMDB from a test.
            patch.object(recommend, "fetch_movie_details_by_id", return_value=(None, "not_found")),
        ]
        for p in self.patches:
            p.start()
            self.addCleanup(p.stop)

    def known_vector(self):
        _, vector = recommend.get_vector(self.known_id, "movie")
        return vector

    def rated(self, rating):
        """Stand in for the user's stored ratings: one rated title with its real vector."""
        return patch.object(main, "fetch_rated_embeddings", return_value=[(rating, self.known_vector())])


class RouteRegistrationOrderTests(MovieEndpointsTestCase):
    """Regression coverage for the route-shadowing bug found during spec 0010."""

    def test_movies_search_is_reachable_without_auth_not_shadowed_by_movies_id(self):
        self.assertEqual(self.client.get("/movies/search", params={"q": "interstellar"}).status_code, 200)

    def test_movies_trending_is_reachable_and_requires_auth(self):
        main.app.dependency_overrides.pop(main.get_current_user_id, None)
        try:
            with TestClient(main.app) as bare_client:
                response = bare_client.get("/movies/trending")
        finally:
            main.app.dependency_overrides[main.get_current_user_id] = lambda: FAKE_USER_ID
        self.assertEqual(response.status_code, 401)

    def test_id_based_similar_route_reached_for_a_numeric_segment_not_the_old_title_route(self):
        main.app.dependency_overrides.pop(main.get_current_user_id, None)
        try:
            with TestClient(main.app) as bare_client:
                response = bare_client.get(f"/movies/movie/{self.known_id}/similar")
        finally:
            main.app.dependency_overrides[main.get_current_user_id] = lambda: FAKE_USER_ID
        # The id-based route requires auth; the old title-based route
        # doesn't and would 404 on a numeric "title" instead of 401.
        self.assertEqual(response.status_code, 401)

    def test_old_title_based_similar_route_still_works_for_a_non_numeric_segment(self):
        response = self.client.get(f"/movies/{KNOWN_LOCAL_TITLE}/similar")
        self.assertEqual(response.status_code, 200)
        self.assertGreater(len(response.json()), 0)

    def test_admin_reload_is_gone(self):
        self.assertEqual(self.client.post("/admin/reload").status_code, 404)


class RootRouteTests(MovieEndpointsTestCase):
    def test_keeps_its_keys_and_reports_a_row_estimate(self):
        body = self.client.get("/").json()
        self.assertEqual(body["status"], "ok")
        self.assertIsInstance(body["movies_loaded"], int)

    def test_a_database_outage_is_reported_not_raised(self):
        with patch.object(main, "connection", side_effect=RuntimeError("db down")):
            response = self.client.get("/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["status"], "error")
        self.assertIsNone(response.json()["movies_loaded"])

    def test_starts_without_the_model_loaded(self):
        embedder.reset_for_tests()
        self.assertEqual(self.client.get("/").status_code, 200)
        self.assertFalse(embedder.is_ready())


class MovieDetailEndpointTests(MovieEndpointsTestCase):
    def test_returns_200_with_the_full_field_set(self):
        response = self.client.get(f"/movies/movie/{self.known_id}")

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body.keys()), MOVIE_DETAIL_KEYS)
        self.assertEqual(body["id"], self.known_id)
        self.assertEqual(body["media_type"], "movie")
        self.assertEqual(body["title"], KNOWN_LOCAL_TITLE)

    def test_genres_is_a_list_not_a_pipe_separated_string(self):
        self.assertIsInstance(self.client.get(f"/movies/movie/{self.known_id}").json()["genres"], list)

    def test_cast_entries_carry_a_name_and_profile_path(self):
        cast = self.client.get(f"/movies/movie/{self.known_id}").json()["cast"]
        self.assertGreater(len(cast), 0)
        self.assertIn("profile_path", cast[0])
        self.assertIn("name", cast[0])

    def test_watch_providers_has_exactly_the_three_category_keys(self):
        providers = self.client.get(f"/movies/movie/{self.known_id}").json()["watch_providers"]
        self.assertEqual(set(providers.keys()), {"stream", "rent", "buy"})

    def test_no_usable_taste_signal_gives_a_null_predicted_score_and_needs_no_model(self):
        embedder.reset_for_tests()
        response = self.client.get(f"/movies/movie/{self.known_id}")
        self.assertEqual(response.status_code, 200)
        self.assertIsNone(response.json()["predicted_score"])

    def test_a_qualifying_rating_history_produces_a_whole_number_score(self):
        with self.rated(5):
            score = self.client.get(f"/movies/movie/{self.known_id}").json()["predicted_score"]
        self.assertIsInstance(score, int)
        # Rating the same movie the detail is for gives a ceiling equal to
        # its own similarity to the resulting taste vector: a perfect match.
        self.assertEqual(score, 100)

    def test_user_rating_comes_from_the_ratings_table(self):
        with patch.object(main, "fetch_user_rating", return_value=4):
            body = self.client.get(f"/movies/movie/{self.known_id}").json()
        self.assertEqual(body["user_rating"], 4)

    def test_the_country_is_passed_to_the_provider_lookup_with_ng_as_default(self):
        seen = []
        def spy(movie_id, media_type, country):
            seen.append(country)
            return recommend.providers_response({})
        with patch.object(main, "get_watch_providers", side_effect=spy):
            self.client.get(f"/movies/movie/{self.known_id}")
            with patch.object(main, "get_user_country", return_value="GB"):
                self.client.get(f"/movies/movie/{self.known_id}")
        self.assertEqual(seen, ["NG", "GB"])

    def test_a_genuinely_bogus_id_returns_404(self):
        self.assertEqual(self.client.get("/movies/movie/999999999").status_code, 404)

    def test_tmdb_down_for_a_title_not_in_the_catalog_returns_502(self):
        with patch.object(recommend, "fetch_movie_details_by_id", return_value=(None, "fetch_failed")):
            self.assertEqual(self.client.get("/movies/movie/999999999").status_code, 502)

    def test_an_invalid_media_type_segment_returns_422(self):
        self.assertEqual(self.client.get(f"/movies/podcast/{self.known_id}").status_code, 422)


class SimilarMoviesEndpointTests(MovieEndpointsTestCase):
    def test_returns_the_shared_card_shape(self):
        response = self.client.get(f"/movies/movie/{self.known_id}/similar", params={"top_n": 3})

        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 3)
        self.assertEqual(set(body[0].keys()), CARD_KEYS)

    def test_excludes_the_source_movie_from_its_own_results(self):
        ids = [c["id"] for c in self.client.get(f"/movies/movie/{self.known_id}/similar", params={"top_n": 10}).json()]
        self.assertNotIn(self.known_id, ids)

    def test_score_is_not_calibrated_to_any_user(self):
        baseline = self.client.get(f"/movies/movie/{self.known_id}/similar", params={"top_n": 1}).json()
        with self.rated(5):
            with_rating = self.client.get(f"/movies/movie/{self.known_id}/similar", params={"top_n": 1}).json()
        self.assertEqual(baseline[0]["predicted_score"], with_rating[0]["predicted_score"])

    def test_needs_no_model_for_a_source_that_has_an_embedding(self):
        embedder.reset_for_tests()
        self.assertEqual(self.client.get(f"/movies/movie/{self.known_id}/similar").status_code, 200)

    def test_bogus_source_id_returns_404(self):
        self.assertEqual(self.client.get("/movies/movie/999999999/similar").status_code, 404)

    def test_media_types_are_movie_or_tv(self):
        body = self.client.get(f"/movies/movie/{self.known_id}/similar", params={"top_n": 10}).json()
        self.assertTrue({c["media_type"] for c in body}.issubset({"movie", "tv"}))


class TrendingEndpointTests(MovieEndpointsTestCase):
    def test_returns_the_shared_card_shape(self):
        body = self.client.get("/movies/trending", params={"top_n": 5}).json()
        self.assertEqual(len(body), 5)
        # Trending alone adds backdrop_path (Home's hero carousel); every other
        # endpoint keeps the exact shared card shape.
        self.assertEqual(set(body[0].keys()), CARD_KEYS | {"backdrop_path"})

    def test_null_score_for_a_user_with_no_usable_taste_signal(self):
        for card in self.client.get("/movies/trending", params={"top_n": 3}).json():
            self.assertIsNone(card["predicted_score"])

    def test_whole_number_score_for_a_user_with_a_qualifying_rating(self):
        with self.rated(5):
            cards = self.client.get("/movies/trending", params={"top_n": 5}).json()
        self.assertTrue(all(c["predicted_score"] is None or isinstance(c["predicted_score"], int) for c in cards))
        self.assertTrue(any(isinstance(c["predicted_score"], int) for c in cards))

    def test_every_title_has_at_least_50_votes(self):
        cards = self.client.get("/movies/trending", params={"top_n": 20}).json()
        with connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM movies WHERE vote_count < 50 AND (id, media_type) IN "
                "(SELECT * FROM unnest(%s::int[], %s::text[]))",
                ([c["id"] for c in cards], [c["media_type"] for c in cards]),
            )
            self.assertEqual(cur.fetchone()[0], 0)

    def test_still_works_while_the_model_is_not_ready(self):
        embedder.reset_for_tests()
        embedder._factory = FailingFactory()
        self.assertEqual(self.client.get("/movies/trending").status_code, 200)


class SearchAndBrowseEndpointTests(MovieEndpointsTestCase):
    def test_search_finds_a_title_by_substring_with_the_card_keys(self):
        body = self.client.get("/movies/search", params={"q": "interstell"}).json()
        self.assertIn(KNOWN_LOCAL_TITLE, [r["title"] for r in body])
        self.assertEqual(set(body[0]), {"id", "media_type", "title", "release_date", "poster_path"})

    def test_search_tolerates_a_one_letter_typo(self):
        titles = [r["title"] for r in self.client.get("/movies/search", params={"q": "interstelar"}).json()]
        self.assertIn(KNOWN_LOCAL_TITLE, titles)

    def test_search_does_not_match_unrelated_words(self):
        titles = [r["title"].lower() for r in self.client.get("/movies/search", params={"q": "healer"}).json()]
        self.assertNotIn("shelter", titles)

    def test_search_has_one_row_per_id_and_media_type(self):
        body = self.client.get("/movies/search", params={"q": "the", "limit": 50}).json()
        keys = [(r["id"], r["media_type"]) for r in body]
        self.assertEqual(len(keys), len(set(keys)))

    def test_search_with_a_percent_sign_is_plain_text(self):
        self.assertEqual(self.client.get("/movies/search", params={"q": "zz%zz"}).json(), [])

    def test_search_needs_two_characters(self):
        self.assertEqual(self.client.get("/movies/search", params={"q": "a"}).json(), [])
        self.assertEqual(self.client.get("/movies/search", params={"q": "  "}).json(), [])

    def test_browse_filters_by_language_and_media_type(self):
        body = self.client.get("/movies", params={"language": "ko", "media_type": "tv", "limit": 5}).json()
        self.assertGreater(len(body), 0)
        self.assertTrue(all(r["original_language"] == "ko" and r["media_type"] == "tv" for r in body))
        self.assertEqual(
            set(body[0]),
            {"id", "media_type", "title", "original_language", "release_date", "genres", "poster_path"},
        )

    def test_browse_both_mixes_movies_and_tv_and_respects_the_limit(self):
        body = self.client.get("/movies", params={"limit": 40}).json()
        self.assertEqual(len(body), 40)
        self.assertEqual({r["media_type"] for r in body}, {"movie", "tv"})


class RecommendTests(MovieEndpointsTestCase):
    def test_no_ratings_and_no_mood_returns_an_empty_list_not_popularity_fallback(self):
        response = self.client.post("/recommend", json={})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), [])

    def test_all_neutral_ratings_also_returns_an_empty_list(self):
        with self.rated(3):
            response = self.client.post("/recommend", json={})
        self.assertEqual(response.json(), [])

    def test_a_qualifying_rating_returns_card_shaped_results_without_the_model(self):
        embedder.reset_for_tests()
        with self.rated(5):
            response = self.client.post("/recommend", json={"top_n": 3})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(len(body), 3)
        self.assertEqual(set(body[0].keys()), CARD_KEYS)
        self.assertTrue(all(isinstance(card["predicted_score"], int) for card in body))

    def test_mood_only_returns_cards_with_null_scores(self):
        body = self.client.post("/recommend", json={"mood_text": "a cosy comedy", "top_n": 3}).json()
        self.assertEqual(len(body), 3)
        self.assertTrue(all(card["predicted_score"] is None for card in body))

    def test_mood_text_while_the_model_loads_is_a_503_with_retry_after(self):
        embedder.reset_for_tests()
        embedder._factory = FailingFactory()
        response = self.client.post("/recommend", json={"mood_text": "a cosy comedy"})
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.headers["Retry-After"], "15")

    def test_filters_that_match_no_title_at_all_return_404(self):
        response = self.client.post("/recommend", json={"mood_text": "anything", "language": "zz"})
        self.assertEqual(response.status_code, 404)

    def test_a_language_filter_only_returns_that_language(self):
        body = self.client.post("/recommend", json={"mood_text": "a thriller", "language": "ko", "top_n": 5}).json()
        self.assertGreater(len(body), 0)
        with connection() as conn, conn.cursor() as cur:
            cur.execute(
                "SELECT count(*) FROM movies WHERE original_language <> 'ko' "
                "AND (id, media_type) IN (SELECT * FROM unnest(%s::int[], %s::text[]))",
                ([c["id"] for c in body], [c["media_type"] for c in body]),
            )
            self.assertEqual(cur.fetchone()[0], 0)

    def test_liked_titles_are_left_out_of_the_results(self):
        body = self.client.post("/recommend", json={"liked_titles": [KNOWN_LOCAL_TITLE], "top_n": 20}).json()
        self.assertNotIn(self.known_id, [card["id"] for card in body])


class PredictAndLegacySimilarTests(MovieEndpointsTestCase):
    def test_predict_scores_a_candidate_against_liked_titles(self):
        response = self.client.post(
            "/predict", json={"liked_titles": [KNOWN_LOCAL_TITLE], "candidate_title": KNOWN_LOCAL_TITLE}
        )
        self.assertEqual(response.status_code, 200)
        self.assertAlmostEqual(response.json()["predicted_score"], 1.0, places=3)

    def test_predict_with_no_resolvable_liked_title_is_a_404(self):
        with patch.object(main, "resolve_title_to_vector", return_value=(None, None, None)):
            response = self.client.post("/predict", json={"liked_titles": ["zzzz"], "candidate_title": "yyyy"})
        self.assertEqual(response.status_code, 404)

    def test_legacy_similar_scores_are_raw_similarity_rounded_to_two_places(self):
        body = self.client.get(f"/movies/{KNOWN_LOCAL_TITLE}/similar", params={"top_n": 3}).json()
        self.assertEqual(len(body), 3)
        self.assertEqual(set(body[0].keys()), CARD_KEYS)
        for card in body:
            self.assertIsInstance(card["predicted_score"], float)
            self.assertEqual(card["predicted_score"], round(card["predicted_score"], 2))

    def test_the_31st_request_in_a_minute_from_one_address_is_429(self):
        with patch.object(main, "resolve_title_to_vector", return_value=(None, None, None)):
            codes = [
                self.client.post("/predict", json={"liked_titles": ["a"], "candidate_title": "b"}).status_code
                for _ in range(31)
            ]
        self.assertEqual(codes[:30], [404] * 30)
        self.assertEqual(codes[30], 429)


class ResolveEndpointTests(MovieEndpointsTestCase):
    def test_a_local_title_resolves_without_tmdb_or_the_model(self):
        embedder.reset_for_tests()
        embedder._factory = FailingFactory()
        with patch.object(recommend, "search_tmdb_title", side_effect=AssertionError("no TMDB call")):
            response = self.client.post("/movies/resolve", json={"title": KNOWN_LOCAL_TITLE})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual(set(body), {"movie_id", "media_type", "title", "release_date", "poster_path"})
        self.assertEqual(body["movie_id"], self.known_id)

    def test_a_title_nowhere_is_404(self):
        with patch.object(recommend, "search_tmdb_title", return_value=(None, None)):
            response = self.client.post("/movies/resolve", json={"title": "zzzzqqqq not a movie"})
        self.assertEqual(response.status_code, 404)

    def test_a_full_catalog_is_503_with_the_message(self):
        with patch.object(main, "resolve_catalog_title", side_effect=recommend.CatalogFull("full")):
            response = self.client.post("/movies/resolve", json={"title": "anything"})
        self.assertEqual(response.status_code, 503)
        self.assertIn("catalog is full", response.json()["detail"])

    def test_tmdb_unreachable_is_502(self):
        with patch.object(main, "resolve_catalog_title", side_effect=recommend.TmdbUnavailable("down")):
            self.assertEqual(self.client.post("/movies/resolve", json={"title": "x"}).status_code, 502)


if __name__ == "__main__":
    unittest.main()
