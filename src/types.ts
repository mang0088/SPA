export type CatalogTab = 'trending' | 'movies' | 'tv' | 'anime' | 'upcoming' | 'dramas';
export type UpcomingCategory = 'movies' | 'tv' | 'anime' | 'dramas';
export type MediaType = 'movie' | 'tv' | 'person';

export interface TmdbTitle {
  id: number;
  media_type?: MediaType;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  overview?: string;
  poster_path: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  original_language?: string;
  popularity?: number;
  adult?: boolean;
  profile_path?: string | null;
  known_for_department?: string;
}

export interface TmdbPerson extends TmdbTitle {
  name?: string;
  known_for_department?: string;
  known_for?: TmdbTitle[];
}

export interface TmdbListResponse<T> {
  page: number;
  results: T[];
  total_pages: number;
  total_results: number;
}

export interface TmdbGenre {
  id: number;
  name: string;
}

export interface TmdbGenreResponse {
  genres: TmdbGenre[];
}

export interface CatalogItem {
  id: number;
  mediaType: Exclude<MediaType, 'person'>;
  title: string;
  originalTitle: string;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  date: string;
  rating: number;
  voteCount: number;
  popularity: number;
  genreIds: number[];
  language: string;
  genres?: string[];
  cast?: Array<{ name: string; profilePath: string }>;
  director?: string;
}

export class TmdbError extends Error {
  constructor(message: string, public readonly status: number, public readonly retryAfter: string | null = null) {
    super(message);
    this.name = 'TmdbError';
  }
}
