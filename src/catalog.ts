import { cacheGet, cacheSet } from './cache.js';
import { tmdbRequest } from './tmdb.js';
import type { CatalogItem, CatalogTab, MediaType, TmdbGenre, TmdbGenreResponse, TmdbListResponse, TmdbTitle, UpcomingCategory } from './types.js';

const TAB_KEYS: CatalogTab[] = ['trending', 'movies', 'tv', 'anime', 'upcoming'];
const SEASON_MONTHS = [
  { name: 'Winter', start: [1, 1] as const, end: [3, 31] as const },
  { name: 'Spring', start: [4, 1] as const, end: [6, 30] as const },
  { name: 'Summer', start: [7, 1] as const, end: [9, 30] as const },
  { name: 'Fall', start: [10, 1] as const, end: [12, 31] as const },
];
const GENRE_TTL = 24 * 60 * 60 * 1000;
const GENRE_KEY_PREFIX = 'catalog-genres:';

export interface CatalogQuery {
  endpoint: string;
  params: Record<string, string | number | boolean>;
}

export interface CatalogFilters {
  sort: string;
  language: 'original' | 'english';
  status: 'all' | 'airing' | 'upcoming';
}

export function selectedTab(): CatalogTab {
  const value = new URLSearchParams(location.search).get('tab');
  if (value === 'dramas') return 'upcoming';
  return TAB_KEYS.includes(value as CatalogTab) ? value as CatalogTab : 'trending';
}

export function seasonOf(date: Date): string {
  const month = date.getMonth() + 1;
  const season = SEASON_MONTHS.find((candidate) => month >= candidate.start[0] && month <= candidate.end[0]);
  return season?.name ?? 'Winter';
}

export function seasonRange(year: number, season: string): { gte: string; lte: string } {
  const range = SEASON_MONTHS.find((candidate) => candidate.name.toLowerCase() === season.toLowerCase()) ?? SEASON_MONTHS[0]!;
  const endDay = new Date(Date.UTC(year, range.end[0], 0)).getUTCDate();
  const format = (month: number, day: number): string => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { gte: format(range.start[0], range.start[1]), lte: format(range.end[0], endDay) };
}

export function catalogQuery(
  tab: CatalogTab,
  page: number,
  sort: string,
  now = new Date(),
  chosenSeason?: string,
  chosenYear?: number,
  upcomingCategory: UpcomingCategory = 'movies',
): CatalogQuery {
  if (tab === 'trending') return { endpoint: 'trending/all/week', params: { page } };
  if (tab === 'movies' && sort === 'upcoming') {
    const start = now.toISOString().slice(0, 10);
    const end = new Date(now.getTime() + 120 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    return { endpoint: 'discover/movie', params: { page, sort_by: 'primary_release_date.asc', 'primary_release_date.gte': start, 'primary_release_date.lte': end } };
  }
  if (tab === 'movies') return { endpoint: `movie/${sort}`, params: { page } };
  if (tab === 'tv') return { endpoint: `tv/${sort === 'upcoming' ? 'on_the_air' : sort}`, params: { page } };
  if (tab === 'dramas') return { endpoint: 'discover/tv', params: { page, sort_by: sort === 'top_rated' ? 'vote_average.desc' : 'popularity.desc', with_original_language: 'ko|zh|ja' } };
  if (tab === 'upcoming') {
    const today = now.toISOString().slice(0, 10);
    if (upcomingCategory === 'tv') {
      return { endpoint: 'discover/tv', params: { page, sort_by: 'popularity.desc', 'first_air_date.gte': today } };
    }
    if (upcomingCategory === 'anime') {
      return { endpoint: 'discover/tv', params: { page, sort_by: 'popularity.desc', with_genres: 16, with_original_language: 'ja', 'first_air_date.gte': today } };
    }
    if (upcomingCategory === 'dramas') {
      return { endpoint: 'discover/tv', params: { page, sort_by: 'popularity.desc', with_original_language: 'ko|zh|ja', 'first_air_date.gte': today } };
    }
    return { endpoint: 'movie/upcoming', params: { page } };
  }

  const season = chosenSeason ?? seasonOf(now);
  const range = seasonRange(chosenYear ?? now.getFullYear(), season);
  return {
    endpoint: 'discover/tv',
    params: { page, sort_by: 'popularity.desc', with_genres: 16, with_original_language: 'ja', 'first_air_date.gte': range.gte, 'first_air_date.lte': range.lte },
  };
}

export function mapCatalogItem(raw: TmdbTitle, tab: CatalogTab, upcomingCategory: UpcomingCategory = 'movies'): CatalogItem {
  const isTv = raw.media_type === 'tv' || tab === 'tv' || tab === 'anime' || tab === 'dramas' || (tab === 'upcoming' && upcomingCategory !== 'movies');
  const mediaType: Exclude<MediaType, 'person'> = isTv ? 'tv' : 'movie';
  const title = raw.title ?? raw.name ?? 'Untitled';
  return {
    id: raw.id,
    mediaType,
    title,
    originalTitle: raw.original_title ?? raw.original_name ?? title,
    overview: raw.overview ?? '',
    posterPath: raw.poster_path,
    backdropPath: raw.backdrop_path ?? null,
    date: raw.release_date ?? raw.first_air_date ?? '',
    rating: raw.vote_average ?? 0,
    voteCount: raw.vote_count ?? 0,
    popularity: raw.popularity ?? 0,
    genreIds: raw.genre_ids ?? [],
    language: raw.original_language ?? 'und',
  };
}

export async function loadGenres(type: 'movie' | 'tv'): Promise<Map<number, string>> {
  const key = `${GENRE_KEY_PREFIX}${type}`;
  const cached = cacheGet<TmdbGenreResponse>(key);
  if (cached) return new Map<number, string>(cached.genres.map((genre: TmdbGenre) => [genre.id, genre.name]));
  const response = await tmdbRequest<TmdbGenreResponse>(`genre/${type}/list`);
  cacheSet(key, response, GENRE_TTL);
  return new Map<number, string>(response.genres.map((genre: TmdbGenre) => [genre.id, genre.name]));
}

export async function loadCatalog(
  tab: CatalogTab,
  page: number,
  filters: CatalogFilters,
  signal?: AbortSignal,
  upcomingCategory: UpcomingCategory = 'movies',
): Promise<TmdbListResponse<TmdbTitle>> {
  const request = catalogQuery(tab, page, filters.sort, new Date(), undefined, undefined, upcomingCategory);
  const params = { ...request.params };
  if (filters.language === 'english' && tab !== 'anime' && tab !== 'dramas' && !(tab === 'upcoming' && (upcomingCategory === 'anime' || upcomingCategory === 'dramas'))) {
    params.with_original_language = 'en';
  }
  if (filters.sort === 'top_rated') params['vote_count.gte'] = 10;
  if (filters.sort === 'title') params.sort_by = 'original_title.asc';
  if (tab === 'movies' && filters.sort === 'upcoming') params['primary_release_date.gte'] = new Date().toISOString().slice(0, 10);
  if (filters.status === 'airing' && (tab === 'tv' || tab === 'anime' || tab === 'dramas')) params['first_air_date.lte'] = new Date().toISOString().slice(0, 10);
  if (filters.status === 'upcoming' && tab !== 'upcoming') {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    if (tab === 'movies') params['primary_release_date.gte'] = tomorrow;
    else if (tab === 'tv' || tab === 'anime' || tab === 'dramas') params['first_air_date.gte'] = tomorrow;
  }
  return tmdbRequest<TmdbListResponse<TmdbTitle>>(request.endpoint, params, signal);
}
