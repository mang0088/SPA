import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { after, before, test } from 'node:test';
import { catalogQuery, mapCatalogItem, seasonOf, seasonRange } from '../dist/src/catalog.js';

let server;
let baseUrl;
let stderr = '';

before(async () => {
  const port = 18080 + Math.floor(Math.random() * 1000);
  server = spawn(process.execPath, ['-r', './test/mock-upstream.cjs', 'server.cjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TMDB_API_KEY: 'integration-test-key' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (chunk) => { stderr += String(chunk); });
  baseUrl = `http://127.0.0.1:${port}`;
  await Promise.race([new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('server readiness timed out')), 5000);
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Catalog server listening')) { clearTimeout(timeout); resolve(); }
    });
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`server exited before readiness (${code}): ${stderr}`)));
  })]);
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
});

test('season helpers return accurate quarter boundaries and labels', () => {
  assert.equal(seasonOf(new Date('2026-10-09T12:00:00Z')), 'Fall');
  assert.deepEqual(seasonRange(2026, 'Winter'), { gte: '2026-01-01', lte: '2026-03-31' });
  assert.deepEqual(seasonRange(2026, 'Fall'), { gte: '2026-10-01', lte: '2026-12-31' });
});

test('catalog tabs map to the expected TMDB endpoints and filters', () => {
  assert.equal(catalogQuery('trending', 2, 'popular').endpoint, 'trending/all/week');
  assert.equal(catalogQuery('movies', 1, 'top_rated').endpoint, 'movie/top_rated');
  assert.equal(catalogQuery('tv', 1, 'on_the_air').endpoint, 'tv/on_the_air');
  assert.equal(catalogQuery('dramas', 1, 'popular').params.with_original_language, 'ko|zh|ja');
  assert.deepEqual(catalogQuery('anime', 1, 'popular', new Date('2026-10-09T12:00:00Z')).params, {
    page: 1, sort_by: 'popularity.desc', with_genres: 16, with_original_language: 'ja', 'first_air_date.gte': '2026-10-01', 'first_air_date.lte': '2026-12-31',
  });
  assert.equal(catalogQuery('upcoming', 1, 'popular', new Date('2026-10-09T12:00:00Z'), undefined, undefined, 'movies').endpoint, 'movie/upcoming');
  assert.deepEqual(catalogQuery('upcoming', 1, 'popular', new Date('2026-10-09T12:00:00Z'), undefined, undefined, 'tv'), {
    endpoint: 'discover/tv', params: { page: 1, sort_by: 'popularity.desc', 'first_air_date.gte': '2026-10-09' },
  });
  assert.deepEqual(catalogQuery('upcoming', 1, 'popular', new Date('2026-10-09T12:00:00Z'), undefined, undefined, 'anime'), {
    endpoint: 'discover/tv', params: { page: 1, sort_by: 'popularity.desc', with_genres: 16, with_original_language: 'ja', 'first_air_date.gte': '2026-10-09' },
  });
  assert.deepEqual(catalogQuery('upcoming', 1, 'popular', new Date('2026-10-09T12:00:00Z'), undefined, undefined, 'dramas'), {
    endpoint: 'discover/tv', params: { page: 1, sort_by: 'popularity.desc', with_original_language: 'ko|zh|ja', 'first_air_date.gte': '2026-10-09' },
  });
});

test('mapping creates typed movie and TV cards without inventing absent fields', () => {
  const movie = mapCatalogItem({ id: 7, title: 'Quiet Tide', poster_path: '/poster.jpg', release_date: '2026-05-01' }, 'movies');
  assert.equal(movie.mediaType, 'movie');
  assert.equal(movie.title, 'Quiet Tide');
  assert.equal(movie.rating, 0);
  assert.deepEqual(movie.genreIds, []);
  const series = mapCatalogItem({ id: 8, name: 'North Light', poster_path: null, media_type: 'tv' }, 'trending');
  assert.equal(series.mediaType, 'tv');
  assert.equal(series.title, 'North Light');
});

test('server routes requested TMDB lists through the authenticated canonical upstream', async () => {
  for (const path of ['trending%2Fall%2Fweek', 'movie%2Fpopular', 'tv%2Fpopular', 'discover%2Ftv']) {
    const response = await fetch(`${baseUrl}/api/tmdb?path=${path}&page=1`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.test_auth, true);
    assert.equal(body.test_language, true);
    assert.equal(body.results[0].id, 603);
  }
});

test('server handles real detail, season-one, search and rate-limit routes', async () => {
  const detail = await fetch(`${baseUrl}/api/tmdb?path=movie%2F603&append_to_response=videos%2Ccredits%2Cwatch%2Fproviders`);
  assert.equal(detail.status, 200);
  assert.equal((await detail.json()).videos.results[0].key, 'yt-test-key');
  const episodes = await fetch(`${baseUrl}/api/tmdb?path=tv%2F603%2Fseason%2F1`);
  assert.equal((await episodes.json()).episodes[0].name, 'Pilot');
  const search = await fetch(`${baseUrl}/api/tmdb?path=search%2Fmulti&query=Batman`);
  assert.match((await search.json()).results[0].title, /Batman/);
  const rateLimited = await fetch(`${baseUrl}/api/tmdb?path=movie%2Fpopular&page=429`);
  assert.equal(rateLimited.status, 429);
  assert.equal(rateLimited.headers.get('retry-after'), '3');
});

test('server safely serves the app, rewrites direct detail routes, and blocks unsafe proxy paths', async () => {
  const page = await fetch(baseUrl);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /dist\/src\/main\.js/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(page.headers.get('x-frame-options'), 'DENY');
  assert.equal(page.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.match(page.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
  const module = await fetch(`${baseUrl}/dist/src/main.js`);
  assert.equal(module.status, 200);
  assert.doesNotMatch(await module.text(), /api_key=/i);
  const directDetail = await fetch(`${baseUrl}/title/movie/603`);
  assert.equal(directDetail.status, 200);
  assert.match(await directDetail.text(), /Stillframe/);
  assert.equal((await fetch(`${baseUrl}/api/tmdb?path=configuration%2Fapi%2Fkey`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/.env`)).status, 404);
});
