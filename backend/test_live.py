"""
test_live.py
Tests for the live paths of spec 0013: resolving a title that is not in the
catalog (AC-6), the size ceiling (AC-11), on demand embedding (AC-7), the lazy
details fill and the watch provider cache (AC-5).

They run on TEMPORARY tables that shadow movies, movie_details and
watch_provider_cache inside one transaction that is rolled back, so they need
a reachable DATABASE_URL (with pgvector) but never touch real data. TMDB and
the embedding model are fakes, so nothing is downloaded or called. Skipped
without a DATABASE_URL.

Run: .venv\\Scripts\\python.exe -m unittest test_live -v
"""

import contextlib
import datetime
import os
import time
import unittest
from unittest.mock import patch

import numpy as np
import requests
from dotenv import load_dotenv

load_dotenv()
os.environ.setdefault("TMDB_TOKEN", "test-unused")  # recommend.py insists on one at import

import recommend as r  # noqa: E402
from db import details as details_db  # noqa: E402
from db import embedder, engine  # noqa: E402
from db.catalog import EMBEDDING_DIM, EMBEDDING_MODEL  # noqa: E402


class FakeModel:
    """Encodes any text to the same unit vector, and counts the calls."""
    def __init__(self):
        self.calls = 0

    def encode(self, texts):
        self.calls += 1
        vector = np.zeros(EMBEDDING_DIM, dtype=np.float32)
        vector[0] = 1.0
        return np.array([vector for _ in texts])


def tmdb_details(movie_id, title="Brand New", media_type="movie"):
    """What fetch_movie_details returns: the TMDB payload after enrichment."""
    base = {
        "id": movie_id, "overview": "A new overview", "genres": [{"name": "Drama"}],
        "keywords": ["new"], "cast": ["Ann"], "director": ["Dee"], "tagline": "Fresh",
        "original_language": "en", "vote_average": 7.5, "vote_count": 120, "popularity": 4.2,
        "poster_path": "/p.jpg", "backdrop_path": "/b.jpg", "runtime": 99, "status": "Released",
        "trailer_keys": ["abc"], "cast_photos": [{"name": "Ann", "profile_path": "/a.jpg"}],
        "watch_providers": {},
    }
    if media_type == "tv":
        return {**base, "name": title, "first_air_date": "2024-03-01", "origin_country": ["US"], "number_of_seasons": 2}
    return {**base, "title": title, "release_date": "2024-03-01", "production_countries": [{"iso_3166_1": "US"}]}


@unittest.skipUnless(os.getenv("DATABASE_URL"), "needs DATABASE_URL with pgvector")
class LiveTestCase(unittest.TestCase):
    def setUp(self):
        from db.pool import _connect
        self.conn = _connect()
        self.cur = self.conn.cursor()
        for table in ("movies", "movie_details", "watch_provider_cache"):
            self.cur.execute(f"CREATE TEMP TABLE {table} (LIKE public.{table} INCLUDING ALL)")

        @contextlib.contextmanager
        def shared_connection():
            yield self.conn
        for p in (
            patch.object(r, "connection", shared_connection),
            patch.object(r, "catalog_is_full", return_value=False),
        ):
            p.start()
            self.addCleanup(p.stop)

        embedder.reset_for_tests()
        self.addCleanup(embedder.reset_for_tests)
        self.addCleanup(setattr, embedder, "_factory", embedder._factory)
        self.model = FakeModel()

    def tearDown(self):
        self.conn.rollback()
        self.conn.close()

    def model_ready(self):
        embedder.reset_for_tests()
        embedder._factory = lambda: self.model
        embedder.start_background_load()
        deadline = time.time() + 5
        while not embedder.is_ready() and time.time() < deadline:
            time.sleep(0.01)
        self.assertTrue(embedder.is_ready())

    def model_loading_forever(self):
        """The model is never ready: the factory fails, so every need gets ModelNotReady."""
        embedder.reset_for_tests()
        def failing():
            raise RuntimeError("not available in this test")
        embedder._factory = failing

    def row(self, movie_id, media_type="movie"):
        self.cur.execute(
            "SELECT title, embedding IS NOT NULL, embedding_model, popularity FROM movies WHERE id = %s AND media_type = %s",
            (movie_id, media_type),
        )
        return self.cur.fetchone()

    def count(self, table="movies"):
        self.cur.execute(f"SELECT count(*) FROM {table}")
        return self.cur.fetchone()[0]

    def insert_local(self, movie_id, title, media_type="movie", embedded=True, details=True):
        self.cur.execute(
            "INSERT INTO movies (id, media_type, title, combined_text, embedding, popularity, vote_count) "
            "VALUES (%s, %s, %s, 'stored text', "
            + ("(SELECT ('[1' || repeat(',0', 383) || ']')::extensions.vector)" if embedded else "NULL")
            + ", 5, 10)",
            (movie_id, media_type, title),
        )
        if details:
            self.cur.execute("INSERT INTO movie_details (id, media_type, tagline) VALUES (%s, %s, 'kept')", (movie_id, media_type))


