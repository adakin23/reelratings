import Constants from "expo-constants";
import { useRouter } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { supabase } from "../lib/supabase";

const CATEGORIES = ["Bug", "Feature Request", "Other"] as const;
type Category = (typeof CATEGORIES)[number];

export default function ProfileScreen() {
  const router = useRouter();

  const [username, setUsername] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [memberSince, setMemberSince] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [feedbackCategory, setFeedbackCategory] = useState<Category>("Bug");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadProfile();
  }, []);

  const loadProfile = async () => {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      setEmail(user.email ?? null);
      setMemberSince(
        user.created_at
          ? new Date(user.created_at).toLocaleDateString("en-US", {
              month: "long",
              year: "numeric",
            })
          : null,
      );

      const { data: profile } = await supabase
        .from("profiles")
        .select("username")
        .eq("id", user.id)
        .single();

      setUsername(profile?.username ?? null);
    } finally {
      setLoading(false);
    }
  };

  const handleSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          await supabase.auth.signOut();
          router.replace("/");
        },
      },
    ]);
  };

  const handleSubmitFeedback = async () => {
    if (!feedbackMessage.trim()) {
      Alert.alert("Empty feedback", "Please write something before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { error } = await supabase.from("feedback").insert({
        user_id: user.id,
        category: feedbackCategory,
        message: feedbackMessage.trim(),
      });

      if (error) throw error;

      setFeedbackMessage("");
      Alert.alert("Thanks!", "Your feedback has been submitted.");
    } catch (err) {
      Alert.alert("Error", "Failed to submit feedback. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Account info */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account</Text>
        <View style={styles.infoCard}>
          {username && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Username</Text>
              <Text style={styles.infoValue}>{username}</Text>
            </View>
          )}
          {email && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Email</Text>
              <Text style={styles.infoValue}>{email}</Text>
            </View>
          )}
          {memberSince && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Member since</Text>
              <Text style={styles.infoValue}>{memberSince}</Text>
            </View>
          )}
          <View style={[styles.infoRow, styles.lastRow]}>
            <Text style={styles.infoLabel}>App version</Text>
            <Text style={styles.infoValue}>
              {Constants.expoConfig?.version ?? "—"}
            </Text>
          </View>
        </View>
      </View>

      {/* Feedback */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Feedback</Text>

        <Text style={styles.label}>Category</Text>
        <View style={styles.categoryRow}>
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[
                styles.categoryChip,
                feedbackCategory === cat && styles.categoryChipActive,
              ]}
              onPress={() => setFeedbackCategory(cat)}
            >
              <Text
                style={[
                  styles.categoryChipText,
                  feedbackCategory === cat && styles.categoryChipTextActive,
                ]}
              >
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </View>

        <Text style={styles.label}>Message</Text>
        <TextInput
          style={styles.textInput}
          value={feedbackMessage}
          onChangeText={setFeedbackMessage}
          placeholder="Tell us what's on your mind..."
          placeholderTextColor="#555555"
          multiline
          numberOfLines={5}
          textAlignVertical="top"
        />

        <TouchableOpacity
          style={[styles.submitButton, submitting && styles.submitButtonDisabled]}
          onPress={handleSubmitFeedback}
          disabled={submitting}
        >
          <Text style={styles.submitButtonText}>
            {submitting ? "Submitting..." : "Submit Feedback"}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Sign out */}
      <View style={styles.section}>
        <TouchableOpacity style={styles.signOutButton} onPress={handleSignOut}>
          <Text style={styles.signOutText}>Sign Out</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0d0d0d",
  },
  centered: {
    alignItems: "center",
    justifyContent: "center",
  },
  content: {
    padding: 20,
    paddingBottom: 60,
  },
  section: {
    marginBottom: 32,
  },
  sectionTitle: {
    color: "#ffffff",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 12,
  },
  infoCard: {
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#2a2a2a",
    overflow: "hidden",
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: "#2a2a2a",
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  infoLabel: {
    color: "#888888",
    fontSize: 14,
  },
  infoValue: {
    color: "#ffffff",
    fontSize: 14,
    fontWeight: "500",
    maxWidth: "60%",
    textAlign: "right",
  },
  label: {
    color: "#888888",
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  categoryRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  categoryChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
  },
  categoryChipActive: {
    backgroundColor: "#1a2a1a",
    borderColor: "#4caf50",
  },
  categoryChipText: {
    color: "#888888",
    fontSize: 13,
    fontWeight: "600",
  },
  categoryChipTextActive: {
    color: "#4caf50",
  },
  textInput: {
    backgroundColor: "#1a1a1a",
    borderWidth: 1,
    borderColor: "#2a2a2a",
    borderRadius: 10,
    padding: 14,
    color: "#ffffff",
    fontSize: 14,
    minHeight: 120,
    marginBottom: 12,
  },
  submitButton: {
    backgroundColor: "#1a2a1a",
    borderWidth: 1,
    borderColor: "#2a4a2a",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  submitButtonDisabled: {
    opacity: 0.5,
  },
  submitButtonText: {
    color: "#6fcf6f",
    fontSize: 15,
    fontWeight: "700",
  },
  signOutButton: {
    backgroundColor: "#1a0a0a",
    borderWidth: 1,
    borderColor: "#3a1a1a",
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: "center",
  },
  signOutText: {
    color: "#f44336",
    fontSize: 15,
    fontWeight: "700",
  },
});
