import { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'
import { getMovieDetails, getPosterUrl } from '../lib/tmdb'
import { normalizeElo } from '../lib/elo'

type WatchStatus = 'watched' | 'watchlist' | 'do_not_watch' | null

interface MovieDetail {
  id: number
  title: string
  poster_path: string | null
  release_date: string
  runtime: number
  overview: string
  genres: { id: number; name: string }[]
  credits: {
    cast: { id: number; name: string; character: string; profile_path: string | null }[]
    crew: { id: number; name: string; job: string }[]
  }
}

interface UserMovieData {
  elo: number
  matchup_count: number
  win_count: number
  loss_count: number
  status: WatchStatus
  normalizedScore: number
}

const STATUS_LABELS: Record<string, string> = {
  watched: 'Watched',
  watchlist: 'Watchlist',
  do_not_watch: "Don't Want to Watch",
}

const STATUS_COLORS: Record<string, string> = {
  watched: '#4caf50',
  watchlist: '#2196f3',
  do_not_watch: '#f44336',
}

export default function MovieDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  const [movie, setMovie] = useState<MovieDetail | null>(null)
  const [userMovie, setUserMovie] = useState<UserMovieData | null>(null)
  const [globalScore, setGlobalScore] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [statusUpdating, setStatusUpdating] = useState(false)

  useEffect(() => {
    if (id) loadMovie(id)
  }, [id])

  const loadMovie = async (movieId: string) => {
    setLoading(true)
    try {
      // Fetch TMDB details
      const details = await getMovieDetails(Number(movieId))
      setMovie(details)

      // Fetch user's personal data for this movie
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const { data: userMovieData } = await supabase
        .from('user_movies')
        .select('elo, matchup_count, win_count, loss_count, status')
        .eq('user_id', user.id)
        .eq('movie_id', movieId)
        .single()

      // Fetch all user elos for normalization
      const { data: allUserMovies } = await supabase
        .from('user_movies')
        .select('elo')
        .eq('user_id', user.id)

      if (userMovieData && allUserMovies) {
        const elos = allUserMovies.map(m => m.elo)
        const minElo = Math.min(...elos)
        const maxElo = Math.max(...elos)
        setUserMovie({
          ...userMovieData,
          status: userMovieData.status as WatchStatus,
          normalizedScore: normalizeElo(userMovieData.elo, minElo, maxElo),
        })
      }

      // Fetch global average ELO for this movie
      const { data: globalData } = await supabase
        .from('user_movies')
        .select('elo')
        .eq('movie_id', movieId)
        .gt('matchup_count', 0)

      if (globalData && globalData.length > 0) {
        const avgElo = globalData.reduce((sum, r) => sum + r.elo, 0) / globalData.length

        // Get global min/max for normalization
        const { data: allGlobal } = await supabase
          .from('user_movies')
          .select('elo')
          .gt('matchup_count', 0)

        if (allGlobal && allGlobal.length > 0) {
          const globalElos = allGlobal.map(m => m.elo)
          setGlobalScore(normalizeElo(avgElo, Math.min(...globalElos), Math.max(...globalElos)))
        }
      }
    } finally {
      setLoading(false)
    }
  }

  const updateStatus = async (newStatus: 'watched' | 'watchlist' | 'do_not_watch') => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user || !id) return

    setStatusUpdating(true)
    try {
      // Check if user_movie record exists
      const { data: existing } = await supabase
        .from('user_movies')
        .select('id')
        .eq('user_id', user.id)
        .eq('movie_id', id)
        .single()

      if (existing) {
        await supabase
          .from('user_movies')
          .update({ status: newStatus })
          .eq('user_id', user.id)
          .eq('movie_id', id)
      } else {
        // First ensure movie exists in movies table
        if (movie) {
          await supabase.from('movies').upsert(
            {
              id,
              title: movie.title,
              poster_path: movie.poster_path,
              release_date: movie.release_date || null,
              overview: movie.overview,
              genres: movie.genres.map(g => g.name),
              runtime: movie.runtime,
            },
            { onConflict: 'id' }
          )
        }
        await supabase.from('user_movies').insert({
          user_id: user.id,
          movie_id: id,
          elo: 1000,
          status: newStatus,
        })
      }

      setUserMovie(prev => prev ? { ...prev, status: newStatus } : null)
      Alert.alert('Updated', `Marked as ${STATUS_LABELS[newStatus]}`)
    } finally {
      setStatusUpdating(false)
    }
  }

  const directors = movie?.credits?.crew?.filter(c => c.job === 'Director') ?? []
  const topCast = movie?.credits?.cast?.slice(0, 10) ?? []

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    )
  }

  if (!movie) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>Movie not found.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container}>
      {/* Poster */}
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
        {/* Title & Meta */}
        <Text style={styles.title}>{movie.title}</Text>
        <Text style={styles.meta}>
          {movie.release_date?.slice(0, 4)}
          {movie.runtime ? `  ·  ${movie.runtime} min` : ''}
          {movie.genres?.length > 0 ? `  ·  ${movie.genres.map(g => g.name).join(', ')}` : ''}
        </Text>

        {/* Ratings */}
        <View style={styles.ratingsRow}>
          {userMovie && userMovie.matchup_count > 0 && (
            <View style={styles.ratingBox}>
              <Text style={styles.ratingScore}>{userMovie.normalizedScore}</Text>
              <Text style={styles.ratingLabel}>Your Rating</Text>
              <Text style={styles.ratingRecord}>
                {userMovie.win_count}W · {userMovie.loss_count}L
              </Text>
            </View>
          )}
          {globalScore !== null && (
            <View style={styles.ratingBox}>
              <Text style={styles.ratingScore}>{globalScore}</Text>
              <Text style={styles.ratingLabel}>Global Rating</Text>
            </View>
          )}
          {(!userMovie || userMovie.matchup_count === 0) && globalScore === null && (
            <Text style={styles.noRatingText}>No ratings yet — start swiping!</Text>
          )}
        </View>

        {/* Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Status</Text>
          <View style={styles.statusRow}>
            {(['watched', 'watchlist', 'do_not_watch'] as const).map(s => (
              <TouchableOpacity
                key={s}
                style={[
                  styles.statusButton,
                  userMovie?.status === s && { backgroundColor: STATUS_COLORS[s] },
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
        </View>

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
              {directors.length === 1 ? 'Director' : 'Directors'}
            </Text>
            <Text style={styles.directorName}>
              {directors.map(d => d.name).join(', ')}
            </Text>
          </View>
        )}

        {/* Cast */}
        {topCast.length > 0 && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Cast</Text>
            {topCast.map(actor => (
              <View key={actor.id} style={styles.castRow}>
                {actor.profile_path ? (
                  <Image
                    source={{ uri: `https://image.tmdb.org/t/p/w92${actor.profile_path}` }}
                    style={styles.castPhoto}
                  />
                ) : (
                  <View style={[styles.castPhoto, styles.noPhoto]} />
                )}
                <View style={styles.castInfo}>
                  <Text style={styles.castName}>{actor.name}</Text>
                  <Text style={styles.castCharacter}>{actor.character}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  centered: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  poster: {
    width: '100%',
    height: 400,
  },
  noPoster: {
    width: '100%',
    height: 400,
    backgroundColor: '#1a1a1a',
  },
  content: {
    padding: 20,
  },
  title: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  meta: {
    color: '#888888',
    fontSize: 13,
    marginBottom: 20,
  },
  ratingsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 24,
  },
  ratingBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
    minWidth: 100,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  ratingScore: {
    color: '#ffffff',
    fontSize: 32,
    fontWeight: 'bold',
  },
  ratingLabel: {
    color: '#888888',
    fontSize: 12,
    marginTop: 4,
  },
  ratingRecord: {
    color: '#555555',
    fontSize: 11,
    marginTop: 4,
  },
  noRatingText: {
    color: '#555555',
    fontSize: 13,
    fontStyle: 'italic',
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 10,
  },
  statusRow: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  statusButton: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  statusButtonText: {
    color: '#888888',
    fontSize: 13,
    fontWeight: '600',
  },
  statusButtonTextActive: {
    color: '#ffffff',
  },
  overview: {
    color: '#aaaaaa',
    fontSize: 14,
    lineHeight: 22,
  },
  directorName: {
    color: '#cccccc',
    fontSize: 15,
  },
  castRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  castPhoto: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },
  noPhoto: {
    backgroundColor: '#1a1a1a',
  },
  castInfo: {
    flex: 1,
  },
  castName: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
  },
  castCharacter: {
    color: '#666666',
    fontSize: 12,
    marginTop: 2,
  },
  errorText: {
    color: '#666666',
    fontSize: 16,
  },
})
