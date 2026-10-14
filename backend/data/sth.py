python -c 

import os, json
files = [
    'data/discovered_movies.json',
    'data/discovered_movies_test.json',
    'data/fetch_progress.json',
    'data/fetch_progress_test.json'
]
for f in files:
    exists = os.path.exists(f)
    size = os.path.getsize(f) if exists else 0
    print(f'{f}: exists={exists}, size={size} bytes')
