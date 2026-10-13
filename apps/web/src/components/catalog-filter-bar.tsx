'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';
import type { GamePlatform } from '@/lib/api';
import {
  catalogHref,
  hasActiveFilters,
  SORT_OPTIONS,
  sortOptionOf,
  sortOverrides,
  type CatalogFilterValues,
  type CatalogSortOption,
} from '@/lib/catalog-filters';

const DEBOUNCE_MS = 300;
const FIELD =
  'w-full h-10 rounded-control border border-edge bg-field px-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent/55 focus:ring-[3px] focus:ring-accent/15 disabled:opacity-60';
const LABEL = 'block text-sm text-muted';
const ADVANCED_KEYS = [
  'edition',
  'year',
  'publisher',
  'genre',
  'playerCount',
] as const satisfies readonly (keyof CatalogFilterValues)[];
const SORT_LABEL_KEY: Record<
  CatalogSortOption,
  'sort.titleAsc' | 'sort.titleDesc' | 'sort.yearDesc' | 'sort.yearAsc'
> = {
  'title-asc': 'sort.titleAsc',
  'title-desc': 'sort.titleDesc',
  'year-desc': 'sort.yearDesc',
  'year-asc': 'sort.yearAsc',
};
const PLATFORM_CHIP =
  'inline-flex h-9 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-medium transition-colors duration-[140ms] ease-[ease] motion-reduce:transition-none';
const PLATFORM_CHIP_ON = 'border-accent bg-accent text-accent-ink';
const PLATFORM_CHIP_OFF =
  'border-edge bg-surface text-ink hover:border-edge-strong';

type TextKey = 'q' | 'year' | 'publisher' | 'genre' | 'playerCount';
type Draft = Record<TextKey, string>;
const DRAFT_KEYS = ['q', 'year', 'publisher', 'genre', 'playerCount'] as const;
const EMPTY_DRAFT: Draft = {
  q: '',
  year: '',
  publisher: '',
  genre: '',
  playerCount: '',
};

function toDraft(values: CatalogFilterValues): Draft {
  return {
    q: values.q ?? '',
    year: values.year === undefined ? '' : String(values.year),
    publisher: values.publisher ?? '',
    genre: values.genre ?? '',
    playerCount:
      values.playerCount === undefined ? '' : String(values.playerCount),
  };
}

/** '' → undefined (clear), valid → number, invalid → 'invalid' (keep the committed value). */
function boundedInt(
  raw: string,
  min: number,
  max: number,
): number | undefined | 'invalid' {
  const t = raw.trim();
  if (t === '') return undefined;
  if (!/^\d+$/.test(t)) return 'invalid';
  const n = Number(t);
  return n >= min && n <= max ? n : 'invalid';
}

function draftOverrides(draft: Draft): Partial<CatalogFilterValues> {
  const out: Partial<CatalogFilterValues> = {};
  const q = draft.q.trim();
  out.q = q === '' ? undefined : q;
  const publisher = draft.publisher.trim();
  out.publisher = publisher === '' ? undefined : publisher;
  const genre = draft.genre.trim();
  out.genre = genre === '' ? undefined : genre;
  const year = boundedInt(draft.year, 1000, 2100);
  if (year !== 'invalid') out.year = year;
  const players = boundedInt(draft.playerCount, 1, 100);
  if (players !== 'invalid') out.playerCount = players;
  return out;
}

function Chip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}): React.ReactElement {
  const t = useTranslations('catalogFilters');
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-edge bg-surface py-1 pr-1 pl-3 text-xs text-ink">
      {label}
      <button
        type="button"
        aria-label={t('removeFilter', { label })}
        onClick={onRemove}
        className="-mr-1.5 ml-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted hover:text-danger"
      >
        ×
      </button>
    </span>
  );
}

interface CatalogFilterBarProps {
  /** Committed, server-parsed values — the URL is the source of truth. */
  values: CatalogFilterValues;
  /** `games.filters.platforms` — never hardcoded. */
  platforms: GamePlatform[];
  /** `games.filters.editions` — never hardcoded. */
  editions: string[];
}