class StoreNewTitleTests(LiveTestCase):
    def test_writes_the_row_and_its_details_with_the_embedding_when_the_model_is_ready(self):
        self.model_ready()
        vector = r.store_new_title(tmdb_details(900), "movie")

        self.assertIsNotNone(vector)
        self.assertEqual(self.row(900), ("Brand New", True, EMBEDDING_MODEL, 4.2))
        self.cur.execute("SELECT tagline, runtime, backdrop_path, trailer_keys, cast_photos FROM movie_details WHERE id = 900")
        tagline, runtime, backdrop, trailers, cast = self.cur.fetchone()
        self.assertEqual((tagline, runtime, backdrop, trailers), ("Fresh", 99, "/b.jpg", "abc"))
        self.assertEqual(cast, [{"name": "Ann", "profile_path": "/a.jpg"}])

    def test_writes_a_null_embedding_and_never_raises_while_the_model_is_not_ready(self):
        self.model_loading_forever()
        self.assertIsNone(r.store_new_title(tmdb_details(901), "movie"))
        self.assertEqual(self.row(901), ("Brand New", False, None, 4.2))
        self.assertEqual(self.count("movie_details"), 1)

    def test_a_tv_title_is_stored_with_its_tv_fields(self):
        self.model_ready()
        r.store_new_title(tmdb_details(902, "Show", "tv"), "tv")
        self.cur.execute("SELECT media_type, release_date, number_of_seasons FROM movies WHERE id = 902")
        self.assertEqual(self.cur.fetchone(), ("tv", datetime.date(2024, 3, 1), 2))

    def test_the_same_title_stored_twice_leaves_one_row_and_no_error(self):
        self.model_ready()
        r.store_new_title(tmdb_details(903), "movie")
        r.store_new_title(tmdb_details(903), "movie")
        self.assertEqual(self.count(), 1)
        self.assertEqual(self.count("movie_details"), 1)

    def test_an_existing_row_without_an_embedding_gets_one(self):
        self.model_loading_forever()
        r.store_new_title(tmdb_details(904), "movie")
        self.assertFalse(self.row(904)[1])
        self.model_ready()
        r.store_new_title(tmdb_details(904), "movie")
        self.assertEqual(self.row(904)[1:3], (True, EMBEDDING_MODEL))

    def test_an_existing_embedding_is_never_overwritten(self):
        self.insert_local(905, "Old", embedded=True)
        self.cur.execute("UPDATE movies SET embedding_model = 'older-model' WHERE id = 905")
        self.model_ready()
        r.store_new_title(tmdb_details(905, "Old"), "movie")
        self.assertEqual(self.row(905)[2], "older-model")

    def test_refuses_at_the_hard_ceiling_and_writes_nothing(self):
        self.model_ready()
        with patch.object(r, "catalog_is_full", return_value=True):
            with self.assertRaises(r.CatalogFull):
                r.store_new_title(tmdb_details(906), "movie")
        self.assertEqual(self.count(), 0)


