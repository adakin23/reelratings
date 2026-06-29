# ReelRatings — Project Planning Document

> **Read this at the start of every session** to get oriented quickly.
> Update it whenever a major decision changes.

---

## What This App Does

ReelRatings is a cross-platform mobile app that lets users rank movies through head-to-head matchups. Two movies are shown stacked vertically — the user swipes to pick their favorite. Over time, an ELO rating system builds a personalized ranked list of every movie the user has seen. These ratings are also stored server-side so that, once enough users are on the platform, a global rankings system can be built from the aggregated data.

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
| Routing | Expo Router (file-based) | `src/app` is the root directory. Tab layout under `src/app/(tabs)/`. |
| Backend / DB | Supabase (PostgreSQL) | Relational data fits matchup records perfectly. Built-in auth. Scales to global aggregation later. |
| Auth | Supabase Auth — Google sign-in | Web: full page redirect. Native: WebBrowser + exchangeCodeForSession. Apple sign-in is a future addition. |
| Movie Data | TMDB API | Free, comprehensive, includes posters, cast, crew, genres, runtime. |
| Session Storage | AsyncStorage (native) / detectSessionInUrl (web) | Keeps users logged in between sessions. |
| App output mode | `"spa"` in app.json | Must be "spa" not "static" — static mode causes `window is not defined` SSR errors. |
| Version Control | GitHub (private repo) | Source: github.com/[your-username]/reelratings |

---

## Project Structure

