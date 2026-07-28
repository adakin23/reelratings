export interface FilterState {
  genres: string[];
  yearMin: string;
  yearMax: string;
  runtimeMin: number;
  runtimeMax: number;
  languages: string[];
  actors: string[];
  directors: string[];
  streamingServices: string[];
}

export const DEFAULT_FILTERS: FilterState = {
  genres: [],
  yearMin: "",
  yearMax: "",
  runtimeMin: 0,
  runtimeMax: 300,
  languages: [],
  actors: [],
  directors: [],
  streamingServices: [],
};

export function countActiveFilters(filters: FilterState): number {
  let count = 0;
  if (filters.genres.length > 0) count++;
  if (filters.yearMin || filters.yearMax) count++;
  if (filters.runtimeMin > 0 || filters.runtimeMax < 300) count++;
  if (filters.languages.length > 0) count++;
  if (filters.actors.length > 0) count++;
  if (filters.directors.length > 0) count++;
  if (filters.streamingServices.length > 0) count++;
  return count;
}

export const LANGUAGE_NAMES: Record<string, string> = {
  en: "English",
  fr: "French",
  es: "Spanish",
  de: "German",
  it: "Italian",
  ja: "Japanese",
  ko: "Korean",
  zh: "Chinese",
  pt: "Portuguese",
  ru: "Russian",
  hi: "Hindi",
  ar: "Arabic",
  sv: "Swedish",
  da: "Danish",
  nl: "Dutch",
  pl: "Polish",
  tr: "Turkish",
  th: "Thai",
  he: "Hebrew",
  fa: "Persian",
  no: "Norwegian",
  fi: "Finnish",
  cs: "Czech",
  hu: "Hungarian",
};
