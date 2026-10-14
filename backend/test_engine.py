"""
test_engine.py
Tests for the Postgres recommendation engine (spec 0013, AC-3, AC-4, AC-12 title
lookup): the taste math on rows, and the SQL in db/engine.py.

The SQL tests run on TEMPORARY tables that shadow movies and ratings inside one
transaction that is rolled back, so they need a reachable DATABASE_URL (with
pgvector) but never touch real data. They are skipped without one.

Run: .venv\\Scripts\\python.exe -m unittest test_engine -v
"""

import datetime
import os
import unittest

import numpy as np
from dotenv import load_dotenv

load_dotenv()
os.environ.setdefault("TMDB_TOKEN", "test-unused")  # recommend.py insists on one at import

import recommend as r  # noqa: E402
from db import engine  # noqa: E402
from db.catalog import EMBEDDING_DIM, vector_literal  # noqa: E402


def basis(i, j=None, weight=0.0):
    """A unit vector along axis i, optionally tilted toward axis j."""
    v = np.zeros(EMBEDDING_DIM, dtype=np.float32)
    v[i] = 1.0
    if j is not None:
        v[j] = weight
    return v / np.linalg.norm(v)


class TasteVectorTests(unittest.TestCase):
    def test_no_rows_is_no_taste(self):
        self.assertIsNone(r.taste_vector_from_rows([]))

    def test_all_neutral_ratings_are_no_taste(self):
        self.assertIsNone(r.taste_vector_from_rows([(3, basis(0)), (3, basis(1))]))

    def test_a_love_pulls_toward_the_title(self):
        taste = r.taste_vector_from_rows([(5, basis(0))])
        self.assertGreater(r.cosine(taste, basis(0)), 0.99)

    def test_a_dislike_pushes_away(self):
        taste = r.taste_vector_from_rows([(1, basis(0))])
        self.assertLess(r.cosine(taste, basis(0)), -0.99)

    def test_normalised_by_conviction_not_count(self):
        taste = r.taste_vector_from_rows([(5, basis(0)), (4, basis(1))])
        np.testing.assert_allclose(taste[:2], [2 / 3, 1 / 3], rtol=1e-6)

    def test_a_zero_length_result_is_no_taste(self):
        self.assertIsNone(r.taste_vector_from_rows([(5, basis(0)), (1, basis(0))]))


class PersonalCeilingTests(unittest.TestCase):
    def test_none_without_a_four_or_five_star_title(self):
        self.assertIsNone(r.personal_ceiling_from_rows([(2, basis(0))], basis(0)))

    def test_averages_only_four_and_five_star_titles(self):
        rows = [(5, basis(0)), (4, basis(1)), (2, basis(2))]
        ceiling = r.personal_ceiling_from_rows(rows, basis(0))
        self.assertAlmostEqual(ceiling, 0.5, places=5)


class CardsFromRankedTests(unittest.TestCase):
    ranked = [{
        "id": 7, "media_type": "tv", "title": "T", "release_date": datetime.date(2020, 1, 2),
        "poster_path": "/p.jpg", "similarity": 0.8, "taste_similarity": 0.4,
    }]

    def test_card_shape_and_iso_date(self):
        card = r.cards_from_ranked(self.ranked, 0.8)[0]
        self.assertEqual(set(card), {"id", "media_type", "title", "release_date", "poster_path", "predicted_score"})
        self.assertEqual(card["release_date"], "2020-01-02")
        self.assertEqual(card["predicted_score"], 50)

    def test_similarity_with_ceiling_one_is_a_plain_percentage(self):
        self.assertEqual(r.cards_from_ranked(self.ranked, 1.0, score_key="similarity")[0]["predicted_score"], 80)

    def test_no_taste_gives_a_null_score_not_zero(self):
        ranked = [{**self.ranked[0], "taste_similarity": None}]
        self.assertIsNone(r.cards_from_ranked(ranked, 0.8)[0]["predicted_score"])


