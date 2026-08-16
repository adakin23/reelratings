import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import FilterModal from "../components/FilterModal";
import { supabase } from "../lib/supabase";
import { getPosterUrl } from "../lib/tmdb";
import {
  DEFAULT_FILTERS,
  FilterState,
  countActiveFilters,
} from "../types/filters";

interface WatchlistMovie {
  movie_id: string;
  predicted_score: number | null;
  title: string;
  poster_path: string | null;
  release_date: string | null;
  genres: { id: number; name: string }[] | null;
  runtime: number | null;
  original_language: string | null;
  top_cast: string[] | null;
  director: string[] | null;
  watch_providers: any | null;
}

const SORT_OPTIONS = [
  { value: "added_desc", label: "Recently Added" },
  { value: "predicted_desc", label: "Predicted" },
  { value: "year_desc", label: "Newest" },
  { value: "year_asc", label: "Oldest" },
  { value: "title_asc", label: "A–Z" },
];

function applyFiltersAndSort(
  movies: WatchlistMovie[],
  search: string,
  filters: FilterState,
  sort: string,
  sharedUserMovieIds: Map<string, string[]>,
): WatchlistMovie[] {
  let result = movies;

  if (search.trim()) {
    const q = search.toLowerCase();
    result = result.filter((m) => m.title.toLowerCase().includes(q));
  }

  if (filters.genres.length > 0) {
    result = result.filter((m) => {
      const names = (m.genres ?? []).map((g) => g.name);
      return filters.genres.some((g) => names.includes(g));
    });
  }

  if (filters.yearMin) {
    const min = parseInt(filters.yearMin);
    result = result.filter((m) => {
      const y = m.release_date ? parseInt(m.release_date.slice(0, 4)) : 0;
      return y >= min;
    });
  }

  if (filters.yearMax) {
    const max = parseInt(filters.yearMax);
    result = result.filter((m) => {
      const y = m.release_date ? parseInt(m.release_date.slice(0, 4)) : 9999;
      return y <= max;
    });
  }

  if (filters.runtimeMin > 0 || filters.runtimeMax < 300) {
    result = result.filter((m) => {
      if (m.runtime === null) return true;
      return m.runtime >= filters.runtimeMin && m.runtime <= filters.runtimeMax;
    });
  }

  if (filters.languages.length > 0) {
    result = result.filter((m) =>
      filters.languages.includes(m.original_language ?? ""),
    );
  }

  if (filters.actors.length > 0) {
    result = result.filter((m) =>
      filters.actors.some((a) => (m.top_cast ?? []).includes(a)),
    );
  }

  if (filters.directors.length > 0) {
    result = result.filter((m) =>
      filters.directors.some((d) => (m.director ?? []).includes(d)),
    );
  }

  if (filters.streamingServices.length > 0) {
    result = result.filter((m) => {
      const providers = (m.watch_providers?.flatrate ?? []).map(
        (p: any) => p.provider_name,
      );
      return filters.streamingServices.some((s) => providers.includes(s));
    });
  }

  if (filters.sharedWithUsernames.length > 0) {
    result = result.filter((m) =>
      filters.sharedWithUsernames.every((username) =>
        (sharedUserMovieIds.get(username) ?? []).includes(m.movie_id),
      ),
    );
  }

  const sorted = [...result];
  switch (sort) {
    case "predicted_desc":
      // Movies with no score go to the bottom
      sorted.sort(
        (a, b) => (b.predicted_score ?? -1) - (a.predicted_score ?? -1),
      );
      break;
    case "year_desc":
      sorted.sort((a, b) =>
        (b.release_date ?? "").localeCompare(a.release_date ?? ""),
      );
      break;
    case "year_asc":
      sorted.sort((a, b) =>
        (a.release_date ?? "").localeCompare(b.release_date ?? ""),
      );
      break;
    case "title_asc":
      sorted.sort((a, b) => a.title.localeCompare(b.title));
      break;
  }

  return sorted;
}

