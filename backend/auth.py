"""
auth.py
Thin proxy to Supabase Auth (signup/login) plus local JWT verification.

Why proxy instead of having the app call Supabase directly: every other
piece of this app talks only to our own FastAPI backend — keeping auth
behind the same door means the mobile app only ever needs one base URL,
and we're free to change auth providers later without touching the client.

Verifying tokens locally against Supabase's JWKS (via PyJWKClient, which
caches the fetched public keys) instead of calling Supabase on every
request keeps auth checks fast without a network round trip per protected
endpoint. This project's Supabase instance uses the newer asymmetric JWT
Signing Keys (ES256), not the legacy shared HS256 secret.
"""

import os
import requests
import jwt
from jwt import PyJWKClient
from dotenv import load_dotenv
from fastapi import Header, HTTPException, status

from db.import_data import get_connection

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
# Used only by the daily purge job (spec 0009) to hard-delete a Supabase
# Auth user via the Admin API -- never referenced by the mobile app or any
# EXPO_PUBLIC_ variable. Not enforced at import time like the two above:
# the purge job is the only caller, and a missing key should fail that one
# job (logged, per-account, see delete_auth_user) rather than crash the
# whole server on startup before the engineer has configured it.
SUPABASE_SERVICE_ROLE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")

if not (SUPABASE_URL and SUPABASE_ANON_KEY):
    raise ValueError(
        "SUPABASE_URL and SUPABASE_ANON_KEY must both be set. Check your "
        ".env file (find these in Supabase → Project Settings → API)."
    )

_jwks_client = PyJWKClient(f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json")

AUTH_HEADERS = {
    "apikey": SUPABASE_ANON_KEY,
    "Content-Type": "application/json",
}

# ---------- SIGNUP / LOGIN (proxied to Supabase Auth's REST API) ----------

def sign_up(email: str, password: str) -> dict:
    """
    Create a new Supabase Auth user. Returns Supabase's raw response —
    contains access_token/refresh_token (if email confirmation is off in
    the Supabase project) and the new user's id (a UUID) under
    response["user"]["id"].
    """
    response = requests.post(
        f"{SUPABASE_URL}/auth/v1/signup",
        headers=AUTH_HEADERS,
        json={"email": email, "password": password},
        timeout=15,
    )
    if response.status_code >= 400:
        raise HTTPException(
            status_code=response.status_code,
            detail=response.json().get("msg", "Signup failed"),
        )
    return response.json()

def sign_in(email: str, password: str) -> dict:
    """
    Log in an existing user. Returns access_token/refresh_token/user.

    An account that exists but hasn't confirmed its email yet gets its own
    403 with error_code="email_not_confirmed" (Supabase's own code, passed
    through) instead of the generic 401 -- a wrong password and an
    unconfirmed account need different recovery paths on the client
    (spec 0004, AC-16).

    A rejected password IS an auth failure and maps to 401, but a
    Supabase 5xx/timeout/rate-limit does NOT mean the credentials were
    wrong -- same distinction refresh_access_token already draws, and for
    the same reason: this grant type shares Supabase's /auth/v1/token
    endpoint (and its rate limit bucket) with grant_type=refresh_token, so
    a burst of refresh attempts can leave the endpoint rate-limited right
    when the client falls back to a fresh login. Reporting that as
    "Invalid email or password" told users their real password was wrong
    when it was Supabase asking them to wait.
    """
    try:
        response = requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=password",
            headers=AUTH_HEADERS,
            json={"email": email, "password": password},
            timeout=15,
        )
    except requests.RequestException:
        raise HTTPException(status_code=503, detail="Auth provider unreachable")

    if response.status_code >= 400:
        try:
            body = response.json()
        except ValueError:
            body = {}
        if body.get("error_code") == "email_not_confirmed":
            raise HTTPException(
                status_code=403,
                detail={
                    "message": "Confirm your email before logging in.",
                    "error_code": "email_not_confirmed",
                },
            )
        if response.status_code == 429 or response.status_code >= 500:
            raise HTTPException(status_code=503, detail="Auth provider unavailable")
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return response.json()

