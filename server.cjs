const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const ROOT = __dirname;
const TMDB_BASE_URL = 'https://api.themoviedb.org/3/';
const AUTH_STORE_VERSION = 1;
const SESSION_COOKIE = 'stillframe_session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_AUTH_BODY_BYTES = 8 * 1024;
const MAX_WATCHLIST_BODY_BYTES = 2 * 1024 * 1024;
const SCRYPT_KEY_LENGTH = 64;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const AUTH_RATE_LIMIT = { windowMs: 5 * 60 * 1000, max: 40 };
const authAttempts = new Map();
let authQueue = Promise.resolve();
const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const initialEnvKeys = new Set(Object.keys(process.env));

function loadEnvironment() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  try {
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      const key = match[1];
      const val = match[2].replace(/^(["'])(.*)\1$/, '$2').trim();
      if (!initialEnvKeys.has(key) || !process.env[key] || process.env[key].trim() === '') {
        process.env[key] = val;
      }
    }
  } catch (error) {
    console.error('[TMDB proxy] failed to read .env file:', error);
  }
}

function allowedTmdbPath(value) {
  return /^(?:trending\/(?:all|movie|tv)\/week|search\/(?:multi|person)|movie\/(?:popular|upcoming|now_playing|top_rated)|tv\/(?:popular|on_the_air|airing_today|top_rated)|genre\/(?:movie|tv)\/list|discover\/(?:movie|tv)|(?:movie|tv)\/\d+(?:\/(?:keywords|recommendations|videos|images|external_ids|credits|watch\/providers|season\/\d+))?)$/.test(value);
}

function reply(response, status, body, contentType = 'application/json; charset=utf-8', extraHeaders = {}) {
  response.writeHead(status, { 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', ...extraHeaders });
  response.end(body);
}

function replyJson(response, status, payload, extraHeaders = {}) {
  reply(response, status, JSON.stringify(payload), 'application/json; charset=utf-8', { 'Cache-Control': 'no-store', ...extraHeaders });
}

function dataDirectory() {
  const configured = typeof process.env.DATA_DIR === 'string' ? process.env.DATA_DIR.trim() : '';
  return configured ? path.resolve(configured) : path.join(ROOT, 'data');
}

function authStorePath() {
  return path.join(dataDirectory(), 'auth.json');
}

function blockedStaticPrefixes() {
  const prefixes = new Set(['/data/']);
  const relative = path.relative(ROOT, dataDirectory());
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
    prefixes.add(`/${relative.split(path.sep).join('/')}/`);
  }
  return [...prefixes];
}

function readAuthStore() {
  const empty = { version: AUTH_STORE_VERSION, users: [], sessions: {} };
  const file = authStorePath();
  try {
    if (!fs.existsSync(file)) return empty;
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (parsed === null || typeof parsed !== 'object') return empty;
    return {
      version: AUTH_STORE_VERSION,
      users: Array.isArray(parsed.users) ? parsed.users : [],
      sessions: parsed.sessions !== null && typeof parsed.sessions === 'object' && !Array.isArray(parsed.sessions) ? parsed.sessions : {},
    };
  } catch (error) {
    console.error('[auth] could not read the account store:', error instanceof Error ? error.message : String(error));
    return empty;
  }
}

function writeAuthStore(store) {
  const file = authStorePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(store, null, 2));
  fs.renameSync(temporary, file);
}

function pruneSessions(store) {
  const now = Date.now();
  for (const [hash, session] of Object.entries(store.sessions)) {
    if (session === null || typeof session !== 'object' || typeof session.expiresAt !== 'number' || session.expiresAt <= now) {
      delete store.sessions[hash];
    }
  }
}

function updateAuthStore(mutator) {
  const task = authQueue.then(async () => {
    const store = readAuthStore();
    const result = await mutator(store);
    pruneSessions(store);
    writeAuthStore(store);
    return result;
  });
  authQueue = task.then(() => undefined, () => undefined);
  return task;
}

function publicUser(user) {
  return { id: user.id, email: user.email, displayName: user.displayName, createdAt: user.createdAt };
}

function sanitizeWatchlist(value) {
  if (!Array.isArray(value) || value.length > 500) return null;
  const items = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) return null;
    if (!Number.isSafeInteger(item.id) || item.id < 1 || !['movie', 'tv'].includes(item.mediaType)) return null;
    if (typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200) return null;
    if (typeof item.originalTitle !== 'string' || item.originalTitle.length > 200) return null;
    if (typeof item.overview !== 'string' || item.overview.length > 4000) return null;
    if (item.posterPath !== null && (typeof item.posterPath !== 'string' || item.posterPath.length > 200)) return null;
    if (item.backdropPath !== null && (typeof item.backdropPath !== 'string' || item.backdropPath.length > 200)) return null;
    if (typeof item.date !== 'string' || item.date.length > 10) return null;
    if (![item.rating, item.voteCount, item.popularity].every((number) => typeof number === 'number' && Number.isFinite(number) && number >= 0)) return null;
    if (!Array.isArray(item.genreIds) || item.genreIds.length > 50 || !item.genreIds.every((id) => Number.isSafeInteger(id) && id >= 0)) return null;
    if (typeof item.language !== 'string' || item.language.length > 8) return null;
    items.push({
      id: item.id, mediaType: item.mediaType, title: item.title.trim(), originalTitle: item.originalTitle,
      overview: item.overview, posterPath: item.posterPath, backdropPath: item.backdropPath, date: item.date,
      rating: item.rating, voteCount: item.voteCount, popularity: item.popularity,
      genreIds: item.genreIds, language: item.language,
    });
  }
  return items;
}

