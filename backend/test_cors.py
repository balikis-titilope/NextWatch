"""
Regression test: the mobile app's web target calls this API from a
browser origin (localhost:8081 in dev), which requires CORS headers on
every response, including the preflight OPTIONS request browsers send
before a cross-origin GET. Without CORSMiddleware registered, Starlette
has no OPTIONS handler for any route, so the preflight itself 405s and
the browser blocks the real request before it's ever sent -- confirmed
live against the running dev server (/check verify, search & browse).

backend/ has no test framework configured yet (see AGENTS.md), so this
uses only the standard library (unittest) plus starlette's TestClient,
matching test_auth_refresh.py -- run with:
    venv\\Scripts\\python.exe -m unittest test_cors -v
"""
import unittest

from starlette.testclient import TestClient

from main import app


class CorsPreflightTests(unittest.TestCase):
    def setUp(self):
        # No `with` block: skip the app's lifespan (data/model loading),
        # since CORSMiddleware answers the preflight before it ever
        # reaches a route handler or touches app state.
        self.client = TestClient(app)

    def test_preflight_get_movies_is_allowed(self):
        response = self.client.options(
            "/movies",
            headers={
                "Origin": "http://localhost:8081",
                "Access-Control-Request-Method": "GET",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "*")

    def test_preflight_post_ratings_is_allowed(self):
        # A second route/method pair, to prove this is app-wide
        # middleware and not a fix scoped to one endpoint.
        response = self.client.options(
            "/ratings",
            headers={
                "Origin": "http://localhost:8081",
                "Access-Control-Request-Method": "POST",
            },
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("access-control-allow-origin"), "*")


if __name__ == "__main__":
    unittest.main()
