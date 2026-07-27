import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import {
    ActivityIndicator,
    Dimensions,
    ScrollView,
    StyleSheet,
    Text,
    View,
} from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";
import { supabase } from "../lib/supabase";

const CHART_WIDTH = Dimensions.get("window").width - 40;
const CHART_HEIGHT = 110;

interface EloPoint {
  elo: number;
  matchup_count: number;
  created_at: string;
}

interface MatchupRecord {
  id: string;
  won: boolean;
  opponent_title: string;
  elo_change: number;
  created_at: string;
}

export default function MovieHistoryScreen() {
  const { id, title } = useLocalSearchParams<{ id: string; title: string }>();
  const [eloHistory, setEloHistory] = useState<EloPoint[]>([]);
  const [matchups, setMatchups] = useState<MatchupRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) loadHistory(id);
  }, [id]);

  const loadHistory = async (movieId: string) => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const [{ data: history }, { data: matchupData }] = await Promise.all([
      supabase
        .from("user_elo_history")
        .select("elo, matchup_count, created_at")
        .eq("user_id", user.id)
        .eq("movie_id", movieId)
        .order("created_at", { ascending: true })
        .limit(50),
      supabase
        .from("matchups")
        .select("id, movie_a_id, movie_b_id, winner_id, elo_change, created_at")
        .eq("user_id", user.id)
        .or(`movie_a_id.eq.${movieId},movie_b_id.eq.${movieId}`)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

    setEloHistory(history ?? []);

    if (matchupData && matchupData.length > 0) {
      const opponentIds = matchupData.map((m) =>
        m.movie_a_id === movieId ? m.movie_b_id : m.movie_a_id,
      );
      const uniqueIds = [...new Set(opponentIds)];

      const { data: opponentMovies } = await supabase
        .from("movies")
        .select("id, title")
        .in("id", uniqueIds);

      const titleMap = Object.fromEntries(
        (opponentMovies ?? []).map((m) => [m.id, m.title]),
      );

      setMatchups(
        matchupData.map((m) => ({
          id: m.id,
          won: m.winner_id === movieId,
          opponent_title:
            titleMap[m.movie_a_id === movieId ? m.movie_b_id : m.movie_a_id] ??
            "Unknown",
          elo_change: m.elo_change,
          created_at: m.created_at,
        })),
      );
    }

    setLoading(false);
  };

  const renderChart = () => {
    if (eloHistory.length < 2) {
      return (
        <View style={styles.chartPlaceholder}>
          <Text style={styles.chartPlaceholderText}>
            Rate this movie in a few more matchups to see the trend
          </Text>
        </View>
      );
    }

    const elos = eloHistory.map((h) => h.elo);
    const minElo = Math.min(...elos);
    const maxElo = Math.max(...elos);
    const range = maxElo - minElo || 1;
    const n = elos.length;
    const padding = 8;

    const toCoords = (h: EloPoint, i: number) => {
      const x = n === 1 ? CHART_WIDTH / 2 : (i / (n - 1)) * CHART_WIDTH;
      const y =
        CHART_HEIGHT -
        padding -
        ((h.elo - minElo) / range) * (CHART_HEIGHT - padding * 2) +
        padding;
      return { x, y };
    };

    const points = eloHistory
      .map((h, i) => {
        const { x, y } = toCoords(h, i);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

    const last = toCoords(eloHistory[eloHistory.length - 1], n - 1);
    const trending = eloHistory[n - 1].elo >= eloHistory[0].elo;
    const lineColor = trending ? "#4caf50" : "#f44336";

    return (
      <View style={styles.chartContainer}>
        <Svg width={CHART_WIDTH} height={CHART_HEIGHT}>
          <Polyline
            points={points}
            stroke={lineColor}
            strokeWidth={2}
            fill="none"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          <Circle cx={last.x} cy={last.y} r={4} fill={lineColor} />
        </Svg>
        <View style={styles.chartLabels}>
          <Text style={styles.chartLabel}>First matchup</Text>
          <Text style={styles.chartLabel}>Most recent</Text>
        </View>
      </View>
    );
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Rating Trend</Text>
          {renderChart()}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Match History</Text>
          {matchups.length === 0 ? (
            <Text style={styles.emptyText}>No matchups recorded yet</Text>
          ) : (
            matchups.map((m) => (
              <View key={m.id} style={styles.matchRow}>
                <View
                  style={[
                    styles.resultBadge,
                    m.won ? styles.winBadge : styles.lossBadge,
                  ]}
                >
                  <Text style={styles.resultBadgeText}>
                    {m.won ? "W" : "L"}
                  </Text>
                </View>
                <View style={styles.matchInfo}>
                  <Text style={styles.opponentTitle} numberOfLines={1}>
                    vs. {m.opponent_title}
                  </Text>
                  <Text style={styles.matchDate}>
                    {new Date(m.created_at).toLocaleDateString()}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.eloChange,
                    m.won ? styles.eloUp : styles.eloDown,
                  ]}
                >
                  {m.won ? `+${m.elo_change}` : `-${m.elo_change}`}
                </Text>
              </View>
            ))
          )}
        </View>
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
  content: {
    padding: 20,
  },
  title: {
    color: "#ffffff",
    fontSize: 22,
    fontWeight: "bold",
    marginBottom: 24,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },
  chartContainer: {
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  chartLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
  },
  chartLabel: {
    color: "#444444",
    fontSize: 11,
  },
  chartPlaceholder: {
    backgroundColor: "#1a1a1a",
    borderRadius: 10,
    padding: 24,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  chartPlaceholderText: {
    color: "#555555",
    fontSize: 13,
    textAlign: "center",
    lineHeight: 20,
  },
  emptyText: {
    color: "#555555",
    fontSize: 13,
  },
  matchRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
  },
  resultBadge: {
    width: 30,
    height: 30,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
  },
  winBadge: {
    backgroundColor: "#1a3a1a",
  },
  lossBadge: {
    backgroundColor: "#3a1a1a",
  },
  resultBadgeText: {
    color: "#ffffff",
    fontSize: 13,
    fontWeight: "bold",
  },
  matchInfo: {
    flex: 1,
  },
  opponentTitle: {
    color: "#ffffff",
    fontSize: 14,
  },
  matchDate: {
    color: "#555555",
    fontSize: 11,
    marginTop: 2,
  },
  eloChange: {
    fontSize: 13,
    fontWeight: "600",
    minWidth: 36,
    textAlign: "right",
  },
  eloUp: {
    color: "#4caf50",
  },
  eloDown: {
    color: "#f44336",
  },
});
