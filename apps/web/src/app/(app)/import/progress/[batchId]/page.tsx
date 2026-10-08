import { notFound } from 'next/navigation';
import { ImportProgressView } from '@/components/import-progress-view';
import { getImportBatch, getImportJobsForBatch } from '@/lib/api/server';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Reload-safe batch progress view. The server supplies the first paint (batch
 * aggregate + per-photo rows) and the client keeps polling until the batch
 * completes. Keep the route path stable.
 */
export default async function ImportProgressPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}): Promise<React.ReactElement> {
  await requireUser();
  const { batchId } = await params;
  const progress = await getImportBatch(batchId);
  if (progress === null) notFound();
  const jobs = await getImportJobsForBatch(batchId);

  return (
    <ImportProgressView
      key={batchId}
      batchId={batchId}
      initialProgress={progress}
      initialItems={jobs.items}
    />
  );
}
