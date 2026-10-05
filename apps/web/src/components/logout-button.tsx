'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function LogoutButton(): React.ReactElement {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function handleLogout(): Promise<void> {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (res.status === 204 || res.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setError(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-danger">
          Couldn&#39;t sign out. Try again.
        </span>
      )}
      <button
        type="button"
        onClick={() => {
          void handleLogout();
        }}
        disabled={busy}
        className="rounded-md border border-edge px-3 py-1.5 text-sm text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60"
      >
        {busy ? 'Signing out…' : 'Sign out'}
      </button>
    </div>
  );
}
