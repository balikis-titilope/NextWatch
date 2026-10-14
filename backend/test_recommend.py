"""
test_recommend.py
Unit tests for recommend.py: the score calibration primitives,
watch-provider resolution, and the TMDB field-mapping helpers. Pure logic --
no network, no DB, no model loading (the taste math on rows and the SQL live
in test_engine.py; live resolve, the model loader and the refresh have their
own test files).

Run: venv\\Scripts\\python.exe -m unittest test_recommend -v
"""

import unittest
from unittest.mock import patch
import recommend


class CalibratedScoreTests(unittest.TestCase):
    def test_raw_equal_to_ceiling_is_100_percent(self):
        self.assertEqual(recommend.calibrated_score(0.8, 0.8), 100)

    def test_raw_half_of_ceiling_is_50_percent(self):
        self.assertEqual(recommend.calibrated_score(0.4, 0.8), 50)

    def test_raw_above_ceiling_clamps_to_100(self):
        self.assertEqual(recommend.calibrated_score(0.95, 0.8), 100)

    def test_negative_raw_similarity_clamps_to_0_not_negative(self):
        self.assertEqual(recommend.calibrated_score(-0.2, 0.8), 0)

    def test_none_raw_similarity_returns_none_not_zero(self):
        self.assertIsNone(recommend.calibrated_score(None, 0.8))

    def test_none_ceiling_returns_none_not_zero(self):
        self.assertIsNone(recommend.calibrated_score(0.5, None))

    def test_zero_ceiling_returns_none_avoids_division_by_zero(self):
        self.assertIsNone(recommend.calibrated_score(0.5, 0.0))

    def test_negative_ceiling_returns_none(self):
        self.assertIsNone(recommend.calibrated_score(0.5, -0.1))

    def test_rounds_to_the_nearest_whole_number(self):
        # 0.333/0.8 = 0.41625 -> 41.625% -> rounds to 42
        self.assertEqual(recommend.calibrated_score(0.333, 0.8), 42)


class ResolveWatchProvidersTests(unittest.TestCase):
    def setUp(self):
        self.providers = {
            "GB": {
                "link": "https://example.com/gb",
                "flatrate": [{"provider_name": "Netflix", "logo_path": "/netflix.jpg"}],
                "rent": [],
                "buy": [{"provider_name": "Amazon Video", "logo_path": "/amazon.jpg"}],
            },
            "NG": {
                "flatrate": [{"provider_name": "Showmax", "logo_path": "/showmax.jpg"}],
            },
            "US": {
                "flatrate": [{"provider_name": "Hulu", "logo_path": "/hulu.jpg"}],
            },
        }

    def test_resolves_to_the_requested_country_when_covered(self):
        result = recommend.resolve_watch_providers(self.providers, "GB")
        self.assertEqual(result["stream"], [{"name": "Netflix", "logo_path": "/netflix.jpg"}])
        self.assertEqual(result["buy"], [{"name": "Amazon Video", "logo_path": "/amazon.jpg"}])
        self.assertEqual(result["rent"], [])

    def test_falls_back_to_ng_when_no_country_given(self):
        result = recommend.resolve_watch_providers(self.providers, None)
        self.assertEqual(result["stream"], [{"name": "Showmax", "logo_path": "/showmax.jpg"}])

    def test_falls_back_to_ng_when_the_given_country_is_not_covered(self):
        result = recommend.resolve_watch_providers(self.providers, "FR")
        self.assertEqual(result["stream"], [{"name": "Showmax", "logo_path": "/showmax.jpg"}])

    def test_falls_back_to_us_when_neither_given_nor_ng_is_covered(self):
        providers = {"US": self.providers["US"]}
        result = recommend.resolve_watch_providers(providers, None)
        self.assertEqual(result["stream"], [{"name": "Hulu", "logo_path": "/hulu.jpg"}])

    def test_empty_input_returns_all_empty_categories_not_a_crash(self):
        result = recommend.resolve_watch_providers({}, None)
        self.assertEqual(result, {"stream": [], "rent": [], "buy": []})

    def test_none_input_is_treated_as_empty(self):
        result = recommend.resolve_watch_providers(None, "GB")
        self.assertEqual(result, {"stream": [], "rent": [], "buy": []})

    def test_every_provider_carries_a_logo_path_not_just_a_name(self):
        # AC-7: "include each provider's logo path, not just its name".
        result = recommend.resolve_watch_providers(self.providers, "GB")
        self.assertIn("logo_path", result["stream"][0])
        self.assertEqual(result["stream"][0]["logo_path"], "/netflix.jpg")


