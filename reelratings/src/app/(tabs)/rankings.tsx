import { View, Text, StyleSheet } from 'react-native'

export default function RankingsScreen() {
  return (
    <View style={styles.container}>
      <Text style={styles.text}>My Rankings</Text>
      <Text style={styles.subtext}>Coming soon</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0d0d0d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: '#ffffff',
    fontSize: 24,
    fontWeight: 'bold',
  },
  subtext: {
    color: '#666666',
    fontSize: 16,
    marginTop: 8,
  },
})