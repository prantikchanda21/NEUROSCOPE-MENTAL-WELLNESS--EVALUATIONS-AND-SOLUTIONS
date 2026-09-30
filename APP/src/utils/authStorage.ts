/**
 * Lightweight, browser-only account system.
 *
 * IMPORTANT — read this before wiring this into a real production launch:
 * there is no backend database in this project yet, so "accounts" are
 * persisted in this browser's localStorage only. That's enough to let a
 * returning visitor on the same device/browser sign back in, keep their past
 * reports, and build a real daily-login streak — but it is NOT a substitute
 * for a real user table. It will not sync across devices, and it will not
 * survive the user clearing site data. Passwords are hashed (SHA-256 + a
 * random per-user salt) before they ever touch storage, but that is
 * client-side hashing, not a server-verified account system — if you later
 * add a real backend, swap the functions below for real API calls and keep
 * the same call signatures so nothing else has to change.
 */

export interface StoredUser {
  id: string; // normalized email, used as the storage key
  email: string;
  name: string;
  provider: 'password' | 'google';
  passwordHash?: string;
  salt?: string;
  picture?: string;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  provider: 'password' | 'google';
  picture?: string;
}

export interface LoginStreakState {
  loginDates: string[]; // ISO 'YYYY-MM-DD', deduped, ascending
  currentStreak: number;
  longestStreak: number;
  lastLoginDate: string | null;
  totalLogins: number;
}

const USERS_KEY = 'neuroscope_auth_users_v1';
const SESSION_KEY = 'neuroscope_auth_session_v1';
const STREAK_KEY_PREFIX = 'neuroscope_login_streak_v1_';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const toPublicUser = (u: StoredUser): PublicUser => ({
  id: u.id,
  email: u.email,
  name: u.name,
  provider: u.provider,
  picture: u.picture,
});

const normalizeEmail = (email: string) => email.trim().toLowerCase();

function readUsers(): Record<string, StoredUser> {
  try {
    const raw = localStorage.getItem(USERS_KEY);
    return raw ? (JSON.parse(raw) as Record<string, StoredUser>) : {};
  } catch {
    return {};
  }
}

function writeUsers(users: Record<string, StoredUser>): void {
  try {
    localStorage.setItem(USERS_KEY, JSON.stringify(users));
  } catch {
    // best-effort; storage may be unavailable (e.g. private mode with quota exceeded)
  }
}

function randomSalt(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password: string, salt: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${salt}:${password}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function setSession(userId: string): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ userId }));
  } catch {
    // ignore
  }
}

export function getCurrentUser(): PublicUser | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const { userId } = JSON.parse(raw) as { userId: string };
    const users = readUsers();
    const user = users[userId];
    return user ? toPublicUser(user) : null;
  } catch {
    return null;
  }
}

export function signOut(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export type AuthResult = { user: PublicUser } | { error: string };

export async function createAccountWithEmail(
  name: string,
  email: string,
  password: string
): Promise<AuthResult> {
  const cleanName = name.trim();
  const cleanEmail = normalizeEmail(email);

  if (!cleanName) return { error: 'Please enter your name.' };
  if (!EMAIL_RE.test(cleanEmail)) return { error: 'Please enter a valid email address.' };
  if (password.length < 6) return { error: 'Password must be at least 6 characters.' };

  const users = readUsers();
  if (users[cleanEmail]) {
    return { error: 'An account with this email already exists. Try signing in instead.' };
  }

  const salt = randomSalt();
  const passwordHash = await hashPassword(password, salt);
  const user: StoredUser = {
    id: cleanEmail,
    email: cleanEmail,
    name: cleanName,
    provider: 'password',
    passwordHash,
    salt,
    createdAt: new Date().toISOString(),
  };

  users[cleanEmail] = user;
  writeUsers(users);
  setSession(user.id);
  recordDailyLogin(user.id);

  return { user: toPublicUser(user) };
}

export async function signInWithEmail(email: string, password: string): Promise<AuthResult> {
  const cleanEmail = normalizeEmail(email);
  const users = readUsers();
  const user = users[cleanEmail];

  if (!user || user.provider !== 'password' || !user.salt || !user.passwordHash) {
    return { error: 'Incorrect email or password.' };
  }

  const hash = await hashPassword(password, user.salt);
  if (hash !== user.passwordHash) {
    return { error: 'Incorrect email or password.' };
  }

  setSession(user.id);
  recordDailyLogin(user.id);
  return { user: toPublicUser(user) };
}

export function signInWithGoogleProfile(profile: {
  email: string;
  name: string;
  picture?: string;
}): PublicUser {
  const cleanEmail = normalizeEmail(profile.email);
  const users = readUsers();
  const existing = users[cleanEmail];

  const user: StoredUser = existing
    ? { ...existing, name: profile.name || existing.name, picture: profile.picture || existing.picture }
    : {
        id: cleanEmail,
        email: cleanEmail,
        name: profile.name || cleanEmail,
        provider: 'google',
        picture: profile.picture,
        createdAt: new Date().toISOString(),
      };

  users[cleanEmail] = user;
  writeUsers(users);
  setSession(user.id);
  recordDailyLogin(user.id);

  return toPublicUser(user);
}

// ---- Daily login streak tracking (same day-diff approach as the existing
// protocol streak tracker in historyStorage.ts) ----

function streakKey(userId: string): string {
  return `${STREAK_KEY_PREFIX}${userId}`;
}

const emptyStreak = (): LoginStreakState => ({
  loginDates: [],
  currentStreak: 0,
  longestStreak: 0,
  lastLoginDate: null,
  totalLogins: 0,
});

export function getLoginStreak(userId: string): LoginStreakState {
  try {
    const raw = localStorage.getItem(streakKey(userId));
    if (!raw) return emptyStreak();
    return JSON.parse(raw) as LoginStreakState;
  } catch {
    return emptyStreak();
  }
}

/** Call once per successful sign-in/sign-up. Idempotent for repeat logins on
 * the same calendar day — the streak only advances the first time a new day
 * is seen. */
export function recordDailyLogin(userId: string): LoginStreakState {
  const today = new Date().toISOString().split('T')[0];
  const state = getLoginStreak(userId);

  const alreadyToday = state.lastLoginDate === today;
  const dates = alreadyToday ? state.loginDates : [...state.loginDates, today];

  let currentStreak = state.currentStreak || 0;
  if (!alreadyToday) {
    const oneDayMs = 24 * 60 * 60 * 1000;
    const wasYesterday =
      state.lastLoginDate !== null &&
      Math.round((new Date(today).getTime() - new Date(state.lastLoginDate).getTime()) / oneDayMs) === 1;
    currentStreak = wasYesterday ? currentStreak + 1 : 1;
  }

  const newState: LoginStreakState = {
    loginDates: dates.slice(-90), // keep a rolling window; this is a streak counter, not an audit log
    currentStreak,
    longestStreak: Math.max(state.longestStreak || 0, currentStreak),
    lastLoginDate: today,
    totalLogins: state.totalLogins + (alreadyToday ? 0 : 1),
  };

  try {
    localStorage.setItem(streakKey(userId), JSON.stringify(newState));
  } catch {
    // ignore
  }

  return newState;
}