@unittest.skipUnless(os.getenv("DATABASE_URL"), "needs DATABASE_URL with pgvector")
class EngineSqlTests(unittest.TestCase):
    USER = "00000000-0000-0000-0000-00000000bbbb"

    def setUp(self):
        from db.pool import _connect
        self.conn = _connect()
        self.cur = self.conn.cursor()
        self.cur.execute("CREATE TEMP TABLE movies (LIKE public.movies INCLUDING DEFAULTS)")
        self.cur.execute("CREATE TEMP TABLE ratings (user_id uuid, movie_id int, media_type text, rating int)")
        rows = [
            # id, type, title, lang, date, cast, vector, popularity, votes
            (1, "movie", "Alpha", "en", "2012-05-01", "Ann Lee|Bo Chan", basis(0), 5.0, 100),
            (2, "movie", "Beta", "ko", "2015-05-01", "Cy 100%", basis(0, 1, 0.5), 9.0, 80),
            (3, "tv", "Gamma", "en", "2021-05-01", "Di_a Ray", basis(0, 1, 1.0), 1.0, 60),
            (4, "movie", "Delta", "en", "2019-05-01", "Ed Fox", None, 3.0, 50),
            (5, "movie", "Dune", "en", "2021-10-01", "Tim", basis(2), 8.0, 900),
            (5, "tv", "Dune", "en", "1984-01-01", "Tom", basis(3), 2.0, 90),
            (6, "movie", "Titanic", "en", "1997-12-01", "Kate", basis(4), 7.0, 500),
        ]
        for movie_id, kind, title, lang, date, cast, vec, pop, votes in rows:
            self.cur.execute(
                "INSERT INTO movies (id, media_type, title, original_language, release_date, cast_members, "
                "embedding, popularity, vote_count) VALUES (%s,%s,%s,%s,%s,%s,%s::extensions.vector,%s,%s)",
                (movie_id, kind, title, lang, date, cast, None if vec is None else vector_literal(vec), pop, votes),
            )

    def tearDown(self):
        self.conn.rollback()
        self.conn.close()

    def ids(self, ranked):
        return [(x["id"], x["media_type"]) for x in ranked]

    def test_ranks_by_cosine_similarity_best_first(self):
        ranked = engine.rank_titles(self.cur, basis(0), top_n=3)
        self.assertEqual(self.ids(ranked), [(1, "movie"), (2, "movie"), (3, "tv")])
        self.assertAlmostEqual(ranked[0]["similarity"], 1.0, places=5)

    def test_a_row_without_an_embedding_is_never_returned(self):
        ranked = engine.rank_titles(self.cur, basis(0), top_n=50)
        self.assertNotIn((4, "movie"), self.ids(ranked))

    def test_rated_titles_are_left_out_for_the_user(self):
        self.cur.execute("INSERT INTO ratings VALUES (%s, 1, 'movie', 5)", (self.USER,))
        ranked = engine.rank_titles(self.cur, basis(0), top_n=3, user_id=self.USER)
        self.assertNotIn((1, "movie"), self.ids(ranked))

    def test_a_rating_on_the_other_media_type_does_not_exclude(self):
        self.cur.execute("INSERT INTO ratings VALUES (%s, 5, 'tv', 5)", (self.USER,))
        ranked = engine.rank_titles(self.cur, basis(2), top_n=3, user_id=self.USER)
        self.assertEqual(self.ids(ranked)[0], (5, "movie"))

    def test_explicit_exclusions_match_on_id_and_media_type(self):
        ranked = engine.rank_titles(self.cur, basis(2), top_n=50, exclude=[(5, "movie")])
        self.assertNotIn((5, "movie"), self.ids(ranked))
        self.assertIn((5, "tv"), self.ids(ranked))

    def test_taste_similarity_is_to_the_taste_vector_not_the_query(self):
        ranked = engine.rank_titles(self.cur, basis(2), taste_vector=basis(0), top_n=50)
        by_key = {(x["id"], x["media_type"]): x for x in ranked}
        self.assertAlmostEqual(by_key[(1, "movie")]["taste_similarity"], 1.0, places=5)

    def test_taste_similarity_is_null_without_a_taste_vector(self):
        ranked = engine.rank_titles(self.cur, basis(0), top_n=1)
        self.assertIsNone(ranked[0]["taste_similarity"])

    def test_language_and_year_filters(self):
        ranked = engine.rank_titles(self.cur, basis(0), top_n=50, language="en", start_year=2010, end_year=2020)
        self.assertEqual(self.ids(ranked), [(1, "movie")])

    def test_actor_filter_is_a_case_insensitive_substring(self):
        ranked = engine.rank_titles(self.cur, basis(0), top_n=50, actor="ann lee")
        self.assertEqual(self.ids(ranked), [(1, "movie")])

    def test_percent_and_underscore_in_an_actor_are_plain_text(self):
        self.assertEqual(self.ids(engine.rank_titles(self.cur, basis(0), top_n=50, actor="%")), [(2, "movie")])
        self.assertEqual(self.ids(engine.rank_titles(self.cur, basis(0), top_n=50, actor="_")), [(3, "tv")])
        self.assertEqual(engine.rank_titles(self.cur, basis(0), top_n=50, actor="Z%"), [])

    def test_filters_match_any_ignores_ratings_and_embeddings(self):
        self.assertTrue(engine.filters_match_any(self.cur, language="en", start_year=2019, end_year=2019))
        self.assertFalse(engine.filters_match_any(self.cur, language="fr"))

    def test_top_n_zero_returns_nothing(self):
        self.assertEqual(engine.rank_titles(self.cur, basis(0), top_n=0), [])

    def test_rated_embeddings_skip_titles_without_a_vector(self):
        self.cur.execute("INSERT INTO ratings VALUES (%s, 1, 'movie', 5), (%s, 4, 'movie', 2)", (self.USER, self.USER))
        rows = engine.fetch_rated_embeddings(self.cur, self.USER)
        self.assertEqual([rating for rating, _ in rows], [5])

    def test_find_title_exact_is_case_insensitive(self):
        self.assertEqual(engine.find_title_local(self.cur, "ALPHA"), (1, "movie"))

    def test_find_title_strips_a_leading_article(self):
        self.assertEqual(engine.find_title_local(self.cur, "the titanic"), (6, "movie"))
        self.assertEqual(engine.find_title_local(self.cur, "the gamma"), (3, "tv"))

    def test_a_title_shared_by_a_movie_and_a_tv_show_goes_to_the_more_popular(self):
        self.assertEqual(engine.find_title_local(self.cur, "dune"), (5, "movie"))

    def test_an_unrelated_similar_length_word_does_not_resolve(self):
        self.cur.execute("INSERT INTO movies (id, media_type, title) VALUES (9, 'movie', 'Shelter')")
        self.assertEqual(engine.find_title_local(self.cur, "healer"), (None, None))

    def test_a_blank_title_resolves_to_nothing(self):
        self.assertEqual(engine.find_title_local(self.cur, "  "), (None, None))

    # ---------- browse: trending, browse, search ----------

    def test_trending_needs_50_votes_and_orders_by_rating_then_popularity_nulls_last(self):
        self.cur.execute("UPDATE movies SET vote_average = 8 WHERE title IN ('Alpha', 'Beta')")
        self.cur.execute("UPDATE movies SET vote_average = 9 WHERE title = 'Titanic'")
        self.cur.execute("UPDATE movies SET vote_average = NULL WHERE title = 'Gamma'")
        rows = engine.trending_titles(self.cur, top_n=50)
        titles = [x["title"] for x in rows]
        self.assertEqual(titles[0], "Titanic")
        self.assertLess(titles.index("Beta"), titles.index("Alpha"))  # same rating, more popular first
        self.assertEqual(titles[-1], "Gamma")                          # no rating sorts last
        self.assertIn("Delta", titles)                                 # exactly 50 votes still counts
        self.cur.execute("UPDATE movies SET vote_count = 49 WHERE title = 'Delta'")
        self.assertNotIn("Delta", [x["title"] for x in engine.trending_titles(self.cur, top_n=50)])

    def test_trending_scores_against_the_taste_vector_and_is_null_without_one_or_an_embedding(self):
        rows = {x["title"]: x for x in engine.trending_titles(self.cur, taste_vector=basis(0), top_n=50)}
        self.assertAlmostEqual(rows["Alpha"]["taste_similarity"], 1.0, places=5)
        self.assertIsNone(rows["Delta"]["taste_similarity"])  # no embedding
        plain = engine.trending_titles(self.cur, top_n=50)
        self.assertTrue(all(x["taste_similarity"] is None for x in plain))

    def test_trending_orders_by_closeness_to_taste_and_leaves_out_rated_titles(self):
        rows = engine.trending_titles(self.cur, taste_vector=basis(4), top_n=50, user_id=self.USER)
        self.assertEqual(rows[0]["title"], "Titanic")
        self.assertEqual(rows[-1]["title"], "Delta")  # no embedding sorts last
        self.cur.execute("INSERT INTO ratings VALUES (%s, 6, 'movie', 5)", (self.USER,))
        rated = engine.trending_titles(self.cur, taste_vector=basis(4), top_n=50, user_id=self.USER)
        self.assertNotIn("Titanic", [x["title"] for x in rated])

    def test_browse_personalized_orders_by_taste_and_leaves_out_rated_titles(self):
        rows = engine.browse_titles(self.cur, limit=50, taste_vector=basis(4), user_id=self.USER)
        self.assertEqual(rows[0]["title"], "Titanic")
        self.cur.execute("INSERT INTO ratings VALUES (%s, 6, 'movie', 5)", (self.USER,))
        rated = engine.browse_titles(self.cur, limit=50, taste_vector=basis(4), user_id=self.USER)
        self.assertNotIn("Titanic", [x["title"] for x in rated])
        plain = engine.browse_titles(self.cur, limit=50)
        self.assertEqual([x["title"] for x in plain][:3], ["Beta", "Dune", "Titanic"])  # unchanged

    def test_browse_filters_by_genre_substring(self):
        self.cur.execute("UPDATE movies SET genres = 'Action|Drama' WHERE title = 'Alpha'")
        self.cur.execute("UPDATE movies SET genres = 'Sci-Fi & Fantasy' WHERE title = 'Gamma'")
        self.assertEqual([x["title"] for x in engine.browse_titles(self.cur, genre="drama", limit=50)], ["Alpha"])
        self.assertEqual([x["title"] for x in engine.browse_titles(self.cur, genre="fantasy", limit=50)], ["Gamma"])
        self.assertEqual(engine.browse_titles(self.cur, genre="%", limit=50), [])  # a literal percent sign

    def test_browse_personalized_rows_carry_taste_similarity(self):
        rows = {x["title"]: x for x in engine.browse_titles(self.cur, limit=50, taste_vector=basis(0), user_id=self.USER)}
        self.assertAlmostEqual(rows["Alpha"]["taste_similarity"], 1.0, places=5)
        self.assertIsNone(rows["Delta"]["taste_similarity"])  # no embedding
        self.assertNotIn("taste_similarity", engine.browse_titles(self.cur, limit=5)[0])

    def test_browse_orders_by_popularity_and_filters_by_media_type(self):
        both = engine.browse_titles(self.cur, limit=50)
        self.assertEqual([x["title"] for x in both][:3], ["Beta", "Dune", "Titanic"])
        tv = engine.browse_titles(self.cur, media_type="tv", limit=50)
        self.assertEqual({x["media_type"] for x in tv}, {"tv"})
        self.assertEqual(len(engine.browse_titles(self.cur, media_type="both", limit=50)), 7)

    def test_browse_applies_the_same_filters_as_ranking(self):
        rows = engine.browse_titles(self.cur, language="en", start_year=2010, end_year=2020, limit=50)
        self.assertEqual([x["title"] for x in rows], ["Alpha", "Delta"])
        self.assertEqual([x["title"] for x in engine.browse_titles(self.cur, actor="%", limit=50)], ["Beta"])

    def test_search_orders_exact_then_prefix_then_anywhere(self):
        self.cur.execute("INSERT INTO movies (id, media_type, title, popularity) VALUES (20, 'movie', 'Dune Part Two', 9.9)")
        self.cur.execute("INSERT INTO movies (id, media_type, title, popularity) VALUES (21, 'movie', 'Sand Dune Story', 9.9)")
        titles = [x["title"] for x in engine.search_titles(self.cur, "dune", limit=10)]
        self.assertEqual(titles[:2], ["Dune", "Dune"])           # exact, both media types
        self.assertEqual(titles[2:4], ["Dune Part Two", "Sand Dune Story"])  # prefix, then anywhere

    def test_search_finds_a_one_letter_typo(self):
        self.cur.execute("INSERT INTO movies (id, media_type, title, popularity) VALUES (22, 'movie', 'Interstellar', 9.0)")
        self.assertEqual([x["title"] for x in engine.search_titles(self.cur, "interstelar")], ["Interstellar"])
        self.assertIn("Dune", [x["title"] for x in engine.search_titles(self.cur, "dine")])
        self.assertIn("Dune", [x["title"] for x in engine.search_titles(self.cur, "dnue")])  # swapped letters

    def test_search_does_not_match_unrelated_words(self):
        self.cur.execute("INSERT INTO movies (id, media_type, title) VALUES (9, 'movie', 'Shelter')")
        self.assertEqual(engine.search_titles(self.cur, "healer"), [])

    def test_search_returns_one_row_per_id_and_media_type(self):
        rows = engine.search_titles(self.cur, "dune", limit=10)
        keys = [(x["id"], x["media_type"]) for x in rows]
        self.assertEqual(len(keys), len(set(keys)))
        self.assertEqual(set(keys), {(5, "movie"), (5, "tv")})

    def test_search_needs_two_characters_and_treats_percent_and_underscore_as_text(self):
        self.assertEqual(engine.search_titles(self.cur, "a"), [])
        self.assertEqual(engine.search_titles(self.cur, "  "), [])
        self.assertEqual(engine.search_titles(self.cur, "%%"), [])
        self.assertEqual(engine.search_titles(self.cur, "d_n"), [])  # _ is not a wildcard

    def test_search_respects_the_limit(self):
        self.assertEqual(len(engine.search_titles(self.cur, "a", limit=0)), 0)
        self.assertEqual(len(engine.search_titles(self.cur, "ta", limit=1)), 1)

    def test_fetch_card_returns_the_resolve_shape_or_none(self):
        card = engine.fetch_card(self.cur, 6, "movie")
        self.assertEqual(set(card), {"movie_id", "media_type", "title", "release_date", "poster_path"})
        self.assertEqual((card["movie_id"], card["release_date"]), (6, "1997-12-01"))
        self.assertIsNone(engine.fetch_card(self.cur, 999, "movie"))


class OneEditVariantsTests(unittest.TestCase):
    def test_includes_a_deletion_a_replacement_an_insertion_and_a_swap(self):
        variants = engine.one_edit_variants("dune")
        for expected in ("dun", "dine", "duneo", "dnue"):
            self.assertIn(expected, variants)

    def test_never_includes_the_text_itself_and_has_no_duplicates(self):
        variants = engine.one_edit_variants("dune")
        self.assertNotIn("dune", variants)
        self.assertEqual(len(variants), len(set(variants)))

    def test_stays_small_enough_to_send_to_the_database(self):
        self.assertLess(len(engine.one_edit_variants("x" * engine.SEARCH_TYPO_MAX_CHARS)), 5000)


if __name__ == "__main__":
    unittest.main()