```
reelratings/
├── src/
│   ├── app/                     # Expo Router screens (file-based routing)
│   │   ├── _layout.tsx          # Root layout — auth gate (shows AuthScreen or Stack)
│   │   ├── (tabs)/
│   │   │   ├── _layout.tsx      # Tab layout — Match, My Rankings, Global, Search
│   │   │   ├── index.tsx        # Match tab
│   │   │   ├── rankings.tsx     # My Rankings tab
│   │   │   ├── global.tsx       # Global Rankings tab
│   │   │   └── search.tsx       # Search tab
│   │   ├── movie/[id].tsx       # Movie detail page
│   │   ├── person/[id].tsx      # Actor/Director detail page
│   │   └── import.tsx           # Letterboxd import page
│   ├── screens/                 # Full screen components (imported by app/ files)
│   │   ├── AuthScreen.tsx
│   │   ├── MatchupScreen.tsx
│   │   ├── RankingsScreen.tsx
│   │   ├── GlobalScreen.tsx
│   │   ├── SearchScreen.tsx
│   │   ├── MovieDetailScreen.tsx
│   │   ├── PersonDetailScreen.tsx
│   │   └── ImportScreen.tsx
│   └── lib/
│       ├── supabase.ts          # Supabase client (platform-aware storage)
│       ├── tmdb.ts              # TMDB API functions
│       └── elo.ts               # ELO calculation and normalization
├── .env                         # API keys (never commit this)
├── PLANNING.md                  # This file
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
| last_matchup_at | timestamp | Timestamp of most recent matchup |
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

### RLS Policies
Row Level Security is enabled on all tables. Policies applied:

| Table | Policy | Rule |
|---|---|---|
| movies | Authenticated users can insert movies | `auth.role() = 'authenticated'` |
| movies | Authenticated users can update movies | `auth.role() = 'authenticated'` |
| user_movies | Users can insert their own movies | `auth.uid() = user_id` |
| user_movies | Users can select their own movies | `auth.uid() = user_id` |
| user_movies | Users can update their own user_movies | `auth.uid() = user_id` |

---

## ELO System

- **Starting ELO:** 1000 for every movie
- **K-factor:** 32 (standard — can tune later)
- **Display:** ELO is normalized to a 0–100 scale across the user's personal library. Highest-rated movie = 100, lowest = 0. Scores shift as the library grows.
- **Pairing logic:** Prioritize movies with the fewest matchups. Shuffle within that group for variety.

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

## Swipe Gestures

The matchup screen uses a 4-directional swipe system with direction locking (locks to horizontal or vertical after 15px of movement).

| Gesture | Action |
|---|---|
| Swipe up | Top movie wins the matchup |
| Swipe down | Bottom movie wins the matchup |
| Swipe left (on a card) | Mark that movie as do-not-watch, remove from matchup pool |
| Swipe right (on a card) | Add that movie to watchlist, remove from matchup pool |

Movies marked do-not-watch or watchlist are removed from the matchup pool immediately. They can be re-added by changing their status on the movie detail page.

**Known implementation detail:** `gestureState` (gs) in PanResponder is a mutable object that gets reset after the gesture ends. Always capture `gs.dy` / `gs.dx` into a local variable before starting any animation whose callback uses those values — otherwise the callback reads a stale/reset value.

---

## Onboarding Flow

### New users (no Letterboxd import)
1. Sign in with Google
2. App seeds their library with ~200 popular/top-rated movies from TMDB (5 pages each of `/movie/popular` and `/movie/top_rated`, deduplicated). Shows "Setting up your library..." screen while seeding.
3. User starts swiping immediately
4. Movies they haven't seen can be swiped left (do-not-watch) or right (watchlist) to remove them from the pool

### Letterboxd users
1. Sign in with Google
2. Import Letterboxd `watched.csv` via the Import button on the My Rankings tab
3. Imported movies become their matchup pool
4. **Important:** Search TMDB by title only, not title + year — title+year drops match rate to ~20%; title-only achieves ~99%

### Adding new movies
Search for any movie → tap it → change status to Watched, or tap "⚡ Rate This Movie Now" to enter focus mode immediately.

---

## Focus Mode

A feature on the movie detail page that lets users do rapid matchups for a single movie to get it an accurate rating quickly — especially useful when adding a newly watched film.

- Tap **"⚡ Rate This Movie Now"** on any movie detail page
- Ensures the movie is in the library with status `watched`
- Navigates to the Match tab with `focusMovieId` as a URL param
- Every matchup in focus mode pairs the focused movie against a random opponent
- Green banner at top of Match tab shows the focused movie title and an ✕ to exit
- Focus mode exits automatically if the focused movie is swiped left or right

---

## V1 Feature List

- [x] Auth (Google sign-in)
- [x] TMDB integration — search and fetch movie/person data
- [x] Matchup screen — head-to-head voting with 4-directional swipe
- [x] ELO calculation on each matchup result
- [x] Personal rankings list with search bar, auto-refresh on tab focus
- [x] Global rankings list (aggregated average ELO across all users)
- [x] Movie detail page — poster, ratings, win/loss record, status buttons, cast/crew
- [x] Actor/Director detail page — bio, filmography, your ELO for each film
- [x] Watchlist and do-not-watch via left/right swipe or status buttons
- [x] Letterboxd import (watched.csv — matches by title only)
- [x] New user seeding (~200 movies on first load, seeding skipped if library exists)
- [x] Focus mode (rapid matchups for a single movie from its detail page)
- [x] Search tab — search movies and people simultaneously, two sub-tabs
- [ ] Apple sign-in
- [ ] Data export (CSV download of personal rankings)
- [ ] Ability to remove movies from library
- [ ] Actor/Director ELO regression (Phase 1 stretch goal)

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
2. Check what's unchecked in the V1 Feature List above
3. Run `npm run web` in the VS Code terminal to start the dev server

**At the end of every session:**
1. Update this file with anything that changed
2. Commit and push all changes:
   ```
   git add .
   git commit -m "describe what you built"
   git push
   ```
3. Stop the dev server with `Ctrl+C`

---

## Key Decisions Log

| Date | Decision | Reason |
|---|---|---|
| 2026-06-28 | React Native + Expo over Flutter | Better ecosystem for this use case, TypeScript familiarity |
| 2026-06-28 | Supabase over Firebase | Relational data fits matchup records; better for future regression queries |
| 2026-06-28 | Google sign-in only (for now) | Simpler to implement; Apple sign-in is a future addition |
| 2026-06-28 | App name: ReelRatings | Descriptive, accurate, available |
| 2026-06-28 | app.json output: "spa" not "static" | "static" causes `window is not defined` SSR errors at startup |
| 2026-06-28 | Cards stacked vertically, not side by side | Better for mobile — more poster space, clearer comparison |
| 2026-06-28 | Letterboxd search by title only, not title + year | Title + year confused TMDB; title-only improved match rate from ~20% to ~99% |
| 2026-06-28 | Removed watchlist cooldown timers | Cooldowns added friction; left/right swipe now permanently removes a movie until user manually re-adds it via the movie detail page |
| 2026-06-28 | Seed ~200 movies for new users | Users need content immediately without requiring a Letterboxd import |
| 2026-06-28 | Focus mode for individual movie rating | Lets users quickly establish an accurate ELO for a newly added movie |
