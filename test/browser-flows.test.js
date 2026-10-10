import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

let server;
let baseUrl;
let browser;
let accountDataDirectory;
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const debugPort = 9220 + Math.floor(Math.random() * 500);

before(async () => {
  const port = 19000 + Math.floor(Math.random() * 1000);
  accountDataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stillframe-browser-auth-'));
  server = spawn(process.execPath, ['-r', './test/mock-upstream.cjs', 'server.cjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', TMDB_API_KEY: 'integration-test-key', DATA_DIR: accountDataDirectory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  baseUrl = `http://127.0.0.1:${port}`;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('test app server did not start')), 5000);
    server.stdout.on('data', (chunk) => { if (String(chunk).includes('Catalog server listening')) { clearTimeout(timeout); resolve(); } });
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`test app server exited (${code})`)));
  });
  browser = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-sandbox', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${process.cwd()}/.cache/chrome-functional-test-${debugPort}`, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let browserError = '';
  browser.stderr.on('data', (chunk) => { browserError += String(chunk); });
  browser.on('exit', (code) => { if (code !== 0) process.stderr.write(`Chrome exited (${code}): ${browserError}\\n`); });
});

after(async () => {
  if (browser && browser.exitCode === null) { browser.kill(); await Promise.race([once(browser, 'exit'), new Promise((resolve) => setTimeout(resolve, 1500))]); }
  if (server && server.exitCode === null) { server.kill(); await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 1500))]); }
  if (accountDataDirectory) fs.rmSync(accountDataDirectory, { recursive: true, force: true });
});