export default function WatchlistScreen() {
  const router = useRouter();
  const [movies, setMovies] = useState<WatchlistMovie[]>([]);
  const [displayed, setDisplayed] = useState<WatchlistMovie[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("added_desc");
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [sharedUserMovieIds, setSharedUserMovieIds] = useState<
    Map<string, string[]>
  >(new Map());

  useFocusEffect(
    useCallback(() => {
      loadWatchlist();
    }, []),
  );

  useEffect(() => {
    setDisplayed(
      applyFiltersAndSort(movies, search, filters, sort, sharedUserMovieIds),
    );
  }, [movies, search, filters, sort, sharedUserMovieIds]);

  useEffect(() => {
    if (filters.sharedWithUsernames.length === 0) {
      setSharedUserMovieIds(new Map());
      return;
    }
    const fetchSharedMovies = async () => {
      const newMap = new Map<string, string[]>();
      await Promise.all(
        filters.sharedWithUsernames.map(async (username) => {
          const { data: profile } = await supabase
            .from("profiles")
            .select("id")
            .eq("username", username)
            .single();
          if (!profile) return;
          const { data: watchlist } = await supabase
            .from("user_movies")
            .select("movie_id")
            .eq("user_id", profile.id)
            .eq("status", "watchlist");
          if (watchlist) {
            newMap.set(
              username,
              watchlist.map((w: any) => w.movie_id),
            );
          }
        }),
      );
      setSharedUserMovieIds(newMap);
    };
    fetchSharedMovies();
  }, [filters.sharedWithUsernames]);

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
        .select(
          `movie_id, predicted_score,
          movies(id, title, poster_path, release_date, genres, runtime,
                 original_language, top_cast, director, watch_providers)`,
        )
        .eq("user_id", user.id)
        .eq("status", "watchlist")
        .order("created_at", { ascending: false });

      if (data) {
        setMovies(
          data.map((row) => {
            const m = row.movies as any;
            return {
              movie_id: row.movie_id,
              predicted_score: (row as any).predicted_score ?? null,
              title: m.title,
              poster_path: m.poster_path,
              release_date: m.release_date,
              genres: m.genres,
              runtime: m.runtime,
              original_language: m.original_language,
              top_cast: m.top_cast,
              director: m.director,
              watch_providers: m.watch_providers,
            };
          }),
        );
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    movies.forEach((m) =>
      (m.genres ?? []).forEach((g) => g.name && set.add(g.name)),
    );
    return Array.from(set).sort();
  }, [movies]);

  const availableLanguages = useMemo(() => {
    const set = new Set<string>();
    movies.forEach((m) => m.original_language && set.add(m.original_language));
    return Array.from(set).sort();
  }, [movies]);

  const availableServices = useMemo(() => {
    const set = new Set<string>();
    movies.forEach((m) =>
      (m.watch_providers?.flatrate ?? []).forEach(
        (p: any) => p.provider_name && set.add(p.provider_name),
      ),
    );
    return Array.from(set).sort();
  }, [movies]);

  const allActors = useMemo(() => {
    const set = new Set<string>();
    movies.forEach((m) => (m.top_cast ?? []).forEach((a) => set.add(a)));
    return Array.from(set).sort();
  }, [movies]);

  const allDirectors = useMemo(() => {
    const set = new Set<string>();
    movies.forEach((m) => (m.director ?? []).forEach((d) => set.add(d)));
    return Array.from(set).sort();
  }, [movies]);

  const runtimeBounds = useMemo(() => {
    const runtimes = movies
      .filter((m) => m.runtime !== null)
      .map((m) => m.runtime!);
    return {
      min: runtimes.length > 0 ? Math.min(...runtimes) : 0,
      max: runtimes.length > 0 ? Math.max(...runtimes) : 300,
    };
  }, [movies]);

  const activeFilterCount = countActiveFilters(filters);

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  const isEmpty = movies.length === 0;
  const noResults = !isEmpty && displayed.length === 0;

  return (
    <View style={styles.container}>
      {/* Search + Filter row */}
      <View style={styles.topRow}>
        <TextInput
          style={styles.searchBar}
          placeholder="Search watchlist..."
          placeholderTextColor="#555555"
          value={search}
          onChangeText={setSearch}
        />
        <TouchableOpacity
          style={[
            styles.filterBtn,
            activeFilterCount > 0 && styles.filterBtnActive,
          ]}
          onPress={() => setFilterModalVisible(true)}
        >
          <Text
            style={[
              styles.filterBtnText,
              activeFilterCount > 0 && styles.filterBtnTextActive,
            ]}
          >
            {activeFilterCount > 0
              ? `Filters (${activeFilterCount})`
              : "Filters"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Import button */}
      <TouchableOpacity
        style={styles.importButton}
        onPress={() => router.push("/import")}
      >
        <Text style={styles.importButtonText}>↑ Import from Letterboxd</Text>
      </TouchableOpacity>

      {/* Sort chips */}
      <View style={styles.sortRow}>
        {SORT_OPTIONS.map((opt) => (
          <TouchableOpacity
            key={opt.value}
            style={[
              styles.sortChip,
              sort === opt.value && styles.sortChipActive,
            ]}
            onPress={() => setSort(opt.value)}
          >
            <Text
              style={[
                styles.sortChipText,
                sort === opt.value && styles.sortChipTextActive,
              ]}
            >
              {opt.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {isEmpty ? (
        <View style={[styles.centered, { flex: 1 }]}>
          <Text style={styles.emptyTitle}>Your watchlist is empty</Text>
          <Text style={styles.emptySubtext}>
            Swipe right on any movie in the Match tab to add it here
          </Text>
        </View>
      ) : noResults ? (
        <View style={[styles.centered, { flex: 1 }]}>
          <Text style={styles.emptyTitle}>No results match your filters</Text>
          <TouchableOpacity
            onPress={() => {
              setFilters(DEFAULT_FILTERS);
              setSearch("");
            }}
          >
            <Text style={styles.clearLink}>Clear filters</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={displayed}
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
                  <Text style={styles.year}>
                    {item.release_date.slice(0, 4)}
                  </Text>
                ) : null}
              </View>
              {item.predicted_score !== null && (
                <View style={styles.scoreBox}>
                  <Text style={styles.scoreLabel}>PRED</Text>
                  <Text style={styles.score}>
                    {Math.round(item.predicted_score)}
                  </Text>
                </View>
              )}
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
        />
      )}

      <FilterModal
        visible={filterModalVisible}
        onClose={() => setFilterModalVisible(false)}
        filters={filters}
        onFiltersChange={setFilters}
        availableGenres={availableGenres}
        availableLanguages={availableLanguages}
        availableServices={availableServices}
        allActors={allActors}
        allDirectors={allDirectors}
        runtimeBounds={runtimeBounds}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  centered: { alignItems: "center", justifyContent: "center", padding: 32 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    margin: 12,
    marginBottom: 6,
    gap: 8,
  },
  searchBar: {
    flex: 1,
    padding: 10,
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    color: "#ffffff",
    fontSize: 15,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  filterBtn: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  filterBtnActive: { backgroundColor: "#e8572a", borderColor: "#e8572a" },
  filterBtnText: { color: "#aaaaaa", fontSize: 14, fontWeight: "600" },
  filterBtnTextActive: { color: "#ffffff" },
  importButton: {
    marginHorizontal: 12,
    marginBottom: 8,
    padding: 10,
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  importButtonText: { color: "#e8572a", fontSize: 14, fontWeight: "600" },
  sortRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 12,
    gap: 8,
    marginBottom: 8,
  },
  sortChip: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  sortChipActive: { backgroundColor: "#ffffff", borderColor: "#ffffff" },
  sortChipText: { color: "#666666", fontSize: 13 },
  sortChipTextActive: { color: "#0d0d0d", fontWeight: "700" },
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
  clearLink: { color: "#e8572a", fontSize: 14, marginTop: 12 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  poster: { width: 50, height: 75, borderRadius: 6, marginRight: 14 },
  noPoster: { backgroundColor: "#1a1a1a" },
  info: { flex: 1 },
  title: { color: "#ffffff", fontSize: 15, fontWeight: "600", marginBottom: 4 },
  year: { color: "#666666", fontSize: 13 },
  separator: { height: 1, backgroundColor: "#1a1a1a", marginLeft: 80 },
  scoreBox: {
    backgroundColor: "#1a1a1a",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: "center",
    minWidth: 44,
  },
  scoreLabel: {
    color: "#555555",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  score: { color: "#ffffff", fontSize: 16, fontWeight: "bold" },
});
