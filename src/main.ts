import { AuthError, loadSession, loadWatchlist, logIn, logOut, saveWatchlist, signUp, type AuthUser } from './auth.js';
import { catalogQuery, loadCatalog, loadGenres, mapCatalogItem, seasonOf, seasonRange, selectedTab, type CatalogFilters } from './catalog.js';
import { tmdbRequest } from './tmdb.js';
import type { CatalogItem, CatalogTab, TmdbListResponse, TmdbTitle, UpcomingCategory } from './types.js';

type SelectValue = 'popular' | 'top_rated' | 'upcoming' | 'now_playing' | 'on_the_air' | 'airing_today' | 'title';

const NAV_TABS: Array<{ key: CatalogTab; label: string }> = [
  { key: 'trending', label: 'Trending' },
  { key: 'movies', label: 'Movies' },
  { key: 'tv', label: 'TV Shows' },
  { key: 'anime', label: 'Anime' },
  { key: 'upcoming', label: 'Upcoming' },
];

const TAB_LABELS: Record<CatalogTab, string> = {
  trending: 'Trending',
  movies: 'Movies',
  tv: 'TV Shows',
  anime: 'Anime',
  upcoming: 'Upcoming',
  dramas: 'Asian Dramas',
};
const tabs = NAV_TABS.map((t) => t.key);
const savedKey = 'entertainment:v1:watchlist';
const preferenceKey = 'entertainment:v1';
const initialParams = new URLSearchParams(location.search);
const initialStatus = initialParams.get('status');
const initialCategory = initialParams.get('category');
const storedSort = localStorage.getItem(`${preferenceKey}:sort`);
const validSorts: SelectValue[] = ['popular', 'top_rated', 'upcoming', 'now_playing', 'on_the_air', 'airing_today', 'title'];
let tab: CatalogTab = selectedTab();
let upcomingCategory: UpcomingCategory = initialCategory && ['movies', 'tv', 'anime', 'dramas'].includes(initialCategory)
  ? (initialCategory as UpcomingCategory)
  : 'movies';
let filters: CatalogFilters = {
  sort: (initialParams.get('sort') || (storedSort && validSorts.includes(storedSort as SelectValue) ? storedSort : 'popular')) as SelectValue,
  language: initialParams.get('language') === 'english' || localStorage.getItem(`${preferenceKey}:language`) === 'english' ? 'english' : 'original',
  status: initialStatus === 'airing' || initialStatus === 'upcoming' ? initialStatus : 'all',
};
let items: CatalogItem[] = [];
let page = 1;
let totalPages = 1;
let isLoading = false;
let filtersOpen = false;
let selectedSeason = seasonOf(new Date());
let selectedSeasonYear = new Date().getFullYear();
let genreMaps: Record<'movie' | 'tv', Map<number, string>> = { movie: new Map(), tv: new Map() };
let loadController: AbortController | null = null;
let catalogLoadVersion = 0;
let pageObserver: IntersectionObserver | null = null;
const pendingBookmarks = new Set<number>();
let bookmarkIds = readBookmarks();
let currentUser: AuthUser | null = null;
let authRevision = 0;

function readBookmarks(): Set<number> {
  try {
    const values: unknown = JSON.parse(localStorage.getItem(savedKey) ?? '[]');
    return new Set(Array.isArray(values) ? values.filter((id): id is number => typeof id === 'number') : []);
  } catch {
    return new Set();
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function svgIcon(name: 'sun' | 'moon' | 'search' | 'filter' | 'bookmark' | 'check' | 'chevron' | 'user'): string {
  const paths: Record<typeof name, string> = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42"/>',
    moon: '<path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    filter: '<path d="M4 6h16M7 12h13M10 18h10"/>',
    bookmark: '<path d="M6 4.75A1.75 1.75 0 0 1 7.75 3h8.5A1.75 1.75 0 0 1 18 4.75V21l-6-4-6 4Z"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    user: '<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}

function createHeader(): HTMLElement {
  const header = el('header', 'site-header glass-surface');
  const brand = el('a', 'wordmark', 'Stillframe');
  brand.href = '/?tab=trending';
  brand.setAttribute('aria-label', 'Stillframe home');
  brand.addEventListener('click', (event) => {
    event.preventDefault();
    if (location.pathname.startsWith('/title/')) {
      history.pushState({}, '', '/?tab=trending');
    }
    setTab('trending');
  });
  const nav = el('nav', 'primary-nav');
  nav.setAttribute('aria-label', 'Primary navigation');
  nav.setAttribute('role', 'tablist');

  NAV_TABS.forEach(({ key, label }) => {
    const navItem = el('button', `nav-link nav-text-button${tab === key ? ' active' : ''}`, label);
    navItem.type = 'button';
    navItem.id = `tab-${key}`;
    navItem.setAttribute('role', 'tab');
    navItem.setAttribute('aria-selected', String(tab === key));
    navItem.addEventListener('click', (event) => {
      event.preventDefault();
      if (location.pathname.startsWith('/title/')) {
        history.pushState({}, '', `/?tab=${key}`);
      }
      setTab(key);
    });
    nav.append(navItem);
  });

  const actions = el('div', 'header-actions');
  const searchButton = el('button', 'icon-button');
  searchButton.type = 'button';
  searchButton.innerHTML = svgIcon('search');
  searchButton.setAttribute('aria-label', 'Search titles');
  searchButton.addEventListener('click', openSearch);
  const filterButton = el('button', 'icon-button filter-toggle-button');
  filterButton.type = 'button';
  filterButton.id = 'filterToggle';
  filterButton.innerHTML = `${svgIcon('filter')}<span class="sr-only">Filters</span>`;
  filterButton.title = 'Filters';
  filterButton.setAttribute('aria-label', 'Filters');
  filterButton.setAttribute('aria-controls', 'filterPanel');
  filterButton.setAttribute('aria-expanded', String(filtersOpen));
  filterButton.addEventListener('click', () => {
    if (document.getElementById('filterPanel')) { filtersOpen ? closeFilterDrawer() : openFilterDrawer(); return; }
    tab = selectedTab();
    history.pushState({}, '', `/?tab=${tab}`);
    filtersOpen = true;
    page = 1;
    items = [];
    renderCatalog();
    void loadPage(true);
  });
  const count = el('span', 'watchlist-count', String(bookmarkIds.size));
  count.id = 'watchlistCount';
  const watchlistButton = el('button', 'icon-button watchlist-button');
  watchlistButton.type = 'button';
  watchlistButton.innerHTML = `${svgIcon('bookmark')}<span class="sr-only">Watchlist</span>`;
  watchlistButton.append(count);
  watchlistButton.setAttribute('aria-label', `Watchlist, ${bookmarkIds.size} saved titles`);
  watchlistButton.addEventListener('click', showWatchlist);
  const themeButton = el('button', 'icon-button');
  themeButton.type = 'button';
  themeButton.id = 'themeToggle';
  themeButton.addEventListener('click', toggleTheme);
  const theme = localStorage.getItem(`${preferenceKey}:theme`) === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = theme;
  updateThemeButton(themeButton);
  const authArea = el('div', 'auth-area');
  authArea.id = 'authArea';
  renderAuthArea(authArea);
  actions.append(searchButton, filterButton, watchlistButton, themeButton, authArea);
  header.append(brand, nav, actions);
  return header;
}

function updateThemeButton(button: HTMLButtonElement): void {
  const light = document.documentElement.dataset.theme === 'light';
  button.innerHTML = svgIcon(light ? 'moon' : 'sun');
  button.setAttribute('aria-label', light ? 'Switch to dark theme' : 'Switch to light theme');
  button.title = light ? 'Switch to dark theme' : 'Switch to light theme';
}

function toggleTheme(): void {
  const theme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(`${preferenceKey}:theme`, theme);
  const button = document.getElementById('themeToggle');
  if (button instanceof HTMLButtonElement) updateThemeButton(button);
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return words.map((word) => word.charAt(0).toUpperCase()).join('') || '?';
}

function closeUserMenu(): void {
  const menu = document.getElementById('userMenu');
  if (!menu || menu.hidden) return;
  menu.hidden = true;
  const button = document.getElementById('userMenuButton');
  if (button) {
    button.setAttribute('aria-expanded', 'false');
    button.classList.remove('active');
  }
}

function renderAuthArea(container: HTMLElement): void {
  container.replaceChildren();
  if (!currentUser) {
    const login = el('button', 'secondary-pill login-button');
    login.type = 'button';
    login.id = 'loginButton';
    login.innerHTML = `${svgIcon('user')}<span class="login-label">Log in</span>`;
    login.setAttribute('aria-label', 'Log in or create an account');
    login.addEventListener('click', () => openAuthDialog('login'));
    container.append(login);
    return;
  }
  const account = currentUser;
  const button = el('button', 'user-menu-button');
  button.type = 'button';
  button.id = 'userMenuButton';
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'userMenu');
  button.setAttribute('aria-label', `Account menu for ${account.displayName}`);
  button.append(el('span', 'user-avatar', initialsFor(account.displayName)), el('span', 'user-name', account.displayName));
  const menu = el('div', 'user-menu glass-surface');
  menu.id = 'userMenu';
  menu.hidden = true;
  const identity = el('div', 'user-menu-identity');
  identity.append(el('p', 'user-menu-name', account.displayName), el('p', 'user-menu-email', account.email));
  const signOut = el('button', 'user-menu-item', 'Sign out');
  signOut.type = 'button';
  signOut.id = 'signOutButton';
  signOut.addEventListener('click', () => { void handleSignOut(); });
  menu.append(identity, signOut);
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = menu.hidden !== false;
    menu.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.classList.toggle('active', open);
  });
  container.append(button, menu);
}

