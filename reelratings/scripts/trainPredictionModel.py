"""
trainPredictionModel.py

Weekly training script. For each user with matchup history:
  1. Trains a Bradley-Terry model (logistic regression on pairwise feature differences)
  2. Predicts 0-100 scores for watchlist movies, blended with Bayesian-adjusted TMDB score
  3. Computes actor/director affinity scores via residual method
  4. Writes results back to Supabase

Run:   python scripts/trainPredictionModel.py
Deps:  pip install supabase pandas scikit-learn python-dotenv numpy
"""

import os
import sys
import numpy as np
import pandas as pd
from collections import Counter
from datetime import datetime, timezone
from sklearn.linear_model import LogisticRegression, Ridge
from sklearn.preprocessing import StandardScaler
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

# ── Config ────────────────────────────────────────────────────────────────────

SUPABASE_URL = os.environ.get("EXPO_PUBLIC_SUPABASE_URL")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")

if not SUPABASE_URL or not SERVICE_ROLE_KEY:
    print("ERROR: Missing EXPO_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    sys.exit(1)

MIN_MATCHUPS_FOR_BT = 10      # Users below this threshold get pure TMDB-based predictions
MIN_PERSON_MOVIES = 3         # Minimum rated movies per actor/director to store an affinity score
COLD_START_FULL_WEIGHT = 50   # BT weight reaches 1.0 at this matchup count
TOP_KEYWORDS_COUNT = 50       # How many most-common keywords to use as features
MIN_VOTES_BAYESIAN = 100      # m in Bayesian rating formula (minimum vote threshold)

supabase = create_client(SUPABASE_URL, SERVICE_ROLE_KEY)


# ── Data fetching ─────────────────────────────────────────────────────────────

def fetch_movies():
    """Fetch all movies with their feature columns."""
    resp = supabase.from_("movies").select(
        "id, genres, runtime, release_date, original_language, "
        "vote_average, vote_count, keywords, certification, top_cast, director"
    ).execute()
    return resp.data or []

def fetch_matchups():
    """Fetch all matchups across all users."""
    resp = supabase.from_("matchups").select(
        "user_id, movie_a_id, movie_b_id, winner_id"
    ).execute()
    return resp.data or []

def fetch_user_movies():
    """Fetch all user_movies rows (both watched and watchlist)."""
    resp = supabase.from_("user_movies").select(
        "user_id, movie_id, status, elo, matchup_count"
    ).execute()
    return resp.data or []


# ── Feature engineering ───────────────────────────────────────────────────────

def get_global_genres(movies):
    """Collect all unique genre names across the full movie database."""
    genres = set()
    for m in movies:
        for g in (m.get("genres") or []):
            if isinstance(g, dict) and g.get("name"):
                genres.add(g["name"])
            elif isinstance(g, str) and g:
                genres.add(g)
    return sorted(genres)

def get_top_keywords(movies, n=TOP_KEYWORDS_COUNT):
    """Return the N most common keyword names across all movies."""
    counter = Counter()
    for m in movies:
        for kw in (m.get("keywords") or []):
            if kw.get("name"):
                counter[kw["name"]] += 1
    return [name for name, _ in counter.most_common(n)]

def cert_to_ordinal(cert):
    """Map MPAA certification to an ordinal number."""
    return float({"G": 0, "PG": 1, "PG-13": 2, "R": 3, "NC-17": 4}.get(cert or "", 2))

def release_decade_feature(release_date):
    """
    Convert release date to a normalized decade feature.
    Centered at 2000s so that: 1980s = -2.0, 2000s = 0.0, 2020s = 2.0
    """
    try:
        year = int(str(release_date)[:4])
        decade = (year // 10) * 10
        return float(decade - 2000) / 10.0
    except Exception:
        return 0.0  # fallback to ~year 2000

def bayesian_tmdb_score(vote_avg, vote_count, global_mean, m=MIN_VOTES_BAYESIAN):
    """
    Bayesian-adjusted TMDB score, normalized to 0-100.
    Prevents movies with very few votes from having outsized scores.
    Formula: (m * C + v * R) / (m + v), where C = global mean, R = movie rating
    """
    if not vote_avg or not vote_count:
        return (global_mean / 10.0) * 100.0
    adjusted = (m * global_mean + vote_count * vote_avg) / (m + vote_count)
    return (adjusted / 10.0) * 100.0  # TMDB is 0-10, convert to 0-100

def build_feature_df(movie_ids, movie_lookup, global_genres, top_keywords, global_mean_vote):
    """
    Build a feature DataFrame with one row per movie.
    Features: genre multi-hot, runtime, release decade, language, certification,
              Bayesian TMDB score, keyword multi-hot.
    """
    rows = []
    index = []

    for mid in movie_ids:
        m = movie_lookup.get(str(mid), {})
        row = {}

        # Genres (multi-hot encoded) — handle both {id, name} objects and plain strings
        raw_genres = m.get("genres") or []
        movie_genres = set()
        for g in raw_genres:
            if isinstance(g, dict) and g.get("name"):
                movie_genres.add(g["name"])
            elif isinstance(g, str) and g:
                movie_genres.add(g)
        for g in global_genres:
            row[f"g_{g}"] = 1.0 if g in movie_genres else 0.0

        # Runtime in minutes (default 90 if missing)
        row["runtime"] = float(m.get("runtime") or 90)

        # Release decade (normalized)
        row["decade"] = release_decade_feature(m.get("release_date"))

        # Language: binary English vs. non-English
        row["is_english"] = 1.0 if m.get("original_language") == "en" else 0.0

        # MPAA certification (ordinal: G=0 to NC-17=4, unknown=2)
        row["certification"] = cert_to_ordinal(m.get("certification"))

        # Bayesian-adjusted TMDB community score
        row["tmdb_score"] = bayesian_tmdb_score(
            m.get("vote_average"), m.get("vote_count"), global_mean_vote
        )

        # Keywords (multi-hot for top N most common)
        movie_keywords = {kw["name"] for kw in (m.get("keywords") or [])}
        for kw in top_keywords:
            row[f"kw_{kw}"] = 1.0 if kw in movie_keywords else 0.0

        rows.append(row)
        index.append(str(mid))

    return pd.DataFrame(rows, index=index)


# ── Per-user model ────────────────────────────────────────────────────────────

def process_user(user_id, matchups, user_movies, feature_df_scaled, movie_lookup, global_mean_tmdb):
    """
    Train BT model and compute affinity scores for a single user.

    Returns:
      predicted_scores: dict {movie_id: score (0-100)} for watchlist movies
      actor_scores:     dict {actor_name: (score, movie_count)}
      director_scores:  dict {director_name: (score, movie_count)}
    """
    rated = [um for um in user_movies if um["status"] == "watched"]
    watchlist = [um for um in user_movies if um["status"] == "watchlist"]
    total_matchups = sum(r.get("matchup_count", 0) for r in rated)

    # Compute Bayesian TMDB score for every watchlist movie (used for cold start)
    tmdb_scores = {}
    for um in watchlist:
        mid = str(um["movie_id"])
        m = movie_lookup.get(mid, {})
        tmdb_scores[mid] = bayesian_tmdb_score(
            m.get("vote_average"), m.get("vote_count"), global_mean_tmdb
        )

    # Not enough matchups — return pure TMDB predictions
    if total_matchups < MIN_MATCHUPS_FOR_BT:
        return {mid: round(s, 1) for mid, s in tmdb_scores.items()}, {}, {}

    # ── Build pairwise training data ──────────────────────────────────────────
    # Each matchup becomes two rows (winner→loser=1, loser→winner=0) for symmetry
    X_rows, y_rows = [], []
    for match in matchups:
        winner = str(match["winner_id"])
        a, b = str(match["movie_a_id"]), str(match["movie_b_id"])
        loser = b if a == winner else a

        if winner not in feature_df_scaled.index or loser not in feature_df_scaled.index:
            continue

        diff = feature_df_scaled.loc[winner].values - feature_df_scaled.loc[loser].values
        X_rows.append(diff)    # winner − loser → preferred
        y_rows.append(1)
        X_rows.append(-diff)   # loser − winner → not preferred
        y_rows.append(0)

    if len(X_rows) < MIN_MATCHUPS_FOR_BT * 2:
        return {mid: round(s, 1) for mid, s in tmdb_scores.items()}, {}, {}

    X = np.array(X_rows)
    y = np.array(y_rows)

    # ── Fit Bradley-Terry model ───────────────────────────────────────────────
    # Logistic regression with no intercept: this IS the BT model.
    # Coefficients represent how much each feature drives preference.
    bt = LogisticRegression(fit_intercept=False, max_iter=1000, C=1.0)
    bt.fit(X, y)
    coef = bt.coef_[0]

    # ── Compute BT strength scores for ALL movies in the database ────────────
    # Strength = dot(coefficients, scaled_features)
    # Higher strength → predicted to win more matchups → user prefers this movie
    all_ids = list(feature_df_scaled.index)
    if not all_ids:
        return {mid: round(s, 1) for mid, s in tmdb_scores.items()}, {}, {}

    strengths = feature_df_scaled.loc[all_ids].values @ coef
    s_min, s_max = strengths.min(), strengths.max()
    if s_max > s_min:
        bt_normalized = (strengths - s_min) / (s_max - s_min) * 100.0
    else:
        bt_normalized = np.full(len(strengths), 50.0)
    bt_scores = dict(zip(all_ids, bt_normalized))

    # ── Cold start blend for ALL movies ──────────────────────────────────────
    # w = 0 → pure TMDB (0 matchups)
    # w = 1 → pure BT  (50+ matchups)
    w = min(1.0, total_matchups / COLD_START_FULL_WEIGHT)
    predicted = {}
    for mid in all_ids:
        m = movie_lookup.get(mid, {})
        tmdb_s = bayesian_tmdb(m.get("vote_average"), m.get("vote_count"), global_mean_tmdb)
        bt_s = bt_scores.get(mid, tmdb_s)
        predicted[mid] = round(w * bt_s + (1 - w) * tmdb_s, 1)

    # ── Residual-based actor/director affinity scores ─────────────────────────
    rated_ids = [str(r["movie_id"]) for r in rated if str(r["movie_id"]) in feature_df_scaled.index]

    if len(rated_ids) < MIN_MATCHUPS_FOR_BT:
        return predicted, {}, {}

    rated_dict = {str(r["movie_id"]): r for r in rated}
    elo_values = np.array([float(rated_dict[mid]["elo"]) for mid in rated_ids])

    # Baseline Ridge regression: predict ELO from features alone (no person identity)
    # Residual = actual ELO − predicted ELO
    # A positive residual means the movie beat feature-based expectations → good for actors/directors in it
    X_rated = feature_df_scaled.loc[rated_ids].values
    baseline = Ridge(alpha=1.0)
    baseline.fit(X_rated, elo_values)
    residuals = elo_values - baseline.predict(X_rated)
    residual_map = dict(zip(rated_ids, residuals))
    matchup_count_map = {mid: rated_dict[mid].get("matchup_count", 1) for mid in rated_ids}

    def compute_affinity(person_key):
        """Compute affinity scores for actors or directors."""
        person_movies = {}  # name → list of (residual, matchup_count)
        for mid in rated_ids:
            m = movie_lookup.get(mid, {})
            for person in (m.get(person_key) or []):
                person_movies.setdefault(person, []).append(
                    (residual_map[mid], matchup_count_map[mid])
                )

        scores = {}
        for person, items in person_movies.items():
            if len(items) < MIN_PERSON_MOVIES:
                continue
            res_arr = np.array([r for r, _ in items])
            wt_arr = np.array([wt for _, wt in items], dtype=float)
            score = round(float(np.average(res_arr, weights=wt_arr)), 2)
            scores[person] = (score, len(items))

        return scores

    actor_scores = compute_affinity("top_cast")
    director_scores = compute_affinity("director")

    return predicted, actor_scores, director_scores


# ── Supabase writes ───────────────────────────────────────────────────────────

def write_predicted_scores(user_id, predicted_scores, watchlist_ids: set):
    """
    Write predictions to two places:
      1. movie_predictions — all movies (used by person detail screen etc.)
      2. user_movies.predicted_score — watchlist movies only (used by watchlist screen)
    """
    if not predicted_scores:
        return

    now = datetime.now(timezone.utc).isoformat()

    # Write all predictions to movie_predictions table
    # Batch in chunks of 500 to avoid request size limits
    all_rows = [
        {"user_id": user_id, "movie_id": mid, "score": score, "updated_at": now}
        for mid, score in predicted_scores.items()
    ]
    chunk_size = 500
    for i in range(0, len(all_rows), chunk_size):
        supabase.from_("movie_predictions").upsert(
            all_rows[i:i + chunk_size], on_conflict="user_id,movie_id"
        ).execute()

    # Also write to user_movies.predicted_score for watchlist items (backward compat)
    watchlist_rows = [
        {"user_id": user_id, "movie_id": mid, "predicted_score": score}
        for mid, score in predicted_scores.items()
        if mid in watchlist_ids
    ]
    if watchlist_rows:
        supabase.from_("user_movies").upsert(
            watchlist_rows, on_conflict="user_id,movie_id"
        ).execute()

def write_affinity_scores(user_id, actor_scores, director_scores):
    """Upsert actor and director affinity scores."""
    now = datetime.now(timezone.utc).isoformat()

    if actor_scores:
        actor_rows = [
            {
                "user_id": user_id,
                "actor_name": name,
                "score": score,
                "movie_count": count,
                "updated_at": now,
            }
            for name, (score, count) in actor_scores.items()
        ]
        supabase.from_("actor_affinity_scores").upsert(
            actor_rows, on_conflict="user_id,actor_name"
        ).execute()

    if director_scores:
        director_rows = [
            {
                "user_id": user_id,
                "director_name": name,
                "score": score,
                "movie_count": count,
                "updated_at": now,
            }
            for name, (score, count) in director_scores.items()
        ]
        supabase.from_("director_affinity_scores").upsert(
            director_rows, on_conflict="user_id,director_name"
        ).execute()


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Fetching data from Supabase...")
    movies = fetch_movies()
    matchups = fetch_matchups()
    user_movies = fetch_user_movies()

    if not movies:
        print("No movies found. Exiting.")
        return

    print(f"  {len(movies)} movies, {len(matchups)} matchups, {len(user_movies)} user_movie rows")

    # Build global feature structures
    movie_lookup = {str(m["id"]): m for m in movies}
    global_genres = get_global_genres(movies)
    top_keywords = get_top_keywords(movies)

    # Global mean TMDB vote_average (used in Bayesian adjustment)
    vote_avgs = [m["vote_average"] for m in movies if m.get("vote_average")]
    global_mean_vote = sum(vote_avgs) / len(vote_avgs) if vote_avgs else 7.0
    global_mean_tmdb = (global_mean_vote / 10.0) * 100.0

    print(f"  {len(global_genres)} genres, {len(top_keywords)} keywords used as features")
    print(f"  Global mean TMDB vote: {global_mean_vote:.2f}")

    # Build feature matrix for ALL movies, then scale globally
    print("\nBuilding feature matrix...")
    all_movie_ids = list(movie_lookup.keys())
    feature_df = build_feature_df(
        all_movie_ids, movie_lookup, global_genres, top_keywords, global_mean_vote
    )

    # Scale features globally (fit on all movies so scale is consistent across users)
    scaler = StandardScaler()
    scaled_values = scaler.fit_transform(feature_df.values)
    feature_df_scaled = pd.DataFrame(
        scaled_values, index=feature_df.index, columns=feature_df.columns
    )

    print(f"  Feature matrix: {feature_df_scaled.shape[0]} movies × {feature_df_scaled.shape[1]} features")

    # Group matchups and user_movies by user_id
    matchups_by_user = {}
    for match in matchups:
        uid = match["user_id"]
        matchups_by_user.setdefault(uid, []).append(match)

    user_movies_by_user = {}
    for um in user_movies:
        uid = um["user_id"]
        user_movies_by_user.setdefault(uid, []).append(um)

    # Process each user
    all_users = set(matchups_by_user.keys()) | set(user_movies_by_user.keys())
    print(f"\nProcessing {len(all_users)} users...\n")

    for i, user_id in enumerate(all_users, 1):
        user_matchups = matchups_by_user.get(user_id, [])
        user_um = user_movies_by_user.get(user_id, [])

        watchlist_count = sum(1 for um in user_um if um["status"] == "watchlist")
        rated_count = sum(1 for um in user_um if um["status"] == "watched")
        total_matchups = sum(um.get("matchup_count", 0) for um in user_um if um["status"] == "watched")

        print(f"[{i}/{len(all_users)}] User {user_id[:8]}... "
              f"({rated_count} rated, {watchlist_count} watchlist, {total_matchups} matchups)")

        predicted, actor_scores, director_scores = process_user(
            user_id=user_id,
            matchups=user_matchups,
            user_movies=user_um,
            feature_df_scaled=feature_df_scaled,
            movie_lookup=movie_lookup,
            global_mean_tmdb=global_mean_tmdb,
        )

        watchlist_ids = {str(um["movie_id"]) for um in user_um if um["status"] == "watchlist"}
        write_predicted_scores(user_id, predicted, watchlist_ids)
        write_affinity_scores(user_id, actor_scores, director_scores)

        mode = "BT+TMDB blend" if total_matchups >= MIN_MATCHUPS_FOR_BT else "TMDB only"
        print(f"  → {len(predicted)} predictions ({mode}), "
              f"{len(actor_scores)} actors, {len(director_scores)} directors scored")

    print("\nDone.")

if __name__ == "__main__":
    main()