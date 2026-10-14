"""
test_refresh.py
Tests for the daily catalog refresh (spec 0013, AC-10, AC-11): db/refresh_catalog.py.

They run on TEMPORARY tables that shadow movies and movie_details inside one
transaction that is rolled back, so they need a reachable DATABASE_URL (with
pgvector) but never touch real data. TMDB is a fake session and the embedder
is a fake, so no network call or model download happens. Skipped without a
DATABASE_URL.

Run: .venv\\Scripts\\python.exe -m unittest test_refresh -v
"""

import contextlib
import datetime
import os
import re
import unittest
from unittest.mock import patch

import numpy as np
import requests
from dotenv import load_dotenv

load_dotenv()
os.environ.setdefault("TMDB_TOKEN", "test-unused")  # recommend.py insists on one at import

from db import refresh_catalog as refresh  # noqa: E402
from db.catalog import EMBEDDING_DIM, EMBEDDING_MODEL  # noqa: E402

TODAY = datetime.date(2026, 10, 12)


class FakeEmbedder:
    def __init__(self):
        self.encoded = 0

    def encode(self, texts):
        self.encoded += len(texts)
        vector = np.zeros(EMBEDDING_DIM, dtype=np.float32)
        vector[0] = 1.0
        return np.array([vector for _ in texts])


class FakeResponse:
    def __init__(self, status_code=200, body=None):
        self.status_code = status_code
        self._body = body if body is not None else {}

    def json(self):
        return self._body


def raw_details(movie_id, title, media_type="movie", adult=False):
    """A TMDB /movie/{id} or /tv/{id} response with the appended parts."""
    body = {
        "id": movie_id, "overview": f"About {title}", "genres": [{"name": "Drama"}],
        "original_language": "en", "vote_average": 7.0, "vote_count": 55, "popularity": 3.0,
        "poster_path": "/p.jpg", "backdrop_path": "/b.jpg", "status": "Released", "tagline": "tag",
        "adult": adult, "videos": {"results": []}, "watch/providers": {"results": {}},
    }
    if media_type == "tv":
        body.update({"name": title, "first_air_date": "2026-09-20", "created_by": [],
                     "keywords": {"results": []}, "aggregate_credits": {"cast": []}, "origin_country": ["US"]})
    else:
        body.update({"title": title, "release_date": "2026-09-20", "runtime": 100, "production_countries": [],
                     "keywords": {"keywords": []}, "credits": {"cast": [], "crew": []}})
    return body

class FakeSession:
    """
    Routes TMDB URLs to canned answers. discover: {media_type: [(id, title)]}.
    gone: ids that answer 404. broken: ids that answer 500 (every attempt).
    stats: id -> the vote and popularity numbers /movie/{id} returns without an append.
    """
    def __init__(self, discover=None, gone=(), broken=(), stats=None, adult=()):
        self.discover = discover or {"movie": [], "tv": []}
        self.gone, self.broken, self.adult = set(gone), set(broken), set(adult)
        self.stats = stats or {}
        self.urls = []

    def get(self, url, headers=None, params=None, timeout=None):
        self.urls.append(url)
        path = url.split("/3", 1)[1]
        match = re.match(r"/discover/(movie|tv)$", path)
        if match:
            media_type = match.group(1)
            results = [{"id": i, "adult": False} for i, _ in self.discover[media_type]]
            return FakeResponse(200, {"results": results, "total_pages": 1})
        match = re.match(r"/(movie|tv)/(\d+)$", path)
        if match:
            media_type, movie_id = match.group(1), int(match.group(2))
            if movie_id in self.gone:
                return FakeResponse(404)
            if movie_id in self.broken:
                return FakeResponse(500)
            if "append_to_response" in (params or {}):
                titles = dict(self.discover[media_type])
                return FakeResponse(200, raw_details(movie_id, titles.get(movie_id, f"Title {movie_id}"), media_type,
                                                     adult=movie_id in self.adult))
            return FakeResponse(200, {**{"vote_average": 8.0, "vote_count": 999, "popularity": 50.0,
                                         "poster_path": "/new.jpg", "backdrop_path": "/newb.jpg"},
                                      **self.stats.get(movie_id, {})})
        return FakeResponse(404)


