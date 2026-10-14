"""
test_import_data.py
Unit tests for the spec 0005 additions to db/import_data.py: country
threading (create_user_profile, get_user_country). The numpy scalar
handling a live-resolved row needs now lives in db/catalog.py's writer
(spec 0013) and is covered by test_catalog.py.

The DB connection is mocked at the boundary (get_connection) -- no real
Postgres connection is made by these tests.

Run: venv\\Scripts\\python.exe -m unittest test_import_data -v
"""

import unittest
from unittest.mock import MagicMock, patch

from db import import_data


def _mock_connection():
    """A MagicMock standing in for a psycopg2 connection, wired so
    `with conn.cursor() as cur:` works and the cursor's calls are
    inspectable via the returned cursor mock."""
    conn = MagicMock()
    cursor = MagicMock()
    conn.cursor.return_value.__enter__.return_value = cursor
    return conn, cursor


class CreateUserProfileTests(unittest.TestCase):
    def test_inserts_with_the_given_country(self):
        conn, cursor = _mock_connection()
        with patch.object(import_data, "get_connection", return_value=conn):
            import_data.create_user_profile("user-1", country="GB")

        sql, params = cursor.execute.call_args[0]
        self.assertIn("INSERT INTO users", sql)
        self.assertEqual(params, ("user-1", "GB"))
        conn.commit.assert_called_once()

    def test_defaults_country_to_none_when_not_given(self):
        conn, cursor = _mock_connection()
        with patch.object(import_data, "get_connection", return_value=conn):
            import_data.create_user_profile("user-1")

        _, params = cursor.execute.call_args[0]
        self.assertEqual(params, ("user-1", None))

    def test_uses_on_conflict_do_nothing_so_a_second_call_never_overwrites(self):
        conn, cursor = _mock_connection()
        with patch.object(import_data, "get_connection", return_value=conn):
            import_data.create_user_profile("user-1", country="GB")

        sql, _ = cursor.execute.call_args[0]
        self.assertIn("ON CONFLICT (id) DO NOTHING", sql)


class GetUserCountryTests(unittest.TestCase):
    def test_returns_the_stored_country(self):
        conn, cursor = _mock_connection()
        cursor.fetchone.return_value = ("GB",)
        with patch.object(import_data, "get_connection", return_value=conn):
            result = import_data.get_user_country("user-1")

        self.assertEqual(result, "GB")

    def test_returns_none_when_no_country_is_stored(self):
        conn, cursor = _mock_connection()
        cursor.fetchone.return_value = (None,)
        with patch.object(import_data, "get_connection", return_value=conn):
            result = import_data.get_user_country("user-1")

        self.assertIsNone(result)

    def test_guarantees_the_row_exists_first_via_an_upsert_guard(self):
        conn, cursor = _mock_connection()
        cursor.fetchone.return_value = (None,)
        with patch.object(import_data, "get_connection", return_value=conn):
            import_data.get_user_country("user-1")

        first_sql = cursor.execute.call_args_list[0][0][0]
        self.assertIn("ON CONFLICT (id) DO NOTHING", first_sql)


if __name__ == "__main__":
    unittest.main()
