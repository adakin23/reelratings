import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Dimensions,
  Image,
  PanResponder,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import defaultMovies from "../data/defaultMovies.json";
import { calculateElo } from "../lib/elo";
import { supabase } from "../lib/supabase";
import { getPosterUrl } from "../lib/tmdb";

const { height: SCREEN_HEIGHT, width: SCREEN_WIDTH } = Dimensions.get("window");
const SWIPE_THRESHOLD = 80;
const DIRECTION_LOCK_THRESHOLD = 15;

// Matchups below this count use random pairing (baseline phase).
// At or above this count, pairing switches to similar-ELO opponents (convergence phase).
const PAIRING_RANDOM_THRESHOLD = 10;

// Movies need this many matchups to appear on Rankings.
// Must match the constant in RankingsScreen.tsx.
const MATCHUP_THRESHOLD = 5;

interface Movie {
  id: string;
  title: string;
  poster_path: string | null;
  release_date: string;
  elo: number;
  matchup_count: number;
}

function rowToMovie(row: any): Movie {
  return {
    id: row.movie_id,
    title: (row.movies as any).title,
    poster_path: (row.movies as any).poster_path,
    release_date: (row.movies as any).release_date,
    elo: row.elo,
    matchup_count: row.matchup_count ?? 0,
  };
}

