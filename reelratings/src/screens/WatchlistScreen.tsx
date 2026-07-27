import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useState } from "react";
import {
    ActivityIndicator,
    FlatList,
    Image,
    RefreshControl,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from "react-native";
import { supabase } from "../lib/supabase";
import { getPosterUrl } from "../lib/tmdb";

interface WatchlistMovie {
  movie_id: string;
  title: string;
  poster_path: string | null;
  release_date: string | null;
}

export default function WatchlistScreen() {
  const router = useRouter();
  const [movies, setMovies] = useState<WatchlistMovie[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      loadWatchlist();
    }, []),
  );

  const loadWatchlist = async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from("user_movies")
        .select("movie_id, movies(id, title, poster_path, release_date)")
        .eq("user_id", user.id)
        .eq("status", "watchlist")
        .order("created_at", { ascending: false });

      if (data) {
        setMovies(
          data.map((row) => ({
            movie_id: row.movie_id,
            title: (row.movies as any).title,
            poster_path: (row.movies as any).poster_path,
            release_date: (row.movies as any).release_date,
          })),
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  if (movies.length === 0) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.emptyTitle}>Your watchlist is empty</Text>
        <Text style={styles.emptySubtext}>
          Swipe right on any movie in the Match tab to add it here
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      style={styles.container}
      data={movies}
      keyExtractor={(item) => item.movie_id}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={() => loadWatchlist(true)}
          tintColor="#ffffff"
        />
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={styles.row}
          onPress={() => router.push(`/movie/${item.movie_id}`)}
        >
          {item.poster_path ? (
            <Image
              source={{ uri: getPosterUrl(item.poster_path)! }}
              style={styles.poster}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.poster, styles.noPoster]} />
          )}
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={2}>
              {item.title}
            </Text>
            {item.release_date ? (
              <Text style={styles.year}>{item.release_date.slice(0, 4)}</Text>
            ) : null}
          </View>
        </TouchableOpacity>
      )}
      ItemSeparatorComponent={() => <View style={styles.separator} />}
    />
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
    padding: 32,
  },
  emptyTitle: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
    marginBottom: 10,
    textAlign: "center",
  },
  emptySubtext: {
    color: "#555555",
    fontSize: 14,
    textAlign: "center",
    lineHeight: 22,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  poster: {
    width: 50,
    height: 75,
    borderRadius: 6,
    marginRight: 14,
  },
  noPoster: {
    backgroundColor: "#1a1a1a",
  },
  info: {
    flex: 1,
  },
  title: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 4,
  },
  year: {
    color: "#666666",
    fontSize: 13,
  },
  separator: {
    height: 1,
    backgroundColor: "#1a1a1a",
    marginLeft: 80,
  },
});
