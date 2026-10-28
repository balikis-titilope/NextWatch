# Rationale: 0010. TV show support

## Context

NextWatch's entire pipeline, from TMDB fetching through the database to the recommendation engine, is built only for movies. `search_tmdb_movie` (`backend/recommend.py`) calls TMDB's `/search/movie` exclusively; the local dataset (`movies_test.csv`, soon `movies.csv`), the `movies` Postgres table, and every embedding are movie only. A TV series can never resolve, even on an exact title match, because it lives in TMDB's separate `/search/tv` catalog, one this codebase never queries.

This was flagged after a real user searched three real titles ("The Manipulated", "Moon Lovers: Scarlet Heart Ryeo") that all turned out to be TV series, not movies, and none could be found, rated, or recommended. The product's own framing ("NextWatch helps people decide what to watch next") never promised movies only; the gap is a genuine correctness bug in a system that quietly assumed its content was one type forever.

The core technical forces at play: TMDB movie IDs and TV IDs are separate namespaces (the same numeric id can be a completely different movie and TV show), the recommendation engine works over one flat in memory dataframe and one aligned embedding matrix rather than relational queries at request time, and the mobile app's types and screens (`MovieDetail`, `MovieCard`, the `/movie/[id]` route) assume "movie" as both the display concept and the identifier shape. Any fix has to resolve the id collision problem, decide whether movies and TV shows share one taste vector or two, and decide how far "support" goes: just fixing search, or genuine parity across every surface a movie already works on.

## Options considered

### Option 1: Extend the existing `movies` table (shared table, composite key)

Add `media_type` as part of the primary key on the existing `movies` table, reuse columns whose meaning transfers directly between the two types (`release_date` holds first_air_date, `director` holds creator), and add a small number of new nullable columns for genuinely TV only facts (season/episode counts, status). `ratings` gains a matching `media_type` column and a composite foreign key. The recommendation engine's single dataframe and embedding matrix absorb both types with no change to how ranking works.

**Pros**:
- The recommendation engine already works over one flat dataframe and one embedding matrix; a shared table needs no merge step to feed it, since that's already the source it reads
- Ratings, notifications, and every other table that references "the rated thing" keep a single, simple foreign key shape instead of a polymorphic association
- Nearly every code path that already works correctly for movies (filters, the Ratings tab, PosterCard, trending) needs no branching, since it already just reads generic columns

**Cons**:
- TV only columns are null on every movie row and vice versa, a normalization compromise a strict schema purist would flag
- Reusing `release_date`/`director` for a different real world concept (first_air_date/creator) is not self documenting; needs an explicit comment where the columns are defined

### Option 2: Separate `tv_shows` table with a polymorphic ratings reference

A second table, structurally independent from `movies`, holding only TV rows and TV specific columns. `ratings` would need either two nullable foreign key columns (`movie_id`, `tv_id`) with a check constraint enforcing exactly one set, or an exclusion constraint pattern.

**Pros**:
- Textbook normalization: no nullable columns for a concept the row's own type doesn't have
- Each table's schema reads cleanly on its own, no reused columns with a second meaning

**Cons**:
- The recommendation engine would still need one merged dataframe and one embedding matrix to rank across both types (Home's mixed rows, cross type similar items, one taste vector), so the separate tables buy nothing at the layer that actually does the ranking, they only add a concatenation step on every load
- Every query that touches "the rated thing" (ratings joins, `upsert_movie`, `get_movie_by_id`) becomes more complex: either a polymorphic foreign key with a check constraint, or two separate code paths merged at the application layer
- More new schema surface overall for a system whose actual access pattern (search, recommend, rate) treats both types identically almost everywhere

### Option 3: Single column surrogate key (an encoded id string)

Keep `movies`' primary key as one column, but store a TV row under a synthesized string id (e.g. "tv:1399") instead of the raw TMDB id, so `id` alone stays unique and every existing single column id lookup, ON CONFLICT clause, and join keeps working unmodified.

**Pros**:
- Removes this spec's own biggest stated cost directly: no existing id based function (`upsert_movie`, `get_movie_by_id`, every ratings join) needs a composite key change
- A smaller looking migration: one column stays, no primary key swap, no composite foreign key

**Cons**:
- The stored id is no longer the real TMDB id; every place that talks to TMDB directly (re fetching a cached row, watch provider links, debugging a specific title) has to parse the prefix back out first, a permanent, easy to forget footgun
- Filtering or joining by media_type alone (the Browse filter chip, the unified /recommend ranking) still needs a string parse or a derived column, quietly reintroducing most of the complexity it claimed to avoid
- Mixing a real numeric id and a synthetic string id in the same column is an implicit, undocumented encoding, harder for a future engineer to trust than a documented composite key with an explicit media_type column

## Rationale

Option 1 wins because this system's real bottleneck for "clean design" is not the Postgres schema, it is the recommendation engine's in memory shape: one dataframe, one embedding matrix, indexed by row position. That structure is single table by nature no matter what Postgres looks like underneath it. Splitting the source tables would only add a merge step on every server startup and every live resolve, for a normalization benefit that the engine itself can never actually take advantage of, since it flattens everything back into one array regardless.

The real cost of Option 2 shows up in `ratings`, the one table that actually needs to point at "the rated thing." A polymorphic foreign key (two nullable columns plus a check constraint, or an exclusion constraint) is a genuinely harder pattern to get right and to query than the single composite foreign key Option 1 uses, and that complexity would propagate into every place ratings gets joined, not just the schema definition.

Option 1's real cost, the handful of nullable TV only columns and the reused `release_date`/`director` meaning, is small and contained: three integer columns, and one documented convention. That is a fair trade for keeping the recommendation engine, the ratings foreign key, and most of the existing filter/display code completely unchanged.

Option 3 (a synthetic prefixed id) was also weighed as a way to dodge a composite key entirely. It trades the composite key's explicit, self documenting shape for an implicit string encoding that still has to be unpacked everywhere media_type actually matters (filtering, ranking, a direct TMDB call). It does not remove the complexity this decision has to account for, it just hides it in a string format instead of a schema, which is a worse trade, not a free one.
