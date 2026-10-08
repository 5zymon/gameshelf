'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isApiError } from '@/lib/api';
import { api } from '@/lib/api/browser';

export function SetupForm(): React.ReactElement {
  const router = useRouter();
  const t = useTranslations('auth');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(
    event: React.SubmitEvent<HTMLFormElement>,
  ): Promise<void> {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.setup.create({ email, password });
      router.replace('/login?setup=complete');
      router.refresh();
      return;
    } catch (error) {
      if (isApiError(error) && error.status === 409) {
        router.replace('/login');
        router.refresh();
        return;
      }
      if (isApiError(error) && error.status === 400) {
        setError(t('setup.inputError'));
        return;
      }
      setError(t('setup.genericError'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      className="space-y-4"
      noValidate
    >
      {error && (
        <p
          role="alert"
          aria-live="polite"
          className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="setup-email" className="block text-sm text-muted">
          {t('setup.email')}
        </label>
        <input
          id="setup-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          className="w-full rounded-md border border-edge bg-ink px-3 py-2 text-fog outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="setup-password" className="block text-sm text-muted">
          {t('setup.password')}
        </label>
        <input
          id="setup-password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          className="w-full rounded-md border border-edge bg-ink px-3 py-2 text-fog outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:bg-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-strong disabled:opacity-60"
      >
        {submitting ? t('setup.creating') : t('setup.createAccount')}
      </button>
    </form>
  );
}
