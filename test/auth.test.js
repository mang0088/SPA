import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';

let server;
let baseUrl;
let dataDirectory;
let stderr = '';
const storeFile = () => path.join(dataDirectory, 'auth.json');

before(async () => {
  dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stillframe-auth-'));
  const port = 20000 + Math.floor(Math.random() * 1000);
  server = spawn(process.execPath, ['server.cjs'], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: dataDirectory },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stderr.on('data', (chunk) => { stderr += String(chunk); });
  baseUrl = `http://127.0.0.1:${port}`;
  await Promise.race([new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`account server readiness timed out: ${stderr}`)), 5000);
    server.stdout.on('data', (chunk) => {
      if (String(chunk).includes('Catalog server listening')) { clearTimeout(timeout); resolve(); }
    });
    server.once('error', reject);
    server.once('exit', (code) => reject(new Error(`account server exited before readiness (${code}): ${stderr}`)));
  })]);
});

after(async () => {
  if (server && server.exitCode === null) {
    server.kill();
    await Promise.race([once(server, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]);
  }
  fs.rmSync(dataDirectory, { recursive: true, force: true });
});

function cookieOf(response) {
  const headers = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie')];
  const header = headers.filter(Boolean)[0];
  return header ? header.split(';')[0] : '';
}

function post(pathname, body, cookie) {
  return fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function readSession(cookie) {
  const response = await fetch(`${baseUrl}/api/auth/session`, cookie ? { headers: { cookie } } : undefined);
  return { status: response.status, body: await response.json() };
}

test('signup stores a hashed account and starts a session', async () => {
  const response = await post('/api/auth/signup', { displayName: '  Ada   Lovelace ', email: 'Ada@Example.com', password: 'correct horse battery' });
  assert.equal(response.status, 201);
  const setCookie = response.headers.get('set-cookie') ?? '';
  assert.match(setCookie, /^stillframe_session=/);
  assert.match(setCookie, /HttpOnly/);
  assert.match(setCookie, /SameSite=Lax/);
  assert.match(setCookie, /Max-Age=/);
  const cookie = cookieOf(response);
  const payload = await response.json();
  assert.equal(payload.user.email, 'ada@example.com');
  assert.equal(payload.user.displayName, 'Ada Lovelace');
  assert.equal(typeof payload.user.id, 'string');
  assert.equal('password' in payload.user, false);
  assert.equal('passwordHash' in payload.user, false);

  const session = await readSession(cookie);
  assert.equal(session.status, 200);
  assert.equal(session.body.user.id, payload.user.id);

  const anonymous = await readSession();
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.body.user, null);

  const stored = fs.readFileSync(storeFile(), 'utf8');
  assert.match(stored, /scrypt\$[0-9a-f]{32}\$[0-9a-f]{128}/);
  assert.doesNotMatch(stored, /correct horse battery/);
  assert.doesNotMatch(stored, new RegExp(cookie.split('=')[1]));
});

test('signup rejects invalid input and duplicate emails', async () => {
  const invalid = await post('/api/auth/signup', { displayName: 'A', email: 'nope', password: 'short' });
  assert.equal(invalid.status, 400);
  const problems = (await invalid.json()).error;
  assert.match(problems, /valid email/i);
  assert.match(problems, /Display name/i);
  assert.match(problems, /at least 8 characters/i);

  const duplicate = await post('/api/auth/signup', { displayName: 'Ada Again', email: 'ada@example.com', password: 'another password' });
  assert.equal(duplicate.status, 409);
  assert.match((await duplicate.json()).error, /already exists/i);
});

test('login rejects the wrong password and accepts the right one', async () => {
  const wrong = await post('/api/auth/login', { email: 'ada@example.com', password: 'not the password' });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.get('set-cookie'), null);
  assert.match((await wrong.json()).error, /incorrect/i);

  const unknown = await post('/api/auth/login', { email: 'nobody@example.com', password: 'correct horse battery' });
  assert.equal(unknown.status, 401);

  const success = await post('/api/auth/login', { email: 'ada@example.com', password: 'correct horse battery' });
  assert.equal(success.status, 200);
  assert.equal((await success.json()).user.displayName, 'Ada Lovelace');
  const cookie = cookieOf(success);
  assert.match(cookie, /^stillframe_session=/);
  assert.equal((await readSession(cookie)).body.user.email, 'ada@example.com');
});

test('logout invalidates the session on the server', async () => {
  const login = await post('/api/auth/login', { email: 'ada@example.com', password: 'correct horse battery' });
  const cookie = cookieOf(login);
  assert.equal((await readSession(cookie)).body.user.email, 'ada@example.com');

  const logout = await post('/api/auth/logout', {}, cookie);
  assert.equal(logout.status, 200);
  assert.equal((await logout.json()).user, null);
  assert.match(logout.headers.get('set-cookie') ?? '', /Max-Age=0/);
  assert.equal((await readSession(cookie)).body.user, null);
});

test('watchlists require a session, validate titles, and persist with the account', async () => {
  const anonymousRead = await fetch(`${baseUrl}/api/auth/watchlist`);
  assert.equal(anonymousRead.status, 401);
  const anonymousWrite = await fetch(`${baseUrl}/api/auth/watchlist`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ items: [] }) });
  assert.equal(anonymousWrite.status, 401);

  const login = await post('/api/auth/login', { email: 'ada@example.com', password: 'correct horse battery' });
  const cookie = cookieOf(login);
  const item = {
    id: 603, mediaType: 'movie', title: 'Integration Film', originalTitle: 'Integration Film', overview: 'A test title.',
    posterPath: '/poster.jpg', backdropPath: null, date: '2026-10-09', rating: 7.5, voteCount: 100, popularity: 42,
    genreIds: [18], language: 'en',
  };
  const save = await fetch(`${baseUrl}/api/auth/watchlist`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ items: [item] }) });
  assert.equal(save.status, 200);
  assert.deepEqual((await save.json()).items, [item]);

  const read = await fetch(`${baseUrl}/api/auth/watchlist`, { headers: { cookie } });
  assert.equal(read.status, 200);
  assert.deepEqual((await read.json()).items, [item]);

  const invalid = await fetch(`${baseUrl}/api/auth/watchlist`, { method: 'PUT', headers: { 'content-type': 'application/json', cookie }, body: JSON.stringify({ items: [{ id: 603, title: 'Malformed' }] }) });
  assert.equal(invalid.status, 400);
});

