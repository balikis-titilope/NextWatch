// Mirrors backend/main.py's MeResponse (spec 0004; email added for the
// Profile screen, design.md §6.9; notification_prefs added by spec 0006;
// deactivated_at added by spec 0009). email is null only in the unlikely
// case the account's JWT carries no email claim. deactivated_at is an ISO
// timestamp during the 30 day account-deletion grace period, null while
// the account is active.
export interface Me {
  user_id: string;
  email: string | null;
  onboarding_completed: boolean;
  notification_prefs: NotificationPrefs;
  deactivated_at: string | null;
}

// Mirrors backend/main.py's NotificationPrefs (spec 0006 AC-7) -- both
// keys are always present, defaulting to true for every account.
export interface NotificationPrefs {
  recommendations_ready: boolean;
  re_engagement: boolean;
}

// Mirrors GET /me/notifications's per-row shape (backend/main.py, spec
// 0006 AC-3). type is an application-level enum, not yet a union here
// since the notifications screen only needs to display it, not branch on it.
export interface Notification {
  id: number;
  type: "recommendations_ready" | "re_engagement";
  title: string;
  body: string;
  read_at: string | null;
  created_at: string;
}

// Mirrors the response shape shared by /auth/login, /auth/refresh, and
// /auth/verify-signup in backend/main.py.
export interface AuthResponse {
  access_token: string;
  refresh_token: string;
  user_id: string;
}

// Mirrors POST /auth/signup's discriminated response (spec 0004): a
// session comes back immediately when the Supabase project doesn't
// require email confirmation, otherwise the account needs the confirm
// email flow before it has one.
export type SignupResponse =
  ({ status: "ok" } & AuthResponse) | { status: "confirmation_required"; email: string };

// Mirrors POST /auth/request-password-reset's request body (backend/main.py, spec 0007).
export interface RequestPasswordResetRequest {
  email: string;
}

// Mirrors POST /auth/reset-password's request body (backend/main.py, spec
// 0007) -- new_password's 8 character minimum is enforced both here
// (client side, fast feedback) and server side (the check that holds).
export interface ResetPasswordRequest {
  email: string;
  token: string;
  new_password: string;
}

// A row's media type (spec 0010): TV support extends the existing movie
// system rather than a separate parallel one -- every card/detail/search
// shape below carries this discriminator, since a movie and a TV show
// can share the same raw TMDB id.
export type MediaType = "movie" | "tv";

// Mirrors GET /movies/search's per-row shape (backend/main.py, spec 0010).
export interface MovieSearchResult {
  id: number;
  media_type: MediaType;
  title: string;
  release_date: string | null;
  poster_path: string | null;
}

// Mirrors POST /movies/resolve's response shape (backend/main.py, spec
// 0010) -- note the id field is named movie_id here, unlike
// MovieSearchResult's id.
export interface ResolvedMovie {
  movie_id: number;
  media_type: MediaType;
  title: string;
  release_date: string | null;
  poster_path: string | null;
}

// Mirrors GET /movies's per-row shape (backend/main.py, design.md §6.5,
// spec 0010). genres is the raw pipe-separated string backend/recommend.py
// stores it as (e.g. "Action|Adventure"), not pre-split.
export interface BrowseMovie {
  id: number;
  media_type: MediaType;
  title: string;
  original_language: string;
  release_date: string | null;
  genres: string | null;
  poster_path: string | null;
  // Only on personalized browse (GET /movies?personalized=true, signed in with
  // a usable taste signal): the user's match score, null for a title with no
  // embedding yet.
  predicted_score?: number | null;
}

// Mirrors GET /me/ratings's per-row shape (backend/main.py, design.md
// §6.8, spec 0010). rated_at is an ISO timestamp (ratings.created_at) --
// the row's "Date rated" caption.
export interface RatingEntry {
  movie_id: number;
  media_type: MediaType;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  rating: number;
  rated_at: string;
}

// Mirrors POST /recommend's request body (backend/main.py) -- every field
// is optional/defaulted server side. Mood Discovery only ever sends
// mood_text, mood_weight, and top_n; the rest exist so this stays a
// faithful mirror of the Pydantic model per AGENTS.md §9.
export interface RecommendRequest {
  liked_titles?: string[];
  mood_text?: string | null;
  mood_weight?: number;
  top_n?: number;
  language?: string | null;
  actor?: string | null;
  start_year?: number | null;
  end_year?: number | null;
}

// The shared card shape (spec 0005, media_type added by spec 0010)
// returned by /recommend, GET /movies/trending, and GET
// /movies/{media_type}/{id}/similar. predicted_score means "match to your
// own taste" (0-100) on the first two and on GET /movies/{media_type}/{id}'s
// own score, but "closeness to the source title" (also 0-100, not
// calibrated to you) on the similar route -- same shape, deliberately
// different meaning depending on which call made it. Always null, never
// 0, when there's no basis to compute a score yet.
export interface MovieCard {
  id: number;
  media_type: MediaType;
  title: string;
  release_date: string | null;
  poster_path: string | null;
  predicted_score: number | null;
  // Only GET /movies/trending sends this (Home's hero carousel); null until
  // that title's details are loaded.
  backdrop_path?: string | null;
}

// Mirrors GET /movies/{media_type}/{id}'s cast entries (backend/recommend.py's
// cast_photos_json) -- unlike BrowseMovie's cast, these carry a photo.
export interface CastMember {
  name: string;
  profile_path: string | null;
}

export interface WatchProvider {
  name: string | null;
  logo_path: string | null;
}

// Mirrors GET /movies/{media_type}/{id}'s watch_providers, already
// resolved server side to the requesting user's own country (spec 0005
// AC-7).
export interface WatchProviders {
  stream: WatchProvider[];
  rent: WatchProvider[];
  buy: WatchProvider[];
}

// Mirrors GET /movies/{media_type}/{id}'s full response shape
// (backend/main.py, spec 0005 AC-5, extended for TV by spec 0010 AC-4).
// For a TV row, release_date holds first_air_date and director holds
// creator(s) -- the backend reuses those columns rather than adding
// parallel ones; render them with type-appropriate labels based on
// media_type. status/number_of_seasons/number_of_episodes/episode_runtime
// are always present but only meaningfully populated for a TV row (null
// on a movie).
export interface MovieDetail {
  id: number;
  media_type: MediaType;
  title: string;
  tagline: string | null;
  overview: string | null;
  genres: string[];
  release_date: string | null;
  runtime: number | null;
  status: string | null;
  number_of_seasons: number | null;
  number_of_episodes: number | null;
  episode_runtime: number | null;
  original_language: string | null;
  poster_path: string | null;
  backdrop_path: string | null;
  predicted_score: number | null;
  cast: CastMember[];
  director: string[];
  trailer_key: string | null;
  watch_providers: WatchProviders;
  user_rating: number | null;
}