async function restoreSession(): Promise<void> {
  const requestRevision = authRevision;
  let restoredUser: AuthUser | null = null;
  try {
    restoredUser = await loadSession();
  } catch (error) {
    console.error('[Auth] session lookup failed:', error);
  }
  if (requestRevision === authRevision) currentUser = restoredUser;
  if (currentUser) await synchronizeWatchlist();
  const area = document.getElementById('authArea');
  if (area) renderAuthArea(area);
}

function updateWatchlistBadge(): void {
  const count = document.getElementById('watchlistCount');
  if (count) count.textContent = String(bookmarkIds.size);
  const button = document.querySelector<HTMLButtonElement>('.watchlist-button');
  button?.setAttribute('aria-label', `Watchlist, ${bookmarkIds.size} saved titles`);
}

function setWatchlistItems(items: CatalogItem[]): void {
  const uniqueItems = [...new Map(items.map((item) => [item.id, item])).values()].slice(0, 500);
  bookmarkIds = new Set(uniqueItems.map((item) => item.id));
  localStorage.setItem(savedKey, JSON.stringify([...bookmarkIds]));
  localStorage.setItem(`${savedKey}:items`, JSON.stringify(uniqueItems));
  updateWatchlistBadge();
  refreshBookmarkControls();
}

function refreshBookmarkControls(): void {
  document.querySelectorAll<HTMLButtonElement>('[data-bookmark-id]').forEach((button) => {
    const id = Number(button.dataset.bookmarkId);
    const saved = bookmarkIds.has(id);
    const title = button.dataset.bookmarkTitle ?? 'title';
    button.classList.toggle('is-saved', saved);
    button.setAttribute('aria-pressed', String(saved));
    if (button.classList.contains('bookmark-button')) {
      button.innerHTML = svgIcon(saved ? 'check' : 'bookmark');
      button.setAttribute('aria-label', `${saved ? 'Remove' : 'Add'} ${title} ${saved ? 'from' : 'to'} watchlist`);
    } else {
      button.textContent = saved ? '✓ Saved' : '＋ Watchlist';
    }
  });
}

async function synchronizeWatchlist(): Promise<void> {
  if (!currentUser) return;
  const localItems = readWatchlistItems();
  try {
    const serverItems = await loadWatchlist();
    const mergedItems = [...new Map([...serverItems, ...localItems].map((item) => [item.id, item])).values()].slice(0, 500);
    setWatchlistItems(mergedItems);
    if (JSON.stringify(mergedItems) !== JSON.stringify(serverItems)) await saveWatchlist(mergedItems);
    if (new URLSearchParams(location.search).get('saved') === '1') {
      items = mergedItems;
      renderCards();
    }
  } catch (error) {
    console.error('[Watchlist] restore failed:', error);
    showNotice('Signed in, but your watchlist could not sync. Check your connection and try again.');
  }
}

async function persistWatchlist(): Promise<void> {
  if (!currentUser) return;
  try {
    await saveWatchlist(readWatchlistItems());
  } catch (error) {
    console.error('[Watchlist] save failed:', error);
    showNotice('Your watchlist could not sync. Check your connection and try again.');
  }
}

async function handleSignOut(): Promise<void> {
  closeUserMenu();
  try {
    await logOut();
  } catch (error) {
    console.error('[Auth] sign out failed:', error);
    showNotice('Could not reach the account service, so you are still signed in.');
    return;
  }
  authRevision += 1;
  currentUser = null;
  setWatchlistItems([]);
  const area = document.getElementById('authArea');
  if (area) renderAuthArea(area);
  showNotice('Signed out.');
}

function authField(id: string, label: string, type: 'text' | 'email' | 'password', autocomplete: 'name' | 'email' | 'username' | 'new-password' | 'current-password', placeholder: string): { field: HTMLElement; input: HTMLInputElement } {
  const field = el('label', 'auth-field');
  field.setAttribute('for', id);
  field.append(el('span', 'auth-label', label));
  const input = el('input', 'glass-input');
  input.id = id;
  input.type = type;
  input.autocomplete = autocomplete;
  input.required = true;
  if (placeholder) input.placeholder = placeholder;
  field.append(input);
  return { field, input };
}

function openAuthDialog(initialMode: 'login' | 'signup'): void {
  document.getElementById('authBackdrop')?.remove();
  closeUserMenu();
  const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const backdrop = el('div', 'auth-backdrop');
  backdrop.id = 'authBackdrop';
  const dialog = el('section', 'auth-dialog glass-surface');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-labelledby', 'authDialogTitle');
  const heading = el('div', 'auth-heading');
  const tabs = el('div', 'auth-tabs');
  const loginTab = el('button', 'auth-tab', 'Log in');
  loginTab.type = 'button';
  loginTab.id = 'authTabLogin';
  const signupTab = el('button', 'auth-tab', 'Create account');
  signupTab.type = 'button';
  signupTab.id = 'authTabSignup';
  tabs.append(loginTab, signupTab);
  const form = el('form', 'auth-form');
  form.noValidate = true;
  const error = el('p', 'auth-error');
  error.id = 'authError';
  error.setAttribute('role', 'alert');
  error.hidden = true;
  const submit = el('button', 'secondary-pill auth-submit');
  submit.type = 'submit';
  submit.id = 'authSubmit';
  dialog.append(heading, tabs, form, error);
  backdrop.append(dialog);

  let active: 'login' | 'signup' = initialMode;
  let pending = false;
  let fields: { displayName: HTMLInputElement | null; email: HTMLInputElement | null; password: HTMLInputElement | null; confirm: HTMLInputElement | null } = { displayName: null, email: null, password: null, confirm: null };

  const showError = (message: string): void => {
    error.textContent = message;
    error.hidden = false;
  };

  const close = (): void => {
    backdrop.remove();
    if (trigger?.isConnected) trigger.focus();
  };

  const renderBody = (): void => {
    const signingUp = active === 'signup';
    loginTab.classList.toggle('active', !signingUp);
    loginTab.setAttribute('aria-selected', String(!signingUp));
    signupTab.classList.toggle('active', signingUp);
    signupTab.setAttribute('aria-selected', String(signingUp));
    const title = el('h2', 'auth-title', signingUp ? 'Create your account' : 'Welcome back');
    title.id = 'authDialogTitle';
    heading.replaceChildren(title, el('p', 'auth-subtitle', signingUp ? 'Pick an email and a password. Nothing else required.' : 'Sign in to keep your watchlist and preferences together.'));
    form.replaceChildren();
    error.hidden = true;
    error.textContent = '';
    const nextFields = { displayName: null, email: null, password: null, confirm: null } as typeof fields;
    if (signingUp) {
      const field = authField('authDisplayName', 'Display name', 'text', 'name', 'Ada Lovelace');
      nextFields.displayName = field.input;
      form.append(field.field);
    }
    const emailField = authField('authEmail', 'Email', 'email', signingUp ? 'email' : 'username', 'you@example.com');
    nextFields.email = emailField.input;
    const passwordField = authField('authPassword', 'Password', 'password', signingUp ? 'new-password' : 'current-password', signingUp ? 'At least 8 characters' : '');
    nextFields.password = passwordField.input;
    form.append(emailField.field, passwordField.field);
    if (signingUp) {
      const confirmField = authField('authConfirm', 'Confirm password', 'password', 'new-password', '');
      nextFields.confirm = confirmField.input;
      form.append(confirmField.field);
    }
    fields = nextFields;
    submit.disabled = false;
    submit.textContent = signingUp ? 'Create account' : 'Log in';
    form.append(submit);
  };

  const setMode = (next: 'login' | 'signup'): void => {
    if (active === next) return;
    active = next;
    renderBody();
    fields.email?.focus();
  };

  const submitForm = async (): Promise<void> => {
    if (pending) return;
    const displayName = fields.displayName?.value.trim() ?? '';
    const email = fields.email?.value.trim() ?? '';
    const password = fields.password?.value ?? '';
    const confirm = fields.confirm?.value ?? '';
    if (!email || !/\./.test(email)) {
      showError('Enter a valid email address.');
      fields.email?.focus();
      return;
    }
    if (!password) {
      showError('Enter your password.');
      fields.password?.focus();
      return;
    }
    if (active === 'signup') {
      if (displayName.length < 2) {
        showError('Your display name needs at least 2 characters.');
        fields.displayName?.focus();
        return;
      }
      if (password.length < 8) {
        showError('Choose a password with at least 8 characters.');
        fields.password?.focus();
        return;
      }
      if (password !== confirm) {
        showError('The two passwords do not match.');
        fields.confirm?.focus();
        return;
      }
    }
    pending = true;
    submit.disabled = true;
    submit.textContent = active === 'signup' ? 'Creating account…' : 'Signing in…';
    try {
      const user = active === 'signup' ? await signUp({ displayName, email, password }) : await logIn({ email, password });
      authRevision += 1;
      currentUser = user;
      const area = document.getElementById('authArea');
      if (area) renderAuthArea(area);
      close();
      await synchronizeWatchlist();
      showNotice(active === 'signup' ? `Account created. Welcome, ${user.displayName}.` : `Signed in as ${user.displayName}.`);
    } catch (requestError) {
      const message = requestError instanceof AuthError
        ? requestError.message
        : 'The account service is unavailable. Check your connection and try again.';
      showError(message);
    } finally {
      pending = false;
      submit.disabled = false;
      submit.textContent = active === 'signup' ? 'Create account' : 'Log in';
    }
  };

  loginTab.addEventListener('click', () => setMode('login'));
  signupTab.addEventListener('click', () => setMode('signup'));
  form.addEventListener('submit', (event) => { event.preventDefault(); void submitForm(); });
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) close(); });
  dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') { event.stopPropagation(); close(); } });

  renderBody();
  document.body.append(backdrop);
  fields.email?.focus();
}

