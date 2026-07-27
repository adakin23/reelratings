import { Session } from "@supabase/supabase-js";
import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import AuthScreen from "../screens/AuthScreen";
import UsernameSetupScreen from "../screens/UsernameSetupScreen";

export default function RootLayout() {
  const [session, setSession] = useState<Session | null>(null);
  const [hasUsername, setHasUsername] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);

  const checkUsername = async (userId: string) => {
    const { data } = await supabase
      .from("profiles")
      .select("username")
      .eq("id", userId)
      .single();
    setHasUsername(!!data?.username);
    setLoading(false);
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        checkUsername(session.user.id);
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      if (session) {
        await checkUsername(session.user.id);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  if (loading) return null;
  if (!session) return <AuthScreen />;
  if (!hasUsername)
    return <UsernameSetupScreen onComplete={() => setHasUsername(true)} />;

  return <Stack />;
}
