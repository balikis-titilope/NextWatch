"""
Regression test for POST /auth/login error mapping (spec 0004).

backend/ has no test framework configured yet (see AGENTS.md), so this uses
only the standard library (unittest + unittest.mock) -- run with:
    venv\\Scripts\\python.exe -m unittest test_auth_login -v
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


class SignInErrorMappingTests(unittest.TestCase):
    def assert_maps_to(self, expected_status, **post_kwargs):
        with patch.object(auth.requests, "post", **post_kwargs):
            with self.assertRaises(HTTPException) as ctx:
                auth.sign_in("user@example.com", "some-password")
            self.assertEqual(ctx.exception.status_code, expected_status)

    def test_wrong_password_maps_to_401(self):
        self.assert_maps_to(
            401,
            return_value=_fake_response(400, {"error_code": "invalid_credentials", "msg": "Invalid login credentials"}),
        )

    def test_unconfirmed_email_maps_to_403(self):
        self.assert_maps_to(
            403,
            return_value=_fake_response(400, {"error_code": "email_not_confirmed", "msg": "Email not confirmed"}),
        )

    def test_supabase_5xx_maps_to_503(self):
        # Regression: this was falling through to 401 "Invalid email or
        # password" -- indistinguishable from a genuinely wrong password.
        self.assert_maps_to(503, return_value=_fake_response(500, {"msg": "internal error"}))

    def test_supabase_rate_limit_maps_to_503(self):
        # Regression: /auth/v1/token's rate-limit bucket is shared with
        # grant_type=refresh_token, so a burst of refresh attempts (e.g.
        # around a forced logout) can leave a login attempt seconds later
        # rate-limited -- this must not read as a wrong password.
        self.assert_maps_to(
            503, return_value=_fake_response(429, {"msg": "rate limited", "error_code": "over_request_rate_limit"})
        )

    def test_malformed_error_body_maps_to_401(self):
        self.assert_maps_to(401, return_value=_fake_response(400, raise_on_json=True))

    def test_network_error_maps_to_503(self):
        self.assert_maps_to(503, side_effect=requests_module.ConnectionError("boom"))


if __name__ == "__main__":
    unittest.main()