function showDetailError(container: HTMLElement, error: unknown, retryAction: () => void): void {
  console.error('[Detail tab] request failed:', error);
  const message = error instanceof Error ? error.message : 'Unknown TMDB error.';
  const retry = el('button', 'secondary-pill', 'Retry');
  retry.type = 'button';
  retry.addEventListener('click', retryAction);
  container.replaceChildren(el('p', 'detail-message', `Failed to load data. ${message}`), retry);
}

let noticeTimer = 0;
function showNotice(message: string): void {
  const notice = document.getElementById('appNotice') ?? el('p', 'app-notice');
  notice.id = 'appNotice';
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.textContent = message;
  if (!notice.isConnected) document.body.append(notice);
  window.clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => notice.remove(), 4500);
}

function openSearch(): void {
  const backdrop = el('div', 'search-backdrop');
  backdrop.id = 'searchBackdrop';
  backdrop.addEventListener('click', (event) => { if (event.target === backdrop) backdrop.remove(); });
  const dialog = el('section', 'search-dialog glass-surface');
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Search movies, TV, and people');
  const input = el('input', 'glass-input');
  input.type = 'search';
  input.placeholder = 'Search movies, shows, people…';
  input.setAttribute('aria-label', 'Search movies, shows, and people');
  const suggestions = el('div', 'search-suggestions');
  dialog.append(input, suggestions);
  backdrop.append(dialog);
  document.body.append(backdrop);
  input.focus();
  let timer = 0;    input.addEventListener('input', () => {
      window.clearTimeout(timer);
      const query = input.value.trim();
      const queryVersion = Number(suggestions.dataset.queryVersion || '0') + 1;
      suggestions.dataset.queryVersion = String(queryVersion);
      if (query.length < 2) { suggestions.replaceChildren(); return; }
      timer = window.setTimeout(() => {
      const loading = el('div', 'search-loading');
      loading.textContent = 'Searching…';
      suggestions.replaceChildren(loading);
      void tmdbRequest<TmdbListResponse<TmdbTitle>>('search/multi', { query, include_adult: false })
        .then((result) => {
          if (suggestions.dataset.queryVersion !== String(queryVersion)) return;
          suggestions.replaceChildren();
          result.results.slice(0, 6).forEach((item) => {
            const mediaType = item.media_type ?? (item.known_for_department ? 'person' : 'movie');
            const row = el('button', 'suggestion-row');
            row.type = 'button';
            if (item.poster_path || item.profile_path) {
              const image = el('img', 'suggestion-poster');
              image.src = `https://image.tmdb.org/t/p/w185${item.poster_path ?? item.profile_path}`;
              image.alt = '';
              row.append(image);
            }
            const title = el('span', 'suggestion-title', item.title ?? item.name ?? 'Untitled');
            const year = (item.release_date ?? item.first_air_date ?? '').slice(0, 4);
            const meta = el('span', 'suggestion-meta', `${mediaType.toUpperCase()}${year ? ` · ${year}` : ''}`);
            row.append(title, meta);
            row.addEventListener('click', () => {
              if (mediaType === 'person') {
                const knownFor = item.known_for ?? [];
                const backToResults = el('button', 'secondary-pill', 'Back to search results');
                backToResults.type = 'button';
                backToResults.addEventListener('click', () => input.dispatchEvent(new Event('input')));
                suggestions.replaceChildren(el('p', 'search-loading', `Titles featuring ${item.name ?? 'this person'}`), backToResults);
                knownFor.forEach((knownTitle) => {
                  const knownType = knownTitle.media_type ?? (knownTitle.first_air_date ? 'tv' : 'movie');
                  const knownRow = el('button', 'suggestion-row');
                  knownRow.type = 'button';
                  knownRow.append(el('span', 'suggestion-title', knownTitle.title ?? knownTitle.name ?? 'Untitled'));
                  knownRow.append(el('span', 'suggestion-meta', knownType.toUpperCase()));
                  knownRow.addEventListener('click', () => {
                    backdrop.remove();
                    navigateToDetail(knownType as 'movie' | 'tv', knownTitle.id);
                  });
                  suggestions.append(knownRow);
                });
                if (!knownFor.length) suggestions.append(el('p', 'search-error', 'No related titles were returned for this result.'));
                return;
              }
              backdrop.remove();
              navigateToDetail(mediaType as 'movie' | 'tv', item.id);
            });
            suggestions.append(row);
          });
        })
        .catch((error: unknown) => {
          if (suggestions.dataset.queryVersion !== String(queryVersion) || !backdrop.isConnected) return;
          const message = error instanceof Error ? error.message : 'Search is temporarily unavailable.';
          suggestions.replaceChildren();
          const retry = el('button', 'secondary-pill', 'Search failed. Retry');
          retry.type = 'button';
          retry.addEventListener('click', () => { input.dispatchEvent(new Event('input')); });
          suggestions.append(el('p', 'search-error', message), retry);
        });
      }, 300);
  });
  dialog.addEventListener('keydown', (event) => { if (event.key === 'Escape') backdrop.remove(); });
}

function renderDetailNavigation(): HTMLElement {
  const navigation = el('div', 'detail-navigation');
  const back = el('button', 'secondary-pill', '← Back to Discover');
  back.type = 'button';
  back.addEventListener('click', () => {
    if (history.state && location.pathname.startsWith('/title/')) history.back();
    else { history.pushState({}, '', '/?tab=trending'); handlePopState(); }
  });
  navigation.append(back);
  return navigation;
}

function createApp(): void {
  const ambientLayer = document.querySelector('.ambient-layer');
  const shell = el('div', 'app-shell');
  const header = createHeader();
  const main = el('main', 'catalog-main');
  main.id = 'catalogMain';
  const footer = el('footer', 'site-footer glass-surface');
  footer.textContent = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';
  shell.append(header, main, footer);
  document.body.replaceChildren(...(ambientLayer ? [ambientLayer, shell] : [shell]));
  bindKeyboardShortcuts();
  window.addEventListener('popstate', handlePopState);
  document.addEventListener('click', (event) => {
    const menu = document.getElementById('userMenu');
    if (!menu || menu.hidden) return;
    if (event.target instanceof Node && menu.parentElement?.contains(event.target)) return;
    closeUserMenu();
  });
  void restoreSession();
  if (location.pathname.startsWith('/title/')) return;
  renderCatalog();
  void initializeCatalog();
}

function navigateToDetail(type: 'movie' | 'tv', id: number): void {
  history.pushState({}, '', `/title/${type}/${id}`);
  void loadDetailRoute(type, id, false);
}

function bindKeyboardShortcuts(): void {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.getElementById('searchBackdrop')?.remove();
      document.getElementById('authBackdrop')?.remove();
      closeUserMenu();
      document.querySelectorAll('.video-modal').forEach((modal) => modal.remove());
      if (filtersOpen) closeFilterDrawer();
    }
    if (event.key === 'Backspace' && !(event.target instanceof HTMLInputElement) && location.pathname.startsWith('/title/')) {
      event.preventDefault(); history.back();
    }
    if (event.key === '/' && !(event.target instanceof HTMLInputElement)) {
      event.preventDefault();
      openSearch();
    }
    if (event.altKey && event.key === 'ArrowLeft') {
      event.preventDefault();
      shiftSeason(-1);
    }
    if (event.altKey && event.key === 'ArrowRight') {
      event.preventDefault();
      shiftSeason(1);
    }
  });
}

function handlePopState(): void {
  loadController?.abort();
  isLoading = false;
  catalogLoadVersion += 1;
  pageObserver?.disconnect();
  const detailRoute = location.pathname.match(/^\/title\/(movie|tv)\/(\d+)$/);
  if (detailRoute) { void loadDetailRoute(detailRoute[1] as 'movie' | 'tv', Number(detailRoute[2]), false); return; }
  tab = selectedTab();
  const params = new URLSearchParams(location.search);
  const cat = params.get('category');
  upcomingCategory = cat && ['movies', 'tv', 'anime', 'dramas'].includes(cat) ? (cat as UpcomingCategory) : 'movies';
  filters.sort = (params.get('sort') || localStorage.getItem(`${preferenceKey}:sort`) || 'popular') as SelectValue;
  filters.language = (params.get('language') === 'english' || localStorage.getItem(`${preferenceKey}:language`) === 'english' ? 'english' : 'original') as CatalogFilters['language'];
  const status = params.get('status');
  filters.status = (status === 'airing' || status === 'upcoming' ? status : 'all') as CatalogFilters['status'];
  page = 1;
  items = [];
  updateNavActive();
  renderCatalog();
  void loadPage(true);
}

