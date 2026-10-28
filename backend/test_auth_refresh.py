"""
Regression test for POST /auth/refresh error mapping (spec 0004, AC-4/AC-10/AC-11).

backend/ has no test framework configured yet (see AGENTS.md), so this uses
only the standard library (unittest + unittest.mock) -- run with:
    venv\\Scripts\\python.exe -m unittest test_auth_refresh -v
"""
import unittest
from unittest.mock import patch, MagicMock

import requests as requests_module
from fastapi import HTTPException

import auth


def _fake_response(status_code, json_body=None, raise_on_json=False):
    resp = MagicMock()
    resp.status_code = status_code
    if raise_on_json:
        resp.json.side_effect = ValueError("not json")
    else:
        resp.json.return_value = json_body
    return resp


class RefreshAccessTokenErrorMappingTests(unittest.TestCase):
    def assert_maps_to(self, expected_status, **post_kwargs):
        with patch.object(auth.requests, "post", **post_kwargs):
            with self.assertRaises(HTTPException) as ctx:
                auth.refresh_access_token("some-token")
            self.assertEqual(ctx.exception.status_code, expected_status)

    def test_refresh_token_not_found_maps_to_401(self):
        # Supabase's actual error_code for a garbage/expired refresh token.
        self.assert_maps_to(
            401,
            return_value=_fake_response(
                400, {"error_code": "refresh_token_not_found", "msg": "Invalid Refresh Token: Refresh Token Not Found"}
            ),
        )

    def test_refresh_token_already_used_maps_to_401(self):
        # Supabase's actual error_code for a revoked/rotated refresh token.
        self.assert_maps_to(
            401,
            return_value=_fake_response(
                400, {"error_code": "refresh_token_already_used", "msg": "Invalid Refresh Token: Already Used"}
            ),
        )

    def test_malformed_refresh_token_maps_to_401(self):
        # Regression: Supabase's actual error_code for a garbage/malformed
        # refresh token -- confirmed live against the real API, this was
        # falling through to 503 (bug: not in REJECTED_REFRESH_TOKEN_CODES).
        self.assert_maps_to(
            401,
            return_value=_fake_response(
                400, {"error_code": "validation_failed", "msg": "Refresh token is not valid"}
            ),
        )

    def test_supabase_5xx_maps_to_503(self):
        self.assert_maps_to(503, return_value=_fake_response(500, {"msg": "internal error"}))

    def test_supabase_rate_limit_maps_to_503(self):
        self.assert_maps_to(503, return_value=_fake_response(429, {"msg": "rate limited"}))

    def test_malformed_error_body_maps_to_503(self):
        self.assert_maps_to(503, return_value=_fake_response(400, raise_on_json=True))

    def test_network_error_maps_to_503(self):
        self.assert_maps_to(503, side_effect=requests_module.ConnectionError("boom"))


if __name__ == "__main__":
    unittest.main()
