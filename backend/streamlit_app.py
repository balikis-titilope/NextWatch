import os
import requests
import streamlit as st

try:
    from recommend import (
        load_and_prepare_data,
        load_model,
        generate_embeddings,
        build_title_index,
        build_user_profile,
        recommend_for_user,
        recommend_popular,
        build_mood_vector,
        combine_vectors,
        filter_by_language,
        filter_by_actor,
        filter_by_year_range,
    )
except Exception as exc:  # pragma: no cover - app startup safety
    load_and_prepare_data = None
    load_model = None
    generate_embeddings = None
    build_title_index = None
    build_user_profile = None
    recommend_for_user = None
    recommend_popular = None
    build_mood_vector = None
    combine_vectors = None
    filter_by_language = None
    filter_by_actor = None
    filter_by_year_range = None
    RECOMMEND_IMPORT_ERROR = exc
else:
    RECOMMEND_IMPORT_ERROR = None


API_BASE = os.getenv("API_BASE", "http://127.0.0.1:8000")


st.set_page_config(page_title="NextWatch", page_icon="🎬", layout="wide")
st.title("NextWatch")
st.caption("Movie recommendations, search, mood discovery, and watchlist flows in one app.")


if "user_id" not in st.session_state:
    st.session_state.user_id = None
if "selected_movie" not in st.session_state:
    st.session_state.selected_movie = None
if "watchlist" not in st.session_state:
    st.session_state.watchlist = []
if "search_results" not in st.session_state:
    st.session_state.search_results = []
if "selected_movie_detail" not in st.session_state:
    st.session_state.selected_movie_detail = None


@st.cache_resource
def load_recommendation_state():
    """Load the core recommendation model once per Streamlit session."""
    if load_and_prepare_data is None:
        raise RuntimeError(str(RECOMMEND_IMPORT_ERROR))

    df = load_and_prepare_data()
    model = load_model()
    embeddings = generate_embeddings(df, model)
    title_to_index = build_title_index(df)
    return df, model, embeddings, title_to_index


def api_request(method: str, path: str, payload: dict | None = None, params: dict | None = None):
    """Hit the FastAPI backend if it is running; otherwise return None."""
    try:
        response = requests.request(
            method=method,
            url=f"{API_BASE}{path}",
            json=payload,
            params=params,
            timeout=10,
        )
        response.raise_for_status()
        return response.json()
    except Exception:
        return None


def ensure_user_created():
    """Create a user record in the backend if possible, otherwise keep a local guest session."""
    if st.session_state.user_id is not None:
        return

    result = api_request("POST", "/users")
    if result and "user_id" in result:
        st.session_state.user_id = result["user_id"]
    else:
        st.session_state.user_id = "guest"


def render_movie_cards(rows, key_prefix: str):
    """Render a simple card-style list of movie titles plus a detail button."""
    if not rows:
        return

    for row in rows:
        title = row.get("title") or row.get("movie_title") or "Untitled"
        with st.container():
            col1, col2 = st.columns([4, 1])
            with col1:
                st.markdown(f"### {title}")
                if isinstance(row, dict):
                    details = []
                    for field in ["release_date", "original_language", "genres", "vote_average"]:
                        if row.get(field) not in (None, ""):
                            details.append(f"**{field.replace('_', ' ').title()}:** {row[field]}")
                    if details:
                        st.write(" | ".join(details))
            with col2:
                if st.button("Details", key=f"{key_prefix}_{title}"):
                    st.session_state.selected_movie = title
                    st.session_state.selected_movie_detail = row


with st.sidebar:
    st.header("Session")
    if st.session_state.user_id is None:
        if st.button("Create user session"):
            ensure_user_created()
            if st.session_state.user_id == "guest":
                st.info("Backend not reachable, using a local guest session.")
            else:
                st.success(f"User {st.session_state.user_id} created.")
    else:
        st.success(f"Session user: {st.session_state.user_id}")

    st.header("Controls")
    top_n = st.slider("Recommended items", min_value=3, max_value=20, value=8)
    mood_weight = st.slider("Mood blend", min_value=0.0, max_value=1.0, value=0.5, step=0.05)


if RECOMMEND_IMPORT_ERROR is not None:
    st.error(
        "The recommendation engine could not be loaded yet. This usually means the local environment is missing the required Python packages or TMDB settings."
    )
    st.write(RECOMMEND_IMPORT_ERROR)
    st.stop()


with st.spinner("Loading recommendation engine..."):
    df, model, embeddings, title_to_index = load_recommendation_state()


home_tab, search_tab, mood_tab, watchlist_tab, onboarding_tab = st.tabs([
    "Home / For You",
    "Search",
    "Mood Discovery",
    "Watchlist",
    "Rate Movies",
])


with home_tab:
    st.subheader("Personalized recommendations")
    liked_titles = st.text_area(
        "Liked movies (one per line)",
        placeholder="Inception\nThe Dark Knight\nSpider-Man: Into the Spider-Verse",
        height=120,
    )
    liked_titles = [line.strip() for line in liked_titles.splitlines() if line.strip()]

    if st.button("Generate For You feed", type="primary"):
        payload = {"user_id": st.session_state.user_id, "top_n": top_n} if st.session_state.user_id not in (None, "guest") else {"top_n": top_n}
        result = api_request("POST", "/recommend", payload=payload)

        if result:
            st.dataframe(result, use_container_width=True)
        else:
            if not liked_titles:
                results = recommend_popular(df, top_n=top_n)
                st.dataframe(results, use_container_width=True)
            else:
                try:
                    current_df, current_embeddings, current_title_to_index, user_embedding, liked_indices = build_user_profile(
                        liked_titles,
                        df,
                        embeddings,
                        title_to_index,
                        model,
                    )
                    results = recommend_for_user(
                        user_embedding,
                        current_df,
                        current_embeddings,
                        top_n=top_n,
                        exclude_indices=liked_indices,
                    )
                    st.dataframe(results, use_container_width=True)
                except Exception as exc:
                    st.error(f"Could not build a personalized feed: {exc}")