class ResolveCatalogTitleTests(LiveTestCase):
    def tmdb_never_called(self):
        return (
            patch.object(r, "search_tmdb_title", side_effect=AssertionError("TMDB searched")),
            patch.object(r, "fetch_movie_details", side_effect=AssertionError("TMDB fetched")),
        )

    def test_a_local_title_resolves_without_tmdb_or_the_model(self):
        self.insert_local(10, "Titanic")
        self.model_loading_forever()
        a, b = self.tmdb_never_called()
        with a, b:
            card = r.resolve_catalog_title("the titanic")
        self.assertEqual((card["movie_id"], card["media_type"], card["title"]), (10, "movie", "Titanic"))

    def test_a_new_title_is_fetched_written_and_returned_ready_to_rate(self):
        self.model_ready()
        with patch.object(r, "search_tmdb_title", return_value=(77, "movie")), \
             patch.object(r, "fetch_movie_details", return_value=tmdb_details(77, "Fresh Film")):
            card = r.resolve_catalog_title("fresh film")
        self.assertEqual((card["movie_id"], card["title"]), (77, "Fresh Film"))
        self.assertEqual(self.row(77)[:2], ("Fresh Film", True))

    def test_resolving_while_the_model_is_not_ready_writes_a_null_embedding_and_succeeds(self):
        self.model_loading_forever()
        with patch.object(r, "search_tmdb_title", return_value=(78, "movie")), \
             patch.object(r, "fetch_movie_details", return_value=tmdb_details(78, "Early Bird")):
            card = r.resolve_catalog_title("early bird")
        self.assertEqual(card["title"], "Early Bird")
        self.assertEqual(self.row(78)[:2], ("Early Bird", False))

    def test_an_id_that_tmdb_returns_but_already_exists_locally_is_not_fetched_again(self):
        self.insert_local(79, "Local Under Another Name")
        with patch.object(r, "search_tmdb_title", return_value=(79, "movie")), \
             patch.object(r, "fetch_movie_details", side_effect=AssertionError("fetched twice")):
            card = r.resolve_catalog_title("a different spelling")
        self.assertEqual(card["movie_id"], 79)

    def test_a_local_row_without_an_embedding_is_filled_in_once_the_model_is_ready(self):
        self.insert_local(80, "Needs Vector", embedded=False)
        self.model_ready()
        r.resolve_catalog_title("needs vector")
        self.assertEqual(self.row(80)[1], True)

    def test_a_title_tmdb_does_not_know_is_none(self):
        with patch.object(r, "search_tmdb_title", return_value=(None, None)):
            self.assertIsNone(r.resolve_catalog_title("zzz nothing"))

    def test_tmdb_unreachable_is_tmdb_unavailable(self):
        with patch.object(r, "search_tmdb_title", side_effect=requests.exceptions.ConnectionError("down")):
            with self.assertRaises(r.TmdbUnavailable):
                r.resolve_catalog_title("anything")
        with patch.object(r, "search_tmdb_title", return_value=(5, "movie")), \
             patch.object(r, "fetch_movie_details", return_value=None):
            with self.assertRaises(r.TmdbUnavailable):
                r.resolve_catalog_title("anything")

    def test_the_catalog_being_full_refuses_a_new_title_but_not_a_local_one(self):
        self.insert_local(81, "Already Here")
        with patch.object(r, "catalog_is_full", return_value=True):
            self.assertEqual(r.resolve_catalog_title("already here")["movie_id"], 81)
            with patch.object(r, "search_tmdb_title", return_value=(82, "movie")), \
                 patch.object(r, "fetch_movie_details", return_value=tmdb_details(82)):
                with self.assertRaises(r.CatalogFull):
                    r.resolve_catalog_title("brand new")
        self.assertIsNone(self.row(82))


class VectorOnDemandTests(LiveTestCase):
    def test_a_stored_vector_needs_no_model(self):
        self.insert_local(20, "Has Vector")
        self.model_loading_forever()
        found, vector = r.get_vector(20, "movie")
        self.assertTrue(found)
        self.assertEqual(len(vector), EMBEDDING_DIM)

    def test_a_missing_embedding_is_computed_from_stored_text_and_saved(self):
        self.insert_local(21, "No Vector Yet", embedded=False)
        self.model_ready()
        found, vector = r.get_vector(21, "movie")
        self.assertTrue(found)
        self.assertEqual(self.model.calls, 1)
        self.assertEqual(self.row(21)[1:3], (True, EMBEDDING_MODEL))

    def test_a_missing_embedding_while_the_model_loads_raises_model_not_ready(self):
        self.insert_local(22, "No Vector Yet", embedded=False)
        self.model_loading_forever()
        with self.assertRaises(embedder.ModelNotReady):
            r.get_vector(22, "movie")

    def test_a_title_not_in_the_catalog_is_not_found(self):
        self.assertEqual(r.get_vector(999, "movie"), (False, None))

    def test_resolve_title_to_vector_for_a_new_title_while_the_model_loads_writes_it_then_503s(self):
        self.model_loading_forever()
        with patch.object(r, "search_tmdb_title", return_value=(30, "movie")), \
             patch.object(r, "fetch_movie_details", return_value=tmdb_details(30, "Needs Model")):
            with self.assertRaises(embedder.ModelNotReady):
                r.resolve_title_to_vector("needs model")
        self.assertEqual(self.row(30)[:2], ("Needs Model", False))  # rateable at once, embedded later

    def test_resolve_id_to_vector_reports_not_found_and_fetch_failed(self):
        with patch.object(r, "fetch_movie_details_by_id", return_value=(None, "not_found")):
            self.assertEqual(r.resolve_id_to_vector(1, "movie"), (None, "not_found"))
        with patch.object(r, "fetch_movie_details_by_id", return_value=(None, "fetch_failed")):
            self.assertEqual(r.resolve_id_to_vector(1, "movie"), (None, "fetch_failed"))

    def test_resolve_id_to_vector_fetches_stores_and_returns_a_vector(self):
        self.model_ready()
        with patch.object(r, "fetch_movie_details_by_id", return_value=(tmdb_details(31, "By Id"), None)):
            vector, error = r.resolve_id_to_vector(31, "movie")
        self.assertIsNone(error)
        self.assertEqual(len(vector), EMBEDDING_DIM)
        self.assertEqual(self.row(31)[:2], ("By Id", True))