# Supabase Auth's (GoTrue) actual error_code values for a rejected refresh
# token -- not the OAuth2-style "invalid_grant" this project's spec used as
# loose shorthand. See https://supabase.com/docs/guides/auth/debugging/error-codes
# refresh_token_not_found / refresh_token_already_used: a well-formed token
# that's expired, revoked, or already rotated. validation_failed: the token
# fails basic input validation (missing, malformed, not even token-shaped) --
# confirmed live against Supabase, e.g. {"refresh_token": "garbage"} ->
# 400 {"error_code": "validation_failed", "msg": "Refresh token is not valid"}.
# All three mean the credential itself is bad (AC-4's "invalid, expired, or
# revoked"), never a transient/network condition.
REJECTED_REFRESH_TOKEN_CODES = {
    "refresh_token_not_found",
    "refresh_token_already_used",
    "validation_failed",
}

def refresh_access_token(refresh_token: str) -> dict:
    """
    Exchange a refresh token for a new access/refresh token pair. Needs
    its own error mapping, unlike sign_in above: sign_in collapses every
    non-2xx into 401 because a login attempt failing IS an auth failure,
    but here a Supabase 5xx/timeout/rate-limit must NOT read the same way
    -- that would force-log-out every signed in user during a transient
    Supabase outage and delete their still-valid refresh credential in
    the process (spec 0004). Only an explicit rejection of the credential
    itself (REJECTED_REFRESH_TOKEN_CODES) maps to 401; anything else
    Supabase or the network returns maps to 503.
    """
    try:
        response = requests.post(
            f"{SUPABASE_URL}/auth/v1/token?grant_type=refresh_token",
            headers=AUTH_HEADERS,
            json={"refresh_token": refresh_token},
            timeout=15,
        )
    except requests.RequestException:
        raise HTTPException(status_code=503, detail="Auth provider unreachable")

    if response.status_code >= 400:
        try:
            body = response.json()
        except ValueError:
            body = {}
        error_code = str(body.get("error_code") or body.get("error") or "")
        if response.status_code in (400, 401) and error_code in REJECTED_REFRESH_TOKEN_CODES:
            raise HTTPException(status_code=401, detail="Invalid or expired refresh token")
        raise HTTPException(status_code=503, detail="Auth provider unavailable")

    return response.json()

def verify_signup_code(email: str, token: str) -> dict:
    """
    Confirm a signup with the numeric code Supabase emailed (spec 0004,
    AC-13/AC-14). No bearer token here either -- the code itself is the
    credential, same trust level as sign_up/sign_in. On success, returns
    the same access_token/refresh_token/user shape as sign_in.
    """
    try:
        response = requests.post(
            f"{SUPABASE_URL}/auth/v1/verify",
            headers=AUTH_HEADERS,
            json={"type": "signup", "email": email, "token": token},
            timeout=15,
        )
    except requests.RequestException:
        raise HTTPException(status_code=503, detail="Auth provider unreachable")

    if response.status_code >= 400:
        try:
            body = response.json()
        except ValueError:
            body = {}
        # Supabase's own error_code, passed through rather than
        # reinterpreted (spec 0004) -- falls back to "otp_invalid" only
        # when Supabase's response doesn't carry one at all.
        error_code = body.get("error_code") or "otp_invalid"
        raise HTTPException(
            status_code=400,
            detail={
                "message": "That code isn't valid. Check it or request a new one.",
                "error_code": error_code,
            },
        )
    return response.json()

def resend_confirmation_code(email: str) -> None:
    """
    Ask Supabase for a fresh signup confirmation code (spec 0004, AC-15).
    Deliberately looks identical to the caller whether the email is
    registered, already confirmed, or unknown -- the caller always gets
    {"status": "ok"} for anything but Supabase's own rate limit, so this
    never becomes an email-enumeration channel.
    """
    try:
        response = requests.post(
            f"{SUPABASE_URL}/auth/v1/resend",
            headers=AUTH_HEADERS,
            json={"type": "signup", "email": email},
            timeout=15,
        )
    except requests.RequestException:
        raise HTTPException(status_code=503, detail="Auth provider unreachable")

    if response.status_code == 429:
        raise HTTPException(status_code=429, detail="Too many requests. Wait a bit before trying again.")
    # Any other non-2xx (unknown email, already confirmed, etc.) is
    # swallowed by design -- see the docstring above.

# ---------- PASSWORD RESET (spec 0007) ----------

