import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { getSetupStatus } from '@/lib/api/server';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ setup?: string }>;
}): Promise<React.ReactElement> {
  if (await getSetupStatus()) redirect('/setup');
  const { setup } = await searchParams;
  const t = await getTranslations('auth');
  return (
    <AuthCard
      eyebrow="GameShelf"
      title={t('signIn')}
      description={t('description')}
    >
      {setup === 'complete' && (
        <p
          role="status"
          className="mb-4 rounded-control border border-edge bg-surface px-3 py-2 text-sm text-accent-text"
        >
          {t('setupComplete')}
        </p>
      )}
      <LoginForm />
    </AuthCard>
  );
}