test('account endpoints reject unsupported methods, unknown routes, and malformed bodies', async () => {
  const wrongWatchlistMethod = await fetch(`${baseUrl}/api/auth/watchlist`, { method: 'POST' });
  assert.equal(wrongWatchlistMethod.status, 405);
  const wrongMethod = await fetch(`${baseUrl}/api/auth/signup`);
  assert.equal(wrongMethod.status, 405);
  const unknownRoute = await fetch(`${baseUrl}/api/auth/refresh`);
  assert.equal(unknownRoute.status, 404);
  const malformed = await post('/api/auth/login', '{ not json');
  assert.equal(malformed.status, 400);
  assert.match((await malformed.json()).error, /valid JSON/i);
  const empty = await post('/api/auth/login', {});
  assert.equal(empty.status, 401);
});

test('the account store is never served as a static file', async () => {
  const probe = path.join(process.cwd(), 'data', 'auth.json');
  const probeExistedBefore = fs.existsSync(probe);
  if (!probeExistedBefore) {
    fs.mkdirSync(path.dirname(probe), { recursive: true });
    fs.writeFileSync(probe, '{"probe":"stillframe-secret-marker"}');
  }
  try {
    const response = await fetch(`${baseUrl}/data/auth.json`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-security-policy')?.includes("default-src 'self'"), true);
    assert.doesNotMatch(await response.text(), /stillframe-secret-marker/);
  } finally {
    if (!probeExistedBefore) {
      fs.rmSync(probe, { force: true });
      try { fs.rmdirSync(path.dirname(probe)); } catch { /* the directory is shared with other runs */ }
    }
  }
});

test('corrupt account storage fails closed without overwriting stored bytes', async () => {
  const original = fs.readFileSync(storeFile());
  const corrupt = Buffer.from('{"probe":"must-not-be-reflected-or-overwritten"');
  fs.writeFileSync(storeFile(), corrupt);
  try {
    const response = await post('/api/auth/signup', { displayName: 'Store Probe', email: 'store-probe@example.com', password: 'stillframe-audit-password' });
    assert.equal(response.status, 500);
    const payload = await response.json();
    assert.equal(payload.error, 'The account service could not complete the request.');
    assert.doesNotMatch(JSON.stringify(payload), /probe|stack|server\.cjs|stillframe-audit-password/i);
    assert.deepEqual(fs.readFileSync(storeFile()), corrupt, 'failed storage reads do not replace the existing file');
    assert.equal((await fetch(baseUrl)).status, 200, 'storage failure does not crash the HTTP server');
  } finally {
    fs.writeFileSync(storeFile(), original);
  }
});

test('the account store is blocked when DATA_DIR is the static root', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'stillframe-root-store-'));
  const rootServerFile = path.join(root, 'server.cjs');
  fs.copyFileSync(path.join(process.cwd(), 'server.cjs'), rootServerFile);
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>isolated test root</title>');
  fs.writeFileSync(path.join(root, 'auth.json'), JSON.stringify({ version: 1, users: [], sessions: {}, probe: 'root-store-secret-marker' }));
  const port = 22000 + Math.floor(Math.random() * 1000);
  const isolatedServer = spawn(process.execPath, [rootServerFile], {
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: root, SESSION_COOKIE_SECURE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let isolatedStderr = '';
  isolatedServer.stderr.on('data', (chunk) => { isolatedStderr += String(chunk); });
  const isolatedUrl = `http://127.0.0.1:${port}`;
  try {
    await Promise.race([new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`isolated server readiness timed out: ${isolatedStderr}`)), 5000);
      isolatedServer.stdout.on('data', (chunk) => {
        if (String(chunk).includes('Catalog server listening')) { clearTimeout(timeout); resolve(); }
      });
      isolatedServer.once('error', reject);
      isolatedServer.once('exit', (code) => reject(new Error(`isolated server exited before readiness (${code}): ${isolatedStderr}`)));
    })]);
    const response = await fetch(`${isolatedUrl}/auth.json`);
    assert.equal(response.status, 404);
    assert.doesNotMatch(await response.text(), /root-store-secret-marker/);
    assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000');

    const signup = await fetch(`${isolatedUrl}/api/auth/signup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Root Store', email: 'root-store@example.com', password: 'stillframe-audit-password' }),
    });
    assert.equal(signup.status, 201);
    assert.match(signup.headers.get('set-cookie') ?? '', /; Secure(?:;|$)/);
    assert.equal(signup.headers.get('strict-transport-security'), 'max-age=31536000');
    assert.equal((await fetch(`${isolatedUrl}/auth.json`)).status, 404, 'the account store stays blocked after an account is created');
    assert.equal((await fetch(isolatedUrl)).status, 200);
  } finally {
    if (isolatedServer.exitCode === null) {
      isolatedServer.kill();
      await Promise.race([once(isolatedServer, 'exit'), new Promise((resolve) => setTimeout(resolve, 2000))]);
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});
