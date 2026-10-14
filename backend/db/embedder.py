"""
db/embedder.py

The one process wide embedding model (spec 0013, AC-7). It loads in a
background thread so the server is ready at once, and a request that needs a
vector while it is not ready gets ModelNotReady (the API turns that into a 503
with Retry-After) instead of waiting.

    from db.embedder import get_model, ModelNotReady

    model = get_model()        # the loaded model, or raises ModelNotReady
    model = peek_model()       # the loaded model, or None (never raises)

A request that finds the model missing starts a background load if none is
running, in both modes. A failed load is logged and clears the loading flag, so
the next need starts a new one. Nothing here ever crashes the server.

Kept free of side effects on import: the model is only built when a load starts.
"""

import os
import threading

from db.catalog import Embedder

# How long a client is told to wait before asking again.
RETRY_AFTER_SECONDS = 15

class ModelNotReady(Exception):
    """A vector is needed right now and the embedding model has not finished loading."""

_lock = threading.Lock()
_model = None
_loading = False
_generation = 0  # bumped by reset_for_tests so a load already in flight cannot land afterwards

# Replaced by tests so no real model is ever downloaded.
_factory = Embedder

def preload_enabled():
    """EMBEDDING_PRELOAD: true (the default) loads the model at startup."""
    return os.getenv("EMBEDDING_PRELOAD", "true").strip().lower() not in ("false", "0", "no", "off")

def is_ready():
    return _model is not None

def is_loading():
    return _loading

def _load(factory, generation):
    global _model, _loading
    try:
        model = factory()
        with _lock:
            if generation == _generation:
                _model = model
        print("Embedding model loaded.")
    except Exception as e:
        print(f"Embedding model failed to load: {e}")
    finally:
        with _lock:
            if generation == _generation:
                _loading = False

def start_background_load():
    """Start loading the model in a thread unless it is loaded or already loading. Returns at once."""
    global _loading
    with _lock:
        if _model is not None or _loading:
            return False
        _loading = True
    threading.Thread(target=_load, args=(_factory, _generation), name="embedding-model-load", daemon=True).start()
    return True

def peek_model():
    """The loaded model, or None. When it is missing, starts a background load."""
    if _model is None:
        start_background_load()
    return _model

def get_model():
    """The loaded model. Raises ModelNotReady (after starting a load) when it is not."""
    model = peek_model()
    if model is None:
        raise ModelNotReady("The embedding model is still loading")
    return model

def reset_for_tests():
    """Forget the model and any load in progress."""
    global _model, _loading, _generation
    with _lock:
        _model = None
        _loading = False
        _generation += 1
