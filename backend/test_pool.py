"""
test_pool.py
Unit tests for db/pool.py (spec 0013, AC-15): the wait for a free connection,
the liveness check, and commit or rollback on every return. The Postgres
pool is replaced by a small fake -- no database connection is made.

Run: .venv\\Scripts\\python.exe -m unittest test_pool -v
"""

import threading
import time
import unittest
from unittest.mock import patch

import psycopg2

from db import pool


class FakeConn:
    def __init__(self, alive=True):
        self.alive = alive
        self.closed = 0
        self.commits = 0
        self.rollbacks = 0
        self.checks = 0

    def cursor(self):
        conn = self

        class Cur:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql):
                conn.checks += 1
                if not conn.alive:
                    raise psycopg2.OperationalError("server closed the connection")

        return Cur()

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def close(self):
        self.closed = 1


class PoolTests(unittest.TestCase):
    def setUp(self):
        pool.close_pool()
        self.opened = []
        self.in_use = 0
        self.max_in_use = 0
        self._lock = threading.Lock()

        def connect():
            conn = FakeConn()
            self.opened.append(conn)
            return conn

        patcher = patch.object(pool, "_connect", side_effect=connect)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(pool.close_pool)

    def test_commits_when_the_block_succeeds(self):
        with pool.connection() as conn:
            pass
        self.assertEqual(conn.commits, 1)

    def test_rolls_back_and_reraises_when_the_block_fails(self):
        with self.assertRaises(ValueError):
            with pool.connection() as conn:
                raise ValueError("boom")
        self.assertEqual(conn.commits, 0)
        self.assertEqual(conn.rollbacks, 1)

    def test_a_recent_connection_is_reused_without_a_check(self):
        with pool.connection() as first:
            pass
        with pool.connection() as second:
            pass
        self.assertIs(first, second)
        self.assertEqual(second.checks, 0)

    def test_an_idle_connection_is_checked_before_use(self):
        with pool.connection() as first:
            pass
        with patch.object(pool, "IDLE_CHECK_SECONDS", 0):
            with pool.connection() as second:
                pass
        self.assertIs(first, second)
        self.assertEqual(second.checks, 1)

    def test_a_dead_idle_connection_is_discarded_and_replaced(self):
        with pool.connection() as dead:
            pass
        dead.alive = False
        with patch.object(pool, "IDLE_CHECK_SECONDS", 0):
            with pool.connection() as fresh:
                pass
        self.assertIsNot(fresh, dead)
        self.assertEqual(dead.closed, 1)

    def test_a_connection_that_broke_in_use_is_not_kept(self):
        with pool.connection() as conn:
            conn.closed = 2
        with pool.connection() as next_conn:
            pass
        self.assertIsNot(next_conn, conn)

    def test_waits_for_a_free_connection_then_times_out(self):
        held = []
        with patch.object(pool, "WAIT_SECONDS", 0.2):
            for _ in range(pool.POOL_SIZE):
                cm = pool.connection()
                cm.__enter__()
                held.append(cm)
            start = time.monotonic()
            with self.assertRaises(pool.PoolTimeout):
                with pool.connection():
                    pass
            self.assertGreaterEqual(time.monotonic() - start, 0.2)
        for cm in held:
            cm.__exit__(None, None, None)
        with pool.connection():  # slots all came back
            pass

    def test_more_callers_than_connections_all_succeed(self):
        results = []

        def work():
            with pool.connection():
                with self._lock:
                    self.in_use += 1
                    self.max_in_use = max(self.max_in_use, self.in_use)
                time.sleep(0.05)
                with self._lock:
                    self.in_use -= 1
            results.append(True)

        threads = [threading.Thread(target=work) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(len(results), 8)
        self.assertLessEqual(self.max_in_use, pool.POOL_SIZE)
        self.assertLessEqual(len(self.opened), pool.POOL_SIZE)

    def test_warm_up_opens_every_connection_and_parks_them(self):
        pool.warm_up()
        self.assertEqual(len(self.opened), pool.POOL_SIZE)
        with pool.connection():
            pass
        self.assertEqual(len(self.opened), pool.POOL_SIZE)

    def test_a_failed_connect_gives_the_slot_back(self):
        with patch.object(pool, "_connect", side_effect=RuntimeError("DATABASE_URL not found")):
            for _ in range(pool.POOL_SIZE + 1):
                with self.assertRaises(RuntimeError):
                    with pool.connection():
                        pass
        with pool.connection():
            pass


if __name__ == "__main__":
    unittest.main()
