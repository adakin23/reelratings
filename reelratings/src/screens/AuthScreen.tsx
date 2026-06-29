import { useState } from 'react'
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
} from 'react-native'
import * as WebBrowser from 'expo-web-browser'
import { makeRedirectUri } from 'expo-auth-session'
import { supabase } from '../lib/supabase'

WebBrowser.maybeCompleteAuthSession()

export default function AuthScreen() {
  const [loading, setLoading] = useState(false)

  const signInWithGoogle = async () => {
    setLoading(true)
    try {
      if (Platform.OS === 'web') {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin,
          },
        })
        if (error) throw error
      } else {
        const redirectUri = makeRedirectUri()
        const { data, error } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: redirectUri,
            skipBrowserRedirect: true,
          },
        })
        if (error) throw error
        if (data?.url) {
          const result = await WebBrowser.openAuthSessionAsync(data.url, redirectUri)
          if (result.type === 'success' && result.url) {
            const url = new URL(result.url)
            const code = url.searchParams.get('code')
            if (code) {
              await supabase.auth.exchangeCodeForSession(code)
            }
          }
        }
      }
    } catch (error: any) {
      Alert.alert('Sign in failed', error.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.title}>ReelRatings</Text>
      <Text style={styles.subtitle}>Rank every movie you've ever seen</Text>

      <TouchableOpacity
        style={styles.googleButton}
        onPress={signInWithGoogle}
        disabled={loading}
      >
        {loading ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Continue with Google</Text>
        )}
      </TouchableOpacity>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  title: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#888888',
    marginBottom: 64,
  },
  googleButton: {
    backgroundColor: '#4285F4',
    paddingVertical: 14,
    paddingHorizontal: 32,
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
    marginBottom: 16,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '600',
  },
})