import AsyncStorage from "@react-native-async-storage/async-storage";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import FilterModal from "../components/FilterModal";
import { supabase } from "../lib/supabase";
import {
  getPosterUrl,
  searchMovies,
  searchPeople,
  TMDBSearchResult,
} from "../lib/tmdb";
import {
  countActiveFilters,
  DEFAULT_FILTERS,
  FilterState,
} from "../types/filters";

const DEFAULT_FILTERS_KEY = "@reelratings/defaultFilters_discover";
const BROWSE_LIMIT = 200;

interface DiscoverMovie {
  movie_id: string;
  predicted_score: number;
  title: string;
  poster_path: string | null;
  release_date: string;
  genres: { id: number; name: string }[] | null;
  runtime: number | null;
  original_language: string | null;
  top_cast: string[] | null;
  director: string[] | null;
  watch_providers: any | null;
}

interface PersonResult {
  id: number;
  name: string;
  profile_path: string | null;
  known_for_department: string;
}

const SORT_OPTIONS = [
  { value: "predicted_desc", label: "Best Match" },
  { value: "year_desc", label: "Newest" },
  { value: "year_asc", label: "Oldest" },
  { value: "title_asc", label: "A–Z" },
];

function applyFiltersAndSort(
  movies: DiscoverMovie[],
  filters: FilterState,
  sort: string,
  sharedUserMovieIds: Map<string, string[]>,
  userStatuses: Map<string, string>,
): DiscoverMovie[] {
  let result = movies;

  // Always hide movies the user has explicitly removed
  result = result.filter(
    (m) => userStatuses.get(m.movie_id) !== "do_not_watch",
  );

  // Status filter (Watched / Watchlist / Undiscovered)
  if (filters.statuses && filters.statuses.length > 0) {
    result = result.filter((m) => {
      const status = userStatuses.get(m.movie_id) ?? null;
      return filters.statuses.some((s) => {
        if (s === "watched") return status === "watched";
        if (s === "watchlist") return status === "watchlist";
        if (s === "undiscovered") return status === null;
        return false;
      });
    });
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
      sorted.sort((a, b) => b.predicted_score - a.predicted_score);
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

export default function DiscoverScreen() {
  const router = useRouter();

  // Browse mode state
  const [browseMovies, setBrowseMovies] = useState<DiscoverMovie[]>([]);
  const [displayed, setDisplayed] = useState<DiscoverMovie[]>([]);
  const [userStatuses, setUserStatuses] = useState<Map<string, string>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState("predicted_desc");
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [filterModalVisible, setFilterModalVisible] = useState(false);
  const [sharedUserMovieIds, setSharedUserMovieIds] = useState<
    Map<string, string[]>
  >(new Map());

  // Search mode state
  const [query, setQuery] = useState("");
  const [searchTab, setSearchTab] = useState<"movies" | "people">("movies");
  const [searchMovieResults, setSearchMovieResults] = useState<
    TMDBSearchResult[]
  >([]);
  const [searchPeopleResults, setSearchPeopleResults] = useState<
    PersonResult[]
  >([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const isSearchMode = query.trim().length > 0;

  // Load saved default filters
  useEffect(() => {
    AsyncStorage.getItem(DEFAULT_FILTERS_KEY)
      .then((saved) => {
        if (saved) setFilters(JSON.parse(saved));
      })
      .catch(() => {});
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadBrowseMovies();
    }, []),
  );

  // Re-apply filters/sort whenever inputs change (browse mode)
  useEffect(() => {
    if (!isSearchMode) {
      setDisplayed(
        applyFiltersAndSort(
          browseMovies,
          filters,
          sort,
          sharedUserMovieIds,
          userStatuses,
        ),
      );
    }
  }, [
    browseMovies,
    filters,
    sort,
    sharedUserMovieIds,
    userStatuses,
    isSearchMode,
  ]);

  // Fetch shared watchlist movie IDs when shared usernames filter changes
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

  // Debounced TMDB search when query changes
  useEffect(() => {
    if (!query.trim()) {
      setSearchMovieResults([]);
      setSearchPeopleResults([]);
      setHasSearched(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      setHasSearched(true);
      try {
        const [movies, people] = await Promise.all([
          searchMovies(query),
          searchPeople(query),
        ]);
        setSearchMovieResults(movies.slice(0, 20));
        setSearchPeopleResults(people.slice(0, 20));
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [query]);

  const loadBrowseMovies = async () => {
    setLoading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch top predicted movies with movie details
      const { data: predictions } = await supabase
        .from("movie_predictions")
        .select(
          `movie_id, score,
          movies(title, poster_path, release_date, genres, runtime,
                 original_language, top_cast, director, watch_providers)`,
        )
        .eq("user_id", user.id)
        .order("score", { ascending: false })
        .limit(BROWSE_LIMIT);

      // Fetch user's current movie statuses
      const { data: userMovies } = await supabase
        .from("user_movies")
        .select("movie_id, status")
        .eq("user_id", user.id);

      const statusMap = new Map<string, string>();
      (userMovies ?? []).forEach((um: any) => {
        statusMap.set(um.movie_id, um.status);
      });
      setUserStatuses(statusMap);

      if (!predictions || predictions.length === 0) {
        setBrowseMovies([]);
        return;
      }

      const movies: DiscoverMovie[] = predictions
        .filter((p) => p.movies)
        .map((p) => {
          const m = p.movies as any;
          return {
            movie_id: p.movie_id,
            predicted_score: Math.round(p.score),
            title: m.title,
            poster_path: m.poster_path,
            release_date: m.release_date ?? "",
            genres: m.genres,
            runtime: m.runtime,
            original_language: m.original_language,
            top_cast: m.top_cast,
            director: m.director,
            watch_providers: m.watch_providers,
          };
        });

      setBrowseMovies(movies);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToWatchlist = async (movieId: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    // Optimistic update
    setUserStatuses((prev) => new Map(prev).set(movieId, "watchlist"));

    const { error } = await supabase.from("user_movies").insert({
      user_id: user.id,
      movie_id: movieId,
      status: "watchlist",
      elo: 1000,
      matchup_count: 0,
      win_count: 0,
      loss_count: 0,
    });

    if (error) {
      // Revert on failure
      setUserStatuses((prev) => {
        const next = new Map(prev);
        next.delete(movieId);
        return next;
      });
    }
  };

  const handleSetDefault = () => {
    AsyncStorage.setItem(DEFAULT_FILTERS_KEY, JSON.stringify(filters)).catch(
      () => {},
    );
  };

  const handleClearDefault = () => {
    AsyncStorage.removeItem(DEFAULT_FILTERS_KEY).catch(() => {});
  };

  // Derived filter options from browse movies
  const availableGenres = useMemo(() => {
    const set = new Set<string>();
    browseMovies.forEach((m) =>
      (m.genres ?? []).forEach((g) => g.name && set.add(g.name)),
    );
    return Array.from(set).sort();
  }, [browseMovies]);

  const availableLanguages = useMemo(() => {
    const set = new Set<string>();
    browseMovies.forEach(
      (m) => m.original_language && set.add(m.original_language),
    );
    return Array.from(set).sort();
  }, [browseMovies]);

  const availableServices = useMemo(() => {
    const set = new Set<string>();
    browseMovies.forEach((m) =>
      (m.watch_providers?.flatrate ?? []).forEach(
        (p: any) => p.provider_name && set.add(p.provider_name),
      ),
    );
    return Array.from(set).sort();
  }, [browseMovies]);

  const allActors = useMemo(() => {
    const set = new Set<string>();
    browseMovies.forEach((m) => (m.top_cast ?? []).forEach((a) => set.add(a)));
    return Array.from(set).sort();
  }, [browseMovies]);

  const allDirectors = useMemo(() => {
    const set = new Set<string>();
    browseMovies.forEach((m) => (m.director ?? []).forEach((d) => set.add(d)));
    return Array.from(set).sort();
  }, [browseMovies]);

  const runtimeBounds = useMemo(() => {
    const runtimes = browseMovies
      .filter((m) => m.runtime !== null)
      .map((m) => m.runtime!);
    return {
      min: runtimes.length > 0 ? Math.min(...runtimes) : 0,
      max: runtimes.length > 0 ? Math.max(...runtimes) : 300,
    };
  }, [browseMovies]);

  const activeFilterCount = countActiveFilters(filters);

  // ─── Render helpers ───────────────────────────────────────────────────────

  const renderBrowseItem = ({ item }: { item: DiscoverMovie }) => {
    const status = userStatuses.get(item.movie_id) ?? null;
    const onWatchlist = status === "watchlist";
    const inLibrary = status === "watched";

    return (
      <TouchableOpacity
        style={styles.row}
        onPress={() => router.push(`/movie/${item.movie_id}`)}
      >
        {item.poster_path ? (
          <Image
            source={{ uri: getPosterUrl(item.poster_path)! }}
            style={styles.poster}
          />
        ) : (
          <View style={[styles.poster, styles.noPoster]} />
        )}
        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          <Text style={styles.meta}>
            {item.release_date?.slice(0, 4)}
            {item.genres && item.genres.length > 0
              ? `  ·  ${item.genres
                  .slice(0, 2)
                  .map((g) => g.name)
                  .join(", ")}`
              : ""}
          </Text>
        </View>
        <View style={styles.rowRight}>
          <View style={styles.scoreBox}>
            <Text style={styles.score}>{item.predicted_score}</Text>
            <Text style={styles.scoreLabel}>PRED</Text>
          </View>
          {inLibrary ? (
            <View style={styles.libraryBadge}>
              <Text style={styles.libraryBadgeText}>★</Text>
            </View>
          ) : onWatchlist ? (
            <View style={[styles.addBtn, styles.addBtnAdded]}>
              <Text style={styles.addBtnText}>✓</Text>
            </View>
          ) : status === "do_not_watch" ? null : (
            <TouchableOpacity
              style={styles.addBtn}
              onPress={() => handleAddToWatchlist(item.movie_id)}
            >
              <Text style={styles.addBtnText}>＋</Text>
            </TouchableOpacity>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  const renderSearchMovie = ({ item }: { item: TMDBSearchResult }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push(`/movie/${item.id}`)}
    >
      {item.poster_path ? (
        <Image
          source={{ uri: getPosterUrl(item.poster_path)! }}
          style={styles.poster}
        />
      ) : (
        <View style={[styles.poster, styles.noPoster]} />
      )}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>
          {item.title}
        </Text>
        <Text style={styles.meta}>{item.release_date?.slice(0, 4)}</Text>
        {item.overview ? (
          <Text style={styles.overview} numberOfLines={2}>
            {item.overview}
          </Text>
        ) : null}
      </View>
    </TouchableOpacity>
  );

  const renderSearchPerson = ({ item }: { item: PersonResult }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push(`/person/${item.id}`)}
    >
      {item.profile_path ? (
        <Image
          source={{
            uri: `https://image.tmdb.org/t/p/w92${item.profile_path}`,
          }}
          style={styles.personPhoto}
        />
      ) : (
        <View style={[styles.personPhoto, styles.noPoster]} />
      )}
      <View style={styles.info}>
        <Text style={styles.title}>{item.name}</Text>
        <Text style={styles.meta}>{item.known_for_department}</Text>
      </View>
    </TouchableOpacity>
  );

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <View style={styles.container}>
      {/* Search bar + filter button */}
      <View style={styles.topRow}>
        <TextInput
          style={styles.searchBar}
          placeholder="Search movies, actors, directors..."
          placeholderTextColor="#555555"
          value={query}
          onChangeText={setQuery}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
        />
        {!isSearchMode && (
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
        )}
      </View>

      {/* ─── BROWSE MODE ─── */}
      {!isSearchMode && (
        <>
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

          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color="#ffffff" />
            </View>
          ) : displayed.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>
                {browseMovies.length === 0
                  ? "Keep swiping to unlock predictions!"
                  : "No results match your filters."}
              </Text>
              {browseMovies.length > 0 && activeFilterCount > 0 && (
                <TouchableOpacity onPress={() => setFilters(DEFAULT_FILTERS)}>
                  <Text style={styles.clearLink}>Clear filters</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <FlatList
              data={displayed}
              keyExtractor={(item) => item.movie_id}
              renderItem={renderBrowseItem}
              contentContainerStyle={styles.list}
              onRefresh={loadBrowseMovies}
              refreshing={loading}
            />
          )}
        </>
      )}

      {/* ─── SEARCH MODE ─── */}
      {isSearchMode && (
        <>
          <View style={styles.searchTabs}>
            <TouchableOpacity
              style={[
                styles.searchTab,
                searchTab === "movies" && styles.searchTabActive,
              ]}
              onPress={() => setSearchTab("movies")}
            >
              <Text
                style={[
                  styles.searchTabText,
                  searchTab === "movies" && styles.searchTabTextActive,
                ]}
              >
                Movies{" "}
                {hasSearched && !searching
                  ? `(${searchMovieResults.length})`
                  : ""}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                styles.searchTab,
                searchTab === "people" && styles.searchTabActive,
              ]}
              onPress={() => setSearchTab("people")}
            >
              <Text
                style={[
                  styles.searchTabText,
                  searchTab === "people" && styles.searchTabTextActive,
                ]}
              >
                People{" "}
                {hasSearched && !searching
                  ? `(${searchPeopleResults.length})`
                  : ""}
              </Text>
            </TouchableOpacity>
          </View>

          {searching ? (
            <View style={styles.centered}>
              <ActivityIndicator size="large" color="#ffffff" />
            </View>
          ) : !hasSearched ? (
            <View style={styles.centered}>
              <Text style={styles.hintText}>
                Search for a movie, actor, or director
              </Text>
            </View>
          ) : searchTab === "movies" && searchMovieResults.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>
                No movies found for "{query}"
              </Text>
            </View>
          ) : searchTab === "people" && searchPeopleResults.length === 0 ? (
            <View style={styles.centered}>
              <Text style={styles.emptyText}>
                No people found for "{query}"
              </Text>
            </View>
          ) : searchTab === "movies" ? (
            <FlatList
              data={searchMovieResults}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderSearchMovie}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
            />
          ) : (
            <FlatList
              data={searchPeopleResults}
              keyExtractor={(item) => String(item.id)}
              renderItem={renderSearchPerson}
              contentContainerStyle={styles.list}
              keyboardShouldPersistTaps="handled"
            />
          )}
        </>
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
        showStatusFilter
        onSetDefault={handleSetDefault}
        onClearDefault={handleClearDefault}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0d0d0d" },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  list: { paddingHorizontal: 12, paddingBottom: 24 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  poster: { width: 46, height: 68, borderRadius: 4, marginRight: 12 },
  personPhoto: {
    width: 46,
    height: 46,
    borderRadius: 23,
    marginRight: 12,
  },
  noPoster: { backgroundColor: "#1a1a1a" },
  info: { flex: 1, marginRight: 8 },
  title: { color: "#ffffff", fontSize: 15, fontWeight: "600" },
  meta: { color: "#666666", fontSize: 12, marginTop: 3 },
  overview: {
    color: "#555555",
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18,
  },
  rowRight: { alignItems: "center", gap: 6 },
  scoreBox: {
    backgroundColor: "#1a1a1a",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: "center",
    minWidth: 44,
  },
  score: { color: "#ffffff", fontSize: 15, fontWeight: "bold" },
  scoreLabel: { color: "#555555", fontSize: 9, fontWeight: "600" },
  addBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#e8572a",
    alignItems: "center",
    justifyContent: "center",
  },
  addBtnAdded: { backgroundColor: "#2a5c2a" },
  addBtnText: { color: "#ffffff", fontSize: 16, fontWeight: "700" },
  libraryBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    alignItems: "center",
    justifyContent: "center",
  },
  libraryBadgeText: { color: "#888888", fontSize: 13 },
  emptyText: {
    color: "#555555",
    fontSize: 15,
    textAlign: "center",
    paddingHorizontal: 32,
  },
  clearLink: { color: "#e8572a", fontSize: 14, marginTop: 12 },
  hintText: { color: "#444444", fontSize: 14 },
  searchTabs: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#2a2a2a",
  },
  searchTab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: "center",
  },
  searchTabActive: {
    borderBottomWidth: 2,
    borderBottomColor: "#ffffff",
  },
  searchTabText: { color: "#555555", fontSize: 14, fontWeight: "600" },
  searchTabTextActive: { color: "#ffffff" },
});
