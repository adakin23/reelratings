# ReelRatings — Project Planning Document

> **Read this at the start of every session** to get oriented quickly.
> Update it whenever a major decision changes.

---

## What This App Does

ReelRatings is a cross-platform mobile app that lets users rank movies through head-to-head matchups. Two movies are shown stacked vertically — the user swipes to pick their favorite. Over time, an ELO rating system builds a personalized ranked list of every movie the user has seen. These ratings are also stored server-side so that, once enough users are on the platform, a global rankings system can be built from the aggregated data.

A machine learning model (Bradley-Terry with Ridge regression) uses each user's pairwise matchup data to predict scores for unseen movies and to generate personal actor/director affinity scores based on their measured contribution to movies the user has enjoyed.

---

## Phases

### Phase 1 — Individual App (current)

Build the full personal experience: matchups, ELO ratings, personal rankings, movie/actor/director pages, watchlist, Letterboxd import, predicted ELO model, streaming services. Collect all matchup data server-side for future use.

### Phase 2 — Global Rankings + Social

Aggregate all user matchup data for global ELO rankings and actor/director ratings. Add shared watchlist / movie picker feature.

---

## Tech Stack

| Layer           | Choice                                           | Reason                                                                                    |
| --------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Framework       | React Native + Expo (SDK 56)                     | Single codebase for iOS and Android.                                                      |
| Language        | TypeScript                                       | Type safety, better tooling.                                                              |
| Routing         | Expo Router (file-based)                         | `src/app` is the root. Tabs under `src/app/(tabs)/`.                                      |
| Backend / DB    | Supabase (PostgreSQL)                            | Relational data fits matchup records. Built-in auth.                                      |
| Auth            | Supabase Auth — Google sign-in                   | Web: full page redirect. Native: WebBrowser + exchangeCodeForSession.                     |
| Movie Data      | TMDB API                                         | Free, comprehensive, includes posters, cast, crew, genres, runtime, streaming providers.  |
| Session Storage | AsyncStorage (native) / detectSessionInUrl (web) | Keeps users logged in.                                                                    |
| App output mode | `"spa"` in app.json                              | Must be "spa" — "static" causes SSR errors.                                               |
| ML Model        | Bradley-Terry + Ridge regression (scikit-learn)  | Designed for pairwise comparison data. Interpretable residuals for actor/director scores. |
| Version Control | GitHub (public repo)                             |                                                                                           |

---

## Project Structure

```
reelratings/
├── .github/
│   └── workflows/
│       └── refresh-movie-data.yml   # Weekly enrichment + BT model training (Mondays 6am UTC)
├── scripts/
│   ├── enrichMovieData.js           # Fetches TMDB metadata for all movies in DB
│   └── trainPredictionModel.py      # Trains Bradley-Terry model, writes predictions + affinity scores
├── reelratings/                     # App source (inner folder — git root is outer reelratings/)
│   ├── src/
│   │   ├── app/                     # Expo Router screens (file-based routing)
│   │   │   ├── _layout.tsx          # Root layout — auth gate
│   │   │   ├── (tabs)/
│   │   │   │   ├── _layout.tsx      # Tab layout — Match, My Rankings, Global, Search
│   │   │   │   ├── index.tsx        # Match tab
│   │   │   │   ├── rankings.tsx     # My Rankings tab
│   │   │   │   ├── global.tsx       # Global Rankings tab
│   │   │   │   └── search.tsx       # Search tab
│   │   │   ├── movie/[id].tsx       # Movie detail page
│   │   │   ├── person/[id].tsx      # Actor/Director detail page
│   │   │   └── import.tsx           # Letterboxd import page
│   │   ├── screens/                 # Full screen components
│   │   │   ├── AuthScreen.tsx
│   │   │   ├── MatchupScreen.tsx
│   │   │   ├── RankingsScreen.tsx
│   │   │   ├── WatchlistScreen.tsx
│   │   │   ├── GlobalScreen.tsx
│   │   │   ├── SearchScreen.tsx
│   │   │   ├── MovieDetailScreen.tsx
│   │   │   ├── PersonDetailScreen.tsx
│   │   │   └── ImportScreen.tsx
│   │   ├── components/
│   │   │   ├── FilterModal.tsx      # Shared filter sheet (Rankings + Watchlist)
│   │   │   └── RangeSlider.tsx
│   │   ├── types/
│   │   │   └── filters.ts           # FilterState type + DEFAULT_FILTERS + countActiveFilters
│   │   └── lib/
│   │       ├── supabase.ts
│   │       ├── tmdb.ts
│   │       └── elo.ts               # ELO calculation and normalization
│   ├── .env                         # API keys (never commit)
│   ├── PLANNING.md                  # This file
│   └── package.json
```

