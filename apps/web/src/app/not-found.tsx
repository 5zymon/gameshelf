import Link from 'next/link';

export const dynamic = 'force-dynamic';

export default function NotFound(): React.ReactElement {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-2 px-6 text-center">
      <p className="text-xs uppercase tracking-widest text-accent">404</p>
      <h1 className="text-2xl font-semibold tracking-tight text-fog">
        Page not found
      </h1>
      <p className="text-sm text-muted">
        That shelf does not exist.{' '}
        <Link className="text-accent hover:text-accent-strong" href="/">
          Back to catalog
        </Link>
      </p>
    </main>
  );
}
