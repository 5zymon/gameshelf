import type { Platform } from '@/lib/api';
import { inDefaultView } from '@/lib/platforms';

export interface ExportPlatform {
  id: string;
  name: string;
  gameCount: number;
}

const EXPORT_CSV_PATH = '/api/export/csv';

/** `inDefaultView` platforms, trimmed to what the form needs, in API order. */
export function exportPlatforms(
  platforms: readonly Platform[],
): ExportPlatform[] {
  return platforms
    .filter(inDefaultView)
    .map(({ id, name, gameCount }) => ({ id, name, gameCount }));
}

/** `/api/export/csv`, or with `?platformId=<encoded id>` when given. */
export function exportCsvHref(platformId?: string): string {
  return platformId === undefined
    ? EXPORT_CSV_PATH
    : `${EXPORT_CSV_PATH}?platformId=${encodeURIComponent(platformId)}`;
}
