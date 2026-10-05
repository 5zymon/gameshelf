import { cookies } from 'next/headers';

const API_ORIGIN = (
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'
).replace(/\/+$/, '');

export interface AuthUser {
  id: number;
  email: string;
  createdAt: string;
}

export interface GameListItem {
  id: number;
  title: string;
  edition: string | null;
  coverUrl: string | null;
  platform: { id: number; name: string; slug: string } | null;
}

export interface GamesPage {
  items: GameListItem[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

async function authFetch(path: string, init?: RequestInit): Promise<Response> {
  const cookieStore = await cookies();
  const cookie = cookieStore.toString();
  const headers = new Headers(init?.headers);
  if (cookie !== '') headers.set('cookie', cookie);
  return fetch(`${API_ORIGIN}${path}`, {
    ...init,
    headers,
    cache: 'no-store',
  });
}

/** 401 → null (not signed in). Other failures throw so they surface as an error, not a false "signed out". */
export async function getCurrentUser(): Promise<AuthUser | null> {
  const res = await authFetch('/auth/me');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /auth/me failed (${String(res.status)})`);
  return (await res.json()) as AuthUser;
}

/** Public endpoint; no cookie needed. Non-OK throws. */
export async function getSetupStatus(): Promise<boolean> {
  const res = await fetch(`${API_ORIGIN}/setup/status`, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`GET /setup/status failed (${String(res.status)})`);
  }
  const data = (await res.json()) as { setupRequired: boolean };
  return data.setupRequired;
}

/** 401 → null so the caller can redirect. Other failures throw. */
export async function getGames(): Promise<GamesPage | null> {
  const res = await authFetch('/games?limit=24');
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`GET /games failed (${String(res.status)})`);
  return (await res.json()) as GamesPage;
}