---

## Database Schema

### `profiles`

| Column     | Type      | Notes                                          |
| ---------- | --------- | ---------------------------------------------- |
| id         | uuid      | References auth.users                          |
| username   | text      | Unique. Required for shared watchlist feature. |
| created_at | timestamp |                                                |

### `movies`

| Column            | Type      | Notes                                                                  |
| ----------------- | --------- | ---------------------------------------------------------------------- |
| id                | text      | TMDB movie ID                                                          |
| title             | text      |                                                                        |
| poster_path       | text      |                                                                        |
| release_date      | date      |                                                                        |
| genres            | jsonb     | Array of `{id, name}` objects from TMDB                                |
| runtime           | int       | Minutes                                                                |
| overview          | text      |                                                                        |
| vote_average      | float     | TMDB vote average. Used in prediction model only — not shown to users. |
| vote_count        | int       | TMDB vote count. Used for Bayesian score adjustment in model.          |
| top_cast          | text[]    | Top 10 billed actors from TMDB. Used in prediction model.              |
| director          | text[]    | Director name(s).                                                      |
| keywords          | jsonb     | Array of `{id, name}` TMDB keyword objects. Used in model features.    |
| certification     | text      | US MPAA rating (G, PG, PG-13, R, etc.)                                 |
| watch_providers   | jsonb     | US streaming data from TMDB (flatrate, rent, buy).                     |
| original_language | text      | ISO 639-1 language code (e.g. "en", "fr").                             |
| created_at        | timestamp |                                                                        |

### `user_movies`

| Column          | Type      | Notes                                          |
| --------------- | --------- | ---------------------------------------------- |
| id              | uuid      |                                                |
| user_id         | uuid      | References profiles                            |
| movie_id        | text      | References movies                              |
| elo             | float     | Default 1000                                   |
| matchup_count   | int       |                                                |
| win_count       | int       |                                                |
| loss_count      | int       |                                                |
| status          | enum      | 'watched', 'watchlist', 'do_not_watch'         |
| predicted_score | float     | BT-predicted score for watchlist items (0–100) |
| custom_order    | int       | User-defined sort order for watchlist          |
| last_matchup_at | timestamp |                                                |
| created_at      | timestamp |                                                |

### `matchups`

| Column     | Type      | Notes                            |
| ---------- | --------- | -------------------------------- |
| id         | uuid      |                                  |
| user_id    | uuid      |                                  |
| movie_a_id | text      |                                  |
| movie_b_id | text      |                                  |
| winner_id  | text      |                                  |
| elo_change | float     |                                  |
| created_at | timestamp | Used to plot ELO trend over time |

### `movie_predictions`

Stores Bradley-Terry predicted scores for ALL movies in the database (not just watchlist items).

| Column     | Type      | Notes                       |
| ---------- | --------- | --------------------------- |
| user_id    | uuid      | PRIMARY KEY (with movie_id) |
| movie_id   | text      | PRIMARY KEY (with user_id)  |
| score      | float     | Predicted score 0–100       |
| updated_at | timestamp |                             |

RLS: Users can only select their own rows.

### `actor_affinity_scores`

| Column      | Type      | Notes                                           |
| ----------- | --------- | ----------------------------------------------- |
| user_id     | uuid      | PRIMARY KEY (with actor_name)                   |
| actor_name  | text      | PRIMARY KEY (with user_id)                      |
| score       | float     | Raw residual score (normalized to 0–100 in app) |
| movie_count | int       | Number of rated movies this actor appears in    |
| updated_at  | timestamp |                                                 |

### `director_affinity_scores`

| Column        | Type      | Notes                                           |
| ------------- | --------- | ----------------------------------------------- |
| user_id       | uuid      | PRIMARY KEY (with director_name)                |
| director_name | text      | PRIMARY KEY (with user_id)                      |
| score         | float     | Raw residual score (normalized to 0–100 in app) |
| movie_count   | int       |                                                 |
| updated_at    | timestamp |                                                 |

### `user_elo_history`

Snapshot of a movie's normalized score after each matchup. Used to draw the rating trend chart.

