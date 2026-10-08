import { getTranslations } from 'next-intl/server';
import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { getSetupStatus } from '@/lib/api/server';
import { SetupForm } from './setup-form';

export const dynamic = 'force-dynamic';

export default async function SetupPage(): Promise<React.ReactElement> {
  if (!(await getSetupStatus())) redirect('/login');
  const t = await getTranslations('auth');
  return (
    <AuthCard
      eyebrow={t('setup.eyebrow')}
      title={t('setup.title')}
      description={t('setup.description')}
    >
      <SetupForm />
    </AuthCard>
  );
}
