import { useEffect, useRef, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Image,
  Animated,
  PanResponder,
  Dimensions,
  ActivityIndicator,
} from 'react-native'
import { supabase } from '../lib/supabase'
import { getPopularMovies, getPosterUrl } from '../lib/tmdb'
import { calculateElo } from '../lib/elo'

const { height: SCREEN_HEIGHT } = Dimensions.get('window')
const SWIPE_THRESHOLD = 80

interface Movie {
  id: string
  title: string
  poster_path: string | null
  release_date: string
  elo: number
}

export default function MatchupScreen() {
  const [movies, setMovies] = useState<[Movie, Movie] | null>(null)
  const [loading, setLoading] = useState(true)
  const [userId, setUserId] = useState<string | null>(null)
  const moviesRef = useRef<[Movie, Movie] | null>(null)
  const userIdRef = useRef<string | null>(null)
  const translateY = useRef(new Animated.Value(0)).current
  const opacity = useRef(new Animated.Value(1)).current

  // Keep refs in sync with state to avoid stale closures in PanResponder
  useEffect(() => {
    moviesRef.current = movies
  }, [movies])

  useEffect(() => {
    userIdRef.current = userId
  }, [userId])

  useEffect(() => {
    initializeUser()
  }, [])

  const initializeUser = async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    setUserId(user.id)
    userIdRef.current = user.id
    await seedMoviesIfNeeded(user.id)
    await loadNextPair(user.id)
  }

  const seedMoviesIfNeeded = async (uid: string) => {
    const { count } = await supabase
      .from('user_movies')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', uid)

    if (count && count > 0) return

    // Seed with 20 popular movies from TMDB
    const popular = await getPopularMovies(1)
    const toSeed = popular.slice(0, 20)

    for (const m of toSeed) {
      await supabase.from('movies').upsert(
        {
          id: String(m.id),
          title: m.title,
          poster_path: m.poster_path,
          release_date: m.release_date || null,
          overview: m.overview,
        },
        { onConflict: 'id' }
      )

      await supabase.from('user_movies').upsert(
        {
          user_id: uid,
          movie_id: String(m.id),
          elo: 1000,
          status: 'watched',
        },
        { onConflict: 'user_id,movie_id' }
      )
    }
  }

  const loadNextPair = async (uid: string) => {
    setLoading(true)
    try {
      const { data } = await supabase
        .from('user_movies')
        .select('movie_id, elo, matchup_count, movies(id, title, poster_path, release_date)')
        .eq('user_id', uid)
        .eq('status', 'watched')
        .order('matchup_count', { ascending: true })
        .limit(10)

      if (!data || data.length < 2) {
        setMovies(null)
        return
      }

      // Shuffle to get variety while still prioritizing low matchup counts
      const shuffled = [...data].sort(() => Math.random() - 0.5)
      const [a, b] = shuffled.slice(0, 2)

      const movieA: Movie = {
        id: a.movie_id,
        title: (a.movies as any).title,
        poster_path: (a.movies as any).poster_path,
        release_date: (a.movies as any).release_date,
        elo: a.elo,
      }

      const movieB: Movie = {
        id: b.movie_id,
        title: (b.movies as any).title,
        poster_path: (b.movies as any).poster_path,
        release_date: (b.movies as any).release_date,
        elo: b.elo,
      }

      setMovies([movieA, movieB])
      moviesRef.current = [movieA, movieB]
    } finally {
      setLoading(false)
    }
  }

  const handleVote = async (winnerId: string, loserId: string) => {
    const uid = userIdRef.current
    const currentMovies = moviesRef.current
    if (!uid || !currentMovies) return

    const winner = currentMovies.find(m => m.id === winnerId)!
    const loser = currentMovies.find(m => m.id === loserId)!
    const { newWinnerElo, newLoserElo, eloChange } = calculateElo(winner.elo, loser.elo)

    // Fetch current counts then update winner
    const { data: winnerData } = await supabase
      .from('user_movies')
      .select('win_count, matchup_count')
      .eq('user_id', uid)
      .eq('movie_id', winnerId)
      .single()

    await supabase
      .from('user_movies')
      .update({
        elo: newWinnerElo,
        win_count: (winnerData?.win_count ?? 0) + 1,
        matchup_count: (winnerData?.matchup_count ?? 0) + 1,
        last_matchup_at: new Date().toISOString(),
      })
      .eq('user_id', uid)
      .eq('movie_id', winnerId)

    // Fetch current counts then update loser
    const { data: loserData } = await supabase
      .from('user_movies')
      .select('loss_count, matchup_count')
      .eq('user_id', uid)
      .eq('movie_id', loserId)
      .single()

    await supabase
      .from('user_movies')
      .update({
        elo: newLoserElo,
        loss_count: (loserData?.loss_count ?? 0) + 1,
        matchup_count: (loserData?.matchup_count ?? 0) + 1,
        last_matchup_at: new Date().toISOString(),
      })
      .eq('user_id', uid)
      .eq('movie_id', loserId)

    // Record the matchup result
    await supabase.from('matchups').insert({
      user_id: uid,
      movie_a_id: currentMovies[0].id,
      movie_b_id: currentMovies[1].id,
      winner_id: winnerId,
      elo_change: eloChange,
    })

    await loadNextPair(uid)
  }

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dy) > 10,
      onPanResponderMove: (_, gestureState) => {
        translateY.setValue(gestureState.dy)
      },
      onPanResponderRelease: (_, gestureState) => {
        const current = moviesRef.current
        if (!current) return

        if (gestureState.dy < -SWIPE_THRESHOLD) {
          // Swiped up → top movie wins
          Animated.parallel([
            Animated.timing(translateY, {
              toValue: -SCREEN_HEIGHT,
              duration: 250,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0,
              duration: 250,
              useNativeDriver: true,
            }),
          ]).start(() => {
            translateY.setValue(0)
            opacity.setValue(1)
            handleVote(current[0].id, current[1].id)
          })
        } else if (gestureState.dy > SWIPE_THRESHOLD) {
          // Swiped down → bottom movie wins
          Animated.parallel([
            Animated.timing(translateY, {
              toValue: SCREEN_HEIGHT,
              duration: 250,
              useNativeDriver: true,
            }),
            Animated.timing(opacity, {
              toValue: 0,
              duration: 250,
              useNativeDriver: true,
            }),
          ]).start(() => {
            translateY.setValue(0)
            opacity.setValue(1)
            handleVote(current[1].id, current[0].id)
          })
        } else {
          // Not enough — snap back
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start()
        }
      },
    })
  ).current

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    )
  }

  if (!movies) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.emptyText}>No movies to compare.</Text>
      </View>
    )
  }

  const [topMovie, bottomMovie] = movies

  return (
    <Animated.View
      style={[styles.container, { transform: [{ translateY }], opacity }]}
      {...panResponder.panHandlers}
    >
      {/* Top Movie Card */}
      <View style={styles.card}>
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
          <Text style={styles.movieTitle} numberOfLines={2}>
            {topMovie.title}
          </Text>
          <Text style={styles.movieYear}>
            {topMovie.release_date?.slice(0, 4)}
          </Text>
        </View>
      </View>

      {/* VS Divider */}
      <View style={styles.divider}>
        <Text style={styles.vsText}>VS</Text>
        <Text style={styles.hintText}>swipe up  ·  swipe down</Text>
      </View>

      {/* Bottom Movie Card */}
      <View style={styles.card}>
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
          <Text style={styles.movieTitle} numberOfLines={2}>
            {bottomMovie.title}
          </Text>
          <Text style={styles.movieYear}>
            {bottomMovie.release_date?.slice(0, 4)}
          </Text>
        </View>
      </View>
    </Animated.View>
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
  card: {
    flex: 1,
    position: 'relative',
    overflow: 'hidden',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  noPoster: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  noPosterText: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  cardOverlay: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    padding: 16,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  movieTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  movieYear: {
    color: '#aaaaaa',
    fontSize: 14,
    marginTop: 2,
  },
  divider: {
    height: 48,
    backgroundColor: '#111111',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#2a2a2a',
  },
  vsText: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: 'bold',
    letterSpacing: 4,
  },
  hintText: {
    color: '#444444',
    fontSize: 11,
    marginTop: 3,
  },
  emptyText: {
    color: '#666666',
    fontSize: 16,
  },
})