class LoadDetailTests(LiveTestCase):
    def test_a_local_title_with_details_is_one_read_and_no_tmdb(self):
        self.insert_local(40, "Complete")
        with patch.object(r, "fetch_movie_details_by_id", side_effect=AssertionError("TMDB called")):
            row, error = r.load_detail(40, "movie")
        self.assertIsNone(error)
        self.assertEqual((row["title"], row["tagline"], row["has_details"]), ("Complete", "kept", True))

    def test_a_title_missing_from_the_catalog_is_fetched_and_stored(self):
        self.model_ready()
        with patch.object(r, "fetch_movie_details_by_id", return_value=(tmdb_details(41, "From TMDB"), None)):
            row, error = r.load_detail(41, "movie")
        self.assertIsNone(error)
        self.assertEqual((row["title"], row["tagline"], row["runtime"]), ("From TMDB", "Fresh", 99))

    def test_a_missing_details_row_is_fetched_once_and_written(self):
        self.insert_local(42, "No Details", details=False)
        with patch.object(r, "fetch_movie_details_by_id", return_value=(tmdb_details(42, "No Details"), None)) as fetch:
            row, _ = r.load_detail(42, "movie")
            row_again, _ = r.load_detail(42, "movie")
        self.assertEqual(fetch.call_count, 1)
        self.assertEqual((row["tagline"], row["runtime"], row["has_details"]), ("Fresh", 99, True))
        self.assertTrue(row_again["has_details"])

    def test_if_the_details_fetch_fails_the_base_row_is_still_served(self):
        self.insert_local(43, "Base Only", details=False)
        with patch.object(r, "fetch_movie_details_by_id", return_value=(None, "fetch_failed")):
            row, error = r.load_detail(43, "movie")
        self.assertIsNone(error)
        self.assertEqual((row["title"], row["has_details"], row["tagline"]), ("Base Only", False, None))

    def test_not_found_and_fetch_failed_are_reported_for_a_title_we_do_not_have(self):
        with patch.object(r, "fetch_movie_details_by_id", return_value=(None, "not_found")):
            self.assertEqual(r.load_detail(999, "movie"), (None, "not_found"))
        with patch.object(r, "fetch_movie_details_by_id", return_value=(None, "fetch_failed")):
            self.assertEqual(r.load_detail(999, "movie"), (None, "fetch_failed"))

    def test_a_movie_and_a_tv_show_with_the_same_id_are_different_titles(self):
        self.insert_local(44, "The Movie", "movie")
        self.insert_local(44, "The Show", "tv")
        self.assertEqual(r.load_detail(44, "tv")[0]["title"], "The Show")


