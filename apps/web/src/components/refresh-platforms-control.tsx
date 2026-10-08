'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isApiError } from '@/lib/api';
import { api } from '@/lib/api/browser';

const SECONDARY_BUTTON =
  'rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-60';

export function RefreshPlatformsControl(): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('platforms');
  const [refreshing, setRefreshing] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleRefresh(): Promise<void> {
    setRefreshing(true);
    setError(null);
    setOutcome(null);
    try {
      const result = await api.platforms.refresh();
      setOutcome(
        t('refresh.summary', {
          fetched: result.fetched,
          created: result.created,
          updated: result.updated,
          unchanged: result.unchanged,
        }),
      );
      router.refresh();
    } catch (caught) {
      if (isApiError(caught) && caught.status === 401) {
        router.replace('/login');
        router.refresh();
        return;
      }
      setError(
        isApiError(caught) && caught.status !== 0
          ? caught.userMessage
          : t('error.refresh'),
      );
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-edge bg-shelf/40 p-4"
      aria-labelledby="platforms-heading"
    >
      <h2 id="platforms-heading" className="text-lg font-medium text-fog">
        {t('refresh.heading')}
      </h2>
      <p className="text-sm text-muted">{t('refresh.body')}</p>
      <button
        type="button"
        onClick={() => {
          void handleRefresh();
        }}
        disabled={refreshing}
        className={SECONDARY_BUTTON}
      >
        {refreshing ? t('refresh.refreshing') : t('refresh.button')}
      </button>

      {outcome !== null && (
        <p role="status" aria-live="polite" className="text-sm text-muted">
          {outcome}
        </p>
      )}
      {error !== null && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}