| Column           | Type      | Notes                                            |
| ---------------- | --------- | ------------------------------------------------ |
| id               | uuid      |                                                  |
| user_id          | uuid      |                                                  |
| movie_id         | text      |                                                  |
| normalized_score | float     | 0–100 score at this point in time                |
| matchup_count    | int       | How many matchups the movie had at this snapshot |
| created_at       | timestamp |                                                  |

### RLS Policies

| Table             | Policy                                 | Rule                            |
| ----------------- | -------------------------------------- | ------------------------------- |
| movies            | Authenticated users can insert movies  | `auth.role() = 'authenticated'` |
| movies            | Authenticated users can update movies  | `auth.role() = 'authenticated'` |
| user_movies       | Users can insert their own movies      | `auth.uid() = user_id`          |
| user_movies       | Users can select their own movies      | `auth.uid() = user_id`          |
| user_movies       | Users can update their own user_movies | `auth.uid() = user_id`          |
| movie_predictions | Users can read own predictions         | `auth.uid() = user_id`          |

---

## ELO System

- **Starting ELO:** 1000 for every movie
- **K-factor:** Variable — K=32 for first 10 matchups, K=24 for matchups 11–20, K=16 for 21+
  - _To adjust thresholds: change the `getKFactor(matchupCount)` function in `src/lib/elo.ts`_
- **Display:** ELO normalized to 0–100 across the user's library. Scores shift as the library grows.
- **Pairing:** Hybrid model — semi-random when matchup count is low (establishes baseline fast), shifts toward similar-ELO opponents as count grows (improves convergence accuracy)
  - _To adjust crossover point: change `PAIRING_RANDOM_THRESHOLD` in `MatchupScreen.tsx`_

### ELO Formula

```
Expected A = 1 / (1 + 10^((ELO_B - ELO_A) / 400))
New ELO_A = ELO_A + K * (result - Expected A)
// result = 1 for win, 0 for loss
```

---

## Streaming Data Refresh Strategy

**Current approach: GitHub Actions weekly cron**

- Watch provider data stored in `watch_providers` JSONB column on `movies` table (US region only)
- Also stored in `original_language`, `top_cast`, `director`, `genres`, `keywords`, `certification` columns for filtering and model features
- Initial population: `node scripts/enrichMovieData.js`
- Weekly refresh: `.github/workflows/refresh-movie-data.yml` every Monday 6am UTC (also runs BT model training after enrichment)
- Can be triggered manually: GitHub → Actions → "Refresh Movie Data" → Run workflow

**Upgrade triggers:**
| Condition | Action |
|---|---|
| International users needed | Expand `watch_providers` to store per-country data. Update enrichment script to fetch multiple regions. |
| GitHub Actions becomes unreliable | Move to Supabase Edge Functions + pg_cron (requires Supabase Pro plan) |
| Need fresher than weekly data | Change cron to daily, or add staleness check (refresh if `watch_providers` last updated >7 days ago) |
| >10,000 users | Move to a dedicated background job service (Railway, Render) with proper queuing |

---

## Prediction Model

### Architecture

**Two-layer system:**

1. **ELO** — real ratings from matchups. Always shown for movies the user has rated.
2. **Bradley-Terry model** — trained weekly on the user's matchup history. Predicts scores for movies they haven't seen. Shown with a "PRED" badge.

### Cold Start Blend

For users with fewer than 50 matchups, BT predictions are blended with a Bayesian-adjusted TMDB score:

```
predicted = w × BT_score + (1 - w) × tmdb_bayesian_score
w = min(1.0, matchup_count / 50)
```

This means new users still see useful predictions immediately, even before the model has enough data.

### Features (BT Model)

| Feature        | Type         | Notes                                                              |
| -------------- | ------------ | ------------------------------------------------------------------ |
| Actor flags    | Binary (0/1) | Top 10 billed cast. Only actors in 3+ rated movies are included.   |
| Director flag  | Binary (0/1) | Always included.                                                   |
| Genre flags    | Binary (0/1) | One per genre                                                      |
| Runtime        | Continuous   | Movie length in minutes                                            |
| Release decade | Categorical  | Binary flags (1970s, 1980s, etc.)                                  |
| TMDB rating    | Continuous   | Bayesian-adjusted; used as feature only — never displayed to users |
| Top keywords   | Binary (0/1) | Top 50 most common keywords across user's rated movies             |

### Actor/Director Affinity Scores