class WatchProviderTests(LiveTestCase):
    REGIONS = {
        "NG": {"flatrate": [{"provider_name": "Netflix NG", "logo_path": "/n.png"}]},
        "US": {"rent": [{"provider_name": "Apple", "logo_path": "/a.png"}]},
        "GB": {"buy": [{"provider_name": "Sky", "logo_path": "/s.png"}]},
    }

    def setUp(self):
        super().setUp()
        self.insert_local(50, "Streamed")

    def cached(self, country):
        self.cur.execute("SELECT payload, fetched_at FROM watch_provider_cache WHERE id = 50 AND country = %s", (country,))
        return self.cur.fetchone()

    def test_a_miss_makes_one_call_resolves_the_fallback_and_stores_under_the_requested_country(self):
        with patch.object(r, "fetch_provider_results", return_value=self.REGIONS) as call:
            result = r.get_watch_providers(50, "movie", "FR")  # FR is not covered: falls back to NG
        self.assertEqual(call.call_count, 1)
        self.assertEqual(result["stream"], [{"name": "Netflix NG", "logo_path": "/n.png"}])
        payload, _ = self.cached("FR")
        self.assertEqual(payload["flatrate"], [{"provider_name": "Netflix NG", "logo_path": "/n.png"}])

    def test_a_covered_country_uses_its_own_region(self):
        with patch.object(r, "fetch_provider_results", return_value=self.REGIONS):
            result = r.get_watch_providers(50, "movie", "GB")
        self.assertEqual(result["buy"], [{"name": "Sky", "logo_path": "/s.png"}])
        self.assertEqual(result["stream"], [])

    def test_a_missing_country_means_ng(self):
        with patch.object(r, "fetch_provider_results", return_value=self.REGIONS):
            r.get_watch_providers(50, "movie", None)
        self.assertIsNotNone(self.cached("NG"))

    def test_a_fresh_cache_row_is_one_read_and_no_tmdb_call(self):
        with patch.object(r, "fetch_provider_results", return_value=self.REGIONS):
            r.get_watch_providers(50, "movie", "GB")
        with patch.object(r, "fetch_provider_results", side_effect=AssertionError("TMDB called")):
            result = r.get_watch_providers(50, "movie", "GB")
        self.assertEqual(result["buy"], [{"name": "Sky", "logo_path": "/s.png"}])

    def test_a_row_older_than_24_hours_is_fetched_again(self):
        with patch.object(r, "fetch_provider_results", return_value=self.REGIONS):
            r.get_watch_providers(50, "movie", "GB")
        self.cur.execute("UPDATE watch_provider_cache SET fetched_at = now() - interval '25 hours' WHERE id = 50")
        changed = {"GB": {"buy": [{"provider_name": "Newer", "logo_path": None}]}}
        with patch.object(r, "fetch_provider_results", return_value=changed) as call:
            result = r.get_watch_providers(50, "movie", "GB")
        self.assertEqual(call.call_count, 1)
        self.assertEqual(result["buy"][0]["name"], "Newer")

    def test_tmdb_failure_serves_the_stale_row(self):
        with patch.object(r, "fetch_provider_results", return_value=self.REGIONS):
            r.get_watch_providers(50, "movie", "GB")
        self.cur.execute("UPDATE watch_provider_cache SET fetched_at = now() - interval '3 days' WHERE id = 50")
        with patch.object(r, "fetch_provider_results", side_effect=requests.exceptions.Timeout("slow")):
            result = r.get_watch_providers(50, "movie", "GB")
        self.assertEqual(result["buy"], [{"name": "Sky", "logo_path": "/s.png"}])

    def test_tmdb_failure_with_no_cache_gives_empty_providers_not_an_error(self):
        with patch.object(r, "fetch_provider_results", side_effect=requests.exceptions.Timeout("slow")):
            result = r.get_watch_providers(50, "movie", "GB")
        self.assertEqual(result, {"stream": [], "rent": [], "buy": []})
        self.assertIsNone(self.cached("GB"))

    def test_the_call_uses_a_three_second_timeout_and_no_retries(self):
        class Response:
            def raise_for_status(self): pass
            def json(self): return {"results": {}}
        with patch.object(r.requests, "get", return_value=Response()) as get:
            r.fetch_provider_results(50, "tv")
        self.assertEqual(get.call_count, 1)
        self.assertEqual(get.call_args.kwargs["timeout"], 3)
        self.assertTrue(get.call_args.args[0].endswith("/tv/50/watch/providers"))

    def test_freshness_helper(self):
        now = datetime.datetime.now(datetime.timezone.utc)
        self.assertTrue(details_db.is_fresh(now - datetime.timedelta(hours=23), now))
        self.assertFalse(details_db.is_fresh(now - datetime.timedelta(hours=25), now))
        self.assertFalse(details_db.is_fresh(None, now))

    def test_the_stored_payload_shape_maps_to_the_api_shape(self):
        payload = {"flatrate": [{"provider_name": "A", "logo_path": "/a"}], "rent": [], "buy": []}
        self.assertEqual(r.providers_response(payload), {"stream": [{"name": "A", "logo_path": "/a"}], "rent": [], "buy": []})
        self.assertEqual(r.providers_response(None), {"stream": [], "rent": [], "buy": []})


class FindTitleAfterStoreTests(LiveTestCase):
    def test_a_stored_title_is_found_by_the_local_lookup_and_similar_search(self):
        self.model_ready()
        r.store_new_title(tmdb_details(60, "Findable"), "movie")
        self.assertEqual(engine.find_title_local(self.cur, "findable"), (60, "movie"))
        ranked = engine.rank_titles(self.cur, np.eye(EMBEDDING_DIM, dtype=np.float32)[0], top_n=5)
        self.assertIn((60, "movie"), [(x["id"], x["media_type"]) for x in ranked])


if __name__ == "__main__":
    unittest.main()
