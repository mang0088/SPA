const originalFetch = global.fetch;

global.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(String(input));
  if (url.origin !== 'https://api.themoviedb.org') return originalFetch(input, init);
  const authenticated = url.searchParams.get('api_key') === 'integration-test-key';
  const correctLanguage = url.searchParams.get('language') === 'en-US';
  const path = url.pathname.replace(/^\/3\//, '');
  if (path === 'genre/movie/list' || path === 'genre/tv/list') {
    return new Response(JSON.stringify({
      genres: [
        { id: 28, name: 'Action' },
        { id: 18, name: 'Drama' },
        { id: 16, name: 'Animation' },
      ],
      test_auth: authenticated,
      test_language: correctLanguage,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (path === 'trending/all/week' || /^(?:movie|tv)\/(?:popular|top_rated|upcoming|now_playing|on_the_air|airing_today)$/.test(path) || path === 'discover/tv' || path === 'discover/movie' || path === 'genre/movie/list' || path === 'genre/tv/list') {
    if (url.searchParams.get('page') === '429') {
      return new Response(JSON.stringify({ status_message: 'Rate limited' }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '3' } });
    }
    const mediaType = path.startsWith('tv/') || path.endsWith('tv') ? 'tv' : 'movie';
    const title = mediaType === 'tv' ? { name: 'Integration Test Series' } : { title: 'Integration Test Film' };
    return new Response(JSON.stringify({
      page: Number(url.searchParams.get('page') || '1'),
      total_pages: 2,
      total_results: 2,
      results: [{ id: 603, media_type: mediaType, ...title, overview: 'Deterministic test data for a cinematic poster card expanded state.', poster_path: '/test-poster.jpg', vote_average: 8.2, vote_count: 25, popularity: 91, genre_ids: [18, 28] }],
      test_auth: authenticated,
      test_language: correctLanguage,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (path === 'movie/603' || path === 'tv/603') {
    const isTv = path.startsWith('tv/');
    return new Response(JSON.stringify({
      id: 603, ...(isTv ? { name: 'Integration Test Series', created_by: [{ name: 'Test Creator' }] } : { title: 'Integration Test Film' }), overview: 'Detail test overview.', poster_path: '/test-poster.jpg', vote_average: 8.2,
      genres: [{ id: 18, name: 'Drama' }, { id: 28, name: 'Action' }],
      videos: { results: [{ id: 'video1', key: 'yt-test-key', name: 'Integration Trailer', site: 'YouTube', type: 'Trailer' }], total_results: 1 },
      credits: { crew: [{ name: 'Test Director', job: 'Director' }], cast: [{ name: 'Cast One', profile_path: '/cast-one.jpg' }, { name: 'Cast Two', profile_path: '/cast-two.jpg' }] }, 'watch/providers': { results: { US: { results: {} } } }, test_auth: authenticated, test_language: correctLanguage,
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (path === 'tv/603/season/1') {
    return new Response(JSON.stringify({ id: 1, episodes: [{ id: 1, episode_number: 1, name: 'Pilot', air_date: '2026-01-01' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (path === 'search/multi') {
    return new Response(JSON.stringify({ page: 1, total_pages: 1, total_results: 2, results: [
      { id: 603, media_type: 'movie', title: 'Batman Integration Test', poster_path: '/test-poster.jpg', release_date: '2026-01-01' },
      { id: 99, media_type: 'person', name: 'Test Actor', profile_path: '/profile.jpg', known_for_department: 'Acting', known_for: [{ id: 603, media_type: 'movie', title: 'Integration Test Film', poster_path: '/test-poster.jpg' }] },
    ] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({ status_message: `Unhandled test endpoint ${path}`, test_auth: authenticated }), { status: 404, headers: { 'content-type': 'application/json' } });
};
