import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
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
  getPersonDetails,
  getPersonMovieCredits,
  getPosterUrl,
  TMDBPerson,
  TMDBPersonCredit,
} from "../lib/tmdb";

interface RankedCredit extends TMDBPersonCredit {
  elo?: number;
  normalizedScore?: number;
  matchup_count?: number;
  predicted_score?: number;
  inLibrary: boolean; // user has watched and rated this movie
  inWatchlist: boolean; // movie is on user's watchlist (has predicted score)
}

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();

  const [person, setPerson] = useState<TMDBPerson | null>(null);
  const [credits, setCredits] = useState<RankedCredit[]>([]);
  const [affinityScore, setAffinityScore] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"your" | "all">("your");

  useEffect(() => {
    if (id) loadPerson(id);
  }, [id]);

  const loadPerson = async (personId: string) => {
    setLoading(true);
    try {
      const [details, movieCredits] = await Promise.all([
        getPersonDetails(Number(personId)),
        getPersonMovieCredits(Number(personId)),
      ]);
      setPerson(details);

      // Combine cast and crew credits, deduplicate by movie id
      const allCredits = new Map<number, TMDBPersonCredit>();
      for (const c of movieCredits.cast ?? []) allCredits.set(c.id, c);
      for (const c of movieCredits.crew ?? []) {
        if (!allCredits.has(c.id)) allCredits.set(c.id, c);
      }

      const creditList = Array.from(allCredits.values()).filter(
        (c) => c.release_date,
      );

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const movieIds = creditList.map((c) => String(c.id));

      // Fetch rated movies (ELO) and all predicted scores in parallel
      const [watchedResp, predictionsResp] = await Promise.all([
        supabase
          .from("user_movies")
          .select("movie_id, elo, matchup_count")
          .eq("user_id", user.id)
          .eq("status", "watched")
          .in("movie_id", movieIds),
        supabase
          .from("movie_predictions")
          .select("movie_id, score")
          .eq("user_id", user.id)
          .in("movie_id", movieIds),
      ]);

      const watchedMap = new Map<
        string,
        { elo: number; matchup_count: number }
      >();
      for (const um of watchedResp.data ?? []) {
        watchedMap.set(um.movie_id, {
          elo: um.elo,
          matchup_count: um.matchup_count,
        });
      }

      const predictionsMap = new Map<string, number>(); // movie_id → predicted score
      for (const p of predictionsResp.data ?? []) {
        predictionsMap.set(p.movie_id, p.score);
      }

      // Normalize ELOs across the user's rated films for this person
      const elos = Array.from(watchedMap.values()).map((v) => v.elo);
      const minElo = elos.length > 0 ? Math.min(...elos) : 0;
      const maxElo = elos.length > 0 ? Math.max(...elos) : 0;

      const ranked: RankedCredit[] = creditList.map((c) => {
        const mid = String(c.id);
        const watchedData = watchedMap.get(mid);
        const predictedScore = predictionsMap.get(mid);
        return {
          ...c,
          elo: watchedData?.elo,
          matchup_count: watchedData?.matchup_count,
          normalizedScore: watchedData
            ? normalizeElo(watchedData.elo, minElo, maxElo)
            : undefined,
          predicted_score: predictedScore,
          inLibrary: !!watchedData,
          inWatchlist: false, // no longer used — predictions come from movie_predictions table
        };
      });

      // Unified sort: all scored movies together by best available score (0-100 scale),
      // unscored movies fall to the bottom sorted by release date
      const getScore = (c: RankedCredit): number => {
        if (c.inLibrary && c.normalizedScore !== undefined)
          return c.normalizedScore;
        if (c.predicted_score !== undefined) return c.predicted_score;
        return -1;
      };
      ranked.sort((a, b) => {
        const sa = getScore(a),
          sb = getScore(b);
        if (sa >= 0 && sb >= 0) return sb - sa;
        if (sa >= 0) return -1;
        if (sb >= 0) return 1;
        return (b.release_date ?? "").localeCompare(a.release_date ?? "");
      });

      setCredits(ranked);

      // Fetch affinity score, normalized 0-100 against all actors/directors in the user's profile
      const department = details?.known_for_department;
      const personName = details?.name;
      if (personName) {
        const table =
          department === "Directing"
            ? "director_affinity_scores"
            : "actor_affinity_scores";
        const nameCol =
          department === "Directing" ? "director_name" : "actor_name";

        // Fetch all scores for this user to compute min/max for normalization
        const { data: allScores } = await supabase
          .from(table)
          .select(`${nameCol}, score`)
          .eq("user_id", user.id);

        if (allScores && allScores.length > 0) {
          const thisRow = allScores.find((r: any) => r[nameCol] === personName);
          if (thisRow) {
            const rawScores = allScores.map((r: any) => r.score as number);
            const minS = Math.min(...rawScores);
            const maxS = Math.max(...rawScores);
            const normalized =
              maxS > minS
                ? Math.round(((thisRow.score - minS) / (maxS - minS)) * 100)
                : 50;
            setAffinityScore(normalized);
          }
        }
      }
    } finally {
      setLoading(false);
    }
  };

  // "Your Rankings" tab: only rated movies, sorted by ELO (already at top of list)
  // "All Films" tab: everything, sorted by unified score
  const displayedCredits =
    tab === "your" ? credits.filter((c) => c.inLibrary) : credits;

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  if (!person) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>Person not found.</Text>
      </View>
    );
  }

  const ratedCount = credits.filter((c) => c.inLibrary).length;

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {person.profile_path ? (
          <Image
            source={{
              uri: `https://image.tmdb.org/t/p/w185${person.profile_path}`,
            }}
            style={styles.photo}
          />
        ) : (
          <View style={[styles.photo, styles.noPhoto]} />
        )}
        <View style={styles.headerInfo}>
          <Text style={styles.name}>{person.name}</Text>
          <Text style={styles.department}>{person.known_for_department}</Text>
          {person.birthday && (
            <Text style={styles.birthday}>
              Born{" "}
              {new Date(person.birthday).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </Text>
          )}
          <Text style={styles.libraryCount}>
            {ratedCount} film{ratedCount !== 1 ? "s" : ""} rated
          </Text>

          {/* Affinity score — only shown when enough data exists */}
          {affinityScore !== null && (
            <View style={styles.affinityRow}>
              <Text style={styles.affinityLabel}>Your Rating</Text>
              <Text style={styles.affinityValue}>{affinityScore}</Text>
            </View>
          )}
        </View>
      </View>

      {/* Bio */}
      {person.biography ? (
        <View style={styles.bioSection}>
          <Text style={styles.bio} numberOfLines={4}>
            {person.biography}
          </Text>
        </View>
      ) : null}

      {/* Tab toggle */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === "your" && styles.tabActive]}
          onPress={() => setTab("your")}
        >
          <Text
            style={[styles.tabText, tab === "your" && styles.tabTextActive]}
          >
            Your Rankings
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === "all" && styles.tabActive]}
          onPress={() => setTab("all")}
        >
          <Text style={[styles.tabText, tab === "all" && styles.tabTextActive]}>
            All Films
          </Text>
        </TouchableOpacity>
      </View>

      {/* Film list */}
      <View style={styles.filmList}>
        {displayedCredits.length === 0 ? (
          <Text style={styles.emptyText}>
            {tab === "your"
              ? "None of their films are in your library yet."
              : "No films found."}
          </Text>
        ) : (
          displayedCredits.map((credit, index) => (
            <TouchableOpacity
              key={`${credit.id}-${index}`}
              style={styles.filmRow}
              onPress={() => router.push(`/movie/${credit.id}`)}
            >
              {credit.poster_path ? (
                <Image
                  source={{ uri: getPosterUrl(credit.poster_path)! }}
                  style={styles.poster}
                />
              ) : (
                <View style={[styles.poster, styles.noPoster]} />
              )}

              <View style={styles.filmInfo}>
                <Text style={styles.filmTitle} numberOfLines={2}>
                  {credit.title}
                </Text>
                <Text style={styles.filmMeta}>
                  {credit.release_date?.slice(0, 4)}
                  {credit.character ? `  ·  ${credit.character}` : ""}
                  {credit.job ? `  ·  ${credit.job}` : ""}
                </Text>
              </View>

              {credit.inLibrary && credit.normalizedScore !== undefined ? (
                // Rated movie — show actual ELO score
                <View style={styles.scoreBox}>
                  <Text style={styles.score}>{credit.normalizedScore}</Text>
                </View>
              ) : credit.predicted_score !== undefined ? (
                // Unrated movie — show predicted score with PRED label
                <View style={styles.scoreBox}>
                  <Text style={styles.scoreLabel}>PRED</Text>
                  <Text style={styles.score}>
                    {Math.round(credit.predicted_score)}
                  </Text>
                </View>
              ) : (
                // No score available
                <View style={styles.notRatedBox}>
                  <Text style={styles.notRatedText}>—</Text>
                </View>
              )}
            </TouchableOpacity>
          ))
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
  header: {
    flexDirection: "row",
    padding: 20,
    gap: 16,
  },
  photo: {
    width: 90,
    height: 120,
    borderRadius: 8,
  },
  noPhoto: {
    backgroundColor: "#1a1a1a",
  },
  headerInfo: {
    flex: 1,
    justifyContent: "center",
    gap: 4,
  },
  name: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "bold",
  },
  department: {
    color: "#888888",
    fontSize: 13,
  },
  birthday: {
    color: "#666666",
    fontSize: 12,
  },
  libraryCount: {
    color: "#555555",
    fontSize: 12,
    marginTop: 4,
  },
  affinityRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 8,
  },
  affinityLabel: {
    color: "#888888",
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  affinityValue: {
    color: "#ffffff",
    fontSize: 20,
    fontWeight: "bold",
  },
  bioSection: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  bio: {
    color: "#888888",
    fontSize: 13,
    lineHeight: 20,
  },
  tabs: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#2a2a2a",
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: "center",
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: "#ffffff",
  },
  tabText: {
    color: "#555555",
    fontSize: 14,
    fontWeight: "600",
  },
  tabTextActive: {
    color: "#ffffff",
  },
  filmList: {
    padding: 12,
  },
  filmRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  poster: {
    width: 46,
    height: 68,
    borderRadius: 4,
    marginRight: 12,
  },
  noPoster: {
    backgroundColor: "#1a1a1a",
  },
  filmInfo: {
    flex: 1,
    marginRight: 8,
  },
  filmTitle: {
    color: "#ffffff",
    fontSize: 15,
    fontWeight: "600",
  },
  filmMeta: {
    color: "#666666",
    fontSize: 12,
    marginTop: 4,
  },
  scoreBox: {
    backgroundColor: "#1a1a1a",
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 44,
    alignItems: "center",
  },
  scoreLabel: {
    color: "#555555",
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  score: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "bold",
  },
  notRatedBox: {
    minWidth: 44,
    alignItems: "center",
  },
  notRatedText: {
    color: "#444444",
    fontSize: 16,
  },
  errorText: {
    color: "#666666",
    fontSize: 16,
  },
  emptyText: {
    color: "#555555",
    fontSize: 14,
    textAlign: "center",
    paddingVertical: 32,
  },
});