with search_tab:
    st.subheader("Search a movie")
    language = st.text_input("Language code", placeholder="en")
    actor = st.text_input("Actor", placeholder="Tom Hanks")
    start_year = st.number_input("Start year", min_value=1900, max_value=2100, value=1900)
    end_year = st.number_input("End year", min_value=1900, max_value=2100, value=2100)

    if st.button("Browse movies"):
        params = {
            "language": language or None,
            "actor": actor or None,
            "start_year": start_year if start_year != 1900 else None,
            "end_year": end_year if end_year != 2100 else None,
            "limit": top_n,
        }
        result = api_request("GET", "/movies", params={k: v for k, v in params.items() if v is not None})

        if result:
            st.session_state.search_results = result
            render_movie_cards(result, key_prefix="search")
        else:
            filtered_df = filter_by_language(df, language or None)
            filtered_df = filter_by_actor(filtered_df, actor or None)
            filtered_df = filter_by_year_range(
                filtered_df,
                start_year if start_year != 1900 else None,
                end_year if end_year != 2100 else None,
            )
            st.session_state.search_results = filtered_df[["title", "release_date", "original_language", "genres"]].head(top_n).to_dict(orient="records")
            render_movie_cards(st.session_state.search_results, key_prefix="search_local")

    if st.session_state.selected_movie:
        st.markdown("---")
        st.subheader(f"Movie detail: {st.session_state.selected_movie}")
        if st.session_state.selected_movie_detail:
            selected = st.session_state.selected_movie_detail
            for field in ["overview", "genres", "release_date", "original_language", "vote_average"]:
                if selected.get(field) not in (None, ""):
                    st.write(f"**{field.replace('_', ' ').title()}:** {selected[field]}")

        similar = api_request("GET", f"/movies/{st.session_state.selected_movie}/similar", params={"top_n": top_n})
        if similar:
            st.write("### Similar movies")
            st.dataframe(similar, use_container_width=True)
        else:
            st.info("Similar-movies endpoint is not reachable right now; the app is still using the local movie shell.")

        if st.button("Add selected movie to watchlist"):
            if st.session_state.selected_movie not in st.session_state.watchlist:
                st.session_state.watchlist.append(st.session_state.selected_movie)
                st.success("Added to watchlist.")


with mood_tab:
    st.subheader("Mood discovery")
    mood_text = st.text_input("How are you feeling?", placeholder="I want a cozy, fun, and uplifting movie")

    if st.button("Recommend by mood"):
        if not mood_text.strip():
            st.warning("Enter a mood description to continue.")
        else:
            payload = {"mood_text": mood_text, "mood_weight": mood_weight, "top_n": top_n}
            if st.session_state.user_id not in (None, "guest"):
                payload["user_id"] = st.session_state.user_id

            result = api_request("POST", "/recommend", payload=payload)
            if result:
                st.dataframe(result, use_container_width=True)
            else:
                mood_embedding = build_mood_vector(mood_text, model)
                blended_embedding = combine_vectors(
                    user_embedding=None,
                    mood_embedding=mood_embedding,
                    mood_weight=mood_weight,
                )
                results = recommend_for_user(blended_embedding, df, embeddings, top_n=top_n)
                st.dataframe(results, use_container_width=True)


with watchlist_tab:
    st.subheader("Watchlist")
    if st.session_state.watchlist:
        st.write("Saved movies for later:")
        for item in st.session_state.watchlist:
            st.markdown(f"- {item}")
    else:
        st.info("Your watchlist is empty right now.")


with onboarding_tab:
    st.subheader("Rate a few movies to reduce the cold start")
    sample_movies = df[["title", "genres", "release_date"]].head(6).to_dict(orient="records")
    render_movie_cards(sample_movies, key_prefix="onboarding")

    if st.session_state.selected_movie:
        rating_value = st.slider(
            "Rate selected movie",
            min_value=1,
            max_value=5,
            value=3,
            key="onboarding_rating",
        )

        if st.button("Save rating"):
            if st.session_state.user_id in (None, "guest"):
                ensure_user_created()

            if st.session_state.user_id not in (None, "guest"):
                movie_id = None
                for row in df.to_dict(orient="records"):
                    if row.get("title") == st.session_state.selected_movie:
                        movie_id = row.get("id")
                        break

                if movie_id is not None:
                    result = api_request(
                        "POST",
                        "/ratings",
                        payload={
                            "user_id": st.session_state.user_id,
                            "movie_id": movie_id,
                            "rating": int(rating_value),
                        },
                    )
                    if result:
                        st.success(f"Saved rating for {st.session_state.selected_movie}.")
                    else:
                        st.info("Backend rating endpoint is not reachable yet. The UI is ready for the next backend integration step.")
                else:
                    st.warning("That selected title could not be mapped to a movie id in the local dataset.")


st.markdown("---")
st.subheader("App wiring summary")
st.write(
    "This version is now wired toward the real app flow: create or reuse a user session, call /recommend for home and mood, call /movies for search, surface a selected movie detail view, and prepare the ratings flow for your onboarding path."
)