function renderCatalog(): void {
  const main = document.getElementById('catalogMain');
  if (!main) return;
  const section = el('section', 'catalog-section');
  const filterBackdrop = el('div', `filter-drawer-backdrop${filtersOpen ? ' is-open' : ''}`);
  filterBackdrop.id = 'filterBackdrop';
  filterBackdrop.setAttribute('aria-hidden', String(!filtersOpen));
  const filtersRow = el('aside', 'filter-drawer glass-surface');
  filtersRow.id = 'filterPanel';
  filtersRow.setAttribute('aria-label', 'Catalog filters');
  filtersRow.setAttribute('aria-hidden', String(!filtersOpen));
  filtersRow.setAttribute('role', 'dialog');
  filtersRow.setAttribute('aria-modal', 'true');
  filtersRow.inert = !filtersOpen;
  const drawerHeader = el('div', 'filter-drawer-header');
  const drawerTitle = el('div', 'filter-drawer-heading');
  const drawerHeading = el('h2', 'filter-drawer-title', 'Filters');
  drawerHeading.id = 'filterDrawerTitle';
  filtersRow.setAttribute('aria-labelledby', 'filterDrawerTitle');
  drawerTitle.append(el('p', 'filter-panel-label', 'Refine your picks'), drawerHeading);
  const closeDrawer = el('button', 'icon-button filter-drawer-close');
  closeDrawer.type = 'button';
  closeDrawer.setAttribute('aria-label', 'Close filters');
  closeDrawer.textContent = '×';
  closeDrawer.addEventListener('click', closeFilterDrawer);
  drawerHeader.append(drawerTitle, closeDrawer);
  const filterControls = el('div', 'filter-drawer-controls');
  filtersRow.append(drawerHeader, filterControls);
  let draftSort = filters.sort;
  let draftLanguage = filters.language;
  let draftStatus = filters.status;
  let draftUpcomingCategory = upcomingCategory;
  const drawerFooter = el('div', 'filter-drawer-footer');
  const resultsHint = el('span', 'results-hint');
  resultsHint.id = 'resultCount';
  const resetFiltersButton = el('button', 'secondary-pill filter-reset-btn', 'Reset');
  resetFiltersButton.type = 'button';
  resetFiltersButton.addEventListener('click', () => {
    draftSort = 'popular';
    draftLanguage = 'original';
    draftStatus = 'all';
    draftUpcomingCategory = 'movies';
    const sortControl = document.getElementById('filter-sort');
    const languageControl = document.getElementById('filter-language');
    const statusControl = document.getElementById('filter-status');
    const categoryControl = document.getElementById('filter-upcoming-category');
    if (sortControl instanceof HTMLSelectElement) sortControl.value = draftSort;
    if (languageControl instanceof HTMLSelectElement) languageControl.value = draftLanguage;
    if (statusControl instanceof HTMLSelectElement) statusControl.value = draftStatus;
    if (categoryControl instanceof HTMLSelectElement) categoryControl.value = draftUpcomingCategory;
  });
  const applyFiltersButton = el('button', 'secondary-pill filter-apply-btn', 'Apply filters');
  applyFiltersButton.type = 'button';
  applyFiltersButton.addEventListener('click', () => {
    filters.sort = draftSort;
    filters.language = draftLanguage;
    filters.status = draftStatus;
    upcomingCategory = draftUpcomingCategory;
    localStorage.setItem(`${preferenceKey}:sort`, filters.sort);
    localStorage.setItem(`${preferenceKey}:language`, filters.language);
    page = 1;
    items = [];
    filtersOpen = false;
    syncUrl();
    renderCatalog();
    void loadPage(true);
    document.getElementById('filterToggle')?.focus();
  });
  drawerFooter.append(resetFiltersButton, applyFiltersButton);
  filtersRow.append(drawerFooter);
  filterBackdrop.append(filtersRow);
  filterBackdrop.addEventListener('click', (event) => { if (event.target === filterBackdrop) closeFilterDrawer(); });
  if (tab === 'anime') {
    const seasonFilter = el('label', 'filter-control');
    seasonFilter.append(el('span', 'filter-control-label', 'Anime season'), seasonControl());
    filterControls.append(seasonFilter);
  }
  if (tab === 'upcoming') {
    appendFilterControl(filterControls, 'Category', createSelect('upcoming-category', 'Category', [
      ['movies', 'Upcoming Movies'],
      ['tv', 'Upcoming TV Shows'],
      ['anime', 'Upcoming Anime'],
      ['dramas', 'Upcoming Asian Drama (KR / CN / JP)'],
    ], draftUpcomingCategory, (value) => {
      draftUpcomingCategory = value as UpcomingCategory;
    }));
  }
  appendFilterControl(filterControls, 'Sort by', createSelect('sort', 'Sort titles', sortOptions(), draftSort, (value) => {
    draftSort = value as SelectValue;
  }));
  appendFilterControl(filterControls, 'Title language', createSelect('language', 'Title language', [['original', 'Original language'], ['english', 'English titles']], draftLanguage, (value) => {
    draftLanguage = value as CatalogFilters['language'];
  }));
  if (tab !== 'upcoming') {
    appendFilterControl(filterControls, 'Release status', createSelect('status', 'Release status', [['all', 'All titles'], ['airing', 'Airing / in theaters'], ['upcoming', 'Upcoming']], draftStatus, (value) => {
      draftStatus = value as CatalogFilters['status'];
    }));
  }
  const grid = el('div', 'catalog-grid');
  grid.id = 'catalogGrid';
  grid.setAttribute('aria-label', `${TAB_LABELS[tab]} titles`);
  const loadMore = el('button', 'secondary-pill load-more', 'Load more');
  loadMore.id = 'loadMore';
  loadMore.type = 'button';
  loadMore.addEventListener('click', () => { if (!isLoading && page < totalPages) { page += 1; void loadPage(false); } });
  const sentinel = el('div', 'catalog-sentinel');
  sentinel.id = 'pageSentinel';
  sentinel.setAttribute('aria-hidden', 'true');
  section.append(grid, loadMore, sentinel);
  main.replaceChildren(section, filterBackdrop);
  applyFilterPanelState();
  renderCards();
  observeSentinel();
}

function observeSentinel(): void {
  pageObserver?.disconnect();
  const sentinel = document.getElementById('pageSentinel');
  if (!sentinel || !('IntersectionObserver' in window)) return;
  pageObserver = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting) && !isLoading && page < totalPages) {
      page += 1;
      void loadPage(false);
    }
  }, { rootMargin: '500px 0px' });
  pageObserver.observe(sentinel);
}

function hasActiveFilters(): boolean {
  if (filters.sort !== 'popular' || filters.language !== 'original') return true;
  return tab === 'upcoming' ? upcomingCategory !== 'movies' : filters.status !== 'all';
}

function applyFilterPanelState(): void {
  const panel = document.getElementById('filterPanel');
  const backdrop = document.getElementById('filterBackdrop');
  if (panel) {
    panel.classList.toggle('is-open', filtersOpen);
    panel.setAttribute('aria-hidden', String(!filtersOpen));
    panel.inert = !filtersOpen;
  }
  if (backdrop instanceof HTMLElement) {
    backdrop.classList.toggle('is-open', filtersOpen);
    backdrop.setAttribute('aria-hidden', String(!filtersOpen));
  }
  document.body.classList.toggle('filter-drawer-open', filtersOpen);
  const toggle = document.getElementById('filterToggle');
  if (toggle) {
    toggle.classList.toggle('active', filtersOpen);
    toggle.classList.toggle('has-filters', hasActiveFilters());
    toggle.setAttribute('aria-expanded', String(filtersOpen));
  }
}

function closeFilterDrawer(): void {
  filtersOpen = false;
  applyFilterPanelState();
}

function openFilterDrawer(): void {
  const panel = document.getElementById('filterPanel');
  if (!panel) return;
  filtersOpen = true;
  applyFilterPanelState();
  panel.querySelector<HTMLSelectElement>('select')?.focus();
}

function appendFilterControl(container: HTMLElement, label: string, select: HTMLSelectElement): void {
  const control = el('label', 'filter-control');
  control.append(el('span', 'filter-control-label', label), select);
  container.append(control);
}

function createSelect(id: string, label: string, options: Array<[string, string]>, value: string, change: (value: string) => void): HTMLSelectElement {
  const select = el('select', 'glass-select');
  select.id = `filter-${id}`;
  select.setAttribute('aria-label', label);
  options.forEach(([optionValue, optionLabel]) => {
    const option = el('option', undefined, optionLabel);
    option.value = optionValue;
    option.selected = optionValue === value;
    select.append(option);
  });
  select.addEventListener('change', () => change(select.value));
  return select;
}

function sortOptions(): Array<[string, string]> {
  if (tab === 'movies') return [['popular', 'Popularity'], ['top_rated', 'Rating'], ['upcoming', 'Upcoming'], ['now_playing', 'Now playing']];
  if (tab === 'tv') return [['popular', 'Popularity'], ['top_rated', 'Rating'], ['on_the_air', 'On the air'], ['airing_today', 'Airing today']];
  if (tab === 'upcoming') return [['popular', 'Popularity'], ['title', 'Title']];
  return [['popular', 'Popularity'], ['top_rated', 'Rating'], ['title', 'Title']];
}

