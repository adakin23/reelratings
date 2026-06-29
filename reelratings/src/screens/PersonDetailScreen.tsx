import { useEffect, useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  Image,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { supabase } from '../lib/supabase'
import { getPersonDetails, getPersonMovieCredits, getPosterUrl, TMDBPerson, TMDBPersonCredit } from '../lib/tmdb'
import { normalizeElo } from '../lib/elo'

interface RankedCredit extends TMDBPersonCredit {
  elo?: number
  normalizedScore?: number
  matchup_count?: number
  inLibrary: boolean
}

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()

  const [person, setPerson] = useState<TMDBPerson | null>(null)
  const [credits, setCredits] = useState<RankedCredit[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'your' | 'all'>('your')

  useEffect(() => {
    if (id) loadPerson(id)
  }, [id])

  const loadPerson = async (personId: string) => {
    setLoading(true)
    try {
      const [details, movieCredits] = await Promise.all([
        getPersonDetails(Number(personId)),
        getPersonMovieCredits(Number(personId)),
      ])
      setPerson(details)

      // Combine cast and crew credits, deduplicate by movie id
      const allCredits = new Map<number, TMDBPersonCredit>()
      for (const c of movieCredits.cast ?? []) allCredits.set(c.id, c)
      for (const c of movieCredits.crew ?? []) {
        if (!allCredits.has(c.id)) allCredits.set(c.id, c)
      }

      const creditList = Array.from(allCredits.values()).filter(c => c.release_date)

      // Fetch user's ELO data for these movies
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      const movieIds = creditList.map(c => String(c.id))

      const { data: userMovies } = await supabase
        .from('user_movies')
        .select('movie_id, elo, matchup_count')
        .eq('user_id', user.id)
        .eq('status', 'watched')
        .in('movie_id', movieIds)

      const eloMap = new Map<string, { elo: number; matchup_count: number }>()
      for (const um of userMovies ?? []) {
        eloMap.set(um.movie_id, { elo: um.elo, matchup_count: um.matchup_count })
      }

      // Normalize ELOs
      const elos = Array.from(eloMap.values()).map(v => v.elo)
      const minElo = elos.length > 0 ? Math.min(...elos) : 0
      const maxElo = elos.length > 0 ? Math.max(...elos) : 0

      const ranked: RankedCredit[] = creditList.map(c => {
        const userData = eloMap.get(String(c.id))
        return {
          ...c,
          elo: userData?.elo,
          matchup_count: userData?.matchup_count,
          normalizedScore: userData ? normalizeElo(userData.elo, minElo, maxElo) : undefined,
          inLibrary: !!userData,
        }
      })

      // Sort: library movies by ELO desc, then non-library by release date desc
      ranked.sort((a, b) => {
        if (a.inLibrary && b.inLibrary) return (b.elo ?? 0) - (a.elo ?? 0)
        if (a.inLibrary) return -1
        if (b.inLibrary) return 1
        return (b.release_date ?? '').localeCompare(a.release_date ?? '')
      })

      setCredits(ranked)
    } finally {
      setLoading(false)
    }
  }

  const displayedCredits = tab === 'your'
    ? credits.filter(c => c.inLibrary)
    : credits

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    )
  }

  if (!person) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.errorText}>Person not found.</Text>
      </View>
    )
  }

  return (
    <ScrollView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        {person.profile_path ? (
          <Image
            source={{ uri: `https://image.tmdb.org/t/p/w185${person.profile_path}` }}
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
              Born {new Date(person.birthday).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </Text>
          )}
          <Text style={styles.libraryCount}>
            {credits.filter(c => c.inLibrary).length} films in your library
          </Text>
        </View>
      </View>

      {/* Bio */}
      {person.biography ? (
        <View style={styles.bioSection}>
          <Text style={styles.bio} numberOfLines={4}>{person.biography}</Text>
        </View>
      ) : null}

      {/* Tab toggle */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'your' && styles.tabActive]}
          onPress={() => setTab('your')}
        >
          <Text style={[styles.tabText, tab === 'your' && styles.tabTextActive]}>
            Your Rankings
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'all' && styles.tabActive]}
          onPress={() => setTab('all')}
        >
          <Text style={[styles.tabText, tab === 'all' && styles.tabTextActive]}>
            All Films
          </Text>
        </TouchableOpacity>
      </View>

      {/* Film list */}
      <View style={styles.filmList}>
        {displayedCredits.length === 0 ? (
          <Text style={styles.emptyText}>
            {tab === 'your'
              ? 'None of their films are in your library yet.'
              : 'No films found.'}
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
                <Text style={styles.filmTitle} numberOfLines={2}>{credit.title}</Text>
                <Text style={styles.filmMeta}>
                  {credit.release_date?.slice(0, 4)}
                  {credit.character ? `  ·  ${credit.character}` : ''}
                  {credit.job ? `  ·  ${credit.job}` : ''}
                </Text>
              </View>

              {credit.inLibrary && credit.normalizedScore !== undefined ? (
                <View style={styles.scoreBox}>
                  <Text style={styles.score}>{credit.normalizedScore}</Text>
                </View>
              ) : (
                <View style={styles.notRatedBox}>
                  <Text style={styles.notRatedText}>—</Text>
                </View>
              )}
            </TouchableOpacity>
          ))
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
  header: {
    flexDirection: 'row',
    padding: 20,
    gap: 16,
  },
  photo: {
    width: 90,
    height: 120,
    borderRadius: 8,
  },
  noPhoto: {
    backgroundColor: '#1a1a1a',
  },
  headerInfo: {
    flex: 1,
    justifyContent: 'center',
    gap: 4,
  },
  name: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
  },
  department: {
    color: '#888888',
    fontSize: 13,
  },
  birthday: {
    color: '#666666',
    fontSize: 12,
  },
  libraryCount: {
    color: '#555555',
    fontSize: 12,
    marginTop: 4,
  },
  bioSection: {
    paddingHorizontal: 20,
    paddingBottom: 16,
  },
  bio: {
    color: '#888888',
    fontSize: 13,
    lineHeight: 20,
  },
  tabs: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#2a2a2a',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  tabActive: {
    borderBottomWidth: 2,
    borderBottomColor: '#ffffff',
  },
  tabText: {
    color: '#555555',
    fontSize: 14,
    fontWeight: '600',
  },
  tabTextActive: {
    color: '#ffffff',
  },
  filmList: {
    padding: 12,
  },
  filmRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
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
  filmInfo: {
    flex: 1,
    marginRight: 8,
  },
  filmTitle: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  filmMeta: {
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
  notRatedBox: {
    minWidth: 44,
    alignItems: 'center',
  },
  notRatedText: {
    color: '#444444',
    fontSize: 16,
  },
  errorText: {
    color: '#666666',
    fontSize: 16,
  },
  emptyText: {
    color: '#555555',
    fontSize: 14,
    textAlign: 'center',
    paddingVertical: 32,
  },
})
