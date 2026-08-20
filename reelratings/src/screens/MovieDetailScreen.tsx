import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { normalizeElo } from "../lib/elo";
import { supabase } from "../lib/supabase";
import {
  getMovieDetails,
  getPosterUrl,
  getWatchProviders,
  WatchProviders,
} from "../lib/tmdb";

type WatchStatus = "watched" | "watchlist" | "do_not_watch" | null;

interface MovieDetail {
  id: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  runtime: number;
  overview: string;
  genres: { id: number; name: string }[];
  credits: {
    cast: {
      id: number;
      name: string;
      character: string;
      profile_path: string | null;
    }[];
    crew: { id: number; name: string; job: string }[];
  };
}

interface UserMovieData {
  elo: number;
  matchup_count: number;
  win_count: number;
  loss_count: number;
  status: WatchStatus;
  normalizedScore: number;
}

const STATUS_LABELS: Record<string, string> = {
  watched: "Watched",
  watchlist: "Watchlist",
};

const STATUS_COLORS: Record<string, string> = {
  watched: "#4caf50",
  watchlist: "#2196f3",
};

export default function MovieDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [movie, setMovie] = useState<MovieDetail | null>(null);
  const [userMovie, setUserMovie] = useState<UserMovieData | null>(null);
  const [watchProviders, setWatchProviders] = useState<WatchProviders>({});
  const [loading, setLoading] = useState(true);
  const [statusUpdating, setStatusUpdating] = useState(false);

  useEffect(() => {
    if (id) loadMovie(id);
  }, [id]);

  const loadMovie = async (movieId: string) => {
    setLoading(true);
    try {
      const [details, providers] = await Promise.all([
        getMovieDetails(Number(movieId)),
        getWatchProviders(Number(movieId)),
      ]);
      setMovie(details);
      setWatchProviders(providers);

      if (providers && Object.keys(providers).length > 0) {
        supabase
          .from("movies")
          .update({ watch_providers: providers })
          .eq("id", movieId);
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: userMovieData } = await supabase
        .from("user_movies")
        .select("elo, matchup_count, win_count, loss_count, status")
        .eq("user_id", user.id)
        .eq("movie_id", movieId)
        .single();

      const { data: allUserMovies } = await supabase
        .from("user_movies")
        .select("elo")
        .eq("user_id", user.id);

      if (userMovieData && allUserMovies) {
        const elos = allUserMovies.map((m) => m.elo);
        const minElo = Math.min(...elos);
        const maxElo = Math.max(...elos);
        setUserMovie({
          ...userMovieData,
          status: userMovieData.status as WatchStatus,
          normalizedScore: normalizeElo(userMovieData.elo, minElo, maxElo),
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (newStatus: "watched" | "watchlist") => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !id) return;

    setStatusUpdating(true);
    try {
      const { data: existing } = await supabase
        .from("user_movies")
        .select("id")
        .eq("user_id", user.id)
        .eq("movie_id", id)
        .single();

      if (existing) {
        await supabase
          .from("user_movies")
          .update({ status: newStatus })
          .eq("user_id", user.id)
          .eq("movie_id", id);
      } else {
        if (movie) {
          await supabase.from("movies").upsert(
            {
              id,
              title: movie.title,
              poster_path: movie.poster_path,
              release_date: movie.release_date || null,
              overview: movie.overview,
              genres: movie.genres.map((g) => g.name),
              runtime: movie.runtime,
            },
            { onConflict: "id" },
          );
        }
        await supabase.from("user_movies").insert({
          user_id: user.id,
          movie_id: id,
          elo: 1000,
          status: newStatus,
        });
      }

      setUserMovie((prev) => (prev ? { ...prev, status: newStatus } : null));
      Alert.alert("Updated", `Marked as ${STATUS_LABELS[newStatus]}`);
    } finally {
      setStatusUpdating(false);
    }
  };

  const handleRateNow = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user || !id || !movie) return;

    setStatusUpdating(true);
    try {
      await supabase.from("movies").upsert(
        {
          id,
          title: movie.title,
          poster_path: movie.poster_path,
          release_date: movie.release_date || null,
          overview: movie.overview,
          genres: movie.genres?.map((g) => g.name) ?? [],
          runtime: movie.runtime ?? null,
        },
        { onConflict: "id" },
      );

      const { data: existing } = await supabase
        .from("user_movies")
        .select("id, status")
        .eq("user_id", user.id)
        .eq("movie_id", id)
        .single();

      if (!existing) {
        await supabase.from("user_movies").insert({
          user_id: user.id,
          movie_id: id,
          elo: 1000,
          status: "watched",
        });
        setUserMovie((prev) =>
          prev
            ? { ...prev, status: "watched" }
            : {
                elo: 1000,
                matchup_count: 0,
                win_count: 0,
                loss_count: 0,
                status: "watched",
                normalizedScore: 50,
              },
        );
      } else if (existing.status !== "watched") {
        await supabase
          .from("user_movies")
          .update({ status: "watched" })
          .eq("user_id", user.id)
          .eq("movie_id", id);
        setUserMovie((prev) => (prev ? { ...prev, status: "watched" } : null));
      }

      router.push({ pathname: "/(tabs)/", params: { focusMovieId: id } });
    } finally {
      setStatusUpdating(false);
    }
  };

  const directors =
    movie?.credits?.crew?.filter((c) => c.job === "Director") ?? [];
  const topCast = movie?.credits?.cast?.slice(0, 10) ?? [];

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  if (!movie) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>Movie not found.</Text>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      {movie.poster_path ? (
        <Image
          source={{ uri: getPosterUrl(movie.poster_path)! }}
          style={styles.poster}
          resizeMode="cover"
        />
      ) : (
        <View style={styles.noPoster} />
      )}

      <View style={styles.content}>
        <Text style={styles.title}>{movie.title}</Text>
        <Text style={styles.meta}>
          {movie.release_date?.slice(0, 4)}
          {movie.runtime ? `  ·  ${movie.runtime} min` : ""}
          {movie.genres?.length > 0
            ? `  ·  ${movie.genres.map((g) => g.name).join(", ")}`
            : ""}
        </Text>

        {/* Ratings */}
        <View style={styles.ratingsRow}>
          {userMovie && userMovie.matchup_count > 0 && (
            <TouchableOpacity
              style={styles.ratingBox}
              onPress={() =>
                router.push({
                  pathname: `/movie-history/${id}`,
                  params: { title: movie?.title },
                })
              }
            >
              <Text style={styles.ratingScore}>
                {userMovie.normalizedScore}
              </Text>
              <Text style={styles.ratingLabel}>Your Rating</Text>
              <Text style={styles.ratingRecord}>
                {userMovie.win_count}W · {userMovie.loss_count}L
              </Text>
            </TouchableOpacity>
          )}
          {(!userMovie || userMovie.matchup_count === 0) && (
            <Text style={styles.noRatingText}>
              No ratings yet — start swiping!
            </Text>
          )}
        </View>

        {/* Rate Now button */}
        <TouchableOpacity
          style={[
            styles.rateButton,
            statusUpdating && styles.rateButtonDisabled,
          ]}
          onPress={handleRateNow}
          disabled={statusUpdating}
        >
          <Text style={styles.rateButtonText}>⚡ Rate This Movie Now</Text>
        </TouchableOpacity>

        {/* Status — Watched and Watchlist only */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Status</Text>
          <View style={styles.statusRow}>
            {(["watched", "watchlist"] as const).map((s) => (
              <TouchableOpacity
                key={s}
                style={[
                  styles.statusButton,
                  userMovie?.status === s && {
                    backgroundColor: STATUS_COLORS[s],
                  },
                ]}
                onPress={() => updateStatus(s)}
                disabled={statusUpdating}
              >
                <Text
                  style={[
                    styles.statusButtonText,
                    userMovie?.status === s && styles.statusButtonTextActive,
                  ]}
                >
                  {STATUS_LABELS[s]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          {userMovie?.status === "do_not_watch" && (
            <Text style={styles.notSeenNote}>
              This movie is in your "Not Seen" list. Tap Watched or Watchlist to
              add it back.
            </Text>
          )}
        </View>

        {/* Streaming / Where to Watch */}
        {watchProviders.flatrate?.length ||
        watchProviders.rent?.length ||
        watchProviders.buy?.length ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Where to Watch</Text>
            {watchProviders.flatrate?.length ? (
              <View style={styles.providerGroup}>
                <Text style={styles.providerGroupLabel}>Stream</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.providerRow}>
                    {watchProviders.flatrate.map((p) => (
                      <View key={p.provider_id} style={styles.providerItem}>
                        <Image
                          source={{
                            uri: `https://image.tmdb.org/t/p/w92${p.logo_path}`,
                          }}
                          style={styles.providerLogo}
                        />
                        <Text style={styles.providerName} numberOfLines={2}>
                          {p.provider_name}
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            ) : null}
            {watchProviders.rent?.length ? (
              <View style={styles.providerGroup}>
                <Text style={styles.providerGroupLabel}>Rent</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.providerRow}>
                    {watchProviders.rent.map((p) => (
                      <View key={p.provider_id} style={styles.providerItem}>
                        <Image
                          source={{
                            uri: `https://image.tmdb.org/t/p/w92${p.logo_path}`,
                          }}
                          style={styles.providerLogo}
                        />
                        <Text style={styles.providerName} numberOfLines={2}>
                          {p.provider_name}
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            ) : null}
            {watchProviders.buy?.length ? (
              <View style={styles.providerGroup}>
                <Text style={styles.providerGroupLabel}>Buy</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.providerRow}>
                    {watchProviders.buy.map((p) => (
                      <View key={p.provider_id} style={styles.providerItem}>
                        <Image
                          source={{
                            uri: `https://image.tmdb.org/t/p/w92${p.logo_path}`,
                          }}
                          style={styles.providerLogo}
                        />
                        <Text style={styles.providerName} numberOfLines={2}>
                          {p.provider_name}
                        </Text>
                      </View>
                    ))}
                  </View>
                </ScrollView>
              </View>
            ) : null}
            <Text style={styles.providerAttribution}>
              Streaming data provided by JustWatch
            </Text>
          </View>
        ) : null}

        {/* Overview */}
        {movie.overview ? (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Overview</Text>
            <Text style={styles.overview}>{movie.overview}</Text>
          </View>
        ) : null}

        {/* Directors */}
        {directors.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              {directors.length === 1 ? "Director" : "Directors"}
            </Text>
            <View style={styles.directorRow}>
              {directors.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  onPress={() => router.push(`/person/${d.id}`)}
                >
                  <Text style={styles.directorName}>{d.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* Cast */}
        {topCast.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cast</Text>
            {topCast.map((actor) => (
              <TouchableOpacity
                key={actor.id}
                style={styles.castRow}
                onPress={() => router.push(`/person/${actor.id}`)}
              >
                {actor.profile_path ? (
                  <Image
                    source={{
                      uri: `https://image.tmdb.org/t/p/w92${actor.profile_path}`,
                    }}
                    style={styles.castPhoto}
                  />
                ) : (
                  <View style={[styles.castPhoto, styles.noPhoto]} />
                )}
                <View style={styles.castInfo}>
                  <Text style={styles.castName}>{actor.name}</Text>
                  <Text style={styles.castCharacter}>{actor.character}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d0d0d",
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
  },
  poster: {
    width: "100%",
    height: 400,
  },
  noPoster: {
    width: "100%",
    height: 400,
    backgroundColor: "#1a1a1a",
  },
  content: {
    padding: 20,
  },
  title: {
    color: "#ffffff",
    fontSize: 24,
    fontWeight: "bold",
    marginBottom: 6,
  },
  meta: {
    color: "#888888",
    fontSize: 13,
    marginBottom: 20,
  },
  ratingsRow: {
    flexDirection: "row",
    gap: 12,
    marginBottom: 16,
  },
  ratingBox: {
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    padding: 16,
    alignItems: "center",
    minWidth: 100,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  ratingScore: {
    color: "#ffffff",
    fontSize: 32,
    fontWeight: "bold",
  },
  ratingLabel: {
    color: "#888888",
    fontSize: 12,
    marginTop: 4,
  },
  ratingRecord: {
    color: "#555555",
    fontSize: 11,
    marginTop: 4,
  },
  noRatingText: {
    color: "#555555",
    fontSize: 13,
    fontStyle: "italic",
  },
  rateButton: {
    backgroundColor: "#1a2a1a",
    borderWidth: 1,
    borderColor: "#2a4a2a",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
    marginBottom: 24,
  },
  rateButtonDisabled: {
    opacity: 0.5,
  },
  rateButtonText: {
    color: "#6fcf6f",
    fontSize: 15,
    fontWeight: "700",
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 10,
  },
  statusRow: {
    flexDirection: "row",
    gap: 8,
    flexWrap: "wrap",
  },
  statusButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  statusButtonText: {
    color: "#888888",
    fontSize: 13,
    fontWeight: "600",
  },
  statusButtonTextActive: {
    color: "#ffffff",
  },
  notSeenNote: {
    color: "#555555",
    fontSize: 12,
    fontStyle: "italic",
    marginTop: 8,
  },
  overview: {
    color: "#aaaaaa",
    fontSize: 14,
    lineHeight: 22,
  },
  directorRow: {
    gap: 8,
  },
  directorName: {
    color: "#4a9eff",
    fontSize: 15,
    fontWeight: "500",
  },
  castRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 12,
  },
  castPhoto: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },
  noPhoto: {
    backgroundColor: "#1a1a1a",
  },
  castInfo: {
    flex: 1,
  },
  castName: {
    color: "#4a9eff",
    fontSize: 14,
    fontWeight: "600",
  },
  castCharacter: {
    color: "#666666",
    fontSize: 12,
    marginTop: 2,
  },
  providerGroup: {
    marginBottom: 12,
  },
  providerGroupLabel: {
    color: "#888888",
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginBottom: 8,
  },
  providerRow: {
    flexDirection: "row",
    gap: 12,
  },
  providerItem: {
    alignItems: "center",
    width: 56,
  },
  providerLogo: {
    width: 44,
    height: 44,
    borderRadius: 10,
    marginBottom: 4,
  },
  providerName: {
    color: "#666666",
    fontSize: 10,
    textAlign: "center",
  },
  providerAttribution: {
    color: "#333333",
    fontSize: 10,
    marginTop: 8,
  },
  errorText: {
    color: "#666666",
    fontSize: 16,
  },
});
