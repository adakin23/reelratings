/**
 * importMovies.js
 *
 * One-time script to bulk-import ~5,000 well-documented movies from TMDB
 * into the ReelRatings movies table.
 *
 * Fetches from three TMDB sources, deduplicates, applies quality filters,
 * and inserts only movies not already in the database.
 *
 * After running this:
 *   1. node scripts/enrichMovieData.js   (fills in cast, streaming, keywords, etc.)
 *   2. python scripts/trainPredictionModel.py  (generates predictions for all users)
 *
 * Usage:
 *   node scripts/importMovies.js
 *
 * Required env vars (in .env):
 *   EXPO_PUBLIC_TMDB_API_KEY
 *   EXPO_PUBLIC_SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY
 */

require("dotenv").config();
const { createClient } = require("@supabase/supabase-js");

const TMDB_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY;
const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!TMDB_KEY) {
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

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ─── Config ──────────────────────────────────────────────────────────────────

const MIN_VOTE_COUNT = 100;  // Minimum TMDB votes — ensures enough data for the model
const PAGE_DELAY_MS  = 260;  // ~260ms between requests stays under TMDB's 40 req/10s limit
const INSERT_BATCH   = 100;  // Rows per Supabase upsert batch

// Pages to fetch from each TMDB source (20 movies per page)
// popular 150p = 3,000 candidates
// top_rated 75p = 1,500 candidates
// discover  75p = 1,500 candidates
// ~6,000 candidates → ~5,000 after dedup and quality filter
const SOURCES = [
  { name: "movie/popular",   pages: 150, params: "" },
  { name: "movie/top_rated", pages: 75,  params: "" },
  {
    name: "discover/movie",
    pages: 75,
    params: "&sort_by=vote_count.desc",  // most-voted films — catches classics not trending
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchPage(endpoint, page, extraParams = "") {
  const url =
    `https://api.themoviedb.org/3/${endpoint}` +
    `?api_key=${TMDB_KEY}&page=${page}&language=en-US${extraParams}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${endpoint} page ${page}`);
  const data = await res.json();
  return data.results ?? [];
}

async function fetchSource(name, pages, extraParams) {
  const all = [];
  for (let page = 1; page <= pages; page++) {
    try {
      const results = await fetchPage(name, page, extraParams);
      all.push(...results);
    } catch (err) {
      // Log but keep going — a single failed page shouldn't abort the run
      process.stderr.write(`\n  Warning: ${err.message}\n`);
    }
    process.stdout.write(
      `\r  ${name}: page ${page}/${pages}  (${all.length} fetched)   `,
    );
    if (page < pages) await sleep(PAGE_DELAY_MS);
  }
  console.log(); // newline after progress line
  return all;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("ReelRatings — TMDB Movie Importer");
  console.log("===================================\n");

  // 1. Load existing IDs so we can skip them
  console.log("Loading existing movie IDs from database...");
  const { data: existing, error: existErr } = await supabase
    .from("movies")
    .select("id");
  if (existErr) {
    console.error("Failed to load existing movies:", existErr.message);
    process.exit(1);
  }
  const existingIds = new Set((existing ?? []).map((m) => String(m.id)));
  console.log(`  ${existingIds.size} movies already in database.\n`);

  // 2. Fetch from all TMDB sources sequentially (respects rate limit)
  console.log("Fetching movie lists from TMDB (this takes ~3 minutes)...");
  const allRaw = [];
  for (const source of SOURCES) {
    const results = await fetchSource(source.name, source.pages, source.params);
    allRaw.push(...results);
  }
  console.log(`\nTotal fetched (with duplicates): ${allRaw.length}`);

  // 3. Deduplicate by TMDB ID
  const seen = new Map();
  for (const m of allRaw) {
    const id = String(m.id);
    if (m.id && !seen.has(id)) seen.set(id, m);
  }
  console.log(`After dedup: ${seen.size} unique movies`);

  // 4. Apply quality filters and skip movies already in the DB
  const toInsert = [];
  for (const [id, m] of seen) {
    if (existingIds.has(id))              continue; // already in DB
    if ((m.vote_count ?? 0) < MIN_VOTE_COUNT) continue; // too obscure
    if (!m.poster_path)                   continue; // no poster
    if (!m.release_date)                  continue; // no date

    toInsert.push({
      id,
      title:             m.title,
      poster_path:       m.poster_path,
      release_date:      m.release_date,
      overview:          m.overview        ?? null,
      original_language: m.original_language ?? null,
      vote_average:      m.vote_average    ?? null,
      vote_count:        m.vote_count      ?? null,
      // genres, runtime, top_cast, director, keywords, watch_providers, certification
      // are all filled in by enrichMovieData.js — leave null here
    });
  }

  console.log(`New movies to insert: ${toInsert.length}\n`);

  if (toInsert.length === 0) {
    console.log("Nothing new to insert — database is already up to date.");
    return;
  }

  // 5. Insert in batches
  console.log(`Inserting into database in batches of ${INSERT_BATCH}...`);
  let inserted = 0;
  let failed   = 0;

  for (let i = 0; i < toInsert.length; i += INSERT_BATCH) {
    const batch = toInsert.slice(i, i + INSERT_BATCH);
    const { error } = await supabase
      .from("movies")
      .upsert(batch, { onConflict: "id" });

    if (error) {
      process.stderr.write(`\n  Batch error: ${error.message}\n`);
      failed += batch.length;
    } else {
      inserted += batch.length;
    }

    process.stdout.write(
      `\r  ${Math.min(i + INSERT_BATCH, toInsert.length)}/${toInsert.length} rows processed`,
    );
  }

  console.log("\n");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`  Inserted:  ${inserted}`);
  if (failed > 0) console.log(`  Failed:    ${failed}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("\nNext steps:");
  console.log("  1. node scripts/enrichMovieData.js");
  console.log("     (fills in cast, streaming, genres, runtime — takes ~20 min)");
  console.log("  2. python scripts/trainPredictionModel.py");
  console.log("     (generates predictions for all users)");
  console.log("  3. Refresh the Discover screen in the app.");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