test('browser exposes working catalog controls and title detail interactions', async () => {
  await waitForPort(debugPort, browser);
  const { CDP } = await import('./cdp-client.js');
  const cdp = await new CDP(`http://127.0.0.1:${debugPort}`).connect();
  try {
    const { targetId } = await cdp.call('Target.createTarget', { url: 'about:blank' });
    const target = await cdp.waitForTarget((candidate) => candidate.targetId === targetId);
    const page = await cdp.attach(target.targetId);
    await page.call('Page.enable');
    await page.call('Runtime.enable');
    await page.call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__testErrors=[]; window.__apiLog=[]; window.addEventListener("error", event=>window.__testErrors.push(event.message)); window.addEventListener("unhandledrejection", event=>window.__testErrors.push(String(event.reason))); const originalFetch=window.fetch.bind(window); window.fetch=async (input, init)=>{ const url=new URL(typeof input==="string"?input:input.url,location.href); const method=(init?.method||(input instanceof Request?input.method:"GET")).toUpperCase(); const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined)); const hasBody=init?.body!==undefined||(input instanceof Request&&input.body!==null); const response=await originalFetch(input,init); if(url.pathname.startsWith("/api/auth/")) window.__apiLog.push({path:url.pathname,method,status:response.status,contentType:headers.get("content-type"),hasBody}); return response; }; Object.defineProperty(window, "IntersectionObserver", { value: class { observe() {} disconnect() {} } });' });
    await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });
    await page.call('Page.navigate', { url: `${baseUrl}/` });
    await page.evaluate(`new Promise((resolve) => {
      const started = Date.now();
      const poll = () => document.querySelector('#catalogGrid .catalog-card h2') ? resolve(true) : Date.now() - started > 6000 ? resolve(false) : setTimeout(poll, 30);
      poll();
    })`);
    const initialState = await page.evaluate(`JSON.stringify({ title: document.title, body: document.body.innerText.slice(0, 1200), errors: window.__testErrors || [], resources: performance.getEntriesByType('resource').map((entry) => entry.name).filter((name) => /main\\.js|api\\/tmdb/.test(name)) })`);
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.catalog-card h2'))`), true, `homepage displays fetched trending cards; state=${initialState}`);
    assert.equal(await page.evaluate(`fetch('/api/auth/watchlist').then(response => response.status)`), 401, 'the real account route denies unauthenticated watchlist access');

    for (const viewport of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }]) {
      await page.call('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false });
      const layout = await page.evaluate(`(() => {
        const grid = document.querySelector('#catalogGrid');
        const originals = [...grid.children];
        for (let index = 0; index < 11; index += 1) grid.append(originals[0].cloneNode(true));
        const cards = [...grid.querySelectorAll('.catalog-card')];
        const rows = new Map();
        cards.forEach((card) => {
          const rect = card.getBoundingClientRect();
          const top = Math.round(rect.top);
          rows.set(top, [...(rows.get(top) ?? []), { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }]);
        });
        const rowValues = [...rows.values()];
        const result = {
          columns: rowValues[0]?.length ?? 0,
          rowCount: rowValues.length,
          completeVisibleRows: rowValues.filter((row) => row.every((card) => card.bottom <= innerHeight)).length,
          firstCard: cards[0] ? (() => { const rect = cards[0].getBoundingClientRect(); return { width: rect.width, height: rect.height }; })() : null,
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          documentWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
        };
        grid.replaceChildren(...originals);
        return result;
      })()`);
      assert.ok(layout.columns >= 5, `${viewport.width}x${viewport.height} has at least 5 cards in its first row: ${JSON.stringify(layout)}`);
      assert.ok(layout.completeVisibleRows >= 2, `${viewport.width}x${viewport.height} shows two complete rows: ${JSON.stringify(layout)}`);
      assert.ok(layout.firstCard.width >= 150 && layout.firstCard.width <= 175, `${viewport.width}x${viewport.height} card width is in the target range: ${JSON.stringify(layout)}`);
      assert.ok(layout.firstCard.height >= 215 && layout.firstCard.height <= 250, `${viewport.width}x${viewport.height} card height is in the target range: ${JSON.stringify(layout)}`);
      assert.equal(layout.horizontalOverflow, false, `${viewport.width}x${viewport.height} has no horizontal overflow`);
      assert.equal(layout.rowCount >= 2, true, `${viewport.width}x${viewport.height} lays cards out across rows`);
    }

    await page.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
    const mobileLayout = await page.evaluate(`(() => {
      const grid = document.querySelector('#catalogGrid');
      const card = grid.querySelector('.catalog-card');
      const rect = card.getBoundingClientRect();
      return { columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length, gap: getComputedStyle(grid).columnGap, width: rect.width, height: rect.height, aspectRatio: rect.width / rect.height, horizontalOverflow: document.documentElement.scrollWidth > innerWidth };
    })()`);
    assert.equal(mobileLayout.columns, 2, `mobile retains its two-column grid: ${JSON.stringify(mobileLayout)}`);
    assert.equal(mobileLayout.gap, '10px', `mobile retains its existing grid gap: ${JSON.stringify(mobileLayout)}`);
    assert.ok(Math.abs(mobileLayout.aspectRatio - 0.70) < 0.02, `mobile retains its poster proportions: ${JSON.stringify(mobileLayout)}`);
    assert.equal(mobileLayout.horizontalOverflow, false, `mobile has no horizontal overflow: ${JSON.stringify(mobileLayout)}`);
    await page.call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 1000, deviceScaleFactor: 1, mobile: false });

    await page.evaluate(`new Promise((resolve) => setTimeout(resolve, 420))`);
    const posterBox = await page.evaluate(`(() => {
      const card = document.querySelector('#catalogGrid .catalog-card');
      const rect = card.getBoundingClientRect();
      const poster = card.querySelector('.catalog-poster');
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, filter: getComputedStyle(poster).filter };
    })()`);
    assert.equal(posterBox.filter, 'none', 'poster image is sharp in its default state');
    await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: posterBox.x + posterBox.width / 2, y: posterBox.y + posterBox.height / 2 });
    await waitForSelector(page, '.poster-cast-portrait');
    assert.equal(await page.evaluate(`document.querySelector('.card-creator')?.textContent`), 'Directed by Test Director', 'real director metadata loads into the card');
    assert.equal(await page.evaluate(`document.querySelector('.rating-score')?.textContent`), '8.2 / 10', 'the poster shows the original ten-point rating');
    assert.equal(await page.evaluate(`document.querySelectorAll('.genre-badge').length`), 2, 'the card displays actual genre names');
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.poster-synopsis')?.textContent)`), true, 'the expanded poster shows the title synopsis');
    await page.evaluate(`new Promise((resolve) => setTimeout(resolve, 380))`);
    const expandedPoster = await page.evaluate(`(() => {
      const card = document.querySelector('#catalogGrid .catalog-card');
      const rect = card.getBoundingClientRect();
      return { width: rect.width, height: rect.height, filter: getComputedStyle(card.querySelector('.catalog-poster')).filter, synopsisOpacity: getComputedStyle(card.querySelector('.poster-expanded')).opacity };
    })()`);
    assert.ok(Number(expandedPoster.filter.match(/blur\(([\d.]+)px\)/)?.[1] ?? 0) > 2.5, 'hover blurs only the poster image');
    assert.notEqual(expandedPoster.synopsisOpacity, '0', 'hover reveals the synopsis');
    assert.ok(Math.abs(expandedPoster.width - posterBox.width) < 0.1, 'card width stays fixed during expansion');
    assert.ok(Math.abs(expandedPoster.height - posterBox.height) < 0.1, 'card height stays fixed during expansion');
    await page.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1250, y: 950 });
    await page.evaluate(`document.querySelector('.catalog-card').classList.remove('is-hovered', 'is-keyboard-focused', 'is-expanded')`);
    await page.evaluate(`new Promise((resolve) => setTimeout(resolve, 700))`);
    const hoverExitState = await page.evaluate(`JSON.stringify({ filter: getComputedStyle(document.querySelector('.catalog-card .catalog-poster')).filter, hover: document.querySelector('.catalog-card')?.matches(':hover'), focus: document.querySelector('.catalog-card')?.matches(':focus-within') })`);
    assert.equal(JSON.parse(hoverExitState).filter, 'none', `leaving restores the sharp poster; state=${hoverExitState}`);
    await page.evaluate(`document.querySelector('#catalogGrid .catalog-card').focus()`);
    await page.evaluate(`new Promise((resolve) => setTimeout(resolve, 380))`);
    const keyboardCard = await page.evaluate(`(() => {
      const card = document.querySelector('#catalogGrid .catalog-card');
      card.focus();
      card.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
      return { filter: getComputedStyle(card.querySelector('.catalog-poster')).filter, focus: card.matches(':focus'), focusWithin: card.matches(':focus-within'), keyboardState: card.classList.contains('is-keyboard-focused') };
    })()`);
    assert.ok(Number(keyboardCard.filter.match(/blur\(([\d.]+)px\)/)?.[1] ?? 0) > 2.5, `keyboard focus reveals expanded details; state=${JSON.stringify(keyboardCard)}`);
    await page.evaluate(`document.querySelector('#catalogGrid .catalog-card').blur()`);
    await page.evaluate(`(() => { const card = document.querySelector('#catalogGrid .catalog-card'); const toggle = card.querySelector('.card-details-toggle'); toggle.click(); })()`);
    assert.equal(await page.evaluate(`document.querySelector('#catalogGrid .catalog-card')?.classList.contains('is-expanded')`), true, 'the explicit details control can reveal and dismiss the expanded view');
    await page.evaluate(`document.querySelector('#catalogGrid .card-details-toggle').click()`);
    assert.equal(await page.evaluate(`document.querySelector('#catalogGrid .catalog-card')?.classList.contains('is-expanded')`), false, 'the details control toggles the view closed');

    await page.evaluate(`document.getElementById('tab-tv').click()`);
    assert.equal(await page.evaluate(`new URLSearchParams(location.search).get('tab')`), 'tv');
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.catalog-heading-row, .catalog-status'))`), false, 'the catalog heading row and status are absent');
    assert.equal(await page.evaluate(`document.querySelectorAll('#catalogGrid .catalog-card').length`), 1);

    assert.equal(await page.evaluate(`Boolean(document.getElementById('filterToggle'))`), true, 'navigation panel exposes a filter icon');
    assert.equal(await page.evaluate(`document.getElementById('filterPanel')?.classList.contains('is-open')`), false, 'filter drawer starts closed');
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.filter-drawer .filter-chip'))`), false, 'saved-only chip is not mixed into the drawer');
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.filter-drawer input[type=search]'))`), false, 'page-search input is not mixed into the drawer');
    await page.evaluate(`document.getElementById('filterToggle').click()`);
    assert.equal(await page.evaluate(`document.getElementById('filterPanel')?.classList.contains('is-open')`), true, 'filter icon slides the drawer open');
    assert.equal(await page.evaluate(`document.getElementById('filterPanel')?.getAttribute('role')`), 'dialog', 'drawer is exposed as a dialog');

    await page.evaluate(`(() => { const filter = document.getElementById('filter-sort'); filter.value = 'top_rated'; filter.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await page.evaluate(`(() => { const filter = document.getElementById('filter-language'); filter.value = 'english'; filter.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    await page.evaluate(`(() => { const filter = document.getElementById('filter-status'); filter.value = 'airing'; filter.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await page.evaluate(`new URLSearchParams(location.search).get('sort')`), 'popular', 'draft filter changes are not applied until Apply is selected');
    await page.evaluate(`document.querySelector('.filter-apply-btn').click()`);
    await waitForProxyRequest(page, { path: 'tv/top_rated', 'vote_count.gte': '10', with_original_language: 'en', 'first_air_date.lte': '__present__' });
    assert.equal(await page.evaluate(`document.getElementById('filterPanel')?.classList.contains('is-open')`), false, 'Apply filters closes the drawer');
    await page.evaluate(`new Promise((resolve) => {
      const started = Date.now();
      const poll = () => document.querySelectorAll('#catalogGrid .catalog-card').length === 1 && !document.getElementById('loadMore').disabled ? resolve(true) : Date.now() - started > 6000 ? resolve(false) : setTimeout(poll, 30);
      poll();
    })`).then((ready) => assert.equal(ready, true, 'filtered catalog remains loaded and has more pages'));
    await page.evaluate(`document.getElementById('loadMore').click()`);
    await waitForProxyRequest(page, { path: 'tv/top_rated', page: '2' });
    await page.evaluate(`new Promise((resolve) => {
      const started = Date.now();
      const poll = () => document.querySelectorAll('#catalogGrid .catalog-card').length === 2 ? resolve(true) : Date.now() - started > 6000 ? resolve(false) : setTimeout(poll, 30);
      poll();
    })`).then((appended) => assert.equal(appended, true, 'load more appends the next page'));

    await page.evaluate(`document.getElementById('filterToggle').click()`);
    assert.equal(await page.evaluate(`document.getElementById('filterPanel')?.classList.contains('is-open')`), true, 'filter drawer can be reopened');
    await page.evaluate(`document.querySelector('.filter-reset-btn').click()`);
    assert.equal(await page.evaluate(`document.getElementById('filter-sort')?.value`), 'popular', 'Reset clears the draft selections');
    await page.evaluate(`document.querySelector('.filter-apply-btn').click()`);
    await waitForProxyRequest(page, { path: 'tv/popular' });
    assert.equal(await page.evaluate(`document.getElementById('filterPanel')?.classList.contains('is-open')`), false, 'applying reset filters closes the drawer');

    await page.evaluate(`document.querySelector('#catalogGrid .catalog-card .title-link').click()`);
    assert.equal(await page.evaluate(`location.pathname`), '/title/tv/603');
    await waitForSelector(page, '.detail-title');
    assert.equal(await page.evaluate(`document.querySelector('.detail-title')?.textContent`), 'Integration Test Series');
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.detail-navigation button'))`), true);

    await page.evaluate(`document.querySelector('.detail-tab[role="tab"]:nth-child(2)').click()`);
    await waitForSelector(page, '.episode-title');
    assert.equal(await page.evaluate(`document.querySelector('.episode-title')?.textContent`), 'EP 1 · Pilot');

    await page.evaluate(`document.querySelector('.detail-tab[role="tab"]:nth-child(3)').click()`);
    await waitForSelector(page, '.video-card .video-title');
    assert.equal(await page.evaluate(`document.querySelector('.video-card .video-title')?.textContent`), 'Integration Trailer');
    await page.evaluate(`document.querySelector('.video-card').click()`);
    assert.match(await page.evaluate(`document.querySelector('.video-frame')?.src || ''`), /yt-test-key/);
    await page.evaluate(`document.querySelector('.video-close').click()`);
    await page.evaluate(`document.querySelector('.detail-navigation button').click()`);
    await page.evaluate(`new Promise((resolve) => {
      const started = Date.now();
      const poll = () => location.pathname === '/' && document.querySelector('#catalogGrid .catalog-card h2') ? resolve(true) : Date.now() - started > 6000 ? resolve(false) : setTimeout(poll, 30);
      poll();
    })`);
    assert.equal(await page.evaluate(`location.pathname`), '/');

    await page.evaluate(`document.getElementById('tab-movies').click()`);
    assert.equal(await page.evaluate(`new URLSearchParams(location.search).get('tab')`), 'movies');
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.catalog-heading-row, .catalog-status'))`), false, 'Movies renders without redundant catalog UI');

    await page.evaluate(`document.getElementById('tab-anime').click()`);
    assert.equal(await page.evaluate(`new URLSearchParams(location.search).get('tab')`), 'anime');
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.catalog-heading-row, .catalog-status'))`), false, 'Anime renders without redundant catalog UI');
    await page.evaluate(`document.getElementById('filterToggle').click()`);
    assert.equal(await page.evaluate(`Boolean(document.querySelector('#filterPanel .season-control'))`), true, 'anime season selector remains available within Filters');
    await page.evaluate(`document.querySelector('.filter-apply-btn').click()`);

    await page.evaluate(`document.getElementById('tab-upcoming').click()`);
    assert.equal(await page.evaluate(`new URLSearchParams(location.search).get('tab')`), 'upcoming');
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.catalog-heading-row, .catalog-status'))`), false, 'Upcoming renders without redundant catalog UI');
    await waitForProxyRequest(page, { path: 'movie/upcoming' });

    await page.evaluate(`document.getElementById('filterToggle').click()`);
    await page.evaluate(`(() => { const filter = document.getElementById('filter-upcoming-category'); filter.value = 'dramas'; filter.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await page.evaluate(`new URLSearchParams(location.search).get('category')`), 'movies', 'upcoming category remains a draft until applied');
    await page.evaluate(`document.querySelector('.filter-apply-btn').click()`);
    assert.equal(await page.evaluate(`new URLSearchParams(location.search).get('category')`), 'dramas');
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.catalog-heading-row, .catalog-status'))`), false, 'Upcoming category changes keep removed UI absent');
    await waitForProxyRequest(page, { path: 'discover/tv', with_original_language: 'ko|zh|ja' });

    await page.evaluate(`document.getElementById('tab-trending').click()`);
    assert.equal(await page.evaluate(`document.getElementById('tab-trending').textContent`), 'Trending', 'the Trending navigation label has no Movie prefix');
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.catalog-heading-row, .catalog-status'))`), false, 'Trending renders without the removed catalog heading and status');
    await page.evaluate(`document.querySelector('[aria-label="Search titles"]').click()`);
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.actor-search-form'))`), false, 'global search does not contain the obsolete actor-only form');
    await page.evaluate(`(() => { const input = document.querySelector('.search-dialog input[type=search]'); input.value='Batman'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await page.evaluate(`new Promise((resolve) => setTimeout(resolve, 380))`);
    assert.equal(await page.evaluate(`document.querySelector('.suggestion-title')?.textContent`), 'Batman Integration Test');
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.catalog-heading-row, .catalog-status, .actor-search-form'))`), false, 'the current landing page has no removed catalog or actor search elements');
    await page.evaluate(`document.querySelector('.suggestion-row').click()`);
    assert.equal(await page.evaluate(`location.pathname`), '/title/movie/603');
    await waitForSelector(page, '.detail-title');
    assert.equal(await page.evaluate(`document.querySelector('.detail-title')?.textContent`), 'Integration Test Film');
    await page.evaluate(`document.querySelector('[aria-label="Search titles"]').click()`);
    await page.evaluate(`(() => { const input = document.querySelector('.search-dialog input[type=search]'); input.value='Batman'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await page.evaluate(`new Promise((resolve) => setTimeout(resolve, 500))`);
    assert.equal(await page.evaluate(`document.querySelectorAll('.suggestion-row').length`), 2, 'global search includes title and people matches');
    await page.evaluate(`document.querySelectorAll('.suggestion-row')[1].click()`);
    assert.equal(await page.evaluate(`document.querySelector('.search-loading')?.textContent`), 'Titles featuring Test Actor', 'people matches show their known-for titles in the global search dialog');
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.actor-search-form, .actor-grid'))`), false, 'people results do not open an actor-specific form or page');
    assert.equal(await page.evaluate(`document.querySelector('.suggestion-row')?.textContent`), 'Integration Test FilmMOVIE', 'a person known-for title is available in global search');
    await page.evaluate(`document.querySelector('.suggestion-row').click()`);
    await waitForSelector(page, '.detail-title');
    assert.equal(await page.evaluate(`document.querySelector('.detail-title')?.textContent`), 'Integration Test Film', 'known-for titles open in the standard title details route');
    await page.evaluate(`document.querySelector('.detail-bookmark').click()`);
    assert.equal(await page.evaluate(`document.querySelector('.detail-bookmark')?.getAttribute('aria-pressed')`), 'true', 'titles can be saved before signing up');
    const localWatchlist = await page.evaluate("localStorage.getItem('entertainment:v1:watchlist:items')");
    assert.match(localWatchlist ?? '', /Integration Test Film/, 'the title is cached before account signup');

    assert.equal(await page.evaluate(`document.querySelector('#loginButton .login-label')?.textContent`), 'Log in', 'the header offers a login entry point');
    await page.evaluate(`document.getElementById('loginButton').click()`);
    await waitForSelector(page, '.auth-dialog');
    assert.equal(await page.evaluate(`document.querySelector('#authDialogTitle')?.textContent`), 'Welcome back', 'the login form opens by default');
    await page.evaluate(`document.getElementById('authTabSignup').click()`);
    assert.equal(await page.evaluate(`document.querySelector('#authDialogTitle')?.textContent`), 'Create your account');
    const browserFlowEmail = `browser-flow-${Date.now()}@example.com`;
    await page.evaluate(`(() => {
      document.getElementById('authDisplayName').value = 'Flow Tester';
      document.getElementById('authEmail').value = '${browserFlowEmail}';
      document.getElementById('authPassword').value = 'stillframe-test-1';
      document.getElementById('authConfirm').value = 'stillframe-test-1';
      document.getElementById('authSubmit').click();
    })()`);
    await waitForSelector(page, '.user-menu-button');
    assert.equal(await page.evaluate(`document.querySelector('.user-avatar')?.textContent`), 'FT');
    assert.equal(await page.evaluate(`document.querySelector('.user-name')?.textContent`), 'Flow Tester');
    assert.equal(await page.evaluate(`Boolean(document.getElementById('authBackdrop'))`), false, 'the dialog closes after a successful signup');
    assert.equal(await page.evaluate(`document.getElementById('watchlistCount')?.textContent`), '1', 'the pre-signup title appears in the signed-in watchlist');
    const signupRequest = await page.evaluate(`window.__apiLog.find(({ path }) => path === '/api/auth/signup')`);
    assert.deepEqual(signupRequest, { path: '/api/auth/signup', method: 'POST', status: 201, contentType: 'application/json', hasBody: true }, 'the signup form sends a JSON body through POST and receives Created');
    const serverHasSavedTitle = await page.evaluate(`new Promise((resolve) => {
      const started = Date.now();
      const poll = () => fetch('/api/auth/watchlist').then(response => response.json()).then(payload => payload.items?.length ? resolve(true) : Date.now() - started > 6000 ? resolve(false) : setTimeout(poll, 30));
      poll();
    })`);
    assert.equal(serverHasSavedTitle, true, `signup syncs the saved title to the account; status=${await page.evaluate(`document.getElementById('appNotice')?.textContent`)}`);

    await page.evaluate(`localStorage.removeItem('entertainment:v1:watchlist'); localStorage.removeItem('entertainment:v1:watchlist:items');`);
    await page.call('Page.navigate', { url: `${baseUrl}/` });
    await waitForSelector(page, '.user-menu-button');
    const restoredWatchlist = await page.evaluate(`new Promise((resolve) => {
      const started = Date.now();
      const poll = () => document.getElementById('watchlistCount')?.textContent === '1' ? resolve(true) : Date.now() - started > 6000 ? resolve(false) : setTimeout(poll, 30);
      poll();
    })`);
    const watchlistState = await page.evaluate("JSON.stringify({ count: document.getElementById('watchlistCount')?.textContent, user: document.querySelector('.user-menu-name')?.textContent, errors: window.__testErrors })");
    assert.equal(restoredWatchlist, true, `watchlist is restored from the account after clearing browser storage; state=${watchlistState}`);
    assert.equal(await page.evaluate(`document.querySelector('.user-menu-name')?.textContent`), 'Flow Tester', 'the session is restored on a fresh page load');
    await page.evaluate(`document.querySelector('.watchlist-button').click()`);
    await waitForSelector(page, '#catalogGrid .catalog-card h2');
    assert.equal(await page.evaluate(`document.querySelector('#catalogGrid .catalog-card h2')?.textContent`), 'Integration Test Film', 'the account watchlist restores the saved title');
    await page.evaluate(`document.querySelector('.watchlist-button').click()`);
    await page.evaluate(`document.getElementById('userMenuButton').click()`);
    assert.equal(await page.evaluate(`document.getElementById('userMenu')?.hidden`), false, 'the account menu opens from the avatar');
    await page.evaluate(`document.getElementById('signOutButton').click()`);
    await waitForSelector(page, '#loginButton');
    assert.equal(await page.evaluate(`Boolean(document.querySelector('.user-menu-button'))`), false, 'signing out restores the login button');
    assert.equal(await page.evaluate(`document.getElementById('watchlistCount')?.textContent`), '0', 'signing out clears account-only watchlist data from the browser');

    await page.evaluate(`document.getElementById('loginButton').click()`);
    await waitForSelector(page, '#authEmail');
    await page.evaluate(`document.getElementById('authTabSignup').click()`);
    await page.evaluate(`(() => {
      document.getElementById('authDisplayName').value = 'Duplicate Tester';
      document.getElementById('authEmail').value = '${browserFlowEmail}';
      document.getElementById('authPassword').value = 'stillframe-test-1';
      document.getElementById('authConfirm').value = 'stillframe-test-1';
      document.getElementById('authSubmit').click();
    })()`);
    await waitForSelector(page, '.auth-error:not([hidden])');
    assert.match(await page.evaluate(`document.getElementById('authError').textContent`), /already exists/i, 'duplicate signup reports a safe validation message');
    assert.deepEqual(await page.evaluate(`window.__apiLog.findLast(({ path }) => path === '/api/auth/signup')`), { path: '/api/auth/signup', method: 'POST', status: 409, contentType: 'application/json', hasBody: true }, 'duplicate signup receives Conflict rather than a method or route error');

    await page.evaluate(`document.getElementById('authTabLogin').click()`);
    await page.evaluate(`(() => {
      document.getElementById('authEmail').value = '${browserFlowEmail}';
      document.getElementById('authPassword').value = 'stillframe-test-1';
      document.getElementById('authSubmit').click();
    })()`);
    await waitForSelector(page, '.user-menu-button');
    assert.deepEqual(await page.evaluate(`window.__apiLog.findLast(({ path }) => path === '/api/auth/login')`), { path: '/api/auth/login', method: 'POST', status: 200, contentType: 'application/json', hasBody: true }, 'the login form sends a JSON body through POST and receives success');
    assert.ok(await page.evaluate(`window.__apiLog.some(({ path, status }) => path === '/api/auth/session' && status === 200)`), 'login establishes a session visible to the session endpoint');
    await page.evaluate(`document.getElementById('signOutButton').click()`);
    await waitForSelector(page, '#loginButton');
    assert.deepEqual(await page.evaluate(`window.__apiLog.findLast(({ path }) => path === '/api/auth/logout')`), { path: '/api/auth/logout', method: 'POST', status: 200, contentType: 'application/json', hasBody: true }, 'logout uses its registered POST endpoint and succeeds');
    assert.equal(await page.evaluate(`fetch('/api/auth/watchlist').then(response => response.status)`), 401, 'sign-out removes access to the protected watchlist');

    await page.evaluate(`document.getElementById('loginButton').click()`);
    await waitForSelector(page, '#authEmail');
    await page.evaluate(`(() => {
      document.getElementById('authEmail').value = 'browser-flow-invalid-${Date.now()}@example.com';
      document.getElementById('authPassword').value = 'stillframe-test-1';
      document.getElementById('authSubmit').click();
    })()`);
    await waitForSelector(page, '.auth-error:not([hidden])');
    assert.match(await page.evaluate(`document.getElementById('authError').textContent`), /incorrect/i);
    assert.deepEqual(await page.evaluate(`window.__apiLog.findLast(({ path }) => path === '/api/auth/login')`), { path: '/api/auth/login', method: 'POST', status: 401, contentType: 'application/json', hasBody: true }, 'invalid credentials are rejected by the login route');
    assert.equal(await page.evaluate(`window.__apiLog.filter(({ path, status }) => path.startsWith('/api/auth/') && [404, 405, 500].includes(status)).length`), 0, 'form flows do not receive unexpected 404, 405, or 500 responses');
    await page.evaluate(`document.getElementById('authEmail').value = 'not-an-email'`);
    await page.evaluate(`document.getElementById('authSubmit').click()`);
    await waitForSelector(page, '.auth-error:not([hidden])');
    assert.match(await page.evaluate(`document.getElementById('authError').textContent`), /valid email/i);
    await page.evaluate(`document.querySelector('.auth-backdrop').click()`);
    assert.equal(await page.evaluate(`Boolean(document.getElementById('authBackdrop'))`), false, 'clicking the backdrop closes the dialog');
  } finally {
    await cdp.close();
  }
});

