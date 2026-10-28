"""
test_embedder.py
Tests for the background model loader (spec 0013, AC-7). No model is ever
downloaded: the loader's factory is replaced with a fake.

Run: .venv\\Scripts\\python.exe -m unittest test_embedder -v
"""

import os
import threading
import time
import unittest
from unittest.mock import patch

from db import embedder


def wait_until(condition, seconds=5):
    deadline = time.time() + seconds
    while time.time() < deadline:
        if condition():
            return True
        time.sleep(0.01)
    return False


class EmbedderTests(unittest.TestCase):
    def setUp(self):
        embedder.reset_for_tests()
        self.addCleanup(embedder.reset_for_tests)
        self.addCleanup(setattr, embedder, "_factory", embedder._factory)

    def test_preload_defaults_to_on_and_can_be_switched_off(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop("EMBEDDING_PRELOAD", None)
            self.assertTrue(embedder.preload_enabled())
        for value in ("false", "False", "0", "no", "off"):
            with patch.dict(os.environ, {"EMBEDDING_PRELOAD": value}):
                self.assertFalse(embedder.preload_enabled())
        with patch.dict(os.environ, {"EMBEDDING_PRELOAD": "true"}):
            self.assertTrue(embedder.preload_enabled())

    def test_starting_a_load_returns_at_once_without_waiting_for_the_model(self):
        release = threading.Event()
        def slow_factory():
            release.wait(5)
            return object()
        embedder._factory = slow_factory

        started = time.time()
        self.assertTrue(embedder.start_background_load())
        self.assertLess(time.time() - started, 1)
        self.assertTrue(embedder.is_loading())
        self.assertFalse(embedder.is_ready())

        release.set()
        self.assertTrue(wait_until(embedder.is_ready))
        self.assertFalse(embedder.is_loading())

    def test_a_second_start_while_loading_does_not_start_another_load(self):
        release = threading.Event()
        calls = []
        def factory():
            calls.append(1)
            release.wait(5)
            return object()
        embedder._factory = factory

        self.assertTrue(embedder.start_background_load())
        self.assertFalse(embedder.start_background_load())
        release.set()
        self.assertTrue(wait_until(embedder.is_ready))
        self.assertEqual(len(calls), 1)
        self.assertFalse(embedder.start_background_load())  # already loaded

    def test_get_model_raises_while_not_ready_and_starts_a_load(self):
        release = threading.Event()
        embedder._factory = lambda: (release.wait(5), object())[1]

        with self.assertRaises(embedder.ModelNotReady):
            embedder.get_model()
        self.assertTrue(embedder.is_loading())
        release.set()
        self.assertTrue(wait_until(embedder.is_ready))
        self.assertIsNotNone(embedder.get_model())

    def test_peek_model_never_raises_and_starts_a_load_when_missing(self):
        embedder._factory = lambda: object()
        embedder.peek_model()  # None or the model, depending on the thread; never an error
        self.assertTrue(wait_until(embedder.is_ready))
        self.assertIsNotNone(embedder.peek_model())

    def test_a_failed_load_is_logged_clears_loading_and_the_next_need_retries(self):
        attempts = []
        release = threading.Event()
        def flaky():
            attempts.append(1)
            if len(attempts) == 1:
                raise RuntimeError("download failed")
            release.wait(5)
            return object()
        embedder._factory = flaky

        embedder.start_background_load()
        self.assertTrue(wait_until(lambda: not embedder.is_loading() and len(attempts) == 1))
        self.assertFalse(embedder.is_ready())  # a failure never crashes, it just stays not ready

        with self.assertRaises(embedder.ModelNotReady):
            embedder.get_model()  # the next need starts a new load
        release.set()
        self.assertTrue(wait_until(embedder.is_ready))
        self.assertEqual(len(attempts), 2)


if __name__ == "__main__":
    unittest.main()