function setTab(nextTab: CatalogTab): void {
  if (tab === nextTab && !location.pathname.startsWith('/title/')) return;
  tab = nextTab;
  filters.sort = 'popular';
  filters.status = 'all';
  localStorage.setItem(`${preferenceKey}:sort`, filters.sort);
  page = 1;
  items = [];
  updateNavActive();
  syncUrl();
  renderCatalog();
  void loadPage(true);
}

function updateNavActive(): void {
  NAV_TABS.forEach(({ key }) => {
    const item = document.getElementById(`tab-${key}`);
    if (item) {
      item.classList.toggle('active', tab === key);
      item.setAttribute('aria-selected', String(tab === key));
    }
  });
}

function syncUrl(): void {
  const params = new URLSearchParams(location.search);
  params.set('tab', tab);
  if (tab === 'upcoming') {
    params.set('category', upcomingCategory);
  } else {
    params.delete('category');
  }
  params.set('sort', filters.sort);
  params.set('language', filters.language);
  params.set('status', filters.status);
  history.pushState({}, '', `${location.pathname}?${params.toString()}`);
}

function seasonControl(): HTMLElement {
  const group = el('div', 'season-control');
  const label = el('span', 'season-label', `${selectedSeason} ${selectedSeasonYear}`);
  const previous = el('button', 'icon-button season-arrow');
  previous.type = 'button'; previous.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m15 18-6-6 6-6"/></svg>';
  previous.setAttribute('aria-label', 'Previous anime season');
  previous.addEventListener('click', () => shiftSeason(-1));
  const choose = el('select', 'glass-select season-select');
  choose.setAttribute('aria-label', 'Anime season');
  const seasons = ['Winter', 'Spring', 'Summer', 'Fall'];
  for (const year of [selectedSeasonYear - 1, selectedSeasonYear, selectedSeasonYear + 1]) {
    seasons.forEach((name) => {
      const option = el('option', undefined, `${name} ${year}`);
      option.value = `${name}|${year}`;
      option.selected = name === selectedSeason && year === selectedSeasonYear;
      choose.append(option);
    });
  }
  choose.addEventListener('change', () => {
    const [season, year] = choose.value.split('|');
    if (season && year) { selectedSeason = season; selectedSeasonYear = Number(year); page = 1; items = []; syncUrl(); renderCatalog(); void loadPage(true); }
  });
  const next = el('button', 'icon-button season-arrow');
  next.type = 'button'; next.innerHTML = svgIcon('chevron');
  next.setAttribute('aria-label', 'Next anime season');
  next.addEventListener('click', () => shiftSeason(1));
  group.append(previous, choose, next);
  return group;
}

function shiftSeason(direction: -1 | 1): void {
  const seasons = ['Winter', 'Spring', 'Summer', 'Fall'];
  const index = seasons.indexOf(selectedSeason);
  const nextIndex = (index + direction + seasons.length) % seasons.length;
  if (direction === 1 && nextIndex === 0) selectedSeasonYear += 1;
  if (direction === -1 && nextIndex === seasons.length - 1) selectedSeasonYear -= 1;
  selectedSeason = seasons[nextIndex]!;
  page = 1;
  items = [];
  renderCatalog();
  void loadPage(true);
}

async function initializeCatalog(): Promise<void> {
  if (new URLSearchParams(location.search).get('saved') === '1') {
    items = readWatchlistItems();
    renderCards();
    showNotice(items.length ? `${items.length} saved titles.` : 'Your watchlist is ready for titles you save.');
    return;
  }
  try {
    const [movieGenres, tvGenres] = await Promise.all([loadGenres('movie'), loadGenres('tv')]);
    genreMaps = { movie: movieGenres, tv: tvGenres };
  } catch {
    // Genre labels are optional; title cards still render without them.
  }
  await loadPage(true);
}

async function loadPage(replace: boolean): Promise<void> {
  if (isLoading && !replace) return;
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  const version = ++catalogLoadVersion;
  const currentPage = replace ? 1 : page;
  isLoading = true;
  setLoading(true, replace);
  try {
    const response = tab === 'anime'
      ? await loadAnimePage(currentPage, controller.signal)
      : tab === 'upcoming'
        ? await loadUpcomingPage(currentPage, controller.signal)
        : await loadCatalog(tab, currentPage, filters, controller.signal);
    if (controller.signal.aborted || version !== catalogLoadVersion) return;
    const mapped = response.results.filter((item) => item.media_type !== 'person').map((item) => mapCatalogItem(item, tab, upcomingCategory));
    items = replace ? mapped : [...items, ...mapped];
    page = response.page;
    totalPages = Math.min(response.total_pages, 500);
    renderCards();
    setLoading(false, false);
    if (filters.status === 'airing' || filters.status === 'upcoming' || tab === 'upcoming') {
      const type = (tab === 'movies' || (tab === 'upcoming' && upcomingCategory === 'movies')) ? 'movie' : 'tv';
      void loadGenres(type).then((genres) => { genreMaps[type] = genres; if (version === catalogLoadVersion) renderCards(); }).catch(() => undefined);
    }
  } catch (error) {
    if (controller.signal.aborted || version !== catalogLoadVersion) return;
    const retryAfter = typeof error === 'object' && error !== null && 'retryAfter' in error ? String(error.retryAfter ?? '') : '';
    const message = error instanceof Error ? error.message : 'Unknown TMDB error.';
    console.error(`[Catalog] ${tab} page ${currentPage} failed`, error);
    setLoading(false, false);
    const retry = el('button', 'secondary-pill', 'Retry');
    retry.type = 'button';
    retry.addEventListener('click', () => { void loadPage(true); });
    const grid = document.getElementById('catalogGrid');
    if (grid) {
      const errorState = el('div', 'empty-state glass-surface');
      errorState.append(el('p', undefined, retryAfter ? `TMDB rate limit — retry in ${retryAfter}s.` : `Failed to load data. ${message}`), retry);
      if (replace) grid.replaceChildren();
      grid.append(errorState);
    }
  } finally {
    if (version === catalogLoadVersion) isLoading = false;
  }
}

async function loadAnimePage(currentPage: number, signal: AbortSignal): Promise<TmdbListResponse<TmdbTitle>> {
  const range = seasonRange(selectedSeasonYear, selectedSeason);
  const query = catalogQuery(tab, currentPage, filters.sort, new Date(), selectedSeason, selectedSeasonYear);
  const params = { ...query.params, 'first_air_date.gte': range.gte, 'first_air_date.lte': range.lte };
  return tmdbRequest<TmdbListResponse<TmdbTitle>>(query.endpoint, params, signal);
}

async function loadUpcomingPage(currentPage: number, signal: AbortSignal): Promise<TmdbListResponse<TmdbTitle>> {
  const query = catalogQuery(tab, currentPage, filters.sort, new Date(), undefined, undefined, upcomingCategory);
  const params = { ...query.params };
  if (filters.language === 'english' && upcomingCategory !== 'anime' && upcomingCategory !== 'dramas') {
    params.with_original_language = 'en';
  }
  return tmdbRequest<TmdbListResponse<TmdbTitle>>(query.endpoint, params, signal);
}

function setLoading(loading: boolean, showSkeletons: boolean): void {
  const button = document.getElementById('loadMore');
  if (button instanceof HTMLButtonElement) {
    button.disabled = loading || page >= totalPages;
    button.textContent = loading ? 'Loading…' : page >= totalPages ? 'End of results' : 'Load more';
  }
  if (showSkeletons) {
    const grid = document.getElementById('catalogGrid');
    if (grid) {
      grid.replaceChildren();
      for (let index = 0; index < 8; index += 1) {
        const skeleton = el('article', 'catalog-card glass-surface skeleton-card');
        skeleton.setAttribute('aria-hidden', 'true');
        grid.append(skeleton);
      }
    }
  }
}

function renderCards(): void {
  const grid = document.getElementById('catalogGrid');
  if (!grid) return;
  const savedOnly = new URLSearchParams(location.search).get('saved') === '1';
  const visible = items.filter((item) => !savedOnly || bookmarkIds.has(item.id));
  visible.sort((left, right) => {
    if (filters.sort === 'top_rated') return right.rating - left.rating;
    if (filters.sort === 'popular') return right.popularity - left.popularity;
    if (filters.sort === 'title') return left.title.localeCompare(right.title);
    return 0;
  });
  const count = document.getElementById('resultCount');
  if (count) count.textContent = `${visible.length} titles`;
  grid.replaceChildren();
  if (!visible.length && !isLoading) {
    grid.append(el('div', 'empty-state glass-surface', savedOnly ? 'No saved titles in this set yet.' : 'No titles match these filters.'));
    return;
  }
  const fragment = document.createDocumentFragment();
  visible.forEach((item, index) => fragment.append(createCard(item, index)));
  grid.append(fragment);
}

