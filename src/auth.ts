import type { CatalogItem } from './types.js';

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

export interface SignUpInput {
  displayName: string;
  email: string;
  password: string;
}

export interface LogInInput {
  email: string;
  password: string;
}

export class AuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'AuthError';
  }
}

interface SessionPayload {
  user: AuthUser | null;
}

function messageFrom(payload: unknown, status: number): string {
  if (payload !== null && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string' && payload.error) return payload.error;
  return `Account request failed (${status}).`;
}

async function authRequest<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const init: RequestInit = body === undefined
    ? { method: 'GET', headers: { Accept: 'application/json' } }
    : { method, headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify(body) };
  const response = await fetch(`/api/auth/${path}`, init);
  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON responses fall back to the status-based message below.
  }
  if (!response.ok) throw new AuthError(messageFrom(payload, response.status), response.status);
  return payload as T;
}

export async function loadSession(): Promise<AuthUser | null> {
  const payload = await authRequest<SessionPayload>('session');
  return payload.user ?? null;
}

export async function signUp(input: SignUpInput): Promise<AuthUser> {
  const payload = await authRequest<SessionPayload>('signup', input);
  if (!payload.user) throw new AuthError('The account was created but the session could not be restored.', 500);
  return payload.user;
}

export async function logIn(input: LogInInput): Promise<AuthUser> {
  const payload = await authRequest<SessionPayload>('login', input);
  if (!payload.user) throw new AuthError('Signed in, but the account details could not be read.', 500);
  return payload.user;
}

export async function logOut(): Promise<void> {
  await authRequest<SessionPayload>('logout', {});
}

export async function loadWatchlist(): Promise<CatalogItem[]> {
  const payload = await authRequest<{ items: CatalogItem[] }>('watchlist');
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function saveWatchlist(items: CatalogItem[]): Promise<void> {
  await authRequest<{ items: CatalogItem[] }>('watchlist', { items }, 'PUT');
}
