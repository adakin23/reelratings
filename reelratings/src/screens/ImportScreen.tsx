import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native'
import * as DocumentPicker from 'expo-document-picker'
import { supabase } from '../lib/supabase'
import { searchMovies } from '../lib/tmdb'

interface ImportResult {
  total: number
  imported: number
  skipped: number
  failed: string[]
}

function parseCSV(text: string): { name: string; year: string }[] {
  const lines = text.split('\n').filter(l => l.trim())
  if (lines.length < 2) return []

  // Find header indices
  const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, '').toLowerCase())
  const nameIdx = headers.indexOf('name')
  const yearIdx = headers.indexOf('year')

  if (nameIdx === -1 || yearIdx === -1) return []

  return lines.slice(1).map(line => {
    // Handle quoted fields with commas inside
    const cols: string[] = []
    let current = ''
    let inQuotes = false
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes
      } else if (char === ',' && !inQuotes) {
        cols.push(current.trim())
        current = ''
      } else {
        current += char
      }
    }
    cols.push(current.trim())

    return {
      name: cols[nameIdx]?.replace(/"/g, '') ?? '',
      year: cols[yearIdx]?.replace(/"/g, '') ?? '',
    }
  }).filter(m => m.name)
}

async function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default function ImportScreen() {
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [result, setResult] = useState<ImportResult | null>(null)

  const runImport = async (status: 'watched' | 'watchlist') => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: 'text/csv',
      copyToCacheDirectory: true,
    })

    if (picked.canceled || !picked.assets?.[0]) return

    const file = picked.assets[0]
    const response = await fetch(file.uri)
    const text = await response.text()
    const movies = parseCSV(text)

    if (movies.length === 0) {
      Alert.alert('Error', 'Could not parse the CSV file. Make sure you selected the correct file from your Letterboxd export.')
      return
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return

    setImporting(true)
    setResult(null)
    setProgress({ current: 0, total: movies.length })

    const importResult: ImportResult = {
      total: movies.length,
      imported: 0,
      skipped: 0,
      failed: [],
    }

    for (let i = 0; i < movies.length; i++) {
      const { name, year } = movies[i]
      setProgress({ current: i + 1, total: movies.length })

      try {
        // Search TMDB for this movie
        const results = await searchMovies(name)

        if (!results || results.length === 0) {
          importResult.failed.push(name)
          continue
        }

        // Pick best match — prefer exact title + year match
        const match =
          results.find(
            r =>
              r.title.toLowerCase() === name.toLowerCase() &&
              r.release_date?.startsWith(year)
          ) ?? results[0]

        // Upsert into movies table
        await supabase.from('movies').upsert(
          {
            id: String(match.id),
            title: match.title,
            poster_path: match.poster_path,
            release_date: match.release_date || null,
            overview: match.overview,
          },
          { onConflict: 'id' }
        )

        // Upsert into user_movies
        const { error } = await supabase.from('user_movies').upsert(
          {
            user_id: user.id,
            movie_id: String(match.id),
            elo: 1000,
            status,
          },
          { onConflict: 'user_id,movie_id' }
        )

        if (error) {
          importResult.failed.push(name)
        } else {
          importResult.imported++
        }

        // Respect TMDB rate limit (40 req / 10s)
        await delay(260)
      } catch {
        importResult.failed.push(name)
      }
    }

    setImporting(false)
    setResult(importResult)
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>Import from Letterboxd</Text>

      <View style={styles.instructionBox}>
        <Text style={styles.instructionTitle}>How to get your Letterboxd export</Text>
        <Text style={styles.step}>1. Go to letterboxd.com and sign in</Text>
        <Text style={styles.step}>2. Click your profile → Settings → Data</Text>
        <Text style={styles.step}>3. Click "Export your data" and download the ZIP</Text>
        <Text style={styles.step}>4. Extract the ZIP — you'll find watched.csv and watchlist.csv</Text>
        <Text style={styles.step}>5. Use the buttons below to import each file</Text>
      </View>

      {!importing && !result && (
        <View style={styles.buttons}>
          <TouchableOpacity
            style={styles.button}
            onPress={() => runImport('watched')}
          >
            <Text style={styles.buttonText}>Import watched.csv</Text>
            <Text style={styles.buttonSub}>Your watched films</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.buttonSecondary]}
            onPress={() => runImport('watchlist')}
          >
            <Text style={styles.buttonText}>Import watchlist.csv</Text>
            <Text style={styles.buttonSub}>Your watchlist</Text>
          </TouchableOpacity>
        </View>
      )}

      {importing && (
        <View style={styles.progressBox}>
          <ActivityIndicator size="large" color="#ffffff" />
          <Text style={styles.progressText}>
            Importing {progress.current} of {progress.total} movies...
          </Text>
          <Text style={styles.progressSub}>
            This may take a few minutes for large libraries.
          </Text>
        </View>
      )}

      {result && (
        <View style={styles.resultBox}>
          <Text style={styles.resultTitle}>Import Complete</Text>
          <Text style={styles.resultStat}>✓ {result.imported} movies imported</Text>
          {result.failed.length > 0 && (
            <>
              <Text style={styles.resultFailed}>
                ✗ {result.failed.length} could not be matched on TMDB:
              </Text>
              {result.failed.slice(0, 10).map((title, i) => (
                <Text key={i} style={styles.failedTitle}>  · {title}</Text>
              ))}
              {result.failed.length > 10 && (
                <Text style={styles.failedTitle}>  · ...and {result.failed.length - 10} more</Text>
              )}
            </>
          )}

          <TouchableOpacity
            style={[styles.button, { marginTop: 24 }]}
            onPress={() => {
              setResult(null)
              setProgress({ current: 0, total: 0 })
            }}
          >
            <Text style={styles.buttonText}>Import another file</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  content: {
    padding: 20,
  },
  heading: {
    color: '#ffffff',
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  instructionBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  instructionTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 12,
  },
  step: {
    color: '#aaaaaa',
    fontSize: 13,
    marginBottom: 6,
    lineHeight: 20,
  },
  buttons: {
    gap: 12,
  },
  button: {
    backgroundColor: '#e8572a',
    borderRadius: 10,
    padding: 16,
    alignItems: 'center',
  },
  buttonSecondary: {
    backgroundColor: '#2a2a2a',
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  buttonSub: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 12,
    marginTop: 3,
  },
  progressBox: {
    alignItems: 'center',
    padding: 32,
    gap: 16,
  },
  progressText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
  progressSub: {
    color: '#666666',
    fontSize: 13,
    textAlign: 'center',
  },
  resultBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 20,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  resultTitle: {
    color: '#ffffff',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  resultStat: {
    color: '#4caf50',
    fontSize: 15,
    marginBottom: 8,
  },
  resultFailed: {
    color: '#f44336',
    fontSize: 14,
    marginTop: 8,
    marginBottom: 6,
  },
  failedTitle: {
    color: '#888888',
    fontSize: 13,
    marginBottom: 3,
  },
})
