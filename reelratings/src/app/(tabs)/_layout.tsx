import { Tabs } from "expo-router";

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
