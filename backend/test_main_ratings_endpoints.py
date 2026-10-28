"""
Regression tests for DELETE /ratings/{movie_id} (spec 0008), extended for
the required media_type query param (spec 0010).

backend/ has no test framework configured yet (see AGENTS.md), so this uses
only the standard library (unittest + unittest.mock) plus starlette's
TestClient, matching test_cors.py -- no `with` block, so the app's lifespan
(real model/embeddings load) never runs; only the DB layer functions
(delete_rating, touch_last_active) are mocked at the main module boundary.

Run: venv\\Scripts\\python.exe -m unittest test_main_ratings_endpoints -v
"""
import unittest
from unittest.mock import patch

from starlette.testclient import TestClient

import main

FAKE_USER_ID = "00000000-0000-0000-0000-000000000000"


class DeleteRatingTests(unittest.TestCase):
    def setUp(self):
        main.app.dependency_overrides[main.get_current_user_id] = lambda: FAKE_USER_ID
        # DELETE /ratings/{movie_id} runs on get_current_active_user_id
        # (spec 0009's deactivation gate), a distinct dependency from
        # get_current_user_id -- both must be overridden.
        main.app.dependency_overrides[main.get_current_active_user_id] = lambda: FAKE_USER_ID
        self.client = TestClient(main.app)
        self.touch_patch = patch.object(main, "touch_last_active")
        self.mock_touch = self.touch_patch.start()
        self.addCleanup(self.touch_patch.stop)
        self.addCleanup(main.app.dependency_overrides.clear)

    def test_delete_own_rating_returns_200_and_status(self):
        # AC-1, AC-3: a rating the caller owns is removed.
        with patch.object(main, "delete_rating", return_value=True) as mock_delete:
            response = self.client.delete("/ratings/42", params={"media_type": "movie"})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "deleted", "movie_id": 42})
        mock_delete.assert_called_once_with(FAKE_USER_ID, 42, "movie")

    def test_delete_own_rating_touches_last_active(self):
        # AC-9: a successful delete keeps the user looking active, same
        # as POST /ratings.
        with patch.object(main, "delete_rating", return_value=True):
            self.client.delete("/ratings/42", params={"media_type": "movie"})
        self.mock_touch.assert_called_once_with(FAKE_USER_ID)

    def test_delete_nonexistent_rating_returns_404(self):
        # AC-4: never rated this movie -- 404, and last_active_at is left
        # untouched (only a genuine delete counts as activity).
        with patch.object(main, "delete_rating", return_value=False):
            response = self.client.delete("/ratings/999", params={"media_type": "movie"})
        self.assertEqual(response.status_code, 404)
        self.mock_touch.assert_not_called()

    def test_delete_someone_elses_rating_returns_same_404(self):
        # AC-4: ownership scoping happens inside delete_rating's own WHERE
        # clause, so from the endpoint's perspective "not mine" and
        # "doesn't exist" are indistinguishable -- both surface as this
        # same 404, never a 403 that would leak which case it was.
        with patch.object(main, "delete_rating", return_value=False):
            response = self.client.delete("/ratings/7", params={"media_type": "movie"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"], "rating not found")

    def test_delete_a_tv_rating(self):
        # Spec 0010: a TV rating deletes identically to a movie one, keyed
        # on the composite (movie_id, media_type).
        with patch.object(main, "delete_rating", return_value=True) as mock_delete:
            response = self.client.delete("/ratings/42", params={"media_type": "tv"})
        self.assertEqual(response.status_code, 200)
        mock_delete.assert_called_once_with(FAKE_USER_ID, 42, "tv")

    def test_delete_without_media_type_returns_422_not_a_silent_default(self):
        # Spec 0010: a movie and a TV show can share the same movie_id, so
        # omitting media_type must never silently default to one or the
        # other -- it's a required query param, same disambiguation rule
        # as every other id lookup in this API.
        with patch.object(main, "delete_rating", return_value=True) as mock_delete:
            response = self.client.delete("/ratings/42")
        self.assertEqual(response.status_code, 422)
        mock_delete.assert_not_called()

    def test_delete_requires_auth(self):
        # No override active here for a clean 401 check;
        # get_current_active_user_id rejects a missing bearer token before
        # touching app state, so this doesn't need the app's lifespan
        # (real model/embeddings load) either.
        main.app.dependency_overrides.pop(main.get_current_user_id, None)
        main.app.dependency_overrides.pop(main.get_current_active_user_id, None)
        bare_client = TestClient(main.app)
        response = bare_client.delete("/ratings/42", params={"media_type": "movie"})
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
