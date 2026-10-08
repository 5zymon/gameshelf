import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getImportBatch } from '@/lib/api/server';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * Minimal, reload-safe landing target for a started upload. Ticket 6.3 replaces
 * the body with the full per-photo progress view; keep the route stable.
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

  const done = progress.completedCount;
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
        Import running
      </h1>
      <p className="text-sm text-muted">
        {done} of {progress.total} photos processed.
      </p>
      <p className="text-sm text-muted">
        Live per-photo status, counts and failures land in a follow-up ticket.
        You can leave this page — the import keeps running.
      </p>
      <Link
        href="/"
        className="inline-block rounded-md border border-edge px-4 py-2 text-sm font-medium text-fog hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        Back to the catalog
      </Link>
    </section>
  );
}
