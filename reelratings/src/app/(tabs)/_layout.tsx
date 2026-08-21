import { Tabs, useRouter } from "expo-router";
import { Text, TouchableOpacity } from "react-native";

function ProfileButton() {
  const router = useRouter();
  return (
    <TouchableOpacity
      onPress={() => router.push("/profile")}
      style={{ marginRight: 16 }}
    >
      <Text style={{ color: "#ffffff", fontSize: 24 }}>👤</Text>
    </TouchableOpacity>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle: {
          backgroundColor: "#0d0d0d",
          borderTopColor: "#222222",
        },
        tabBarActiveTintColor: "#ffffff",
        tabBarInactiveTintColor: "#666666",
        headerStyle: {
          backgroundColor: "#0d0d0d",
        },
        headerTintColor: "#ffffff",
        headerRight: () => <ProfileButton />,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Match",
          headerTitle: "ReelRatings",
        }}
      />
      <Tabs.Screen
        name="rankings"
        options={{
          title: "My Rankings",
          headerTitle: "My Rankings",
        }}
      />
      <Tabs.Screen
        name="watchlist"
        options={{
          title: "Watchlist",
          headerTitle: "My Watchlist",
        }}
      />
      <Tabs.Screen
        name="discover"
        options={{
          title: "Discover",
          headerTitle: "Discover",
        }}
      />
    </Tabs>
  );
}
