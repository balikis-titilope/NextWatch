"""
Regression test for auth.verify_token (spec 0004).

Root cause this guards against: this project's Supabase instance signs
access tokens with the newer asymmetric ES256 JWT Signing Key, not the
legacy shared HS256 secret. Verifying with jwt.decode(token, secret,
algorithms=["HS256"]) rejects every genuine, freshly-issued token with a
401 -- confirmed live via /check verify (GET /me on a real token). The fix
verifies against Supabase's JWKS (PyJWKClient) using ES256 instead.

backend/ has no test framework configured yet (see AGENTS.md), so this uses
only the standard library (unittest + unittest.mock) plus the already
required pyjwt/cryptography -- run with:
    venv\\Scripts\\python.exe -m unittest test_auth_verify_token -v
"""
import unittest
from unittest.mock import patch, MagicMock

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import HTTPException

import auth


def _es256_token(payload, private_key):
    return jwt.encode(payload, private_key, algorithm="ES256", headers={"kid": "test-key"})


class VerifyTokenTests(unittest.TestCase):
    def setUp(self):
        self.private_key = ec.generate_private_key(ec.SECP256R1())
        self.public_key = self.private_key.public_key()
        self.payload = {"sub": "user-123", "aud": "authenticated", "email": "a@b.com"}

    def _patch_jwks(self):
        signing_key = MagicMock()
        signing_key.key = self.public_key
        return patch.object(
            auth._jwks_client, "get_signing_key_from_jwt", return_value=signing_key
        )

    def test_verifies_a_genuine_es256_token(self):
        # Regression: this must succeed via JWKS/ES256, not HS256.
        token = _es256_token(self.payload, self.private_key)
        with self._patch_jwks():
            result = auth.verify_token(token)
        self.assertEqual(result["sub"], "user-123")

    def test_rejects_a_token_signed_by_an_untrusted_key(self):
        other_key = ec.generate_private_key(ec.SECP256R1())
        token = _es256_token(self.payload, other_key)
        with self._patch_jwks():
            with self.assertRaises(HTTPException) as ctx:
                auth.verify_token(token)
        self.assertEqual(ctx.exception.status_code, 401)

    def test_rejects_garbage_token(self):
        with self.assertRaises(HTTPException) as ctx:
            auth.verify_token("not-a-real-token")
        self.assertEqual(ctx.exception.status_code, 401)


if __name__ == "__main__":
    unittest.main()