export function CatalogFilterBar({
  values,
  platforms,
  editions,
}: CatalogFilterBarProps): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('catalogFilters');
  const [draft, setDraft] = useState<Draft>(() => toDraft(values));
  const [isPending, startTransition] = useTransition();
  const draftRef = useRef<Draft>(draft);
  const valuesRef = useRef<CatalogFilterValues>(values);
  // The most recent values we have pushed but whose RSC payload has not committed yet.
  const pendingRef = useRef<CatalogFilterValues | null>(null);
  const syncedRef = useRef<Draft>(toDraft(values));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const advancedCount = ADVANCED_KEYS.filter(
    (key) => values[key] !== undefined,
  ).length;
  const [advancedOpen, setAdvancedOpen] = useState(() => advancedCount > 0);
  const prevAdvancedCountRef = useRef(advancedCount);

  // Keep the ref authoritative for handlers that fire before the next effect flush.
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Reconcile external (back/forward or a pushed URL) changes per field, never clobbering in-flight typing.
  useEffect(() => {
    valuesRef.current = values;
    pendingRef.current = null;
    const incoming = toDraft(values);
    const prev = syncedRef.current;
    const next = { ...draftRef.current };
    for (const key of DRAFT_KEYS) {
      // Apply a changed incoming value only to a field the user has not edited
      // since the previous committed values; a dirty field keeps its in-flight text.
      if (incoming[key] !== prev[key] && draftRef.current[key] === prev[key]) {
        next[key] = incoming[key];
      }
    }
    syncedRef.current = incoming;
    if (DRAFT_KEYS.some((k) => next[k] !== draftRef.current[k])) setDraft(next);
  }, [values]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  // Open the panel when an advanced filter first becomes active (back/forward or a
  // shared URL); a manual collapse with the count unchanged is left alone.
  useEffect(() => {
    if (prevAdvancedCountRef.current === 0 && advancedCount > 0) {
      setAdvancedOpen(true);
    }
    prevAdvancedCountRef.current = advancedCount;
  }, [advancedCount]);

  function navigate(overrides: Partial<CatalogFilterValues> = {}): void {
    const next: CatalogFilterValues = {
      ...(pendingRef.current ?? valuesRef.current), // committed (or in-flight) discrete fields
      ...draftOverrides(draftRef.current), // live text fields
      ...overrides, // explicit clear/set (undefined removes)
    };
    pendingRef.current = next;
    startTransition(() => {
      router.push(catalogHref(next));
    });
  }

  /** Flush pending timers, then push — folds typed text into the same navigation. */
  function commit(overrides: Partial<CatalogFilterValues> = {}): void {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    navigate(overrides);
  }

  function schedule(): void {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      navigate();
    }, DEBOUNCE_MS);
  }

  function setField(key: TextKey, value: string): void {
    const next = { ...draftRef.current, [key]: value };
    draftRef.current = next;
    setDraft(next);
    schedule();
  }

  /** Visibly clears one text input while its committed filter is removed. */
  function resetField(key: TextKey): void {
    const next = { ...draftRef.current, [key]: '' };
    draftRef.current = next;
    setDraft(next);
  }

  /** Single-select platform chips: clicking the selected chip is a no-op. */
  function selectPlatform(id: number | undefined): void {
    if (id === values.platformId) return; // no redundant push
    commit({ platformId: id });
  }

  /**
   * Clears everything through the normal commit path: drafts are reset
   * synchronously so no stale text survives, and the in-flight set captured by
   * `pendingRef` is the fully cleared one (all seven keys explicitly undefined).
   */
  function clearAll(): void {
    draftRef.current = EMPTY_DRAFT;
    setDraft(EMPTY_DRAFT);
    commit({
      platformId: undefined,
      edition: undefined,
      year: undefined,
      publisher: undefined,
      genre: undefined,
      playerCount: undefined,
      q: undefined,
    });
  }

  const platformLabel =
    values.platformId === undefined
      ? ''
      : (platforms.find((p) => p.id === values.platformId)?.name ??
        t('platformFallback', { id: values.platformId }));

  return (
    <div
      aria-busy={isPending}
      className={`space-y-3 sm:space-y-4 ${isPending ? 'opacity-60' : ''}`}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          commit();
        }}
        className="space-y-3"
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative lg:w-72 lg:shrink-0">
            <label htmlFor="catalog-q" className="sr-only">
              {t('searchTitles')}
            </label>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              aria-hidden="true"
              className="pointer-events-none absolute top-1/2 left-3 h-[15px] w-[15px] -translate-y-1/2 text-faint"
            >
              <circle cx={11} cy={11} r={7} />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              id="catalog-q"
              name="q"
              type="search"
              autoComplete="off"
              maxLength={255}
              value={draft.q}
              placeholder={t('searchPlaceholder')}
              onChange={(event) => {
                setField('q', event.target.value);
              }}
              className={`${FIELD} pl-9`}
            />
          </div>

          <div
            role="group"
            aria-label={t('platformGroup')}
            className="flex min-w-0 flex-1 flex-wrap gap-2"
          >
            <button
              type="button"
              aria-pressed={values.platformId === undefined}
              onClick={() => {
                selectPlatform(undefined);
              }}
              className={`${PLATFORM_CHIP} ${
                values.platformId === undefined
                  ? PLATFORM_CHIP_ON
                  : PLATFORM_CHIP_OFF
              }`}
            >
              {t('allChip')}
            </button>
            {platforms.map((platform) => (
              <button
                key={platform.id}
                type="button"
                aria-pressed={values.platformId === platform.id}
                onClick={() => {
                  selectPlatform(platform.id);
                }}
                className={`${PLATFORM_CHIP} ${
                  values.platformId === platform.id
                    ? PLATFORM_CHIP_ON
                    : PLATFORM_CHIP_OFF
                }`}
              >
                {platform.name}
              </button>
            ))}
          </div>

          <div className="lg:w-52 lg:shrink-0">
            <label htmlFor="catalog-sort" className="sr-only">
              {t('sortLabel')}
            </label>
            <select
              id="catalog-sort"
              name="sort"
              value={sortOptionOf(values)}
              onChange={(event) => {
                commit(sortOverrides(event.target.value as CatalogSortOption));
              }}
              className={`${FIELD} select-field`}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {t(SORT_LABEL_KEY[option])}
                </option>
              ))}
            </select>
          </div>
        </div>

        <button
          type="button"
          aria-expanded={advancedOpen}
          aria-controls="catalog-advanced"
          onClick={() => {
            setAdvancedOpen((open) => !open);
          }}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-accent-text underline-offset-4 hover:underline"
        >
          {t('advanced')}
          {advancedCount > 0 && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs">
              {t('advancedActive', { count: advancedCount })}
            </span>
          )}
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            className={`h-4 w-4 transition-transform duration-[140ms] motion-reduce:transition-none ${
              advancedOpen ? 'rotate-180' : ''
            }`}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>

        <div id="catalog-advanced" hidden={!advancedOpen}>
          <div className="grid gap-3 rounded-card border border-edge bg-surface p-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-1.5">
              <label htmlFor="catalog-edition" className={LABEL}>
                {t('edition')}
              </label>
              <select
                id="catalog-edition"
                name="edition"
                value={values.edition ?? ''}
                onChange={(event) => {
                  const v = event.target.value;
                  commit({ edition: v === '' ? undefined : v });
                }}
                className={`${FIELD} select-field`}
              >
                <option value="">{t('allEditions')}</option>
                {editions.map((edition) => (
                  <option key={edition} value={edition}>
                    {edition}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="catalog-year" className={LABEL}>
                {t('year')}
              </label>
              <input
                id="catalog-year"
                name="year"
                type="text"
                inputMode="numeric"
                pattern="\d*"
                maxLength={4}
                value={draft.year}
                onChange={(event) => {
                  setField('year', event.target.value);
                }}
                className={FIELD}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="catalog-player-count" className={LABEL}>
                {t('players')}
              </label>
              <input
                id="catalog-player-count"
                name="playerCount"
                type="text"
                inputMode="numeric"
                pattern="\d*"
                maxLength={3}
                value={draft.playerCount}
                onChange={(event) => {
                  setField('playerCount', event.target.value);
                }}
                className={FIELD}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="catalog-publisher" className={LABEL}>
                {t('publisher')}
              </label>
              <input
                id="catalog-publisher"
                name="publisher"
                type="text"
                maxLength={255}
                value={draft.publisher}
                onChange={(event) => {
                  setField('publisher', event.target.value);
                }}
                className={FIELD}
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="catalog-genre" className={LABEL}>
                {t('genre')}
              </label>
              <input
                id="catalog-genre"
                name="genre"
                type="text"
                maxLength={255}
                value={draft.genre}
                onChange={(event) => {
                  setField('genre', event.target.value);
                }}
                className={FIELD}
              />
            </div>
          </div>
        </div>
      </form>

      {hasActiveFilters(values) && (
        <div className="flex flex-wrap items-center gap-2">
          {values.q !== undefined && (
            <Chip
              label={t('chip.search', { q: values.q })}
              onRemove={() => {
                resetField('q');
                commit({ q: undefined });
              }}
            />
          )}
          {values.platformId !== undefined && (
            <Chip
              label={t('chip.platform', { name: platformLabel })}
              onRemove={() => {
                commit({ platformId: undefined });
              }}
            />
          )}
          {values.edition !== undefined && (
            <Chip
              label={t('chip.edition', { edition: values.edition })}
              onRemove={() => {
                commit({ edition: undefined });
              }}
            />
          )}
          {values.year !== undefined && (
            <Chip
              label={t('chip.year', { year: values.year })}
              onRemove={() => {
                resetField('year');
                commit({ year: undefined });
              }}
            />
          )}
          {values.publisher !== undefined && (
            <Chip
              label={t('chip.publisher', { publisher: values.publisher })}
              onRemove={() => {
                resetField('publisher');
                commit({ publisher: undefined });
              }}
            />
          )}
          {values.genre !== undefined && (
            <Chip
              label={t('chip.genre', { genre: values.genre })}
              onRemove={() => {
                resetField('genre');
                commit({ genre: undefined });
              }}
            />
          )}
          {values.playerCount !== undefined && (
            <Chip
              label={t('chip.players', { count: values.playerCount })}
              onRemove={() => {
                resetField('playerCount');
                commit({ playerCount: undefined });
              }}
            />
          )}
          <button
            type="button"
            onClick={clearAll}
            className="text-sm text-accent-text underline-offset-4 hover:underline"
          >
            {t('clearAll')}
          </button>
        </div>
      )}
    </div>
  );
}