def tmdb_with(session):
    return refresh.Tmdb(session=session, sleep=lambda seconds: None)


@unittest.skipUnless(os.getenv("DATABASE_URL"), "needs DATABASE_URL with pgvector")
class RefreshTestCase(unittest.TestCase):
    def setUp(self):
        from db.pool import _connect
        self.conn = _connect()
        self.cur = self.conn.cursor()
        for table in ("movies", "movie_details"):
            self.cur.execute(f"CREATE TEMP TABLE {table} (LIKE public.{table} INCLUDING ALL)")

        @contextlib.contextmanager
        def shared_connection():
            yield self.conn
        for p in (
            patch.object(refresh, "connection", shared_connection),
            patch.dict(os.environ, {"CATALOG_SIZE_CAP_MB": "1000000"}),
        ):
            p.start()
            self.addCleanup(p.stop)
        self.embedder = FakeEmbedder()

    def tearDown(self):
        self.conn.rollback()
        self.conn.close()

    def seed(self, count, embedded=True, start_id=1, age_step_days=1):
        """count movies, the lowest id the oldest by refreshed_at."""
        for n in range(count):
            self.cur.execute(
                "INSERT INTO movies (id, media_type, title, combined_text, embedding, vote_count, vote_average, "
                "popularity, poster_path, refreshed_at) VALUES (%s, 'movie', %s, 'text', "
                + ("(SELECT ('[1' || repeat(',0', 383) || ']')::extensions.vector)" if embedded else "NULL")
                + ", 1, 1.0, 1.0, '/old.jpg', now() - %s * interval '1 day')",
                (start_id + n, f"Seed {start_id + n}", (count - n) * age_step_days),
            )
            self.cur.execute("INSERT INTO movie_details (id, media_type, backdrop_path) VALUES (%s, 'movie', '/oldb.jpg')",
                             (start_id + n,))

    def run_refresh(self, session):
        tmdb = tmdb_with(session)
        code = refresh.main(tmdb=tmdb, embedder_factory=lambda: self.embedder, today=TODAY)
        return code, tmdb

    def movie(self, movie_id, media_type="movie"):
        self.cur.execute(
            "SELECT title, vote_count, vote_average, popularity, poster_path, embedding IS NOT NULL, "
            "embedding_model, refreshed_at FROM movies WHERE id = %s AND media_type = %s", (movie_id, media_type))
        return self.cur.fetchone()

    def count(self, table="movies"):
        self.cur.execute(f"SELECT count(*) FROM {table}")
        return self.cur.fetchone()[0]


