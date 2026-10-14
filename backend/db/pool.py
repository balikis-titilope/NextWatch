"""
db/pool.py

Pooled database access for the read and write paths (spec 0013, AC-15).

    from db.pool import connection

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(...)

At most POOL_SIZE connections are open at once. A caller that finds them all
busy waits up to WAIT_SECONDS for one instead of failing at once, then gets
PoolTimeout. A connection is checked alive before it is handed out (a dead
one is thrown away and replaced), and is always committed or rolled back
before it goes back to the pool.

Two choices come from measuring the Supabase pooler (about 1 to 2 seconds to
open a connection, 0.3 seconds for one round trip):
- New connections are opened outside any lock, so several callers open theirs
  at the same time instead of one after another.
- The liveness check only runs on a connection that sat idle for
  IDLE_CHECK_SECONDS or more. A connection used a moment ago is trusted, and
  a failure on it still surfaces as an error and the connection is dropped.

Kept free of side effects on import: DATABASE_URL is read on first use, so a
script or a test can import this without the full app configuration.
DATABASE_URL must be the session pooler URL.
"""

import os
import threading
import time
from collections import deque
from contextlib import contextmanager

import psycopg2

POOL_SIZE = 5             # spec 0013: maximum connections
WAIT_SECONDS = 5          # spec 0013: how long a caller waits for a free one
IDLE_CHECK_SECONDS = 10   # check a connection is alive if it sat idle this long


class PoolTimeout(Exception):
    """No connection became free within WAIT_SECONDS."""


_slots = threading.BoundedSemaphore(POOL_SIZE)  # one per connection in use or being opened
_idle = deque()                                 # (connection, time it was returned)
_idle_lock = threading.Lock()


def _connect():
    url = os.getenv("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not found. Check your .env file.")
    return psycopg2.connect(url)


def _is_alive(conn):
    """A cheap round trip. The transaction it opens is closed straight away."""
    if conn.closed:
        return False
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
        conn.rollback()
        return True
    except (psycopg2.OperationalError, psycopg2.InterfaceError):
        return False


def _discard(conn):
    try:
        conn.close()
    except Exception:
        pass


def _checkout():
    """A live connection: a recent idle one, a checked older one, or a new one."""
    while True:
        with _idle_lock:
            entry = _idle.pop() if _idle else None  # newest first, so old ones age out
        if entry is None:
            return _connect()
        conn, returned_at = entry
        if conn.closed:
            continue
        if time.monotonic() - returned_at < IDLE_CHECK_SECONDS or _is_alive(conn):
            return conn
        _discard(conn)


def _checkin(conn, ok):
    """Commit (ok) or roll back, then keep the connection for the next caller."""
    if not conn.closed:
        try:
            conn.commit() if ok else conn.rollback()
        except (psycopg2.OperationalError, psycopg2.InterfaceError):
            pass
    if conn.closed:
        return
    with _idle_lock:
        _idle.append((conn, time.monotonic()))


@contextmanager
def connection():
    """
    A pooled connection for one unit of work. Commits when the block ends
    normally, rolls back when it raises, and always returns the connection.
    """
    if not _slots.acquire(timeout=WAIT_SECONDS):
        raise PoolTimeout(f"No database connection free after {WAIT_SECONDS} seconds")
    try:
        conn = _checkout()
        ok = False
        try:
            yield conn
            ok = True
        finally:
            _checkin(conn, ok)
    finally:
        _slots.release()


def warm_up(count=POOL_SIZE):
    """
    Open `count` connections in parallel and park them idle, so the first
    real requests do not queue behind a cold start (a new connection takes
    1 to 4 seconds to the Supabase pooler). Meant for a background thread at
    server startup; a failure is the caller's to log.
    """
    barrier = threading.Barrier(count)
    errors = []

    def open_one():
        try:
            with connection():
                barrier.wait(timeout=WAIT_SECONDS * 3)  # all held at once, so all are new
        except Exception as exc:
            barrier.abort()
            errors.append(exc)

    threads = [threading.Thread(target=open_one) for _ in range(count)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    if errors:
        raise errors[0]


def close_pool():
    """Close every idle connection (server shutdown, and tests)."""
    with _idle_lock:
        entries = list(_idle)
        _idle.clear()
    for conn, _ in entries:
        _discard(conn)