async function waitForProxyRequest(page, expectedParams) {
  const found = await page.evaluate(`new Promise((resolve) => {
    const expected = ${JSON.stringify(expectedParams)};
    const started = Date.now();
    const matches = () => performance.getEntriesByType('resource').some((entry) => {
      let url;
      try { url = new URL(entry.name); } catch { return false; }
      if (url.pathname !== '/api/tmdb') return false;
      return Object.entries(expected).every(([key, value]) => value === '__present__'
        ? Boolean(url.searchParams.get(key))
        : url.searchParams.get(key) === value);
    });
    const poll = () => matches() ? resolve(true) : Date.now() - started > 6000 ? resolve(false) : setTimeout(poll, 30);
    poll();
  })`);
  assert.equal(found, true, `expected TMDB proxy request parameters: ${JSON.stringify(expectedParams)}`);
}

async function waitForSelector(page, selector) {
  const found = await page.evaluate(`new Promise((resolve) => {
    const started = Date.now();
    const poll = () => document.querySelector(${JSON.stringify(selector)}) ? resolve(true) : Date.now() - started > 6000 ? resolve(false) : setTimeout(poll, 30);
    poll();
  })`);
  assert.equal(found, true, `expected ${selector} to render`);
}

async function waitForPort(port, child) {
  const start = Date.now();
  while (Date.now() - start < 10000) {
    if (child.exitCode !== null) throw new Error(`Chrome exited before the test (${child.exitCode})`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch { /* wait for headless Chrome to open its debugging listener */ }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('Chrome remote debugging endpoint was not ready');
}