Computed from Ridge regression residuals (actual ELO − predicted ELO without that person). A positive residual means the actor/director tends to push movies above what other features predict. Stored as raw residuals; normalized to 0–100 at display time using min-max across all actors in the user's profile.

**Display threshold:** 3+ rated movies featuring that actor/director.

**Future upgrade path:** Once enough users exist, train a Bradley-Terry model at the actor level using cross-user data, with regularization. This would directly estimate each actor's contribution from pairwise matchup outcomes rather than from ELO residuals.

### Retraining Schedule

Model retrains weekly via GitHub Actions (Monday 6am UTC). Writes results to `movie_predictions` and `actor_affinity_scores` / `director_affinity_scores` tables.

### Minimum Data Thresholds

| Matchups             | What Unlocks                                                       |
| -------------------- | ------------------------------------------------------------------ |
| < 10                 | No BT model. Pure Bayesian TMDB score shown as prediction.         |
| 10+                  | BT model trains. Predictions blend BT + TMDB (cold start).         |
| 50+                  | Full BT weight. Predictions shown on watchlist and all film pages. |
| 3+ movies with actor | Actor/Director affinity score shown on their page.                 |

---

## Swipe Gestures

| Gesture                 | Action                                                    |
| ----------------------- | --------------------------------------------------------- |
| Swipe up                | Top movie wins the matchup                                |
| Swipe down              | Bottom movie wins the matchup                             |
| Swipe left (on a card)  | Mark that movie as do-not-watch, remove from matchup pool |
| Swipe right (on a card) | Add that movie to watchlist, remove from matchup pool     |

**Implementation note:** `gestureState` (gs) in PanResponder is mutable and resets after the gesture ends. Always capture `gs.dy` / `gs.dx` into a local variable before starting any animation whose callback uses those values.

---

## Onboarding Flow

### New users (no Letterboxd import)

1. Sign in with Google
2. Create a unique username
3. Brief tutorial overlay explaining swipe directions and ELO
4. App seeds library with the 500-movie default list
5. User starts swiping immediately. Left/right swipe removes movies they haven't seen.

### Letterboxd users

1. Sign in with Google
2. Create a unique username
3. Import Letterboxd `watched.csv` via My Rankings tab
4. **Critical:** Search TMDB by title only (not title+year). Title+year drops match rate to ~20%; title-only achieves ~99%.

### Adding new movies

Search → tap movie → change status to Watched, or tap "⚡ Rate This Movie Now" to enter focus mode.

---

## Focus Mode

Tap **"⚡ Rate This Movie Now"** on any movie detail page → navigates to Match tab with that movie pinned to every matchup. Green banner shows the movie name with ✕ to exit. Exits automatically if the focused movie is swiped left or right.

---

## Watchlist Screen

- **Default sort:** Predicted Rating (descending)
- **Sort options:** Predicted Rating, Recently Added, Newest, Oldest, A–Z, Custom
- **Custom sort:** Drag-to-reorder (long-press ☰ handle on mobile). Saves order to `user_movies.custom_order`. New movies (no saved order) float to top. Drag only works on mobile — not web.
- **Filters:** Genre, Year, Runtime, Language, Streaming Service, Actor, Director, Friends' Watchlists
- **Set as Default:** Saves current filter state to AsyncStorage. Applied automatically on next app open. Clear All removes the saved default.

---

## Feature Checklist

### Built ✓

