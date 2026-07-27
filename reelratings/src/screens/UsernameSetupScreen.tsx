import { useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";

interface Props {
  onComplete: () => void;
}

const USERNAME_REGEX = /^[a-zA-Z0-9_]{3,20}$/;

export default function UsernameSetupScreen({ onComplete }: Props) {
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const isValid = USERNAME_REGEX.test(username);

  const getFormatError = () => {
    if (username.length === 0) return null;
    if (username.length < 3) return "At least 3 characters";
    if (!/^[a-zA-Z0-9_]+$/.test(username))
      return "Letters, numbers, and underscores only";
    return null;
  };

  const formatError = getFormatError();

  const handleSubmit = async () => {
    if (!isValid) return;
    setLoading(true);
    setError(null);

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { error: insertError } = await supabase
        .from("profiles")
        .upsert(
          { id: user.id, username: username.toLowerCase() },
          { onConflict: "id" },
        );

      if (insertError) {
        if (insertError.code === "23505") {
          setError("That username is already taken. Try another.");
        } else {
          setError("Something went wrong. Please try again.");
        }
        return;
      }

      onComplete();
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={styles.content}>
        <Text style={styles.title}>Pick a username</Text>
        <Text style={styles.subtitle}>
          This is how other users will find you on ReelRatings.
        </Text>

        <TextInput
          style={[styles.input, formatError ? styles.inputError : null]}
          value={username}
          onChangeText={(text) => {
            setUsername(text);
            setError(null);
          }}
          placeholder="e.g. filmfan_99"
          placeholderTextColor="#444444"
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={20}
        />

        {formatError && (
          <Text style={styles.validationError}>{formatError}</Text>
        )}

        {error && <Text style={styles.validationError}>{error}</Text>}

        <Text style={styles.rules}>
          3–20 characters · letters, numbers, and underscores only
        </Text>

        <TouchableOpacity
          style={[
            styles.button,
            (!isValid || loading) && styles.buttonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={!isValid || loading}
        >
          {loading ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.buttonText}>Continue</Text>
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d0d0d",
    justifyContent: "center",
  },
  content: {
    padding: 32,
  },
  title: {
    color: "#ffffff",
    fontSize: 28,
    fontWeight: "bold",
    marginBottom: 10,
  },
  subtitle: {
    color: "#888888",
    fontSize: 15,
    marginBottom: 32,
    lineHeight: 22,
  },
  input: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 10,
    color: "#ffffff",
    fontSize: 18,
    padding: 16,
    marginBottom: 8,
  },
  inputError: {
    borderColor: "#f44336",
  },
  validationError: {
    color: "#f44336",
    fontSize: 13,
    marginBottom: 8,
  },
  rules: {
    color: "#444444",
    fontSize: 12,
    marginBottom: 24,
  },
  button: {
    backgroundColor: "#4a9eff",
    borderRadius: 10,
    paddingVertical: 16,
    alignItems: "center",
  },
  buttonDisabled: {
    opacity: 0.4,
  },
  buttonText: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
  },
});