class EnrichMovieDetailsTests(unittest.TestCase):
    def test_extracts_cast_photos_alongside_the_plain_name_list(self):
        details = {
            "id": 1,
            "credits": {
                "cast": [
                    {"name": "Matthew McConaughey", "profile_path": "/mm.jpg"},
                    {"name": "Anne Hathaway", "profile_path": None},
                ],
                "crew": [{"name": "Christopher Nolan", "job": "Director"}],
            },
            "keywords": {"keywords": [{"name": "space"}]},
            "videos": {"results": [{"key": "abc123", "site": "YouTube", "type": "Trailer"}]},
            "watch/providers": {"results": {"US": {"flatrate": []}}},
        }

        enriched = recommend._enrich_movie_details(details)

        self.assertEqual(enriched["cast"], ["Matthew McConaughey", "Anne Hathaway"])
        self.assertEqual(
            enriched["cast_photos"],
            [
                {"name": "Matthew McConaughey", "profile_path": "/mm.jpg"},
                {"name": "Anne Hathaway", "profile_path": None},
            ],
        )
        self.assertEqual(enriched["director"], ["Christopher Nolan"])
        self.assertEqual(enriched["trailer_keys"], ["abc123"])
        self.assertEqual(enriched["watch_providers"], {"US": {"flatrate": []}})

    def test_ignores_non_youtube_or_non_trailer_videos(self):
        details = {
            "credits": {"cast": [], "crew": []},
            "keywords": {"keywords": []},
            "videos": {
                "results": [
                    {"key": "a", "site": "YouTube", "type": "Teaser"},
                    {"key": "b", "site": "Vimeo", "type": "Trailer"},
                ]
            },
            "watch/providers": {},
        }

        enriched = recommend._enrich_movie_details(details)

        self.assertEqual(enriched["trailer_keys"], [])

    def test_caps_cast_at_10_members(self):
        details = {
            "credits": {"cast": [{"name": f"Actor {i}", "profile_path": None} for i in range(15)], "crew": []},
            "keywords": {"keywords": []},
            "videos": {"results": []},
            "watch/providers": {},
        }

        enriched = recommend._enrich_movie_details(details)

        self.assertEqual(len(enriched["cast"]), 10)
        self.assertEqual(len(enriched["cast_photos"]), 10)


class BuildMovieRowTests(unittest.TestCase):
    def test_maps_every_spec_0005_field_from_a_live_tmdb_payload(self):
        details = {
            "id": 50183,
            "title": "The Ascent",
            "overview": "overview text",
            "genres": [{"name": "War"}, {"name": "Drama"}],
            "keywords": ["survival"],
            "cast": ["Boris Plotnikov"],
            "director": ["Larisa Shepitko"],
            "release_date": "1977-04-04",
            "original_language": "ru",
            "production_countries": [{"iso_3166_1": "SU"}],
            "vote_average": 8.2,
            "vote_count": 100,
            "poster_path": "/poster.jpg",
            "backdrop_path": "/backdrop.jpg",
            "runtime": 111,
            "tagline": "a tagline",
            "popularity": 12.3,
            "trailer_keys": ["xyz"],
            "cast_photos": [{"name": "Boris Plotnikov", "profile_path": "/bp.jpg"}],
            "watch_providers": {"US": {"flatrate": []}},
        }

        row = recommend.build_movie_row(details)

        self.assertEqual(row["id"], 50183)
        self.assertEqual(row["genres"], "War|Drama")
        self.assertEqual(row["production_countries"], "SU")
        self.assertEqual(row["backdrop_path"], "/backdrop.jpg")
        self.assertEqual(row["runtime"], 111)
        self.assertEqual(row["tagline"], "a tagline")
        self.assertEqual(row["popularity"], 12.3)
        self.assertEqual(row["trailer_keys"], "xyz")
        self.assertEqual(
            row["cast_photos"], [{"name": "Boris Plotnikov", "profile_path": "/bp.jpg"}]
        )
        # The one shared text builder: overview genres keywords tagline.
        self.assertEqual(row["combined_text"], "overview text War Drama survival a tagline")

    def test_missing_optional_fields_default_to_empty_not_a_crash(self):
        details = {"id": 1, "title": "Bare Minimum"}

        row = recommend.build_movie_row(details)

        self.assertEqual(row["overview"], "")
        self.assertEqual(row["genres"], "")
        self.assertEqual(row["tagline"], "")
        self.assertEqual(row["cast_photos"], [])
        self.assertIsNone(row["backdrop_path"])
        self.assertIsNone(row["runtime"])
        self.assertIsNone(row["popularity"])