def check_email_registered(email: str) -> bool:
    """
    Read-only lookup against Supabase's own auth.users table, over this
    backend's existing DATABASE_URL connection (the same one
    db/import_data.py uses) -- no Supabase Auth API call, no new
    credential. Unlike resend_confirmation_code, this endpoint
    deliberately reveals whether an email is registered (AC-3), so this
    function is allowed to answer that question directly.
    """
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 FROM auth.users WHERE lower(email) = lower(%s)", (email,))
            return cur.fetchone() is not None
    finally:
        conn.close()

def send_password_reset(email: str) -> None:
    """
    Ask Supabase to email a 6-digit recovery code (AC-2), same 429/503
    handling as resend_confirmation_code. Only called after
    check_email_registered confirms the account exists.
    """
    try:
        response = requests.post(
            f"{SUPABASE_URL}/auth/v1/recover",
            headers=AUTH_HEADERS,
            json={"email": email},
            timeout=15,
        )
    except requests.RequestException:
        raise HTTPException(status_code=503, detail="Auth provider unreachable")

    if response.status_code == 429:
        raise HTTPException(status_code=429, detail="Too many requests. Wait a bit before trying again.")
    if response.status_code >= 500:
        raise HTTPException(status_code=503, detail="Auth provider unavailable")

def verify_recovery_code(email: str, token: str) -> dict:
    """
    Verify the recovery code Supabase emailed (AC-6/AC-7), same shape and
    error mapping as verify_signup_code but type="recovery". On success,
    returns the same access_token/refresh_token/user shape sign_in does --
    that access token is the credential finish_password_reset uses to
    actually change the password. The code is single use: once this call
    succeeds, Supabase will not verify the same code again.
    """
    try:
        response = requests.post(
            f"{SUPABASE_URL}/auth/v1/verify",
            headers=AUTH_HEADERS,
            json={"type": "recovery", "email": email, "token": token},
            timeout=15,
        )
    except requests.RequestException:
        raise HTTPException(status_code=503, detail="Auth provider unreachable")

    if response.status_code >= 400:
        try:
            body = response.json()
        except ValueError:
            body = {}
        error_code = body.get("error_code") or "otp_invalid"
        raise HTTPException(
            status_code=400,
            detail={
                "message": "That code isn't valid. Check it or request a new one.",
                "error_code": error_code,
            },
        )
    return response.json()

def finish_password_reset(access_token: str, new_password: str) -> dict:
    """
    Set the new password (AC-6) using the access token verify_recovery_code
    just returned, then revoke every other session for the account (AC-12)
    via Supabase's own scope=others logout. A same_password rejection from
    Supabase maps to 400 here. If the sign-out-others call fails after the
    password update already succeeded, that failure is logged, not raised
    -- a session cleanup hiccup must never look like the password reset
    itself failed (spec 0007's failure-isolation invariant).
    """
    try:
        response = requests.put(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={**AUTH_HEADERS, "Authorization": f"Bearer {access_token}"},
            json={"password": new_password},
            timeout=15,
        )
    except requests.RequestException:
        raise HTTPException(
            status_code=503,
            detail="Couldn't update your password. Request a new code and try again.",
        )

    if response.status_code >= 400:
        try:
            body = response.json()
        except ValueError:
            body = {}
        error_code = str(body.get("error_code") or body.get("code") or "")
        message = str(body.get("msg") or body.get("message") or "")
        if error_code == "same_password" or "different from the old password" in message.lower():
            raise HTTPException(
                status_code=400,
                detail={
                    "message": "Choose a different password.",
                    "error_code": "same_password",
                },
            )
        if response.status_code == 429:
            raise HTTPException(status_code=429, detail="Too many requests. Wait a bit before trying again.")
        raise HTTPException(
            status_code=503,
            detail="Couldn't update your password. Request a new code and try again.",
        )

    result = response.json()

    try:
        requests.post(
            f"{SUPABASE_URL}/auth/v1/logout?scope=others",
            headers={**AUTH_HEADERS, "Authorization": f"Bearer {access_token}"},
            timeout=15,
        )
    except requests.RequestException as error:
        print(f"[auth] failed to revoke other sessions after password reset: {error}")

    return result

# ---------- ACCOUNT DEACTIVATION / DELETION (spec 0009) ----------

