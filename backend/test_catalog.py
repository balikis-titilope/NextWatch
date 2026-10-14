"""
test_catalog.py
Unit tests for db/catalog.py (spec 0013): the shared text builder, vector
literal, LIKE escaping, and the row writer's cleaning and dedupe rules.
The database is mocked at execute_values -- no Postgres connection is made.

Run: .venv\Scripts\python.exe -m unittest test_catalog -v
"""

import unittest
from unittest.mock import MagicMock, patch

import numpy as np

from db import catalog


BS = chr(92)


class BuildCombinedTextTests(unittest.TestCase):
    def test_same_format_as_before(self):
        row = {"overview": "A story.", "genres": "Drama|Crime", "keywords": "heist|rain", "tagline": "Run."}
        self.assertEqual(catalog.build_combined_text(row), "A story. Drama Crime heist rain Run.")

    def test_missing_and_nan_values_are_empty(self):
        row = {"overview": None, "genres": float("nan"), "keywords": "x", "tagline": None}
        self.assertEqual(catalog.build_combined_text(row), "  x ")


class VectorLiteralTests(unittest.TestCase):
    def test_text_form(self):
        self.assertEqual(catalog.vector_literal(np.array([0.5, -1.0, 0.25], dtype=np.float32)), "[0.5,-1,0.25]")


class EscapeLikeTests(unittest.TestCase):
    def test_wildcards_and_escape_char_are_plain_text(self):
        self.assertEqual(catalog.escape_like("100%_a" + BS + "b"), "100" + BS + "%" + BS + "_a" + BS + BS + "b")


class WriteCatalogRowsTests(unittest.TestCase):
    def _write(self, rows):
        with patch.object(catalog, "execute_values") as ev:
            count = catalog.write_catalog_rows(MagicMock(), rows)
        return count, ev

    def test_duplicate_keys_in_a_batch_are_written_once_last_wins(self):
        count, ev = self._write([
            {"id": 1, "media_type": "movie", "title": "Old"},
            {"id": 1, "media_type": "movie", "title": "New"},
            {"id": 1, "media_type": "tv", "title": "Same id, other type"},
        ])
        self.assertEqual(count, 2)
        movie_values = ev.call_args_list[0].args[2]
        self.assertEqual({(v[0], v[1]): v[2] for v in movie_values}, {(1, "movie"): "New", (1, "tv"): "Same id, other type"})

    def test_untitled_rows_are_skipped(self):
        count, ev = self._write([{"id": 1, "title": ""}, {"id": 2, "title": None}, {"id": 3}])
        self.assertEqual(count, 0)
        ev.assert_not_called()

    def test_null_embedding_stays_null_with_no_model_id(self):
        _, ev = self._write([{"id": 1, "title": "A"}])
        values = ev.call_args_list[0].args[2][0]
        self.assertIsNone(values[19])
        self.assertIsNone(values[20])

    def test_embedding_is_stored_with_the_one_model_id(self):
        _, ev = self._write([{"id": 1, "title": "A", "embedding": np.ones(3, dtype=np.float32)}])
        values = ev.call_args_list[0].args[2][0]
        self.assertEqual(values[19], "[1,1,1]")
        self.assertEqual(values[20], catalog.EMBEDDING_MODEL)

    def test_numpy_scalars_nan_and_bad_dates_are_cleaned(self):
        _, ev = self._write([{
            "id": np.int64(7), "title": "A", "vote_count": np.float64(12.0), "vote_average": float("nan"),
            "release_date": "not a date", "popularity": np.float64(3.5),
        }])
        values = ev.call_args_list[0].args[2][0]
        self.assertEqual(values[0], 7)
        self.assertEqual(values[12], 12)
        self.assertIsNone(values[11])
        self.assertIsNone(values[8])
        self.assertEqual(values[21], 3.5)
        self.assertIs(type(values[0]), int)

    def test_media_type_defaults_to_movie(self):
        _, ev = self._write([{"id": 1, "title": "A"}])
        self.assertEqual(ev.call_args_list[0].args[2][0][1], "movie")

    def test_details_row_carries_cast_photos(self):
        _, ev = self._write([{"id": 1, "title": "A", "tagline": "T", "cast_photos": [{"name": "X", "profile_path": None}]}])
        details = ev.call_args_list[1].args[2][0]
        self.assertEqual(details[2], "T")
        self.assertEqual(details[6].adapted, [{"name": "X", "profile_path": None}])


class ParseCastPhotosTests(unittest.TestCase):
    def test_valid_empty_and_broken_json(self):
        self.assertEqual(catalog.parse_cast_photos('[{"name": "A"}]'), [{"name": "A"}])
        self.assertEqual(catalog.parse_cast_photos(None), [])
        self.assertEqual(catalog.parse_cast_photos("{broken"), [])
        self.assertEqual(catalog.parse_cast_photos('{"a": 1}'), [])


if __name__ == "__main__":
    unittest.main()