function createCard(item: CatalogItem, index: number): HTMLElement {
  const card = el('article', 'catalog-card');
  if (item.director || item.cast?.length) card.classList.add('has-card-metadata');
  card.style.setProperty('--card-index', String(index % 12));
  card.tabIndex = 0;
  card.setAttribute('aria-label', `${item.title}, title details`);
  const poster = el('img', 'catalog-poster');
  poster.alt = '';
  poster.setAttribute('aria-hidden', 'true');
  poster.loading = index > 5 ? 'lazy' : 'eager';
  poster.src = item.posterPath ? `https://image.tmdb.org/t/p/w500${item.posterPath}` : fallbackPoster(item);
  poster.onerror = () => { poster.onerror = null; poster.src = fallbackPoster(item); };
  const overlay = el('div', 'poster-overlay');
  overlay.setAttribute('aria-hidden', 'true');
  const content = el('div', 'catalog-card-content');
  const titleLink = el('a', 'title-link');
  titleLink.href = `/title/${item.mediaType}/${item.id}`;
  titleLink.append(el('h2', 'catalog-card-title', item.title));
  titleLink.addEventListener('click', (event) => { event.preventDefault(); navigateToDetail(item.mediaType, item.id); });
  const creator = el('p', 'card-creator');
  creator.hidden = !item.director;
  creator.textContent = item.director ? `${item.mediaType === 'tv' ? 'Created by' : 'Directed by'} ${item.director}` : '';

  const rating = el('div', 'card-rating');
  rating.setAttribute('aria-label', item.rating > 0 ? `Rated ${item.rating.toFixed(1)} out of 10` : 'Rating unavailable');
  const roundedStars = Math.max(0, Math.min(5, Math.round(item.rating / 2)));
  const stars = el('span', 'rating-stars', `${'★'.repeat(roundedStars)}${'☆'.repeat(5 - roundedStars)}`);
  stars.setAttribute('aria-hidden', 'true');
  rating.append(stars, el('span', 'rating-score', item.rating > 0 ? `${item.rating.toFixed(1)} / 10` : 'Not rated'));

  const genres = el('div', 'genre-badges');
  const genreMap = genreMaps[item.mediaType];
  const genreNames = item.genres?.length ? item.genres : item.genreIds.map((id) => genreMap.get(id)).filter((name): name is string => Boolean(name));
  genreNames.slice(0, 3).forEach((name, genreIndex) => {
    genres.append(el('span', `genre-badge genre-badge-${genreIndex % 2}`, name));
  });
  genres.hidden = !genreNames.length;

  const expanded = el('div', 'poster-expanded');
  const expandedInner = el('div', 'poster-expanded-inner');
  if (item.overview.trim()) expandedInner.append(el('p', 'poster-synopsis', item.overview));
  const castSection = el('section', 'poster-cast');
  castSection.hidden = true;
  castSection.append(el('h3', 'poster-cast-heading', 'Cast'));
  const castRow = el('div', 'poster-cast-row');
  castSection.append(castRow);
  expandedInner.append(castSection);
  expanded.append(expandedInner);
  content.append(titleLink, creator, rating, genres, expanded);

  const detailsToggle = el('button', 'card-details-toggle', 'i');
  detailsToggle.type = 'button';
  detailsToggle.setAttribute('aria-label', `Show details for ${item.title}`);
  detailsToggle.setAttribute('aria-expanded', 'false');
  detailsToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const expandedState = card.classList.toggle('is-expanded');
    detailsToggle.setAttribute('aria-expanded', String(expandedState));
    detailsToggle.setAttribute('aria-label', `${expandedState ? 'Hide' : 'Show'} details for ${item.title}`);
    if (expandedState) void loadCardCredits();
  });

  const bookmark = el('button', `bookmark-button${bookmarkIds.has(item.id) ? ' is-saved' : ''}`);
  bookmark.type = 'button';
  bookmark.dataset.bookmarkId = String(item.id);
  bookmark.dataset.bookmarkTitle = item.title;
  bookmark.innerHTML = svgIcon(bookmarkIds.has(item.id) ? 'check' : 'bookmark');
  bookmark.setAttribute('aria-label', `${bookmarkIds.has(item.id) ? 'Remove' : 'Add'} ${item.title} ${bookmarkIds.has(item.id) ? 'from' : 'to'} watchlist`);
  bookmark.setAttribute('aria-pressed', String(bookmarkIds.has(item.id)));
  bookmark.addEventListener('click', (event) => { event.stopPropagation(); toggleBookmark(item, bookmark); });

  let creditsRequest: Promise<void> | null = null;
  const loadCardCredits = (): Promise<void> => {
    if (creditsRequest) return creditsRequest;
    creditsRequest = tmdbRequest<Record<string, unknown>>(`${item.mediaType}/${item.id}`, { append_to_response: 'credits' })
      .then((result) => {
        if (!card.isConnected) return;
        const credits = typeof result.credits === 'object' && result.credits !== null ? result.credits as Record<string, unknown> : {};
        const crew = Array.isArray(credits.crew) ? credits.crew : [];
        const director = crew.find((person) => typeof person === 'object' && person !== null && 'job' in person && person.job === 'Director');
        const creators = Array.isArray(result.created_by) ? result.created_by : [];
        const creatorPerson = item.mediaType === 'tv' ? creators.find((person) => typeof person === 'object' && person !== null && 'name' in person) : director;
        if (typeof creatorPerson === 'object' && creatorPerson !== null && 'name' in creatorPerson && typeof creatorPerson.name === 'string') {
          item.director = creatorPerson.name;
          card.classList.add('has-card-metadata');
          creator.textContent = `${item.mediaType === 'tv' ? 'Created by' : 'Directed by'} ${item.director}`;
          creator.hidden = false;
        }
        const detailGenres = Array.isArray(result.genres) ? result.genres.flatMap((genre) =>
          typeof genre === 'object' && genre !== null && 'name' in genre && typeof genre.name === 'string' ? [genre.name] : []) : [];
        if (detailGenres.length) {
          item.genres = detailGenres;
          genres.replaceChildren(...detailGenres.slice(0, 3).map((name, genreIndex) => el('span', `genre-badge genre-badge-${genreIndex % 2}`, name)));
          genres.hidden = false;
        }
        const castValues = Array.isArray(credits.cast) ? credits.cast : [];
        const castMembers = castValues.flatMap((person) => {
          if (typeof person !== 'object' || person === null || !('profile_path' in person) || typeof person.profile_path !== 'string') return [];
          const name = 'name' in person && typeof person.name === 'string' ? person.name : 'Cast member';
          return [{ name, profilePath: person.profile_path }];
        }).slice(0, 6);
        if (castMembers.length) {
          item.cast = castMembers;
          card.classList.add('has-card-metadata');
          castRow.replaceChildren(...castMembers.map(({ name, profilePath }) => {
            const image = el('img', 'poster-cast-portrait');
            image.src = `https://image.tmdb.org/t/p/w185${profilePath}`;
            image.alt = name;
            image.title = name;
            image.loading = 'lazy';
            return image;
          }));
          castSection.hidden = false;
        }
      })
      .catch((error: unknown) => {
        console.error(`[Card details] ${item.mediaType}/${item.id} failed:`, error);
      });
    return creditsRequest;
  };

  if (item.cast?.length) {
    castRow.replaceChildren(...item.cast.slice(0, 6).map(({ name, profilePath }) => {
      const image = el('img', 'poster-cast-portrait');
      image.src = `https://image.tmdb.org/t/p/w185${profilePath}`;
      image.alt = name;
      image.title = name;
      image.loading = 'lazy';
      return image;
    }));
    castSection.hidden = false;
  }
  if (item.director) card.classList.add('has-card-metadata');
  card.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') {
      card.classList.add('is-hovered');
      void loadCardCredits();
    }
  });
  card.addEventListener('pointerleave', (event) => {
    if (event.pointerType === 'mouse') card.classList.remove('is-hovered');
  });
  card.addEventListener('focusout', (event) => {
    const nextTarget = event.relatedTarget;
    if (!(nextTarget instanceof Node) || !card.contains(nextTarget)) card.classList.remove('is-keyboard-focused');
  });
  card.addEventListener('focusin', () => {
    card.classList.add('is-keyboard-focused');
    void loadCardCredits();
  });
  card.addEventListener('keydown', (event) => {
    if (event.key === ' ') {
      event.preventDefault();
      const expandedState = card.classList.toggle('is-expanded');
      detailsToggle.setAttribute('aria-expanded', String(expandedState));
      if (expandedState) void loadCardCredits();
    } else if (event.key === 'Enter' && event.target === card) {
      event.preventDefault();
      navigateToDetail(item.mediaType, item.id);
    }
  });
  card.addEventListener('click', (event) => {
    if ((event.target as HTMLElement).closest('button, a')) return;
    const touchInput = window.matchMedia('(hover: none), (pointer: coarse)').matches;
    if (touchInput && !card.classList.contains('is-expanded')) {
      card.classList.add('is-expanded');
      detailsToggle.setAttribute('aria-expanded', 'true');
      void loadCardCredits();
      return;
    }
    navigateToDetail(item.mediaType, item.id);
  });
  card.append(poster, overlay, content, detailsToggle, bookmark);
  return card;
}

function fallbackPoster(item: CatalogItem): string {
  const label = encodeURIComponent(item.title.slice(0, 32));
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 342 513"><rect width="342" height="513" fill="#dfecea"/><text x="171" y="245" fill="#365b5a" font-family="sans-serif" font-size="18" text-anchor="middle">${label}</text><text x="171" y="280" fill="#5b7a80" font-family="sans-serif" font-size="12" text-anchor="middle">No poster available</text></svg>`)}`;
}

