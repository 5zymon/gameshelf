'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isApiError } from '@/lib/api';
import { api } from '@/lib/api/browser';

export function LogoutButton(): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('nav');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function handleLogout(): Promise<void> {
    setBusy(true);
    setError(false);
    try {
      await api.auth.logout();
      router.replace('/login');
      router.refresh();
      return;
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && (
        <span role="alert" className="text-xs text-danger">
          {t('signOutError')}
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
        {busy ? t('signingOut') : t('signOut')}
      </button>
    </div>
  );
}