class AddTests(RefreshTestCase):
    def test_adds_new_and_popular_titles_with_an_embedding_and_a_details_row(self):
        session = FakeSession(discover={"movie": [(1000, "Fresh Film")], "tv": [(2000, "Fresh Show")]})
        code, _ = self.run_refresh(session)

        self.assertEqual(code, 0)
        self.assertEqual(self.movie(1000)[0], "Fresh Film")
        self.assertEqual(self.movie(1000)[5:7], (True, EMBEDDING_MODEL))
        self.assertEqual(self.movie(2000, "tv")[0], "Fresh Show")
        self.assertEqual(self.count("movie_details"), 2)

    def test_asks_tmdb_for_adult_excluded_titles_with_at_least_10_votes_from_the_last_30_days(self):
        seen = []
        session = FakeSession()
        original = session.get
        def spy(url, headers=None, params=None, timeout=None):
            if "/discover/" in url:
                seen.append((url.rsplit("/", 1)[1], dict(params)))
            return original(url, headers, params, timeout)
        session.get = spy
        self.run_refresh(session)

        movie_calls = [p for kind, p in seen if kind == "movie"]
        self.assertTrue(all(p["include_adult"] == "false" and p["vote_count.gte"] == 10 for _, p in seen))
        self.assertEqual({p.get("primary_release_date.gte") for p in movie_calls}, {"2026-09-12", None})
        tv_calls = [p for kind, p in seen if kind == "tv"]
        self.assertEqual({p.get("first_air_date.gte") for p in tv_calls}, {"2026-09-12", None})

    def test_a_title_already_in_the_catalog_with_an_embedding_is_not_fetched_again(self):
        self.seed(1, start_id=1000)
        session = FakeSession(discover={"movie": [(1000, "Seed 1000")], "tv": []})
        self.run_refresh(session)
        detail_calls = [u for u in session.urls if u.endswith("/movie/1000")]
        # one stat refresh call for the seeded row, no full detail fetch for the add
        self.assertEqual(len(detail_calls), 1)
        self.assertEqual(self.count(), 1)

    def test_an_adult_title_is_never_added(self):
        session = FakeSession(discover={"movie": [(1001, "Adult One")], "tv": []}, adult=[1001])
        self.run_refresh(session)
        self.assertEqual(self.count(), 0)

    def test_at_the_cap_it_skips_adding_warns_and_still_refreshes_and_sweeps(self):
        self.seed(1, start_id=1)
        self.seed(1, start_id=2, embedded=False)
        session = FakeSession(discover={"movie": [(3000, "Would Be New")], "tv": []})
        with patch.dict(os.environ, {"CATALOG_SIZE_CAP_MB": "1"}):
            with patch("builtins.print") as printed:
                code, _ = self.run_refresh(session)
        output = "\n".join(str(c.args[0]) for c in printed.call_args_list if c.args)
        self.assertEqual(code, 0)
        self.assertIsNone(self.movie(3000))
        self.assertIn("WARNING", output)
        self.assertTrue(self.movie(2)[5])                 # the null embedding was swept
        self.assertEqual(self.movie(1)[1], 999)           # the stat refresh ran
        self.assertFalse([u for u in session.urls if "/discover/" in u])


class StatRefreshTests(RefreshTestCase):
    def test_refreshes_the_oldest_slice_of_about_one_thirtieth_of_the_table(self):
        self.seed(60)  # ceil(60 / 30) = 2 rows
        self.run_refresh(FakeSession())
        refreshed = [i for i in range(1, 61) if self.movie(i)[1] == 999]
        self.assertEqual(refreshed, [1, 2])  # the two with the oldest refreshed_at
        self.assertEqual(self.movie(1)[2:5], (8.0, 50.0, "/new.jpg"))
        self.cur.execute("SELECT backdrop_path FROM movie_details WHERE id = 1")
        self.assertEqual(self.cur.fetchone()[0], "/newb.jpg")

    def test_refreshed_at_moves_forward_and_the_embedding_is_untouched(self):
        self.seed(30)
        before = self.movie(1)[7]
        self.run_refresh(FakeSession())
        after = self.movie(1)
        self.assertGreater(after[7], before)
        self.assertTrue(after[5])

    def test_a_title_tmdb_no_longer_has_advances_refreshed_at_and_is_not_a_failure(self):
        self.seed(30)
        before = self.movie(1)[7]
        code, tmdb = self.run_refresh(FakeSession(gone=[1]))
        self.assertEqual(code, 0)
        self.assertEqual(tmdb.failures, 0)
        self.assertGreater(self.movie(1)[7], before)
        self.assertEqual(self.movie(1)[1], 1)  # stats unchanged: there was nothing to read

    def test_a_null_field_from_tmdb_keeps_the_stored_value(self):
        self.seed(30)
        self.run_refresh(FakeSession(stats={1: {"poster_path": None, "popularity": None}}))
        self.assertEqual(self.movie(1)[3:5], (1.0, "/old.jpg"))

    def test_it_never_deletes_rows(self):
        self.seed(30)
        self.run_refresh(FakeSession(gone=[1, 2, 3]))
        self.assertEqual(self.count(), 30)


