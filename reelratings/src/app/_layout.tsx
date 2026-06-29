import { useEffect, useState } from 'react'
import { Stack } from 'expo-router'
import { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import AuthScreen from '../screens/AuthScreen'

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  if (loading) return null

  if (!session) return <AuthScreen />

  return <Stack />
}