function showWatchlist(): void {
  const params = new URLSearchParams(location.search);
  if (params.get('saved') === '1') {
    params.delete('saved');
    history.pushState({}, '', `/?${params.toString()}`);
    items = [];
    page = 1;
    renderCatalog();
    void loadPage(true);
    showNotice('Showing all titles in this catalog.');
    return;
  }
  params.set('saved', '1');
  params.set('tab', tab);
  history.pushState({}, '', `/?${params.toString()}`);
  loadController?.abort();
  tab = selectedTab();
  items = [];
  const localItems = readWatchlistItems();
  items = localItems;
  renderCatalog();
  renderCards();
  showNotice(localItems.length ? `${localItems.length} saved titles.` : 'Your watchlist is ready for titles you save.');
  if (!localItems.length && currentUser) void synchronizeWatchlist();
}

function readWatchlistItems(): CatalogItem[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(`${savedKey}:items`) ?? '[]');
    if (!Array.isArray(value)) return [];
    return value.filter((item): item is CatalogItem => typeof item === 'object' && item !== null && 'id' in item && typeof item.id === 'number' && 'title' in item && typeof item.title === 'string');
  } catch {
    return [];
  }
}

function toggleBookmark(item: CatalogItem, button: HTMLButtonElement): void {
  if (pendingBookmarks.has(item.id)) return;
  pendingBookmarks.add(item.id);
  if (bookmarkIds.has(item.id)) bookmarkIds.delete(item.id); else bookmarkIds.add(item.id);
  localStorage.setItem(savedKey, JSON.stringify([...bookmarkIds]));
  const watchlistItems = readWatchlistItems().filter((saved) => saved.id !== item.id);
  if (bookmarkIds.has(item.id)) watchlistItems.push(item);
  localStorage.setItem(`${savedKey}:items`, JSON.stringify(watchlistItems));
  updateWatchlistBadge();
  void persistWatchlist();
  button.classList.toggle('is-saved', bookmarkIds.has(item.id));
  button.innerHTML = svgIcon(bookmarkIds.has(item.id) ? 'check' : 'bookmark');
  button.setAttribute('aria-pressed', String(bookmarkIds.has(item.id)));
  button.setAttribute('aria-label', `${bookmarkIds.has(item.id) ? 'Remove' : 'Add'} ${item.title} ${bookmarkIds.has(item.id) ? 'from' : 'to'} watchlist`);
  if (new URLSearchParams(location.search).get('saved') === '1' && !bookmarkIds.has(item.id)) renderCards();
  pendingBookmarks.delete(item.id);
}

