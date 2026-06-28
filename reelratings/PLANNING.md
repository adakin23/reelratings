# ReelRatings — Project Planning Document

> **Read this at the start of every session** to get oriented quickly.
> Update it whenever a major decision changes.

---

## What This App Does

ReelRatings is a cross-platform mobile app that lets users rank movies through head-to-head matchups. Two movies are shown side by side — the user picks their favorite. Over time, an ELO rating system builds a personalized ranked list of every movie the user has seen. These ratings are also stored server-side so that, once enough users are on the platform, a global rankings system can be built from the aggregated data.

Beyond movies, the app uses multivariate regression on ELO scores to generate ratings for actors and directors — showing how much each person contributes to a movie's quality.

---

## Phases

### Phase 1 — Individual App (current)
Build the full personal experience: matchups, ELO ratings, personal rankings, movie/actor/director pages, watchlist, Letterboxd import. Collect all matchup data server-side for future use.

### Phase 2 — Global Rankings
Aggregate all user matchup data to produce global ELO rankings and global actor/director ratings.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Framework | React Native + Expo (SDK 56) | Single codebase for iOS and Android. Expo simplifies setup and deployment. |
| Language | TypeScript | Type safety, better tooling, catches bugs early. |
| Backend / DB | Supabase (PostgreSQL) | Relational data fits matchup records perfectly. Built-in auth. Scales to global aggregation later. |
| Auth | Supabase Auth — Google + Apple sign-in | Frictionless for users, no passwords to manage. |
| Movie Data | TMDB API | Free, comprehensive, includes posters, cast, crew, genres, runtime. |
| Navigation | React Navigation + Bottom Tabs | Standard for React Native apps. |
| Session Storage | AsyncStorage + expo-secure-store | Keeps users logged in between sessions. |
| Version Control | GitHub (private repo) | Source: github.com/[your-username]/reelratings |

---

## Project Structure

```
reelratings/
├── app/                  # Expo Router screens (file-based routing)
├── src/
│   ├── components/       # Reusable UI components
│   ├── screens/          # Full screen components
│   ├── lib/              # Supabase client, TMDB client, ELO logic
│   ├── hooks/            # Custom React hooks
│   └── types/            # TypeScript type definitions
├── .env                  # API keys (never commit this)
├── PLANNING.md           # This file
└── package.json
```

---

## Database Schema

### `profiles`
Extends Supabase auth. One row per user.
| Column | Type | Notes |
|---|---|---|
| id | uuid | References auth.users |
| username | text | |
| created_at | timestamp | |

### `movies`
Cached TMDB data. Populated on demand when a user first encounters a movie.
| Column | Type | Notes |
|---|---|---|
| id | text | TMDB movie ID |
| title | text | |
| poster_path | text | TMDB poster URL |
| release_date | date | |
| genres | text[] | Array of genre strings |
| runtime | int | Minutes |
| overview | text | Plot summary |
| tmdb_data | jsonb | Full raw TMDB response for future use |

### `user_movies`
One row per user per movie. Tracks ELO, watch status, matchup counts.
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid | References profiles |
| movie_id | text | References movies |
| elo | float | Default 1000 |
| matchup_count | int | Total matchups this movie has participated in |
| win_count | int | |
| loss_count | int | |
| status | enum | 'watched', 'watchlist', 'do_not_watch' |
| last_matchup_at | timestamp | Used for watchlist cooldown logic |
| created_at | timestamp | |

### `matchups`
Every head-to-head result. This is the core data asset for global rankings later.
| Column | Type | Notes |
|---|---|---|
| id | uuid | |
| user_id | uuid | References profiles |
| movie_a_id | text | |
| movie_b_id | text | |
| winner_id | text | Movie ID of the winner |
| elo_change | float | How much ELO shifted |
| created_at | timestamp | |

### `watchlist`
Tracks watchlist and do-not-watch entries with cooldown timestamps.
Handled via the `status` and `last_matchup_at` columns in `user_movies`.

---

## ELO System

- **Starting ELO:** 1000 for every movie
- **K-factor:** 32 (standard — can tune later)
- **Display:** ELO is normalized to a 0–100 scale for display
- **Pairing logic:** Smart pairing — prioritize movies with fewer matchups, then movies with similar ELO ratings. Avoid rematches until all pairs have been seen at least once.
- **Watchlist cooldown:** Movies on watchlist won't appear in matchups for 30 days. Do-not-watch: 180 days.

### ELO Formula
```
Expected A = 1 / (1 + 10^((ELO_B - ELO_A) / 400))
New ELO_A = ELO_A + K * (result - Expected A)
// result = 1 for win, 0 for loss
```

---

## Actor / Director Ratings

Using multivariate regression where:
- **Dependent variable:** Movie ELO score
- **Independent variables:** Binary flags for each actor/director (1 if they appear in the movie, 0 if not)
- **Output:** Individual regression coefficients, normalized to 0–100 scale for display

This is a Phase 1 data collection goal — the regression runs once enough matchup data exists per user.

---

## V1 Feature List

- [ ] Auth (Google + Apple sign-in)
- [ ] TMDB integration — search and fetch movie data
- [ ] Matchup screen — head-to-head voting UI
- [ ] ELO calculation on each matchup result
- [ ] Personal rankings list with search and filters
- [ ] Movie detail page
- [ ] Actor / Director detail page
- [ ] Watchlist and do-not-watch (with cooldown rules)
- [ ] Letterboxd import (watched list + watchlist)
- [ ] Data export (CSV download of personal rankings)

---

## API Keys

Stored in `.env` (never committed to GitHub).
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_TMDB_API_KEY`

---

## Session Continuity

**At the start of every session:**
1. Read this file
2. Open GitHub Issues — filter to `in-progress` label
3. Read the last comment on the active issue to see where you left off

**At the end of every session:**
1. Commit and push all changes via GitHub Desktop
2. Add a comment to the active GitHub Issue describing exactly where you stopped and what the next step is
3. If you finished a feature, close the issue and open the next one

---

## Key Decisions Log

| Date | Decision | Reason |
|---|---|---|
| 2026-06-28 | React Native + Expo over Flutter | Better ecosystem for this use case, TypeScript familiarity |
| 2026-06-28 | Supabase over Firebase | Relational data fits matchup records; better for future regression queries |
| 2026-06-28 | Smart pairing over random | Faster ELO convergence, better user experience |
| 2026-06-28 | Google + Apple sign-in only | Simpler UX, no password management |
| 2026-06-28 | App name: ReelRatings | Descriptive, accurate, available |
