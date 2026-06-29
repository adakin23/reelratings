const TMDB_BASE_URL = 'https://api.themoviedb.org/3'
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500'
const API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY

export interface TMDBMovie {
  id: number
  title: string
  poster_path: string | null
  release_date: string
  genres: { id: number; name: string }[]
  runtime: number
  overview: string
}

export interface TMDBSearchResult {
  id: number
  title: string
  poster_path: string | null
  release_date: string
  overview: string
}

export function getPosterUrl(path: string | null): string | null {
  if (!path) return null
  return `${TMDB_IMAGE_BASE}${path}`
}

export async function searchMovies(query: string): Promise<TMDBSearchResult[]> {
  const response = await fetch(
    `${TMDB_BASE_URL}/search/movie?api_key=${API_KEY}&query=${encodeURIComponent(query)}&include_adult=false`
  )
  const data = await response.json()
  return data.results ?? []
}

export async function getMovieDetails(movieId: number): Promise<TMDBMovie> {
  const response = await fetch(
    `${TMDB_BASE_URL}/movie/${movieId}?api_key=${API_KEY}&append_to_response=credits`
  )
  return response.json()
}

export async function getPopularMovies(page = 1): Promise<TMDBSearchResult[]> {
  const response = await fetch(
    `${TMDB_BASE_URL}/movie/popular?api_key=${API_KEY}&page=${page}`
  )
  const data = await response.json()
  return data.results ?? []
}

export interface TMDBPerson {
  id: number
  name: string
  biography: string
  birthday: string | null
  profile_path: string | null
  known_for_department: string
}

export interface TMDBPersonCredit {
  id: number
  title: string
  poster_path: string | null
  release_date: string
  character?: string
  job?: string
}

export async function searchPeople(query: string): Promise<{ id: number; name: string; profile_path: string | null; known_for_department: string }[]> {
  const response = await fetch(
    `${TMDB_BASE_URL}/search/person?api_key=${API_KEY}&query=${encodeURIComponent(query)}`
  )
  const data = await response.json()
  return data.results ?? []
}

export async function getPersonDetails(personId: number): Promise<TMDBPerson> {
  const response = await fetch(
    `${TMDB_BASE_URL}/person/${personId}?api_key=${API_KEY}`
  )
  return response.json()
}

export async function getPersonMovieCredits(personId: number): Promise<{ cast: TMDBPersonCredit[]; crew: TMDBPersonCredit[] }> {
  const response = await fetch(
    `${TMDB_BASE_URL}/person/${personId}/movie_credits?api_key=${API_KEY}`
  )
  return response.json()
}

export async function getTopRatedMovies(page = 1): Promise<TMDBSearchResult[]> {
  const response = await fetch(
    `${TMDB_BASE_URL}/movie/top_rated?api_key=${API_KEY}&page=${page}`
  )
  const data = await response.json()
  return data.results ?? []
}