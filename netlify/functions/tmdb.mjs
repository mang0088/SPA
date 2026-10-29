const TMDB_BASE_URL = 'https://api.themoviedb.org/3/';
const ALLOWED_PATH = /^(?:trending\/(?:all|movie|tv)\/week|search\/(?:multi|person)|movie\/(?:popular|upcoming|now_playing|top_rated)|tv\/(?:popular|on_the_air|airing_today|top_rated)|genre\/(?:movie|tv)\/list|discover\/(?:movie|tv)|(?:movie|tv)\/\d+(?:\/(?:keywords|recommendations|videos|images|external_ids|credits|watch\/providers|season\/\d+))?)$/;
const ALLOWED_APPEND_VALUES = new Set(['videos', 'images', 'external_ids', 'keywords', 'credits', 'watch/providers']);

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export default async function handler(request) {
  if (request.method !== 'GET') {
    return jsonResponse(405, { error: 'Method not allowed.' });
  }

  const requestUrl = new URL(request.url);
  const path = requestUrl.searchParams.get('path') || '';
  if (!ALLOWED_PATH.test(path)) {
    return jsonResponse(400, { error: 'Unsupported TMDB endpoint.' });
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    return jsonResponse(503, { error: 'TMDB_API_KEY is not configured on the server.' });
  }

  const upstreamUrl = new URL(path, TMDB_BASE_URL);
  upstreamUrl.searchParams.set('api_key', apiKey);
  upstreamUrl.searchParams.set('language', 'en-US');
  for (const [key, value] of requestUrl.searchParams) {
    if (key === 'path' || key === 'api_key' || key === 'language' || key.length > 48 || value.length > 200) continue;
    if (key === 'append_to_response') {
      const append = value.split(',').filter((entry) => ALLOWED_APPEND_VALUES.has(entry)).join(',');
      if (append) upstreamUrl.searchParams.set(key, append);
      continue;
    }
    upstreamUrl.searchParams.set(key, value);
  }

  try {
    const upstream = await fetch(upstreamUrl, { signal: AbortSignal.timeout(15000) });
    const headers = {
      'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    };
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) headers['Retry-After'] = retryAfter;
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
  } catch (error) {
    console.error('[TMDB proxy] upstream request failed:', error instanceof Error ? error.message : String(error));
    return jsonResponse(502, { error: 'TMDB is temporarily unavailable.' });
  }
}
