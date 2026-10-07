import { redirect } from 'next/navigation';
import { AuthCard } from '@/components/auth-card';
import { getSetupStatus } from '@/lib/api/server';
import { SetupForm } from './setup-form';

export const dynamic = 'force-dynamic';

export default async function SetupPage(): Promise<React.ReactElement> {
  if (!(await getSetupStatus())) redirect('/login');
  return (
    <AuthCard
      eyebrow="First-run setup"
      title="Set up your shelf"
      description="This account is created once and becomes the owner of this GameShelf instance."
    >
      <SetupForm />
    </AuthCard>
  );
}
