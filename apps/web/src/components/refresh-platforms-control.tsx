'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isApiError } from '@/lib/api';
import { api } from '@/lib/api/browser';

const SECONDARY_BUTTON =
  'inline-flex items-center justify-center rounded-control border border-edge bg-surface px-4 py-2.5 text-sm leading-none font-medium text-ink transition-colors duration-[140ms] ease-[ease] hover:border-edge-strong motion-reduce:transition-none disabled:opacity-60';

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
      className="space-y-3 rounded-card border border-edge bg-surface p-4 shadow-[var(--shadow-card)]"
      aria-labelledby="platforms-heading"
    >
      <h2 id="platforms-heading" className="text-lg font-semibold text-ink">
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