- [x] Auth (Google sign-in)
- [x] TMDB integration — search, movie details, person details
- [x] Matchup screen — 4-directional swipe voting
- [x] ELO calculation + variable K-factor (K=32/24/16)
- [x] Personal rankings with search, filters, sort, auto-refresh on tab focus
- [x] Global rankings
- [x] Movie detail page — poster, ratings, win/loss, status, cast/crew, focus mode
- [x] Actor/Director detail page — bio, filmography, ELO + predicted scores, affinity score
- [x] Watchlist — sort (Predicted default, Recently Added, Newest, Oldest, A–Z, Custom drag)
- [x] Watchlist filters — genre, year, runtime, language, streaming, actor, director, friends
- [x] Filter "Set as Default" — persists per screen via AsyncStorage
- [x] Letterboxd import
- [x] New user seeding (currently TMDB top_rated/popular — to be replaced with 500-movie list)
- [x] Focus mode
- [x] Search tab
- [x] Streaming services on movie detail page
- [x] Weekly GitHub Actions — enrichment (enrichMovieData.js) + BT model training (trainPredictionModel.py)
- [x] Bradley-Terry prediction model with cold-start TMDB blend
- [x] Predicted scores on watchlist (PRED badge)
- [x] Predicted scores on actor/director All Films tab (PRED badge, sorted with rated films)
- [x] Actor/Director affinity scores (residual-based, normalized 0–100)
- [x] movie_predictions table (predictions for all movies, not just watchlist)
- [x] Shared watchlist filter (filter by a friend's watchlist)

### Tier 1 — Foundation (Next to Build)

- [ ] Swap default seeding to 500-movie curated list
- [ ] Smart matchup pairing (hybrid random + similar-ELO) — confirm if implemented
- [ ] Username system on first login — confirm if implemented

### Tier 2 — Remaining High Value

- [ ] Match history + rating trend chart (tap win/loss record on movie detail)
- [ ] Remove movies from library (button on movie detail page)
- [ ] Data export — CSV download of personal rankings
- [ ] New user tutorial overlay

### Tier 3 — Social / Post-Launch

- [ ] Full shared watchlist movie picker UI (beyond filter — dedicated screen)
- [ ] Rating distribution analysis → potential score remapping
- [ ] Apple sign-in
- [ ] Website dashboard (Phase 2)

---

## API Keys

Stored in `.env` (never committed).

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_TMDB_API_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (GitHub Actions secret only — never in .env)

---

## Session Continuity

**Start of session:**

1. Read this file
2. Check the Feature Checklist — find the first unchecked Tier 1 item
3. Run `cd reelratings` then `npm run web` in the VS Code terminal

**End of session:**

1. Update this file with anything that changed
2. Commit and push:
   ```
   git add .
   git commit -m "describe what you built"
   git push
   ```
3. Stop dev server with `Ctrl+C`

---

## Key Decisions Log

| Date       | Decision                                            | Reason                                                                              |
| ---------- | --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 2026-06-28 | React Native + Expo                                 | Better ecosystem, TypeScript familiarity                                            |
| 2026-06-28 | Supabase over Firebase                              | Relational data fits matchup records; better for future regression                  |
| 2026-06-28 | Google sign-in only (for now)                       | Apple sign-in deferred                                                              |
| 2026-06-28 | app.json output: "spa"                              | "static" causes SSR errors                                                          |
| 2026-06-28 | Cards stacked vertically                            | Better for mobile — more poster space                                               |
| 2026-06-28 | Letterboxd: search by title only                    | Title+year dropped match rate to ~20%; title-only achieves ~99%                     |
| 2026-06-28 | Removed watchlist cooldown timers                   | Left/right swipe permanently removes until manually re-added                        |
| 2026-06-28 | Seed ~500 movies for new users                      | Curated list of well-known films across decades/genres                              |
| 2026-06-28 | Actor minimum: 3+ rated movies                      | Below this threshold, actor coefficients are statistically unreliable               |
| 2026-06-28 | Variable K-factor                                   | Standard practice; faster convergence early, more stable later                      |
| 2026-06-28 | Hybrid matchup pairing                              | Random early (baseline), similar-ELO later (convergence accuracy)                   |
| 2026-06-28 | TMDB rating: model only, not displayed              | Useful prediction signal but we want ReelRatings scores to stand alone              |
| 2026-08-16 | Bradley-Terry model instead of Elastic Net          | BT is purpose-built for pairwise comparison data; more principled for matchup input |
| 2026-08-16 | Cold-start TMDB blend for predictions               | Gives new users useful predictions before enough matchups exist                     |
| 2026-08-16 | Residual-based actor/director affinity scores       | Isolates actor impact from movie quality; more meaningful than average ELO          |
| 2026-08-16 | Affinity scores normalized 0–100 (min-max)          | Consistent with movie ELO display; relative to user's own actor pool                |
| 2026-08-16 | movie_predictions table (separate from user_movies) | Stores predictions for all movies, not just watchlist items                         |
| 2026-08-16 | top_cast expanded from 5 to 10 actors               | More actors qualify for affinity scores; improves model coverage                    |
| 2026-08-16 | Weekly GitHub Actions for enrichment + training     | Simple, free, sufficient for current scale                                          |
| 2026-08-16 | Custom drag sort on watchlist                       | Lets users manually curate their watch order                                        |
| 2026-08-16 | Default filters via AsyncStorage                    | Device-local, no backend needed; separate defaults per screen                       |
| 2026-08-16 | Predicted Rating as default watchlist sort          | Most useful default — surfaces movies the user will enjoy most                      |
