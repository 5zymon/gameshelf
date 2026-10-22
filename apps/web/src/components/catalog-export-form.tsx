'use client';

import { useId, useState } from 'react';
import { useTranslations } from 'next-intl';
import { exportCsvHref, type ExportPlatform } from '@/lib/catalog-export';

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-reduce:transition-none';
const FIELD =
  'w-full h-10 rounded-control border border-edge bg-field px-3 text-sm text-ink outline-none focus:border-accent/55 focus:ring-[3px] focus:ring-accent/15 disabled:opacity-60';

type Range = 'all' | 'platform';

export function CatalogExportForm({
  platforms,
  totalGames,
}: {
  platforms: readonly ExportPlatform[];
  totalGames: number;
}): React.ReactElement {
  const t = useTranslations('catalogExport');
  const uid = useId();
  const [range, setRange] = useState<Range>('all');
  const [platformId, setPlatformId] = useState(platforms[0]?.id ?? '');

  const selected =
    range === 'platform'
      ? platforms.find((platform) => platform.id === platformId)
      : undefined;
  const blocked = selected?.gameCount === 0 ? selected : undefined;

  return (
    <>
      <fieldset>
        <legend className="text-lg font-semibold text-ink">{t('range')}</legend>
        <label className="mt-3 flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="range"
            value="all"
            checked={range === 'all'}
            onChange={() => {
              setRange('all');
            }}
            className="accent-accent"
          />
          {t('wholeCatalog')}
        </label>
        <label className="mt-2 flex items-center gap-2 text-sm text-ink">
          <input
            type="radio"
            name="range"
            value="platform"
            checked={range === 'platform'}
            disabled={platforms.length === 0}
            onChange={() => {
              setRange('platform');
            }}
            className="accent-accent"
          />
          {t('onePlatform')}
        </label>
      </fieldset>
      <div className="mt-4 space-y-1">
        <label htmlFor={`${uid}-platform`} className="block text-sm text-muted">
          {t('platform')}
        </label>
        <select
          id={`${uid}-platform`}
          value={platformId}
          disabled={range !== 'platform'}
          onChange={(event) => {
            setPlatformId(event.target.value);
          }}
          className={`${FIELD} select-field sm:max-w-xs`}
        >
          {platforms.map((platform) => (
            <option key={platform.id} value={platform.id}>
              {platform.name}
            </option>
          ))}
        </select>
      </div>
      <p role="status" className="mt-4 max-w-md text-sm text-muted">
        {blocked !== undefined
          ? t('platformEmpty', { platform: blocked.name })
          : range === 'all' && totalGames === 0
            ? t('empty')
            : null}
      </p>
      <div className="mt-6">
        {blocked !== undefined ? (
          <button
            type="button"
            disabled
            className={`${PRIMARY_BUTTON} disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-accent`}
          >
            {t('download')}
          </button>
        ) : (
          <a
            href={exportCsvHref(selected?.id)}
            download
            className={PRIMARY_BUTTON}
          >
            {t('download')}
          </a>
        )}
      </div>
    </>
  );
}
