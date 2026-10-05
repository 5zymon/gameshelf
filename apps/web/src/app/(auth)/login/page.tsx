import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { getSetupStatus } from '@/lib/api';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}): Promise<React.ReactElement> {
  if (await getSetupStatus()) redirect('/setup');
  const { setup } = await searchParams;
  return (
    <AuthCard
      eyebrow="GameShelf"
      title="Sign in"
      description="Your shelf is waiting."
    >
      {setup === 'complete' && (
        <p
          role="status"
          className="mb-4 rounded-md border border-edge bg-ink px-3 py-2 text-sm text-accent-strong"
        >
          Setup complete. Sign in with your new account.
        </p>
      )}
      <LoginForm />
    </AuthCard>
  );
}
