'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { PlatformAddForm } from '@/components/platform-add-form';
import { PlatformMergeDialog } from '@/components/platform-merge-dialog';
import { PlatformRow } from '@/components/platform-row';
import type { Platform } from '@/lib/api';
import { filterPlatforms, splitImported } from '@/lib/platforms';

const LIST_CLASS = 'divide-y divide-edge overflow-hidden rounded-card border';

export function PlatformsManager({
  platforms,
}: {
  platforms: readonly Platform[];
}): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('platforms');
  const [showAll, setShowAll] = useState(false);
  const [mergeSource, setMergeSource] = useState<Platform | null>(null);

  const { imported, rest } = splitImported(platforms);
  const visible = filterPlatforms(rest, showAll);

  function onChanged(): void {
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {imported.length > 0 && (
        <section aria-labelledby="import-review-heading" className="space-y-3">
          <div className="space-y-1">
            <h2
              id="import-review-heading"
              className="text-lg font-semibold text-ink"
            >
              {t('importReview.title')}
            </h2>
            <p className="text-sm text-muted">{t('importReview.body')}</p>
          </div>
          <ul className={`${LIST_CLASS} border-accent/40 bg-accent-soft`}>
            {imported.map((platform) => (
              <li key={platform.id}>
                <PlatformRow
                  platform={platform}
                  onChanged={onChanged}
                  onMerge={setMergeSource}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <PlatformAddForm onChanged={onChanged} />

      <section aria-labelledby="platform-list-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <h2
            id="platform-list-heading"
            className="text-lg font-semibold text-ink"
          >
            {t('all.title')}
          </h2>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={showAll}
              onChange={(event) => {
                setShowAll(event.target.checked);
              }}
              className="h-4 w-4 accent-accent"
            />
            {t('showAll')}
          </label>
        </div>

        {visible.length === 0 ? (
          <p className="rounded-card border border-edge bg-surface px-4 py-6 text-sm text-muted">
            {platforms.length === 0 ? t('empty.none') : t('empty.filtered')}
          </p>
        ) : (
          <ul
            className={`${LIST_CLASS} border-edge bg-surface shadow-[var(--shadow-card)]`}
          >
            {visible.map((platform) => (
              <li key={platform.id}>
                <PlatformRow
                  platform={platform}
                  onChanged={onChanged}
                  onMerge={setMergeSource}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {mergeSource !== null && (
        <PlatformMergeDialog
          source={mergeSource}
          platforms={platforms}
          onClose={() => {
            setMergeSource(null);
          }}
          onMerged={() => {
            setMergeSource(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}
