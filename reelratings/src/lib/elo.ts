const K_FACTOR = 32

export function calculateElo(
  winnerElo: number,
  loserElo: number
): { newWinnerElo: number; newLoserElo: number; eloChange: number } {
  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400))
  const expectedLoser = 1 - expectedWinner

  const eloChange = K_FACTOR * (1 - expectedWinner)

  return {
    newWinnerElo: winnerElo + eloChange,
    newLoserElo: loserElo - K_FACTOR * (1 - expectedLoser),
    eloChange,
  }
}

export function normalizeElo(elo: number, minElo: number, maxElo: number): number {
  if (maxElo === minElo) return 50
  return Math.round(((elo - minElo) / (maxElo - minElo)) * 100)
}