import { cacheGet, cacheSet } from './cache.js';
import { TmdbError } from './types.js';

export const TMDB_BASE_URL = 'https://api.themoviedb.org/3/';
const LIST_TTL = 6 * 60 * 60 * 1000;
const DETAIL_TTL = 24 * 60 * 60 * 1000;
const GENRE_TTL = 24 * 60 * 60 * 1000;
const inFlight = new Map<string, Promise<unknown>>();

export interface TmdbParams {
  page?: number;
  sort_by?: string;
  with_genres?: string | number;
  with_original_language?: string;
  'first_air_date.gte'?: string;
  'first_air_date.lte'?: string;
  query?: string;
  include_adult?: boolean;
  [key: string]: string | number | boolean | undefined;
}

function cacheTtl(path: string): number {
  if (/^genre\//.test(path)) return GENRE_TTL;
  if (/^(movie|tv)\/\d+/.test(path)) return DETAIL_TTL;
  return LIST_TTL;
}

function requestKeyFor(path: string, params: URLSearchParams): string {
  return `${path}?${params.toString()}`;
}

export function tmdbRequest<T>(path: string, params: TmdbParams = {}, signal?: AbortSignal): Promise<T> {
  const normalizedPath = path.replace(/^\/+/, '');
  if (normalizedPath.includes('..') || normalizedPath.includes('?') || normalizedPath.includes('#')) {
    return Promise.reject(new TmdbError('Invalid TMDB endpoint.', 400));
  }
  const query = new URLSearchParams({ language: 'en-US' });
  Object.entries(params).sort(([left], [right]) => left.localeCompare(right)).forEach(([key, value]) => {
    if (value !== undefined) query.set(key, String(value));
  });
  const requestKey = requestKeyFor(normalizedPath, query);
  const cached = cacheGet<T>(requestKey);
  if (cached !== undefined) return Promise.resolve(cached);
  if (signal?.aborted) return Promise.reject(new DOMException('The request was aborted.', 'AbortError'));

  let shared = inFlight.get(requestKey) as Promise<T> | undefined;
  if (!shared) {
    const url = `/api/tmdb?path=${encodeURIComponent(normalizedPath)}&${query.toString()}`;
    shared = fetch(url)
      .then(async (response) => {
        if (!response.ok) {
          let message = `TMDB request failed (${response.status}).`;
          try {
            const payload: unknown = await response.json();
            if (typeof payload === 'object' && payload !== null && 'error' in payload && typeof payload.error === 'string') message = payload.error;
          } catch {
            // Keep the status-based message when proxy error JSON cannot be parsed.
          }
          throw new TmdbError(message, response.status, response.headers.get('Retry-After'));
        }
        return response.json() as Promise<T>;
      })
      .then((data) => {
        cacheSet(requestKey, data, cacheTtl(normalizedPath));
        return data;
      })
      .catch((error: unknown) => {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`[TMDB] ${normalizedPath} failed: ${reason}`);
        throw error;
      })
      .finally(() => inFlight.delete(requestKey));
    inFlight.set(requestKey, shared);
  }

  if (!signal) return shared;
  return Promise.race([
    shared,
    new Promise<T>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('The request was aborted.', 'AbortError')), { once: true });
    }),
  ]);
}
