/**
 * enrichMovieData.js
 *
 * One-time setup + weekly refresh script (run via GitHub Actions).
 * For each movie in the database, fetches from TMDB:
 *   - original_language
 *   - top_cast (top 5 billed actors)
 *   - director(s)
 *   - watch_providers (US streaming/rent/buy data)
 *
 * Usage:
 *   node scripts/enrichMovieData.js
 *
 * Required env vars (in .env or GitHub Secrets):
 *   EXPO_PUBLIC_TMDB_API_KEY
 *   EXPO_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY   ← get from Supabase Dashboard > Settings > API
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const TMDB_API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY;
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TMDB_API_KEY) {
  console.error("ERROR: Missing EXPO_PUBLIC_TMDB_API_KEY");
  process.exit(1);
}
if (!SUPABASE_URL) {
  console.error("ERROR: Missing EXPO_PUBLIC_SUPABASE_URL");
  process.exit(1);
}
if (!SERVICE_ROLE_KEY) {
  console.error("ERROR: Missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

// Service role key bypasses RLS — safe for server-side scripts only, never use in the app
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CONCURRENCY = 5; // Movies processed in parallel
const BATCH_DELAY_MS = 300; // Delay between batches (TMDB rate limit safety)

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function enrichMovie(movieId) {
  try {
    // One call gets details + credits via append_to_response
    const [detailRes, providerRes] = await Promise.all([
      fetch(
        `https://api.themoviedb.org/3/movie/${movieId}?api_key=${TMDB_API_KEY}&append_to_response=credits`,
      ),
      fetch(
        `https://api.themoviedb.org/3/movie/${movieId}/watch/providers?api_key=${TMDB_API_KEY}`,
      ),
    ]);

    const detail = await detailRes.json();
    const providerData = await providerRes.json();

    const topCast = (detail.credits?.cast ?? []).slice(0, 5).map((c) => c.name);

    const directors = (detail.credits?.crew ?? [])
      .filter((c) => c.job === "Director")
      .map((c) => c.name);

    const watchProviders = providerData.results?.US ?? null;

    const { error } = await supabase
      .from("movies")
      .update({
        original_language: detail.original_language ?? null,
        top_cast: topCast.length > 0 ? topCast : null,
        director: directors.length > 0 ? directors : null,
        watch_providers: watchProviders,
      })
      .eq("id", String(movieId));

    if (error) return { success: false, movieId, error: error.message };
    return { success: true, movieId };
  } catch (err) {
    return { success: false, movieId, error: err.message };
  }
}

async function main() {
  console.log("Fetching movie list from database...");
  const { data: movies, error } = await supabase.from("movies").select("id");

  if (error || !movies) {
    console.error("Failed to fetch movies:", error?.message);
    process.exit(1);
  }

  console.log(
    `Enriching ${movies.length} movies (${CONCURRENCY} at a time)...\n`,
  );

  const failed = [];
  let completed = 0;

  for (let i = 0; i < movies.length; i += CONCURRENCY) {
    const batch = movies.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((m) => enrichMovie(m.id)));

    results.forEach((r) => {
      completed++;
      if (!r.success) {
        failed.push(r);
        process.stdout.write("✗");
      } else {
        process.stdout.write("·");
      }
    });

    process.stdout.write(`  ${completed}/${movies.length}\n`);

    if (i + CONCURRENCY < movies.length) {
      await sleep(BATCH_DELAY_MS);
    }
  }

  console.log(`\nDone. ${movies.length - failed.length} updated successfully.`);
  if (failed.length > 0) {
    console.log(`Failed (${failed.length}):`);
    failed.forEach((f) => console.log(`  - Movie ${f.movieId}: ${f.error}`));
  }
}

main();