function userForRequest(request) {
  const user = readSessionUser(request);
  return user ? readAuthStore().users.find((candidate) => candidate.id === user.id) || null : null;
}

function validWatchlistRequest(request, response) {
  const user = userForRequest(request);
  if (!user) {
    replyJson(response, 401, { error: 'Sign in to access your watchlist.' });
    return null;
  }
  return user;
}

function deriveKey(password, salt) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LENGTH, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await deriveKey(password, salt);
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  if (typeof stored !== 'string') return false;
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  if (expected.length !== SCRYPT_KEY_LENGTH) return false;
  const derived = await deriveKey(password, Buffer.from(saltHex, 'hex'));
  return crypto.timingSafeEqual(derived, expected);
}

function sessionTokenHash(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function readCookie(request, name) {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function sessionCookieHeader(token, maxAgeSeconds) {
  const expires = new Date(Date.now() + maxAgeSeconds * 1000).toUTCString();
  const attributes = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`, `Expires=${expires}`];
  if (process.env.SESSION_COOKIE_SECURE === '1') attributes.push('Secure');
  return attributes.join('; ');
}

function readSessionUser(request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  const store = readAuthStore();
  const session = store.sessions[sessionTokenHash(token)];
  if (session === null || typeof session !== 'object' || typeof session.expiresAt !== 'number' || session.expiresAt <= Date.now()) return null;
  const user = store.users.find((candidate) => candidate.id === session.userId);
  return user ? publicUser(user) : null;
}

function authRateLimited(request) {
  const now = Date.now();
  const client = request.socket.remoteAddress || 'unknown';
  const entry = authAttempts.get(client);
  if (!entry || entry.resetAt <= now) {
    if (authAttempts.size > 500) authAttempts.clear();
    authAttempts.set(client, { count: 1, resetAt: now + AUTH_RATE_LIMIT.windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > AUTH_RATE_LIMIT.max;
}

function readAuthBody(request, maxBytes = MAX_AUTH_BODY_BYTES) {
  return new Promise((resolve, reject) => {
    let received = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) {
        reject(Object.assign(new Error('Request body is too large.'), { status: 413 }));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw);
        resolve(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {});
      } catch {
        reject(Object.assign(new Error('Request body must be valid JSON.'), { status: 400 }));
      }
    });
  });
}

function normalizeEmail(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function normalizeDisplayName(value) {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
}

function newSessionFor(userId) {
  return { token: crypto.randomBytes(32).toString('base64url'), record: { userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL_MS } };
}

async function handleAuth(request, requestUrl, response) {
  const route = requestUrl.pathname.replace(/\/+$/, '') || requestUrl.pathname;
  if (route === '/api/auth/session') {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      replyJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    replyJson(response, 200, { user: readSessionUser(request) });
    return;
  }
  if (route === '/api/auth/watchlist') {
    if (request.method !== 'GET' && request.method !== 'PUT') {
      replyJson(response, 405, { error: 'Method not allowed.' });
      return;
    }
    if (request.method === 'GET') {
      const user = validWatchlistRequest(request, response);
      if (user) replyJson(response, 200, { items: Array.isArray(user.watchlist) ? user.watchlist : [] });
      return;
    }
    if (authRateLimited(request)) {
      replyJson(response, 429, { error: 'Too many account attempts. Wait a few minutes and try again.' });
      return;
    }
    let body;
    try {
      body = await readAuthBody(request, MAX_WATCHLIST_BODY_BYTES);
    } catch (error) {
      const status = error !== null && typeof error === 'object' && typeof error.status === 'number' ? error.status : 400;
      replyJson(response, status, { error: error instanceof Error ? error.message : 'Could not read the request body.' });
      return;
    }
    const items = sanitizeWatchlist(body.items);
    if (!items) {
      replyJson(response, 400, { error: 'Watchlist must contain no more than 500 valid titles.' });
      return;
    }
    const user = validWatchlistRequest(request, response);
    if (!user) return;
    await updateAuthStore((store) => {
      const account = store.users.find((candidate) => candidate.id === user.id);
      if (account) account.watchlist = items;
    });
    replyJson(response, 200, { items });
    return;
  }
  if (route !== '/api/auth/signup' && route !== '/api/auth/login' && route !== '/api/auth/logout') {
    replyJson(response, 404, { error: 'Unknown account endpoint.' });
    return;
  }
  if (request.method !== 'POST') {
    replyJson(response, 405, { error: 'Method not allowed.' });
    return;
  }
  if (authRateLimited(request)) {
    replyJson(response, 429, { error: 'Too many account attempts. Wait a few minutes and try again.' });
    return;
  }

  let body;
  try {
    body = await readAuthBody(request);
  } catch (error) {
    const status = error !== null && typeof error === 'object' && typeof error.status === 'number' ? error.status : 400;
    replyJson(response, status, { error: error instanceof Error ? error.message : 'Could not read the request body.' });
    return;
  }

  if (route === '/api/auth/logout') {
    const token = readCookie(request, SESSION_COOKIE);
    if (token) {
      await updateAuthStore((store) => {
        delete store.sessions[sessionTokenHash(token)];
      });
    }
    replyJson(response, 200, { user: null }, { 'Set-Cookie': sessionCookieHeader('', 0) });
    return;
  }

  const email = normalizeEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  if (route === '/api/auth/signup') {
    const displayName = normalizeDisplayName(body.displayName);
    const problems = [];
    if (!EMAIL_PATTERN.test(email) || email.length > 254) problems.push('Enter a valid email address.');
    if (displayName.length < 2 || displayName.length > 60) problems.push('Display name must be between 2 and 60 characters.');
    if (password.length < 8) problems.push('Password must be at least 8 characters.');
    if (password.length > 128) problems.push('Password must be 128 characters or fewer.');
    if (problems.length) {
      replyJson(response, 400, { error: problems.join(' ') });
      return;
    }
    const passwordHash = await hashPassword(password);
    const session = newSessionFor('pending');
    const result = await updateAuthStore((store) => {
      if (store.users.some((user) => user.email === email)) return { conflict: true };
      const user = { id: crypto.randomUUID(), email, displayName, passwordHash, createdAt: new Date().toISOString() };
      session.record.userId = user.id;
      store.users.push(user);
      store.sessions[sessionTokenHash(session.token)] = session.record;
      return { conflict: false, user };
    });
    if (result.conflict) {
      replyJson(response, 409, { error: 'An account with that email already exists.' });
      return;
    }
    replyJson(response, 201, { user: publicUser(result.user) }, { 'Set-Cookie': sessionCookieHeader(session.token, SESSION_TTL_MS / 1000) });
    return;
  }

  if (!email || !password) {
    replyJson(response, 401, { error: 'Email or password is incorrect.' });
    return;
  }
  const store = readAuthStore();
  const candidate = store.users.find((user) => user.email === email);
  const verified = candidate ? await verifyPassword(password, candidate.passwordHash) : false;
  if (!candidate || !verified) {
    replyJson(response, 401, { error: 'Email or password is incorrect.' });
    return;
  }
  const session = newSessionFor(candidate.id);
  await updateAuthStore((data) => {
    data.sessions[sessionTokenHash(session.token)] = session.record;
  });
  replyJson(response, 200, { user: publicUser(candidate) }, { 'Set-Cookie': sessionCookieHeader(session.token, SESSION_TTL_MS / 1000) });
}

async function proxyTmdb(requestUrl, response) {
  const pathname = requestUrl.searchParams.get('path') || '';
  if (!allowedTmdbPath(pathname)) {
    reply(response, 400, JSON.stringify({ error: 'Unsupported TMDB endpoint.' }));
    return;
  }

  if (!process.env.TMDB_API_KEY) {
    loadEnvironment();
  }

  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    reply(response, 503, JSON.stringify({ error: 'TMDB_API_KEY is not configured on the server.' }));
    return;
  }

  const upstreamUrl = new URL(pathname, TMDB_BASE_URL);
  upstreamUrl.searchParams.set('api_key', apiKey);
  upstreamUrl.searchParams.set('language', 'en-US');
  const allowedAppendValues = new Set(['videos', 'images', 'external_ids', 'keywords', 'credits', 'watch/providers']);
  for (const [key, value] of requestUrl.searchParams) {
    if (key === 'path' || key === 'api_key' || key === 'language' || key.length > 48 || value.length > 200) continue;
    if (key === 'append_to_response') {
      const append = value.split(',').filter((entry) => allowedAppendValues.has(entry)).join(',');
      if (append) upstreamUrl.searchParams.set(key, append);
      continue;
    }
    upstreamUrl.searchParams.set(key, value);
  }

  try {
    const upstream = await fetch(upstreamUrl, { signal: AbortSignal.timeout(15000) });
    const headers = { 'Content-Type': upstream.headers.get('content-type') || 'application/json; charset=utf-8', 'X-Content-Type-Options': 'nosniff' };
    const retryAfter = upstream.headers.get('retry-after');
    if (retryAfter) headers['Retry-After'] = retryAfter;
    response.writeHead(upstream.status, headers);
    response.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    console.error('[TMDB proxy] upstream request failed:', error instanceof Error ? error.message : String(error));
    reply(response, 502, JSON.stringify({ error: 'TMDB is temporarily unavailable.' }));
  }
}

function serveFile(requestUrl, response) {
  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    reply(response, 400, 'Invalid URL.', 'text/plain; charset=utf-8');
    return;
  }
  if (pathname === '/') pathname = '/index.html';
  if (pathname.startsWith('/.') || pathname.includes('..') || pathname.includes('\\')) {
    reply(response, 404, 'Not found.', 'text/plain; charset=utf-8');
    return;
  }

  if (blockedStaticPrefixes().some((prefix) => pathname === prefix.slice(0, -1) || pathname.startsWith(prefix))) {
    reply(response, 404, 'Not found.', 'text/plain; charset=utf-8');
    return;
  }

  const filePath = path.resolve(ROOT, `.${pathname}`);
  const isBuiltModule = filePath.startsWith(`${ROOT}${path.sep}dist${path.sep}src${path.sep}`);
  if (!filePath.startsWith(`${ROOT}${path.sep}`) || (!isBuiltModule && filePath.includes(`${path.sep}dist${path.sep}`))) {
    reply(response, 404, 'Not found.', 'text/plain; charset=utf-8');
    return;
  }
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    if (/^\/title\/(movie|tv)\/\d+$/.test(pathname)) pathname = '/index.html';
    else {
      reply(response, 404, 'Not found.', 'text/plain; charset=utf-8');
      return;
    }
  }
  const servedPath = path.resolve(ROOT, `.${pathname}`);
  if (!servedPath.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(servedPath) || !fs.statSync(servedPath).isFile()) {
    reply(response, 404, 'Not found.', 'text/plain; charset=utf-8');
    return;
  }
  const type = MIME_TYPES[path.extname(servedPath)] || 'application/octet-stream';
  response.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
  fs.createReadStream(servedPath).pipe(response);
}

loadEnvironment();
const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';
const server = http.createServer((request, response) => {
  let requestUrl;
  try {
    requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  } catch {
    reply(response, 400, JSON.stringify({ error: 'Invalid URL.' }));
    return;
  }
  if (requestUrl.pathname.startsWith('/api/auth/')) {
    void handleAuth(request, requestUrl, response);
    return;
  }
  if (request.method !== 'GET') {
    reply(response, 405, JSON.stringify({ error: 'Method not allowed.' }));
    return;
  }
  if (requestUrl.pathname === '/api/tmdb') {
    void proxyTmdb(requestUrl, response);
    return;
  }
  serveFile(requestUrl, response);
});

server.listen(port, host, () => console.log(`Catalog server listening on http://${host}:${port}`));