class TitlesMatchTests(unittest.TestCase):
    def test_exact_match_is_case_insensitive(self):
        self.assertTrue(recommend.titles_match("Titanic", "titanic"))

    def test_leading_article_is_ignored(self):
        self.assertTrue(recommend.titles_match("the titanic", "Titanic"))

    def test_single_character_typo_still_matches(self):
        self.assertTrue(recommend.titles_match("interstelar", "Interstellar"))

    def test_word_order_swap_does_not_match(self):
        # Regression: TMDB's own top search result for 'study group' was
        # the unrelated, word-swapped 'Group Study' (ratio 0.45).
        self.assertFalse(recommend.titles_match("study group", "Group Study"))

    def test_unrelated_similar_length_word_does_not_match(self):
        self.assertFalse(recommend.titles_match("healer", "Shelter"))


class SearchTmdbTitleTests(unittest.TestCase):
    """search_tmdb_title (spec 0010) replaces search_tmdb_movie: it checks
    both TMDB catalogs and returns (id, media_type)."""

    def _mock_both(self, movie_response, tv_response):
        return patch("recommend.get_json", side_effect=[movie_response, tv_response])

    def test_returns_none_none_when_neither_catalog_confidently_matches(self):
        with self._mock_both(
            {"results": [{"id": 1598265, "title": "Group Study"}]},
            {"results": []},
        ):
            self.assertEqual(recommend.search_tmdb_title("study group"), (None, None))

    def test_returns_movie_id_when_only_the_movie_catalog_matches(self):
        with self._mock_both(
            {"results": [{"id": 27205, "title": "Inception", "popularity": 50, "vote_count": 100}]},
            {"results": []},
        ):
            self.assertEqual(recommend.search_tmdb_title("inception"), (27205, "movie"))

    def test_returns_tv_id_when_only_the_tv_catalog_matches(self):
        # The bug this spec fixes: a TV-only title like "The Manipulated"
        # never lived in /search/movie.
        with self._mock_both(
            {"results": []},
            {"results": [{"id": 987654, "name": "The Manipulated", "popularity": 20, "vote_count": 10}]},
        ):
            self.assertEqual(recommend.search_tmdb_title("The Manipulated"), (987654, "tv"))

    def test_breaks_a_tie_toward_higher_popularity_when_both_catalogs_match(self):
        with self._mock_both(
            {"results": [{"id": 1, "title": "Fargo", "popularity": 10, "vote_count": 500}]},
            {"results": [{"id": 2, "name": "Fargo", "popularity": 90, "vote_count": 1000}]},
        ):
            self.assertEqual(recommend.search_tmdb_title("Fargo"), (2, "tv"))

    def test_returns_none_none_for_no_results_in_either_catalog(self):
        with self._mock_both({"results": []}, {"results": []}):
            self.assertEqual(recommend.search_tmdb_title("gibberish query"), (None, None))


