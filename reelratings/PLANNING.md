# ReelRatings — Project Planning Document

> **Read this at the start of every session** to get oriented quickly.
> Update it whenever a major decision changes.

---

## What This App Does

ReelRatings is a cross-platform mobile app that lets users rank movies through head-to-head matchups. Two movies are shown stacked vertically — the user swipes to pick their favorite. Over time, an ELO rating system builds a personalized ranked list of every movie the user has seen. These ratings are also stored server-side so that, once enough users are on the platform, a global rankings system can be built from the aggregated data.

A machine learning model (Elastic Net regression) uses each user's ratings to predict scores for unseen movies and to generate personal actor/director scores based on their measured contribution to movies the user has enjoyed.

---

## Phases

### Phase 1 — Individual App (current)

Build the full personal experience: matchups, ELO ratings, personal rankings, movie/actor/director pages, watchlist, Letterboxd import, predicted ELO model, streaming services. Collect all matchup data server-side for future use.

### Phase 2 — Global Rankings + Social

Aggregate all user matchup data for global ELO rankings and actor/director ratings. Add shared watchlist / movie picker feature.

---

## Tech Stack

| Layer           | Choice                                           | Reason                                                                                   |
| --------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| Framework       | React Native + Expo (SDK 56)                     | Single codebase for iOS and Android.                                                     |
| Language        | TypeScript                                       | Type safety, better tooling.                                                             |
| Routing         | Expo Router (file-based)                         | `src/app` is the root. Tabs under `src/app/(tabs)/`.                                     |
| Backend / DB    | Supabase (PostgreSQL)                            | Relational data fits matchup records. Built-in auth.                                     |
| Auth            | Supabase Auth — Google sign-in                   | Web: full page redirect. Native: WebBrowser + exchangeCodeForSession.                    |
| Movie Data      | TMDB API                                         | Free, comprehensive, includes posters, cast, crew, genres, runtime, streaming providers. |
| Session Storage | AsyncStorage (native) / detectSessionInUrl (web) | Keeps users logged in.                                                                   |
| App output mode | `"spa"` in app.json                              | Must be "spa" — "static" causes SSR errors.                                              |
| ML Model        | Elastic Net (scikit-learn or JS port)            | Interpretable coefficients, handles sparse binary features, scalable.                    |
| Version Control | GitHub (private repo)                            |                                                                                          |

---

## Project Structure

