import { useEffect, useState, useCallback } from 'react'
import { useFocusEffect, useRouter } from 'expo-router'
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

interface RankedMovie {
  movie_id: string
  elo: number
  matchup_count: number
  win_count: number
  loss_count: number
  normalizedScore: number
  title: string
  poster_path: string | null
  release_date: string
  genres: string[] | null
  runtime: number | null
}

export default function RankingsScreen() {
  const [movies, setMovies] = useState<RankedMovie[]>([])
  const [filtered, setFiltered] = useState<RankedMovie[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const router = useRouter()


  useEffect(() => {
    if (!search.trim()) {
      setFiltered(movies)
    } else {
      const q = search.toLowerCase()
      setFiltered(movies.filter(m => m.title.toLowerCase().includes(q)))
    }
  }, [search, movies])

  useFocusEffect(
  useCallback(() => {
    loadRankings()
  }, [])
)

  const loadRankings = async () => {
    setLoading(true)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data } = await supabase
        .from('user_movies')
        .select('movie_id, elo, matchup_count, win_count, loss_count, movies(title, poster_path, release_date, genres, runtime)')
        .eq('user_id', user.id)
        .eq('status', 'watched')
        .order('elo', { ascending: false })

      if (!data || data.length === 0) {
        setMovies([])
        return
      }

      const elos = data.map(d => d.elo)
      const minElo = Math.min(...elos)
      const maxElo = Math.max(...elos)

      const ranked: RankedMovie[] = data.map(d => ({
        movie_id: d.movie_id,
        elo: d.elo,
        matchup_count: d.matchup_count,
        win_count: d.win_count,
        loss_count: d.loss_count,
        normalizedScore: normalizeElo(d.elo, minElo, maxElo),
        title: (d.movies as any).title,
        poster_path: (d.movies as any).poster_path,
        release_date: (d.movies as any).release_date,
        genres: (d.movies as any).genres,
        runtime: (d.movies as any).runtime,
      }))

      setMovies(ranked)
      setFiltered(ranked)
    } finally {
      setLoading(false)
    }
  }

  const renderItem = ({ item, index }: { item: RankedMovie; index: number }) => (
    <View style={styles.row}>
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
          {item.matchup_count > 0 ? `  ·  ${item.win_count}W ${item.loss_count}L` : '  ·  No matchups yet'}
        </Text>
      </View>

      <View style={styles.scoreBox}>
        <Text style={styles.score}>{item.normalizedScore}</Text>
      </View>
    </View>
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

      <TouchableOpacity
        style={styles.importButton}
        onPress={() => router.push('/import')}
      >
        <Text style={styles.importButtonText}>↑ Import from Letterboxd</Text>
      </TouchableOpacity>

      {filtered.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>
            {movies.length === 0
              ? 'No rankings yet — start swiping on the Match tab!'
              : 'No results found.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={item => item.movie_id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          onRefresh={loadRankings}
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
    marginBottom: 6,
    padding: 10,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    color: '#ffffff',
    fontSize: 15,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  importButton: {
    marginHorizontal: 12,
    marginBottom: 10,
    padding: 10,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  importButtonText: {
    color: '#e8572a',
    fontSize: 14,
    fontWeight: '600',
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