export default function MatchupScreen() {
  const { focusMovieId: focusParam } = useLocalSearchParams<{
    focusMovieId?: string;
  }>();
  const router = useRouter();

  const [movies, setMovies] = useState<[Movie, Movie] | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);
  const [focusMovie, setFocusMovie] = useState<Movie | null>(null);
  const [swipeHint, setSwipeHint] = useState<string | null>(null);

  const moviesRef = useRef<[Movie, Movie] | null>(null);
  const userIdRef = useRef<string | null>(null);
  const focusMovieRef = useRef<Movie | null>(null);

  const topTranslateX = useRef(new Animated.Value(0)).current;
  const bottomTranslateX = useRef(new Animated.Value(0)).current;
  const screenTranslateY = useRef(new Animated.Value(0)).current;
  const screenOpacity = useRef(new Animated.Value(1)).current;

  const directionLocked = useRef<"horizontal" | "vertical" | null>(null);
  const activeCard = useRef<"top" | "bottom">("top");
  const touchStartY = useRef(0);

  useEffect(() => {
    moviesRef.current = movies;
  }, [movies]);
  useEffect(() => {
    focusMovieRef.current = focusMovie;
  }, [focusMovie]);

  // Enter focus mode when param arrives
  useEffect(() => {
    if (focusParam && userIdRef.current) {
      loadFocusMovie(focusParam, userIdRef.current);
    }
  }, [focusParam]);

  useEffect(() => {
    initializeUser();
  }, []);

  const initializeUser = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    userIdRef.current = user.id;
    await seedMoviesIfNeeded(user.id);
    if (focusParam) {
      await loadFocusMovie(focusParam, user.id);
    } else {
      await loadNextPair(user.id);
    }
  };

  const loadFocusMovie = async (movieId: string, uid: string) => {
    const { data } = await supabase
      .from("user_movies")
      .select(
        "movie_id, elo, matchup_count, movies(id, title, poster_path, release_date)",
      )
      .eq("user_id", uid)
      .eq("movie_id", movieId)
      .single();

    if (data) {
      const fm = rowToMovie(data);
      focusMovieRef.current = fm;
      setFocusMovie(fm);
      await loadNextPair(uid, fm);
    } else {
      await loadNextPair(uid);
    }
  };

  const exitFocusMode = () => {
    focusMovieRef.current = null;
    setFocusMovie(null);
    router.replace("/(tabs)/");
    const uid = userIdRef.current;
    if (uid) loadNextPair(uid, null);
  };

  const seedMoviesIfNeeded = async (uid: string) => {
    const { count } = await supabase
      .from("user_movies")
      .select("*", { count: "exact", head: true })
      .eq("user_id", uid);

    if (count && count > 0) return;

    setSeeding(true);
    try {
      const chunkSize = 50;

      for (let i = 0; i < defaultMovies.length; i += chunkSize) {
        await supabase
          .from("movies")
          .upsert(defaultMovies.slice(i, i + chunkSize), { onConflict: "id" });
      }

      const userMovieRows = defaultMovies.map((m) => ({
        user_id: uid,
        movie_id: m.id,
        elo: 1000,
        status: "watched",
      }));

      for (let i = 0; i < userMovieRows.length; i += chunkSize) {
        await supabase
          .from("user_movies")
          .upsert(userMovieRows.slice(i, i + chunkSize), {
            onConflict: "user_id,movie_id",
          });
      }
    } finally {
      setSeeding(false);
    }
  };

  // Adds a replacement movie when one is removed from the pool (swiped left).
  // Prefers the top predicted unwatched movie; falls back to a random movie.
  const addReplacementMovie = async (uid: string) => {
    try {
      // Get all movie IDs already in the user's library
      const { data: existing } = await supabase
        .from("user_movies")
        .select("movie_id")
        .eq("user_id", uid);

      const existingIds = new Set((existing ?? []).map((m: any) => m.movie_id));

      let movieId: string | null = null;

      // Prefer the best-predicted movie the user hasn't seen
      const { data: predicted } = await supabase
        .from("movie_predictions")
        .select("movie_id")
        .eq("user_id", uid)
        .order("score", { ascending: false })
        .limit(100);

      if (predicted) {
        const candidate = predicted.find((p) => !existingIds.has(p.movie_id));
        if (candidate) movieId = candidate.movie_id;
      }

      // Fallback: random movie from the global pool not already in the library
      if (!movieId) {
        const { data: pool } = await supabase
          .from("movies")
          .select("id")
          .limit(200);

        const available = (pool ?? []).filter((m) => !existingIds.has(m.id));
        if (available.length > 0) {
          movieId = available[Math.floor(Math.random() * available.length)].id;
        }
      }

      if (movieId) {
        await supabase.from("user_movies").insert({
          user_id: uid,
          movie_id: movieId,
          elo: 1000,
          status: "watched",
          matchup_count: 0,
          win_count: 0,
          loss_count: 0,
        });
      }
    } catch (err) {
      // Non-critical — pool size just won't grow if this fails
      console.warn("addReplacementMovie failed:", err);
    }
  };

  const resetAnimations = () => {
    topTranslateX.setValue(0);
    bottomTranslateX.setValue(0);
    screenTranslateY.setValue(0);
    screenOpacity.setValue(1);
  };

  const loadNextPair = async (
    uid: string,
    overrideFocusMovie?: Movie | null,
  ) => {
    setLoading(true);
    setSwipeHint(null);
    try {
      const fm =
        overrideFocusMovie !== undefined
          ? overrideFocusMovie
          : focusMovieRef.current;

      if (fm) {
        // Focus mode: re-fetch focus movie for latest ELO, then pick a random opponent
        const { data: focusData } = await supabase
          .from("user_movies")
          .select(
            "movie_id, elo, matchup_count, movies(id, title, poster_path, release_date)",
          )
          .eq("user_id", uid)
          .eq("movie_id", fm.id)
          .single();

        if (!focusData) {
          focusMovieRef.current = null;
          setFocusMovie(null);
        } else {
          const { data: opponents } = await supabase
            .from("user_movies")
            .select(
              "movie_id, elo, matchup_count, movies(id, title, poster_path, release_date)",
            )
            .eq("user_id", uid)
            .eq("status", "watched")
            .neq("movie_id", fm.id)
            .order("matchup_count", { ascending: true })
            .limit(10);

          if (!opponents || opponents.length === 0) {
            setMovies(null);
            return;
          }

          const updatedFm = rowToMovie(focusData);
          const opponent = rowToMovie(
            opponents[
              Math.floor(Math.random() * Math.min(opponents.length, 5))
            ],
          );
          const pair: [Movie, Movie] =
            Math.random() > 0.5 ? [updatedFm, opponent] : [opponent, updatedFm];

          setMovies(pair);
          moviesRef.current = pair;
          resetAnimations();
          return;
        }
      }

      // Normal mode — hybrid pairing
      // Fetch least-seen movies as the main candidate pool
      const { data: candidates } = await supabase
        .from("user_movies")
        .select(
          "movie_id, elo, matchup_count, movies(id, title, poster_path, release_date)",
        )
        .eq("user_id", uid)
        .eq("status", "watched")
        .order("matchup_count", { ascending: true })
        .limit(20);

      if (!candidates || candidates.length < 2) {
        setMovies(null);
        return;
      }

      // Also fetch movies one matchup away from the ranking threshold.
      // These get 70% priority as movieA so they cross the line quickly.
      const { data: nearThresholdData } = await supabase
        .from("user_movies")
        .select(
          "movie_id, elo, matchup_count, movies(id, title, poster_path, release_date)",
        )
        .eq("user_id", uid)
        .eq("status", "watched")
        .eq("matchup_count", MATCHUP_THRESHOLD - 1)
        .limit(10);

      const nearThreshold = nearThresholdData ?? [];

      // Pick movieA — prioritize near-threshold movies
      let movieA: Movie;
      if (nearThreshold.length > 0 && Math.random() < 0.7) {
        movieA = rowToMovie(
          nearThreshold[Math.floor(Math.random() * nearThreshold.length)],
        );
      } else {
        movieA = rowToMovie(
          candidates[
            Math.floor(Math.random() * Math.min(5, candidates.length))
          ],
        );
      }

      let movieB: Movie;

      if (movieA.matchup_count < PAIRING_RANDOM_THRESHOLD) {
        // Early phase: random opponent from least-seen pool
        const others = candidates.filter((c) => c.movie_id !== movieA.id);
        movieB = rowToMovie(others[Math.floor(Math.random() * others.length)]);
      } else {
        // Later phase: closest ELO opponent
        const { data: pool } = await supabase
          .from("user_movies")
          .select(
            "movie_id, elo, matchup_count, movies(id, title, poster_path, release_date)",
          )
          .eq("user_id", uid)
          .eq("status", "watched")
          .neq("movie_id", movieA.id)
          .limit(100);

        if (!pool || pool.length === 0) {
          setMovies(null);
          return;
        }

        const byEloDist = pool
          .map(rowToMovie)
          .sort(
            (a, b) =>
              Math.abs(a.elo - movieA.elo) - Math.abs(b.elo - movieA.elo),
          );

        movieB =
          byEloDist[Math.floor(Math.random() * Math.min(5, byEloDist.length))];
      }

      const pair: [Movie, Movie] =
        Math.random() > 0.5 ? [movieA, movieB] : [movieB, movieA];
      setMovies(pair);
      moviesRef.current = pair;
      resetAnimations();
    } finally {
      setLoading(false);
    }
  };

  const handleVote = async (winnerId: string, loserId: string) => {
    const uid = userIdRef.current;
    const current = moviesRef.current;
    if (!uid || !current) return;

    const winner = current.find((m) => m.id === winnerId)!;
    const loser = current.find((m) => m.id === loserId)!;

    const [{ data: wd }, { data: ld }] = await Promise.all([
      supabase
        .from("user_movies")
        .select("win_count, matchup_count")
        .eq("user_id", uid)
        .eq("movie_id", winnerId)
        .single(),
      supabase
        .from("user_movies")
        .select("loss_count, matchup_count")
        .eq("user_id", uid)
        .eq("movie_id", loserId)
        .single(),
    ]);

    const { newWinnerElo, newLoserElo, eloChange } = calculateElo(
      winner.elo,
      loser.elo,
      wd?.matchup_count ?? 0,
      ld?.matchup_count ?? 0,
    );

    const now = new Date().toISOString();
    await Promise.all([
      supabase
        .from("user_movies")
        .update({
          elo: newWinnerElo,
          win_count: (wd?.win_count ?? 0) + 1,
          matchup_count: (wd?.matchup_count ?? 0) + 1,
          last_matchup_at: now,
        })
        .eq("user_id", uid)
        .eq("movie_id", winnerId),

      supabase
        .from("user_movies")
        .update({
          elo: newLoserElo,
          loss_count: (ld?.loss_count ?? 0) + 1,
          matchup_count: (ld?.matchup_count ?? 0) + 1,
          last_matchup_at: now,
        })
        .eq("user_id", uid)
        .eq("movie_id", loserId),

      supabase.from("matchups").insert({
        user_id: uid,
        movie_a_id: current[0].id,
        movie_b_id: current[1].id,
        winner_id: winnerId,
        elo_change: eloChange,
      }),

      supabase.from("user_elo_history").insert([
        {
          user_id: uid,
          movie_id: winnerId,
          elo: newWinnerElo,
          matchup_count: (wd?.matchup_count ?? 0) + 1,
        },
        {
          user_id: uid,
          movie_id: loserId,
          elo: newLoserElo,
          matchup_count: (ld?.matchup_count ?? 0) + 1,
        },
      ]),
    ]);

    await loadNextPair(uid);
  };

  const handleStatusChange = async (
    movieId: string,
    status: "watchlist" | "do_not_watch",
  ) => {
    const uid = userIdRef.current;
    if (!uid) return;

    if (focusMovieRef.current?.id === movieId) {
      focusMovieRef.current = null;
      setFocusMovie(null);
    }

    await supabase
      .from("user_movies")
      .update({ status })
      .eq("user_id", uid)
      .eq("movie_id", movieId);

    // When a movie is removed from the pool, add a replacement to keep the library size stable
    if (status === "do_not_watch") {
      addReplacementMovie(uid); // fire and forget — don't await, keep UI snappy
    }

    await loadNextPair(uid);
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        Math.abs(gs.dx) > 8 || Math.abs(gs.dy) > 8,

      onPanResponderGrant: (evt) => {
        directionLocked.current = null;
        touchStartY.current = evt.nativeEvent.pageY;
        const offset = 32 + (focusMovieRef.current ? 44 : 0);
        const midpoint = (SCREEN_HEIGHT + offset) / 2;
        activeCard.current = touchStartY.current < midpoint ? "top" : "bottom";
      },

      onPanResponderMove: (_, gs) => {
        if (!directionLocked.current) {
          if (
            Math.abs(gs.dx) > DIRECTION_LOCK_THRESHOLD ||
            Math.abs(gs.dy) > DIRECTION_LOCK_THRESHOLD
          ) {
            directionLocked.current =
              Math.abs(gs.dx) > Math.abs(gs.dy) ? "horizontal" : "vertical";
          }
        }

        if (directionLocked.current === "vertical") {
          screenTranslateY.setValue(gs.dy);
          if (Math.abs(gs.dy) > 30) {
            setSwipeHint(
              gs.dy < 0 ? "✓ Top movie wins" : "✓ Bottom movie wins",
            );
          }
        } else if (directionLocked.current === "horizontal") {
          if (activeCard.current === "top") {
            topTranslateX.setValue(gs.dx);
          } else {
            bottomTranslateX.setValue(gs.dx);
          }
          const current = moviesRef.current;
          if (current && Math.abs(gs.dx) > 30) {
            const movie =
              activeCard.current === "top" ? current[0] : current[1];
            const label = gs.dx < 0 ? "Not Seen" : "Watchlist";
            setSwipeHint(`${label}: ${movie.title}`);
          }
        }
      },

      onPanResponderRelease: (_, gs) => {
        const current = moviesRef.current;
        const dir = directionLocked.current;
        directionLocked.current = null;
        setSwipeHint(null);

        if (!current || !dir) {
          Animated.parallel([
            Animated.spring(topTranslateX, {
              toValue: 0,
              useNativeDriver: true,
            }),
            Animated.spring(bottomTranslateX, {
              toValue: 0,
              useNativeDriver: true,
            }),
            Animated.spring(screenTranslateY, {
              toValue: 0,
              useNativeDriver: true,
            }),
          ]).start();
          return;
        }

        if (dir === "vertical") {
          if (Math.abs(gs.dy) < SWIPE_THRESHOLD) {
            Animated.spring(screenTranslateY, {
              toValue: 0,
              useNativeDriver: true,
            }).start();
            return;
          }
          const dy = gs.dy;
          const toY = dy < 0 ? -SCREEN_HEIGHT : SCREEN_HEIGHT;
          Animated.parallel([
            Animated.timing(screenTranslateY, {
              toValue: toY,
              duration: 250,
              useNativeDriver: true,
            }),
            Animated.timing(screenOpacity, {
              toValue: 0,
              duration: 250,
              useNativeDriver: true,
            }),
          ]).start(() => {
            resetAnimations();
            if (dy < 0) handleVote(current[0].id, current[1].id);
            else handleVote(current[1].id, current[0].id);
          });
        } else {
          if (Math.abs(gs.dx) < SWIPE_THRESHOLD) {
            Animated.spring(
              activeCard.current === "top" ? topTranslateX : bottomTranslateX,
              { toValue: 0, useNativeDriver: true },
            ).start();
            return;
          }
          const movieId =
            activeCard.current === "top" ? current[0].id : current[1].id;
          const status = gs.dx < 0 ? "do_not_watch" : "watchlist";
          const cardAnim =
            activeCard.current === "top" ? topTranslateX : bottomTranslateX;
          const toX = gs.dx < 0 ? -SCREEN_WIDTH : SCREEN_WIDTH;

          Animated.timing(cardAnim, {
            toValue: toX,
            duration: 250,
            useNativeDriver: true,
          }).start(() => {
            resetAnimations();
            handleStatusChange(movieId, status as "watchlist" | "do_not_watch");
          });
        }
      },
    }),
  ).current;

  if (seeding) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#ffffff" />
        <Text style={styles.seedingText}>Setting up your library...</Text>
        <Text style={styles.seedingSubtext}>This only happens once</Text>
      </View>
    );
  }

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  if (!movies) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.emptyText}>No movies to compare.</Text>
        <Text style={styles.emptySubtext}>
          Import more movies or mark some as watched.
        </Text>
      </View>
    );
  }

  const [topMovie, bottomMovie] = movies;

  return (
    <View style={styles.wrapper} {...panResponder.panHandlers}>
      {focusMovie && (
        <View style={styles.focusBanner}>
          <Text style={styles.focusBannerText} numberOfLines={1}>
            ⚡ Rating: {focusMovie.title}
          </Text>
          <TouchableOpacity
            onPress={exitFocusMode}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={styles.focusBannerExit}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      <View style={styles.hintBar}>
        {swipeHint && <Text style={styles.hintBarText}>{swipeHint}</Text>}
      </View>

      <Animated.View
        style={[
          styles.screenAnim,
          {
            transform: [{ translateY: screenTranslateY }],
            opacity: screenOpacity,
          },
        ]}
      >
        <Animated.View
          style={[styles.card, { transform: [{ translateX: topTranslateX }] }]}
        >
          {topMovie.poster_path ? (
            <Image
              source={{ uri: getPosterUrl(topMovie.poster_path)! }}
              style={styles.poster}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.noPoster}>
              <Text style={styles.noPosterText}>{topMovie.title}</Text>
            </View>
          )}
          <View style={styles.cardOverlay}>
            <View style={styles.cardOverlayRow}>
              <View style={styles.cardOverlayText}>
                <Text style={styles.movieTitle} numberOfLines={2}>
                  {topMovie.title}
                </Text>
                <Text style={styles.movieYear}>
                  {topMovie.release_date?.slice(0, 4)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.infoButton}
                onPress={() => router.push(`/movie/${topMovie.id}`)}
              >
                <Text style={styles.infoButtonText}>ⓘ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>

        <View style={styles.divider}>
          <Text style={styles.vsText}>VS</Text>
          <Text style={styles.dividerHint}>
            ↑ top wins · ↓ bottom wins · ← not seen · → watchlist
          </Text>
        </View>

        <Animated.View
          style={[
            styles.card,
            { transform: [{ translateX: bottomTranslateX }] },
          ]}
        >
          {bottomMovie.poster_path ? (
            <Image
              source={{ uri: getPosterUrl(bottomMovie.poster_path)! }}
              style={styles.poster}
              resizeMode="cover"
            />
          ) : (
            <View style={styles.noPoster}>
              <Text style={styles.noPosterText}>{bottomMovie.title}</Text>
            </View>
          )}
          <View style={styles.cardOverlay}>
            <View style={styles.cardOverlayRow}>
              <View style={styles.cardOverlayText}>
                <Text style={styles.movieTitle} numberOfLines={2}>
                  {bottomMovie.title}
                </Text>
                <Text style={styles.movieYear}>
                  {bottomMovie.release_date?.slice(0, 4)}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.infoButton}
                onPress={() => router.push(`/movie/${bottomMovie.id}`)}
              >
                <Text style={styles.infoButtonText}>ⓘ</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    backgroundColor: "#0d0d0d",
  },
  screenAnim: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: "#0d0d0d",
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
  },
  seedingText: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
    marginTop: 20,
  },
  seedingSubtext: {
    color: "#555555",
    fontSize: 13,
    marginTop: 8,
  },
  focusBanner: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a2a1a",
    borderBottomWidth: 1,
    borderBottomColor: "#2a4a2a",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  focusBannerText: {
    flex: 1,
    color: "#6fcf6f",
    fontSize: 13,
    fontWeight: "600",
  },
  focusBannerExit: {
    color: "#6fcf6f",
    fontSize: 16,
    marginLeft: 12,
  },
  hintBar: {
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#111111",
  },
  hintBarText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "600",
  },
  card: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
  },
  poster: {
    width: "100%",
    height: "100%",
  },
  noPoster: {
    flex: 1,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  noPosterText: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
  },
  cardOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: "rgba(0,0,0,0.65)",
  },
  cardOverlayRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  cardOverlayText: {
    flex: 1,
  },
  movieTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "bold",
  },
  movieYear: {
    color: "#aaaaaa",
    fontSize: 14,
    marginTop: 2,
  },
  infoButton: {
    marginLeft: 12,
    padding: 4,
  },
  infoButtonText: {
    color: "#aaaaaa",
    fontSize: 22,
  },
  divider: {
    height: 52,
    backgroundColor: "#111111",
    alignItems: "center",
    justifyContent: "center",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#2a2a2a",
  },
  vsText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "bold",
    letterSpacing: 4,
  },
  dividerHint: {
    color: "#333333",
    fontSize: 10,
    marginTop: 3,
  },
  emptyText: {
    color: "#666666",
    fontSize: 16,
    marginBottom: 8,
  },
  emptySubtext: {
    color: "#444444",
    fontSize: 13,
  },
});
