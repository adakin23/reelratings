/**
 * ELO rating system for ReelRatings.
 *
 * Variable K-factor:
 *   K=32  →  first 10 matchups  (settles fast from default 1000)
 *   K=24  →  matchups 11–20     (still flexible)
 *   K=16  →  matchups 21+       (stable; only large upsets move the needle)
 *
 * To adjust thresholds: change the getKFactor() function below.
 */

export function getKFactor(matchupCount: number): number {
  if (matchupCount < 10) return 32;
  if (matchupCount < 20) return 24;
  return 16;
}

/**
 * Calculate new ELO ratings after a matchup.
 *
 * Each side uses their own K-factor based on how many matchups they've had.
 * Pass matchupCount BEFORE this matchup (i.e., the count currently in the DB).
 */
export function calculateElo(
  winnerElo: number,
  loserElo: number,
  winnerMatchupCount = 0,
  loserMatchupCount = 0,
): { newWinnerElo: number; newLoserElo: number; eloChange: number } {
  const kWinner = getKFactor(winnerMatchupCount);
  const kLoser = getKFactor(loserMatchupCount);

  const expectedWinner = 1 / (1 + Math.pow(10, (loserElo - winnerElo) / 400));
  const expectedLoser = 1 - expectedWinner;

  const winnerChange = kWinner * (1 - expectedWinner);
  const loserChange = kLoser * (0 - expectedLoser);

  return {
    newWinnerElo: Math.round(winnerElo + winnerChange),
    newLoserElo: Math.round(loserElo + loserChange),
    eloChange: Math.round(winnerChange),
  };
}

/**
 * Normalize an ELO score to 0–100 across the user's library.
 * Returns 50 when all movies have the same ELO (avoids divide-by-zero).
 */
export function normalizeElo(
  elo: number,
  minElo: number,
  maxElo: number,
): number {
  if (maxElo === minElo) return 50;
  return Math.round(((elo - minElo) / (maxElo - minElo)) * 100);
}