```
reelratings/
├── src/
│   ├── app/                     # Expo Router screens (file-based routing)
│   │   ├── _layout.tsx          # Root layout — auth gate
│   │   ├── (tabs)/
│   │   │   ├── _layout.tsx      # Tab layout — Match, My Rankings, Global, Search
│   │   │   ├── index.tsx        # Match tab
│   │   │   ├── rankings.tsx     # My Rankings tab
│   │   │   ├── global.tsx       # Global Rankings tab
│   │   │   └── search.tsx       # Search tab
│   │   ├── movie/[id].tsx       # Movie detail page
│   │   ├── person/[id].tsx      # Actor/Director detail page
│   │   └── import.tsx           # Letterboxd import page
│   ├── screens/                 # Full screen components
│   │   ├── AuthScreen.tsx
│   │   ├── MatchupScreen.tsx
│   │   ├── RankingsScreen.tsx
│   │   ├── GlobalScreen.tsx
│   │   ├── SearchScreen.tsx
│   │   ├── MovieDetailScreen.tsx
│   │   ├── PersonDetailScreen.tsx
│   │   └── ImportScreen.tsx
│   └── lib/
│       ├── supabase.ts          # Supabase client
│       ├── tmdb.ts              # TMDB API functions
│       ├── elo.ts               # ELO calculation and normalization
│       └── model.ts             # Predicted ELO model (to be built)
├── .env                         # API keys (never commit)
├── PLANNING.md                  # This file
└── package.json
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

| Column       | Type   | Notes                                                                  |
| ------------ | ------ | ---------------------------------------------------------------------- |
| id           | text   | TMDB movie ID                                                          |
| title        | text   |                                                                        |
| poster_path  | text   |                                                                        |
| release_date | date   |                                                                        |
| genres       | text[] | Array of genre strings                                                 |
| runtime      | int    | Minutes                                                                |
| overview     | text   |                                                                        |
| tmdb_rating  | float  | TMDB vote average. Used in prediction model only — not shown to users. |
| top_cast     | text[] | Top 5 billed actors from TMDB. Used in prediction model.               |
| tmdb_data    | jsonb  | Full raw TMDB response                                                 |

### `user_movies`

| Column          | Type      | Notes                                  |
| --------------- | --------- | -------------------------------------- |
| id              | uuid      |                                        |
| user_id         | uuid      | References profiles                    |
| movie_id        | text      | References movies                      |
| elo             | float     | Default 1000                           |
| matchup_count   | int       |                                        |
| win_count       | int       |                                        |
| loss_count      | int       |                                        |
| status          | enum      | 'watched', 'watchlist', 'do_not_watch' |
| last_matchup_at | timestamp |                                        |
| created_at      | timestamp |                                        |

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

### `user_elo_history`

Snapshot of a movie's normalized score after each matchup. Used to draw the rating trend chart.
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid | |
| movie_id | text | |
| normalized_score | float | 0–100 score at this point in time |
| matchup_count | int | How many matchups the movie had at this snapshot |
| created_at | timestamp | |

### RLS Policies

| Table       | Policy                                 | Rule                            |
| ----------- | -------------------------------------- | ------------------------------- |
| movies      | Authenticated users can insert movies  | `auth.role() = 'authenticated'` |
| movies      | Authenticated users can update movies  | `auth.role() = 'authenticated'` |
| user_movies | Users can insert their own movies      | `auth.uid() = user_id`          |
| user_movies | Users can select their own movies      | `auth.uid() = user_id`          |
| user_movies | Users can update their own user_movies | `auth.uid() = user_id`          |

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

## Predicted ELO Model

### Purpose

Predict a user's rating for movies they haven't seen. Also used to derive personal actor/director scores and to order the shared watchlist feature by predicted enjoyment.

### Model Type

**Elastic Net regression** — a regularized linear model combining Ridge (L2) and Lasso (L1) penalties. Handles sparse binary features well. Produces interpretable coefficients. Fast to train and retrain.

### Features (Independent Variables)

| Feature           | Type         | Notes                                                                                                                        |
| ----------------- | ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Actor flags       | Binary (0/1) | One per actor from the top-5 billed cast of each movie. Only actors appearing in 3+ of the user's rated movies are included. |
| Director flag     | Binary (0/1) | One per director. Always included regardless of the 3+ filter.                                                               |
| Genre flags       | Binary (0/1) | One per genre (Action, Drama, Comedy, etc.)                                                                                  |
| Runtime           | Continuous   | Movie length in minutes                                                                                                      |
| Release decade    | Categorical  | Encoded as binary flags (1970s, 1980s, etc.)                                                                                 |
| TMDB rating       | Continuous   | Used as a feature only — never displayed to users                                                                            |
| Global ReelRating | Continuous   | Average ELO across all users. Low weight early when user count is small.                                                     |

**Target variable:** User's current normalized ELO score (0–100) for rated movies.

### Actor/Director Scores

The Elastic Net coefficient for each actor/director = their personal score for that user (how much their presence in a movie predicts a higher rating). Normalized to 0–100 for display. Global score = average of personal scores across all users.

### Evaluation

- **Method:** Leave-One-Out Cross-Validation (LOOCV) for users with <300 movies; 5-fold CV for 300+
- **Primary metric:** MAE (Mean Absolute Error) on normalized 0–100 scores
- **Secondary metric:** Spearman rank correlation (does the model correctly order preferences?)
- **Baseline:** TMDB rating scaled to 0–100. Our model must outperform this to be useful.
- **Model comparison:** Run Ridge, Lasso, Elastic Net (and optionally Gradient Boosting) on the same CV folds. Auto-select best performer per user once library is large enough (300+).

### Unlock Thresholds

| Rated Movies | What Unlocks                                                            |
| ------------ | ----------------------------------------------------------------------- |
| < 50         | No model. No predictions shown.                                         |
| 50–99        | Model trains internally but predictions not shown to user.              |
| 100+         | Predicted ELO shown on unseen movie pages (with "predicted" indicator). |
| 150+         | Actor/Director personal scores shown on their detail pages.             |
| 300+         | Model type comparison runs; auto-switch to best performer.              |

### Retraining

Model retrains silently after every 25 new matchups. Elastic Net on 200 movies retrains in milliseconds.

### Scalability Notes

- Each user has their own independent model. No shared model state.
- Elastic Net is trivially fast at personal library scale (50–500 movies).
- At thousands of users: retrain jobs can be queued and run server-side.
- Future consideration: hybrid collaborative filtering (using similarity between users) could improve predictions significantly once user count is high.

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

## Feature Checklist

### Built ✓

- [x] Auth (Google sign-in)
- [x] TMDB integration — search, movie details, person details
- [x] Matchup screen — 4-directional swipe voting
- [x] ELO calculation
- [x] Personal rankings with search bar, auto-refresh on tab focus
- [x] Global rankings
- [x] Movie detail page — poster, ratings, win/loss, status, cast/crew, focus mode
- [x] Actor/Director detail page — bio, filmography, ELO scores
- [x] Watchlist and do-not-watch via swipe or status buttons
- [x] Letterboxd import
- [x] New user seeding (currently TMDB top_rated/popular — to be replaced with 500-movie list)
- [x] Focus mode
- [x] Search tab

### Tier 1 — Foundation (Next to Build)

- [ ] Swap default seeding to 500-movie curated list
- [ ] Variable K-factor (K=32/24/16 by matchup count)
- [ ] Smart matchup pairing (hybrid random + similar-ELO)
- [ ] Username system (unique username on first login)

### Tier 2 — High Value Features

- [ ] Match history + rating trend chart (tap win/loss record on movie detail)
- [ ] Remove movies from library (button on movie detail page)
- [ ] Data export — CSV download of personal rankings
- [ ] Streaming services on movie detail page (TMDB watch providers, USA)
- [ ] Watchlist filters (streaming service, genre, runtime)
- [ ] New user tutorial overlay

### Tier 3 — Intelligence Layer (build in order)

- [ ] Predicted ELO model (Elastic Net, see model spec above)
- [ ] Actor/Director personal + global scores (derived from model coefficients)
- [ ] Predicted ELO displayed on unseen movie pages

### Tier 4 — Social Features

- [ ] Shared watchlist / movie picker (requires username + predicted ELO)

### Tier 5 — Post-Launch

- [ ] Rating distribution analysis → potential score remapping
- [ ] Apple sign-in

---

## API Keys

Stored in `.env` (never committed).

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_TMDB_API_KEY`

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