async function loadDetailRoute(type: 'movie' | 'tv', id: number, pushHistory = true): Promise<void> {
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;    const detail = document.getElementById('detailView') ?? el('main', 'detail-main');
    detail.id = 'detailView';
  detail.replaceChildren(renderDetailNavigation(), el('p', 'detail-message', 'Loading title details…'));
  const main = document.getElementById('catalogMain');
  if (main && detail.parentElement !== main) main.replaceChildren(detail);
  if (pushHistory) history.pushState({}, '', `/title/${type}/${id}`);
  try {
    const result = await tmdbRequest<Record<string, unknown>>(`${type}/${id}`, { append_to_response: 'videos,credits,watch/providers' }, controller.signal);
    if (controller.signal.aborted) return;
    const title = String(result.title ?? result.name ?? 'Title');
    document.title = `${title} – Stillframe`;
    const backdropPath = typeof result.backdrop_path === 'string' ? result.backdrop_path : null;
    const posterPath = typeof result.poster_path === 'string' ? result.poster_path : null;
    const hero = el('section', 'detail-hero');
    if (backdropPath) hero.style.setProperty('--detail-backdrop', `url("https://image.tmdb.org/t/p/w1280${backdropPath}")`);
    const panel = el('div', 'detail-panel glass-surface');
    if (posterPath) { const poster = el('img', 'detail-poster'); poster.src = `https://image.tmdb.org/t/p/w500${posterPath}`; poster.alt = `${title} poster`; panel.append(poster); }
    const info = el('div', 'detail-info');
    info.append(el('p', 'eyebrow', type === 'movie' ? 'FEATURE FILM' : 'TELEVISION'), el('h1', 'detail-title', title));
    const rating = typeof result.vote_average === 'number' ? `★ ${result.vote_average.toFixed(1)} / 10` : 'Rating unavailable';
    const count = typeof result.vote_count === 'number' ? ` · ${result.vote_count.toLocaleString()} ratings` : '';
    info.append(el('p', 'detail-rating', rating + count));
    const genres = Array.isArray(result.genres) ? result.genres.filter((value): value is { name: string } => typeof value === 'object' && value !== null && 'name' in value && typeof value.name === 'string').map((genre) => genre.name).join(' · ') : '';
    if (genres) info.append(el('p', 'detail-genres', genres));
    const overview = typeof result.overview === 'string' && result.overview ? result.overview : 'An untold story, ready to be discovered.';
    info.append(el('p', 'detail-overview', overview));
    const facts = el('div', 'detail-facts');
    const release = String(result.release_date ?? result.first_air_date ?? '');
    if (release) facts.append(el('span', 'detail-fact glass-surface', `Premiere · ${release}`));
    if (typeof result.runtime === 'number') facts.append(el('span', 'detail-fact glass-surface', `Runtime · ${result.runtime} min`));
    if (typeof result.number_of_episodes === 'number') facts.append(el('span', 'detail-fact glass-surface', `${result.number_of_episodes} episodes`));
    panel.append(info, facts);
    hero.append(panel);
    const sections = el('div', 'detail-sections');
    sections.append(el('h2', 'section-title', 'More to explore'));
    const tabs = el('div', 'detail-tabs glass-surface');
    const tabsContent = el('div', 'detail-tab-content');
    const tabNames = ['Info', ...(type === 'tv' ? ['Episodes'] : []), 'Videos', 'Streams', 'Visuals', 'Recommendations'];
    const activateDetailTab = async (name: string): Promise<void> => {
      tabs.querySelectorAll('.detail-tab').forEach((candidate) => {
        candidate.classList.toggle('active', candidate.textContent === name);
        candidate.setAttribute('aria-selected', String(candidate.textContent === name));
      });
      tabsContent.replaceChildren(el('p', 'detail-message', `Loading ${name.toLowerCase()}…`));
      if (name === 'Info') {
        const overviewPanel = el('div', 'detail-tab-panel');
        overviewPanel.append(el('h3', 'section-title', 'Overview'), el('p', 'detail-overview', overview));
        if (typeof result.budget === 'number' && result.budget > 0) overviewPanel.append(el('p', 'detail-fact glass-surface', `Budget · ${new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(result.budget)}`));
        if (typeof result.revenue === 'number' && result.revenue > 0) overviewPanel.append(el('p', 'detail-fact glass-surface', `Box office · ${new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(result.revenue)}`));
        tabsContent.replaceChildren(overviewPanel);
        return;
      }
      if (name === 'Episodes' && type === 'tv') {
        try {
          const season = await tmdbRequest<Record<string, unknown>>(`tv/${id}/season/1`, {}, controller.signal);
          const episodes = Array.isArray(season.episodes) ? season.episodes : [];
          if (!episodes.length) { tabsContent.replaceChildren(el('p', 'empty-state glass-surface', 'No episodes are listed for season 1.')); return; }
          const list = el('div', 'episode-list');
          episodes.forEach((value) => {
            if (typeof value !== 'object' || value === null) return;
            const episode = value as Record<string, unknown>;
            const row = el('article', 'episode-row glass-surface');
            if (typeof episode.still_path === 'string') {
              const still = el('img', 'episode-still'); still.src = `https://image.tmdb.org/t/p/w300${episode.still_path}`; still.alt = ''; still.loading = 'lazy'; row.append(still);
            }
            const runtime = typeof episode.runtime === 'number' ? ` · ${episode.runtime} min` : '';
            row.append(el('p', 'episode-title', `EP ${String(episode.episode_number ?? '—')} · ${String(episode.name ?? 'Episode')}`));
            row.append(el('p', 'episode-meta', `${String(episode.air_date ?? 'Date TBA')}${runtime}`));
            list.append(row);
          });
          tabsContent.replaceChildren(list);
        } catch (error) { showDetailError(tabsContent, error, () => { void activateDetailTab(name); }); }
        return;
      }
      if (name === 'Videos') {
        const videosEndpoint = `${type}/${id}/videos`;
        const videoResponse = typeof result.videos === 'object' && result.videos !== null && 'results' in result.videos ? result.videos.results : null;
        const fetchedVideos = videoResponse ?? (await tmdbRequest<TmdbListResponse<Record<string, unknown>>>(videosEndpoint, {}, controller.signal)).results;
        const videos = Array.isArray(fetchedVideos) ? fetchedVideos.filter((value): value is Record<string, unknown> => typeof value === 'object' && value !== null && value.site === 'YouTube' && typeof value.key === 'string') : [];
        if (!videos.length) { tabsContent.replaceChildren(el('p', 'empty-state glass-surface', 'No YouTube videos are available for this title.')); return; }
        const videoGrid = el('div', 'video-grid');
        videos.forEach((video) => {
          const key = String(video.key);
          const videoButton = el('button', 'video-card glass-surface'); videoButton.type = 'button';
          const thumb = el('img', 'video-thumb'); thumb.src = `https://img.youtube.com/vi/${encodeURIComponent(key)}/hqdefault.jpg`; thumb.alt = `${String(video.name ?? 'Video')} thumbnail`; thumb.loading = 'lazy';
          videoButton.append(thumb, el('span', 'video-title', String(video.name ?? 'YouTube video')), el('span', 'video-type', String(video.type ?? 'Video')));
          videoButton.addEventListener('click', () => {
            const modal = el('div', 'video-modal'); modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true'); modal.setAttribute('aria-label', String(video.name ?? 'Video player'));
            const close = el('button', 'video-close icon-button', '×'); close.type = 'button'; close.setAttribute('aria-label', 'Close video');
            const frame = el('iframe', 'video-frame'); frame.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(key)}?autoplay=1`; frame.title = String(video.name ?? 'YouTube video'); frame.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'; frame.allowFullscreen = true;
            close.addEventListener('click', () => modal.remove()); modal.addEventListener('click', (event) => { if (event.target === modal) modal.remove(); });
            modal.append(close, frame); document.body.append(modal); close.focus();
          });
          videoGrid.append(videoButton);
        });
        tabsContent.replaceChildren(videoGrid);
        return;
      }
      if (name === 'Streams') {
        const providersRoot = typeof result['watch/providers'] === 'object' && result['watch/providers'] !== null && 'results' in result['watch/providers'] ? result['watch/providers'].results : null;
        const providerRegions = typeof providersRoot === 'object' && providersRoot !== null ? providersRoot as Record<string, unknown> : null;
        const providersValue = providerRegions?.US;
        const providers = typeof providersValue === 'object' && providersValue !== null ? providersValue as Record<string, unknown> : null;
        if (!providers) { tabsContent.replaceChildren(el('p', 'empty-state glass-surface', 'Streaming providers are not listed for this region.')); return; }
        const groups = el('div', 'provider-groups');
        for (const groupName of ['flatrate', 'rent', 'buy']) {
          const group = providers[groupName];
          if (!Array.isArray(group) || !group.length) continue;
          const section = el('section', 'provider-group'); section.append(el('h3', 'section-title', groupName === 'flatrate' ? 'Stream' : groupName === 'rent' ? 'Rent' : 'Buy'));
          const chips = el('div', 'provider-chips');
          group.forEach((entry) => { if (typeof entry !== 'object' || entry === null) return; const provider = entry as Record<string, unknown>; const chip = el('span', 'detail-fact glass-surface', String(provider.provider_name ?? 'Provider')); if (typeof provider.logo_path === 'string') { const logo = el('img', 'provider-logo'); logo.src = `https://image.tmdb.org/t/p/w185${provider.logo_path}`; logo.alt = ''; chip.prepend(logo); } chips.append(chip); });
          section.append(chips); groups.append(section);
        }
        tabsContent.replaceChildren(groups.childElementCount ? groups : el('p', 'empty-state glass-surface', 'No streaming offers are listed for this region.'));
        return;
      }
      if (name === 'Visuals') {
        const images = typeof result.images === 'object' && result.images !== null ? result.images as Record<string, unknown> : {};
        const backdrops = Array.isArray(images.backdrops) ? images.backdrops : [];
        const posters = Array.isArray(images.posters) ? images.posters : [];
        const imageGrid = el('div', 'visual-grid');
        [...backdrops, ...posters].slice(0, 24).forEach((value) => { if (typeof value !== 'object' || value === null || !('file_path' in value) || typeof value.file_path !== 'string') return; const image = el('img', 'visual-thumb'); image.src = `https://image.tmdb.org/t/p/w780${value.file_path}`; image.alt = `${title} still`; image.loading = 'lazy'; image.addEventListener('click', () => { const modal = el('div', 'video-modal'); const full = el('img', 'lightbox-image'); full.src = `https://image.tmdb.org/t/p/original${value.file_path}`; full.alt = image.alt; modal.append(full); modal.addEventListener('click', () => modal.remove()); document.body.append(modal); }); imageGrid.append(image); });
        tabsContent.replaceChildren(imageGrid.childElementCount ? imageGrid : el('p', 'empty-state glass-surface', 'No artwork is available.'));
        return;
      }
      if (name === 'Recommendations') {
        try {
          const response = await tmdbRequest<TmdbListResponse<TmdbTitle>>(`${type}/${id}/recommendations`, {}, controller.signal);
          const rail = el('div', 'recommendation-rail');
          response.results.slice(0, 12).forEach((recommendation) => { const mapped = mapCatalogItem(recommendation, type === 'movie' ? 'movies' : 'tv'); rail.append(createCard(mapped, rail.childElementCount)); });
          tabsContent.replaceChildren(rail.childElementCount ? rail : el('p', 'empty-state glass-surface', 'No recommendations are available.'));
        } catch (error) { showDetailError(tabsContent, error, () => { void activateDetailTab(name); }); }
      }
    };
    tabNames.forEach((name, index) => {
      const button = el('button', `detail-tab${index === 0 ? ' active' : ''}`, name);
      button.type = 'button';
      button.setAttribute('role', 'tab'); button.setAttribute('aria-selected', String(index === 0)); button.tabIndex = index === 0 ? 0 : -1;
      button.addEventListener('click', () => { void activateDetailTab(name); });
      button.addEventListener('keydown', (event) => { if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return; event.preventDefault(); const nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabNames.length) % tabNames.length; tabs.querySelectorAll<HTMLButtonElement>('.detail-tab')[nextIndex]?.focus(); });
      tabs.append(button);
    });
    sections.append(tabs, tabsContent);
    await activateDetailTab('Info');
    const credits = result.credits;
    if (typeof credits === 'object' && credits !== null && 'cast' in credits && Array.isArray(credits.cast)) {
      const cast = el('section', 'cast-section');
      cast.append(el('h2', 'section-title', 'Cast'));
      const rail = el('div', 'cast-rail');
      credits.cast.slice(0, 12).forEach((value) => {
        if (typeof value !== 'object' || value === null) return;
        const person = value as Record<string, unknown>;
        const name = String(person.name ?? 'Cast member');
        const card = el('article', 'cast-card glass-surface');
        if (typeof person.profile_path === 'string') { const image = el('img', 'cast-profile'); image.src = `https://image.tmdb.org/t/p/w185${person.profile_path}`; image.alt = name; image.loading = 'lazy'; card.append(image); }
        card.append(el('p', 'cast-name', name));
        if (typeof person.character === 'string') card.append(el('p', 'cast-role', person.character));
        rail.append(card);
      });
      cast.append(rail);
      sections.append(cast);
    }
    const titleBookmark = el('button', `secondary-pill detail-bookmark${bookmarkIds.has(id) ? ' is-saved' : ''}`, bookmarkIds.has(id) ? '✓ Saved' : '＋ Watchlist');
    titleBookmark.type = 'button';
    titleBookmark.dataset.bookmarkId = String(id);
    titleBookmark.dataset.bookmarkTitle = title;
    titleBookmark.setAttribute('aria-pressed', String(bookmarkIds.has(id)));
    titleBookmark.addEventListener('click', () => {
      const detailItem = mapCatalogItem({ id, media_type: type, title: title, name: title, overview: overview, poster_path: posterPath, backdrop_path: backdropPath, vote_average: typeof result.vote_average === 'number' ? result.vote_average : 0, vote_count: typeof result.vote_count === 'number' ? result.vote_count : 0 }, type === 'movie' ? 'movies' : 'tv');
      if (bookmarkIds.has(id)) bookmarkIds.delete(id); else bookmarkIds.add(id);
      localStorage.setItem(savedKey, JSON.stringify([...bookmarkIds]));
      const saved = readWatchlistItems().filter((entry) => entry.id !== id);
      if (bookmarkIds.has(id)) saved.push(detailItem);
      localStorage.setItem(`${savedKey}:items`, JSON.stringify(saved));
      updateWatchlistBadge();
      void persistWatchlist();
      titleBookmark.classList.toggle('is-saved', bookmarkIds.has(id));
      titleBookmark.textContent = bookmarkIds.has(id) ? '✓ Saved' : '＋ Watchlist';
      titleBookmark.setAttribute('aria-pressed', String(bookmarkIds.has(id)));
    });
    info.append(titleBookmark);
    detail.replaceChildren(renderDetailNavigation(), hero, sections);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error(`[Detail] ${type}/${id} failed`, error);
      const message = error instanceof Error ? error.message : 'Unknown detail error.';
      const retry = el('button', 'secondary-pill', 'Retry');
      retry.type = 'button';
      retry.addEventListener('click', () => { void loadDetailRoute(type, id, false); });
      detail.replaceChildren(el('p', 'detail-message', `Failed to load data. ${message}`), retry);
    }
  }
}

window.addEventListener('DOMContentLoaded', () => {
  createApp();
  const detailRoute = location.pathname.match(/^\/title\/(movie|tv)\/(\d+)$/);
  if (detailRoute) void loadDetailRoute(detailRoute[1] as 'movie' | 'tv', Number(detailRoute[2]), false);
});
