import { redirect } from 'next/navigation';
import { getCurrentUser, type AuthUser } from '@/lib/api';

/**
 * Authoritative, server-side session guard for protected routes.
 *
 * `getCurrentUser` is wrapped in React.cache, so the layout and the page can
 * both call `requireUser` during one navigation while the API is hit at most
 * once. `redirect` throws, so no protected markup is returned when there is
 * no valid session.
 */
export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (user === null) {
    redirect('/login');
  }
  return user;
}
