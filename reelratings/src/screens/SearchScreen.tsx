import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  FlatList,
  Image,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native'
import { useRouter } from 'expo-router'
import { searchMovies, searchPeople, getPosterUrl, TMDBSearchResult } from '../lib/tmdb'

type SearchTab = 'movies' | 'people'

interface PersonResult {
  id: number
  name: string
  profile_path: string | null
  known_for_department: string
}

export default function SearchScreen() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [tab, setTab] = useState<SearchTab>('movies')
  const [movieResults, setMovieResults] = useState<TMDBSearchResult[]>([])
  const [peopleResults, setPeopleResults] = useState<PersonResult[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)

  const runSearch = async (text: string) => {
    setQuery(text)
    if (!text.trim()) {
      setMovieResults([])
      setPeopleResults([])
      setSearched(false)
      return
    }

    setLoading(true)
    setSearched(true)
    try {
      const [movies, people] = await Promise.all([
        searchMovies(text),
        searchPeople(text),
      ])
      setMovieResults(movies.slice(0, 20))
      setPeopleResults(people.slice(0, 20))
    } finally {
      setLoading(false)
    }
  }

  const renderMovie = ({ item }: { item: TMDBSearchResult }) => (
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
        <View style={[styles.poster, styles.noImage]} />
      )}
      <View style={styles.info}>
        <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
        <Text style={styles.meta}>{item.release_date?.slice(0, 4)}</Text>
        {item.overview ? (
          <Text style={styles.overview} numberOfLines={2}>{item.overview}</Text>
        ) : null}
      </View>
    </TouchableOpacity>
  )

  const renderPerson = ({ item }: { item: PersonResult }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={() => router.push(`/person/${item.id}`)}
    >
      {item.profile_path ? (
        <Image
          source={{ uri: `https://image.tmdb.org/t/p/w92${item.profile_path}` }}
          style={styles.personPhoto}
        />
      ) : (
        <View style={[styles.personPhoto, styles.noImage]} />
      )}
      <View style={styles.info}>
        <Text style={styles.title}>{item.name}</Text>
        <Text style={styles.meta}>{item.known_for_department}</Text>
      </View>
    </TouchableOpacity>
  )

  const currentResults = tab === 'movies' ? movieResults : peopleResults
  const isEmpty = searched && !loading && currentResults.length === 0

  return (
    <View style={styles.container}>
      {/* Search bar */}
      <TextInput
        style={styles.searchBar}
        placeholder="Search movies, actors, directors..."
        placeholderTextColor="#555555"
        value={query}
        onChangeText={runSearch}
        autoCapitalize="none"
        returnKeyType="search"
      />

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === 'movies' && styles.tabActive]}
          onPress={() => setTab('movies')}
        >
          <Text style={[styles.tabText, tab === 'movies' && styles.tabTextActive]}>
            Movies {searched && !loading ? `(${movieResults.length})` : ''}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === 'people' && styles.tabActive]}
          onPress={() => setTab('people')}
        >
          <Text style={[styles.tabText, tab === 'people' && styles.tabTextActive]}>
            People {searched && !loading ? `(${peopleResults.length})` : ''}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Results */}
      {loading ? (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#ffffff" />
        </View>
      ) : !searched ? (
        <View style={styles.centered}>
          <Text style={styles.hintText}>Search for a movie, actor, or director</Text>
        </View>
      ) : isEmpty ? (
        <View style={styles.centered}>
          <Text style={styles.hintText}>No results for "{query}"</Text>
        </View>
      ) : tab === 'movies' ? (
        <FlatList
          data={movieResults}
          keyExtractor={item => String(item.id)}
          renderItem={renderMovie}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
        />
      ) : (
        <FlatList
          data={peopleResults}
          keyExtractor={item => String(item.id)}
          renderItem={renderPerson}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
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
  tabs: {
    flexDirection: 'row',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#2a2a2a',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
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
  list: {
    padding: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
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
  personPhoto: {
    width: 46,
    height: 46,
    borderRadius: 23,
    marginRight: 12,
    marginTop: 4,
  },
  noImage: {
    backgroundColor: '#1a1a1a',
  },
  info: {
    flex: 1,
  },
  title: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  meta: {
    color: '#666666',
    fontSize: 12,
    marginTop: 3,
  },
  overview: {
    color: '#555555',
    fontSize: 12,
    marginTop: 4,
    lineHeight: 18,
  },
  hintText: {
    color: '#444444',
    fontSize: 14,
  },
})
