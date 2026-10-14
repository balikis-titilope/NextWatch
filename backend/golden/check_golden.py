"""
golden/check_golden.py

Checks the Postgres recommendation engine against the frozen answers of the
old in memory engine (spec 0013, AC-3):

    python -m golden.check_golden

The golden file was made over data/movies_test.csv, but the database now holds
a much bigger catalog, so this script ranks inside a transaction where a
temporary copy of `movies` holds only the golden dataset's rows (a temporary
table shadows the real one for unqualified names). Nothing real is read for
ranking beyond that copy and nothing is written; the transaction is rolled
back.

The copy's embeddings are recomputed from the CSV text, the same way the golden
file was made. The live catalog's stored text has drifted from the CSV for some
rows (TMDB genres and keywords change), so using the stored vectors would
measure that drift, not the engine. This check is about the engine: the SQL
ranking, the filters, the exclusion of rated titles, and the taste math.

Passes when, for every case, the top 10 ids match the golden list. Titles
whose similarity is within 0.001 of each other may swap order (and so may
trade places at the cut off).
"""

import json
import os
import sys

import numpy as np
import pandas as pd
from dotenv import load_dotenv
from psycopg2.extras import execute_values

load_dotenv()
os.environ.setdefault("TMDB_TOKEN", "golden-script-unused")  # recommend.py insists on one at import

import recommend as r  # noqa: E402
from db.catalog import Embedder, build_combined_text, vector_literal  # noqa: E402
from db.engine import fetch_rated_embeddings, rank_titles  # noqa: E402
from db.pool import connection  # noqa: E402

HERE = os.path.dirname(__file__)
GOLDEN_PATH = os.path.join(HERE, "recommend_top10.json")
TOLERANCE = 0.001

def load_golden_dataset(path):
    """The golden dataset's rows with the text the golden file was made from."""
    df = pd.read_csv(path)
    df["media_type"] = df["media_type"].fillna("movie") if "media_type" in df.columns else "movie"
    df["combined_text"] = [build_combined_text(row) for _, row in df.iterrows()]
    return df

def same_top10(golden, got):
    """Same ids, allowing order swaps and cut off trades inside the tolerance."""
    golden_sims = [g["similarity"] for g in golden]
    got_sims = [g["similarity"] for g in got]
    if len(golden) != len(got):
        return False
    if any(abs(a - b) > TOLERANCE for a, b in zip(golden_sims, got_sims)):
        return False
    golden_ids = {(g["id"], g["media_type"]) for g in golden}
    got_ids = {(g["id"], g["media_type"]) for g in got}
    if golden_ids == got_ids:
        return True
    cut = min(golden_sims) if golden_sims else 0
    for g in golden:
        if (g["id"], g["media_type"]) not in got_ids and abs(g["similarity"] - cut) > TOLERANCE:
            return False
    return True

def filtered_case_ok(case, got):
    """
    The old engine had a bug in filtered cases: it excluded rated titles by
    their position in the full table while ranking inside the filtered subset,
    so it returned titles the user had rated and dropped unrelated ones. The
    golden file froze that. The right answer is checked instead: no rated
    title comes back, and every golden title that is valid (not rated) is
    still there with the same similarity.
    """
    rated = {(x["id"], x["media_type"]) for x in case["ratings"]}
    got_by_key = {(x["id"], x["media_type"]): x["similarity"] for x in got}
    if any(key in rated for key in got_by_key):
        return False
    for g in case["top10"]:
        key = (g["id"], g["media_type"])
        if key in rated:
            continue
        if key not in got_by_key or abs(got_by_key[key] - g["similarity"]) > TOLERANCE:
            return False
    return True

def main():
    with open(GOLDEN_PATH, encoding="utf-8") as f:
        golden = json.load(f)
    df = load_golden_dataset(os.path.join(os.path.dirname(HERE), golden["source"]))
    model = Embedder()
    embeddings = model.encode(df["combined_text"].tolist())
    keys = [(int(i), t) for i, t in zip(df["id"], df["media_type"])]
    failures = 0

    with connection() as conn, conn.cursor() as cur:
        cur.execute(
            """
            CREATE TEMP TABLE movies ON COMMIT DROP AS
            SELECT m.* FROM public.movies m
            JOIN unnest(%s::int[], %s::text[]) AS k(id, media_type)
              ON k.id = m.id AND k.media_type = m.media_type
            """,
            ([k[0] for k in keys], [k[1] for k in keys]),
        )
        execute_values(
            cur,
            "UPDATE movies m SET embedding = v.embedding::extensions.vector "
            "FROM (VALUES %s) AS v(id, media_type, embedding) WHERE m.id = v.id AND m.media_type = v.media_type",
            [(i, t, vector_literal(e)) for (i, t), e in zip(keys, embeddings)],
        )
        cur.execute("SELECT count(*), count(embedding) FROM movies")
        total, embedded = cur.fetchone()
        print(f"golden dataset rows found in the database: {total} of {len(keys)} ({embedded} with an embedding)")

        # Rated titles come from the golden case, not from a real user.
        cur.execute("CREATE TEMP TABLE ratings (user_id uuid, movie_id int, media_type text, rating int) ON COMMIT DROP")
        user = "00000000-0000-0000-0000-00000000aaaa"

        for case in golden["cases"]:
            cur.execute("TRUNCATE ratings")
            for rating in case["ratings"]:
                cur.execute(
                    "INSERT INTO ratings VALUES (%s, %s, %s, %s)",
                    (user, rating["id"], rating["media_type"], rating["rating"]),
                )
            rows = fetch_rated_embeddings(cur, user)
            taste = r.taste_vector_from_rows(rows)
            mood = r.build_mood_vector(case["mood_text"], model) if case["mood_text"] else None
            if taste is None and mood is None:
                got = []
            else:
                query = r.combine_vectors(taste, mood, case["mood_weight"])
                ranked = rank_titles(
                    cur, query, top_n=10, user_id=user,
                    language=case["language"], start_year=case["start_year"], end_year=case["end_year"],
                )
                got = [{"id": x["id"], "media_type": x["media_type"], "similarity": x["similarity"]} for x in ranked]
            filtered = case["language"] or case["start_year"] or case["end_year"]
            ok = filtered_case_ok(case, got) if filtered else same_top10(case["top10"], got)
            failures += 0 if ok else 1
            print(f"{'PASS' if ok else 'FAIL'}  {case['name']}")
            if not ok:
                print("   golden:", [(g["id"], round(g["similarity"], 4)) for g in case["top10"]])
                print("   got:   ", [(g["id"], round(g["similarity"], 4)) for g in got])

    print(f"{len(golden['cases']) - failures} of {len(golden['cases'])} cases match the golden file")
    return 1 if failures else 0

if __name__ == "__main__":
    sys.exit(main())