class SweepTests(RefreshTestCase):
    def test_embeds_rows_with_a_null_embedding_from_their_stored_text(self):
        self.seed(3, embedded=False)
        self.run_refresh(FakeSession())
        self.assertTrue(all(self.movie(i)[5:7] == (True, EMBEDDING_MODEL) for i in (1, 2, 3)))
        self.assertEqual(self.embedder.encoded, 3)

    def test_with_nothing_to_embed_the_model_is_never_loaded(self):
        self.seed(3, embedded=True)
        created = []
        refresh.main(tmdb=tmdb_with(FakeSession()), embedder_factory=lambda: created.append(1) or self.embedder, today=TODAY)
        self.assertEqual(created, [])


class ExitCodeTests(RefreshTestCase):
    def test_a_clean_run_exits_zero_and_prints_the_one_line_summary(self):
        self.seed(30)
        with patch("builtins.print") as printed:
            code, _ = self.run_refresh(FakeSession())
        output = "\n".join(str(c.args[0]) for c in printed.call_args_list if c.args)
        self.assertEqual(code, 0)
        self.assertRegex(output, r"refresh done: added=0 refreshed=1 embedded=0 skipped=0 size=[\d.]+MB .* newest_refreshed_at=\d{4}-")

    def test_one_transient_tmdb_failure_among_many_calls_still_exits_zero(self):
        self.seed(300)  # a slice of 10 stat calls plus the discover calls
        code, tmdb = self.run_refresh(FakeSession(broken=[1]))
        self.assertEqual(tmdb.failures, 1)
        self.assertEqual(code, 0)

    def test_more_than_20_percent_failing_exits_non_zero(self):
        self.seed(60)  # a slice of 2: 4 discover calls + 2 stat calls, both stat calls break
        code, tmdb = self.run_refresh(FakeSession(broken=[1, 2]))
        self.assertGreater(tmdb.failure_rate(), 0.2)
        self.assertEqual(code, 1)

    def test_a_database_error_exits_non_zero(self):
        self.seed(30)
        with patch.object(refresh, "apply_stats", side_effect=RuntimeError("deadlock")):
            code, _ = self.run_refresh(FakeSession())
        self.assertEqual(code, 1)

    def test_a_broken_title_is_skipped_not_fatal_and_other_batches_continue(self):
        self.seed(60)
        code, _ = self.run_refresh(FakeSession(broken=[1]))
        self.assertEqual(self.movie(2)[1], 999)  # the other row in the slice was still refreshed


class TmdbClientTests(unittest.TestCase):
    def test_a_404_is_not_a_failure(self):
        tmdb = tmdb_with(FakeSession(gone=[5]))
        self.assertEqual(tmdb.get("/movie/5")[0], "not_found")
        self.assertEqual((tmdb.calls, tmdb.failures), (1, 0))

    def test_a_server_error_is_retried_once_then_counted_as_one_failure(self):
        session = FakeSession(broken=[5])
        tmdb = tmdb_with(session)
        self.assertEqual(tmdb.get("/movie/5")[0], "failed")
        self.assertEqual(len(session.urls), 2)
        self.assertEqual((tmdb.calls, tmdb.failures), (1, 1))

    def test_a_network_error_is_retried_and_can_recover(self):
        class Flaky:
            def __init__(self): self.n = 0
            def get(self, *args, **kwargs):
                self.n += 1
                if self.n == 1:
                    raise requests.exceptions.ConnectionError("blip")
                return FakeResponse(200, {"ok": True})
        tmdb = tmdb_with(Flaky())
        self.assertEqual(tmdb.get("/movie/1"), ("ok", {"ok": True}))
        self.assertEqual(tmdb.failures, 0)

    def test_no_calls_is_a_zero_failure_rate(self):
        self.assertEqual(refresh.Tmdb(session=FakeSession()).failure_rate(), 0.0)


if __name__ == "__main__":
    unittest.main()