def sign_out_everywhere(access_token: str) -> None:
    """
    Revoke every session for the account, on every device (AC-2) --
    scope=global, unlike finish_password_reset's scope=others, since the
    whole point of deactivation is to sign the account out everywhere,
    not just elsewhere. Same failure isolation as finish_password_reset's
    own sign-out call: logged, not raised, so a logout hiccup never masks
    an already-successful deactivation.
    """
    try:
        requests.post(
            f"{SUPABASE_URL}/auth/v1/logout?scope=global",
            headers={**AUTH_HEADERS, "Authorization": f"Bearer {access_token}"},
            timeout=15,
        )
    except requests.RequestException as error:
        print(f"[auth] failed to revoke all sessions during deactivation: {error}")

def delete_auth_user(user_id: str) -> None:
    """
    Hard-delete a Supabase Auth user via the Admin API (AC-7) -- the
    daily purge job's call, authenticated with SUPABASE_SERVICE_ROLE_KEY
    rather than a user's own bearer token. public.users' id column
    references auth.users(id) ON DELETE CASCADE, so this single call
    cascades down through public.users, then ratings and notifications
    (both ON DELETE CASCADE on users(id) as of spec 0009's migration) --
    no separate Postgres DELETE needed here. Raises on any failure; the
    purge job catches and logs per account so one failure doesn't stop
    the rest of the run.
    """
    if not SUPABASE_SERVICE_ROLE_KEY:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is not set -- cannot purge accounts.")
    response = requests.delete(
        f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
        headers={
            "apikey": SUPABASE_SERVICE_ROLE_KEY,
            "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        },
        timeout=15,
    )
    if response.status_code >= 400:
        raise RuntimeError(f"Supabase Admin API delete failed ({response.status_code}): {response.text}")

# ---------- TOKEN VERIFICATION ----------

def verify_token(token: str) -> dict:
    """
    Verify a Supabase-issued JWT locally and return its payload. Raises
    401 if the token is missing, expired, or invalid. Supabase JWTs are
    signed with this project's ES256 JWT Signing Key and always set
    aud="authenticated" for logged-in users; PyJWKClient fetches and
    caches the matching public key (by the token's "kid") from Supabase's
    JWKS endpoint.
    """
    try:
        signing_key = _jwks_client.get_signing_key_from_jwt(token)
        return jwt.decode(token, signing_key.key, algorithms=["ES256"], audience="authenticated")
    except jwt.PyJWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

def _extract_user_id(authorization: str) -> str:
    token = authorization.removeprefix("Bearer ").strip()
    payload = verify_token(token)
    return payload["sub"]  # Supabase auth.users UUID

def get_current_user_id(authorization: str | None = Header(default=None)) -> str:
    """
    FastAPI dependency for endpoints that REQUIRE a logged-in user (e.g.
    rating a movie, reading rating history). Use as:
        user_id: str = Depends(get_current_user_id)
    Raises 401 if there's no valid bearer token — never trust a
    client-supplied user_id for anything that reads or writes a specific
    user's data.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    return _extract_user_id(authorization)

def get_current_active_user_id(authorization: str | None = Header(default=None)) -> str:
    """
    Same bearer-token verification as get_current_user_id, plus a 403 if
    the account is currently deactivated (spec 0009 AC-3) -- the gate
    swapped onto every existing protected write endpoint except
    /me/deactivate and /me/reactivate themselves (a deactivated account
    must still be able to reactivate). GET /me and POST /auth/refresh
    stay on the plain get_current_user_id too, since a deactivated
    account still needs both to reach the reactivate prompt (spec's
    Value sourcing table).
    """
    user_id = get_current_user_id(authorization)
    conn = get_connection()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT deactivated_at FROM users WHERE id = %s", (user_id,))
            row = cur.fetchone()
    finally:
        conn.close()
    if row and row[0] is not None:
        raise HTTPException(status_code=403, detail="This account has been deactivated.")
    return user_id

def get_current_user_email(authorization: str | None = Header(default=None)) -> str | None:
    """
    Same bearer-token verification as get_current_user_id, but returns the
    account's email claim instead -- Profile screen display only
    (design.md §6.9), never used to authorize a request.
    """
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    token = authorization.removeprefix("Bearer ").strip()
    payload = verify_token(token)
    return payload.get("email")

def get_optional_user_id(authorization: str | None = Header(default=None)) -> str | None:
    """
    Same idea, but for endpoints that work both logged-in and anonymous
    (e.g. /recommend, which also supports an ad-hoc liked_titles mode for
    quick testing without an account). Returns None instead of raising
    when there's no token, rather than blocking the request.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return _extract_user_id(authorization)
