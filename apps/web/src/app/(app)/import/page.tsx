import {
  PhotoImportForm,
  type LlmReadiness,
} from '@/components/photo-import-form';
import { getLlmSettings } from '@/lib/api/server';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function ImportPage(): Promise<React.ReactElement> {
  await requireUser();

  let readiness: LlmReadiness;
  try {
    const settings = await getLlmSettings();
    readiness = settings?.importEnabled
      ? {
          state: 'enabled',
          providerLabel: settings.availableProviders.find(
            (provider) => provider.id === settings.provider,
          )?.label,
        }
      : { state: 'disabled' };
  } catch {
    readiness = { state: 'unknown' };
  }

  return (
    <section className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Import from photos
        </h1>
        <p className="text-sm text-muted">
          Photograph your shelf, pick the photos here, and we&rsquo;ll recognise
          the games.
        </p>
      </header>
      <PhotoImportForm readiness={readiness} />
    </section>
  );
}
