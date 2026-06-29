import { useEffect, useState } from 'react'
import { useRouter } from 'expo-router'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  Image,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { supabase } from '../lib/supabase'
import { getPosterUrl } from '../lib/tmdb'
import { normalizeElo } from '../lib/elo'

interface GlobalMovie {
  movie_id: string
  avgElo: number
  totalMatchups: number
  normalizedScore: number
  title: string
  poster_path: string | null
  release_date: string
}

export default function GlobalScreen() {
  const [movies, setMovies] = useState<GlobalMovie[]>([])
  const [filtered, setFiltered] = useState<GlobalMovie[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const router = useRouter()

  useEffect(() => {
    loadGlobalRankings()
  }, [])

  useEffect(() => {
    if (!search.trim()) {
      setFiltered(movies)
    } else {
      const q = search.toLowerCase()
      setFiltered(movies.filter(m => m.title.toLowerCase().includes(q)))
    }
  }, [search, movies])

  const loadGlobalRankings = async () => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('user_movies')
        .select('movie_id, elo, matchup_count, movies(title, poster_path, release_date)')
        .gt('matchup_count', 0)

      if (!data || data.length === 0) {
        setMovies([])
        return
      }

      const grouped: Record<string, { elos: number[]; totalMatchups: number; movie: any }> = {}

      for (const row of data) {
        const id = row.movie_id
        if (!grouped[id]) {
          grouped[id] = { elos: [], totalMatchups: 0, movie: row.movies }
        }
        grouped[id].elos.push(row.elo)
        grouped[id].totalMatchups += row.matchup_count
      }

      const aggregated = Object.entries(grouped).map(([movie_id, val]) => ({
        movie_id,
        avgElo: val.elos.reduce((a, b) => a + b, 0) / val.elos.length,
        totalMatchups: val.totalMatchups,
        title: (val.movie as any).title,
        poster_path: (val.movie as any).poster_path,
        release_date: (val.movie as any).release_date,
      }))

      aggregated.sort((a, b) => b.avgElo - a.avgElo)

      const elos = aggregated.map(m => m.avgElo)
      const minElo = Math.min(...elos)
      const maxElo = Math.max(...elos)

      const ranked: GlobalMovie[] = aggregated.map(m => ({
        ...m,
        normalizedScore: normalizeElo(m.avgElo, minElo, maxElo),
      }))

      setMovies(ranked)
      setFiltered(ranked)
    } finally {
      setLoading(false)
    }
  }

  const renderItem = ({ item, index }: { item: GlobalMovie; index: number }) => (
    <TouchableOpacity style={styles.row} onPress={() => router.push(`/movie/${item.movie_id}`)}>
      <Text style={styles.rank}>#{index + 1}</Text>

      {item.poster_path ? (
        <Image
          source={{ uri: getPosterUrl(item.poster_path)! }}
          style={styles.poster}
        />
      ) : (
        <View style={[styles.poster, styles.noPoster]} />
      )}

      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.meta}>
          {item.release_date?.slice(0, 4)}
          {'  ·  '}{item.totalMatchups} matchup{item.totalMatchups !== 1 ? 's' : ''}
        </Text>
      </View>

      <View style={styles.scoreBox}>
        <Text style={styles.score}>{item.normalizedScore}</Text>
      </View>
    </TouchableOpacity>
  )

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <TextInput
        style={styles.searchBar}
        placeholder="Search movies..."
        placeholderTextColor="#555555"
        value={search}
        onChangeText={setSearch}
      />

      {filtered.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            {movies.length === 0
              ? 'No global rankings yet — complete some matchups first!'
              : 'No results found.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.movie_id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onRefresh={loadGlobalRankings}
          refreshing={loading}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchBar: {
    margin: 12,
    padding: 10,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    color: '#ffffff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  list: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  rank: {
    color: '#555555',
    fontSize: 13,
    width: 36,
    textAlign: 'right',
    marginRight: 10,
  },
  poster: {
    width: 46,
    height: 68,
    borderRadius: 4,
    marginRight: 12,
  },
  noPoster: {
    backgroundColor: '#1a1a1a',
  },
  info: {
    flex: 1,
    marginRight: 8,
  },
  title: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  meta: {
    color: '#666666',
    fontSize: 12,
    marginTop: 4,
  },
  scoreBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: 44,
    alignItems: 'center',
  },
  score: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  emptyText: {
    color: '#555555',
    fontSize: 15,
    textAlign: 'center',
    paddingHorizontal: 32,
  },
})