| Date       | Decision                               | Reason                                                                 |
| ---------- | -------------------------------------- | ---------------------------------------------------------------------- |
| 2026-06-28 | React Native + Expo                    | Better ecosystem, TypeScript familiarity                               |
| 2026-06-28 | Supabase over Firebase                 | Relational data fits matchup records; better for future regression     |
| 2026-06-28 | Google sign-in only (for now)          | Apple sign-in deferred                                                 |
| 2026-06-28 | app.json output: "spa"                 | "static" causes SSR errors                                             |
| 2026-06-28 | Cards stacked vertically               | Better for mobile — more poster space                                  |
| 2026-06-28 | Letterboxd: search by title only       | Title+year dropped match rate to ~20%; title-only achieves ~99%        |
| 2026-06-28 | Removed watchlist cooldown timers      | Left/right swipe permanently removes until manually re-added           |
| 2026-06-28 | Seed ~500 movies for new users         | Curated list of well-known films across decades/genres                 |
| 2026-06-28 | Top-5 billed actors in model           | Most impactful actors; limits feature space vs. full cast              |
| 2026-06-28 | Actor minimum: 3+ rated movies         | Below this threshold, actor coefficients are statistically unreliable  |
| 2026-06-28 | Elastic Net for predicted ELO          | Interpretable coefficients, handles sparse binary features, scalable   |
| 2026-06-28 | Variable K-factor                      | Standard practice; faster convergence early, more stable later         |
| 2026-06-28 | Hybrid matchup pairing                 | Random early (baseline), similar-ELO later (convergence accuracy)      |
| 2026-06-28 | TMDB rating: model only, not displayed | Useful prediction signal but we want ReelRatings scores to stand alone |
