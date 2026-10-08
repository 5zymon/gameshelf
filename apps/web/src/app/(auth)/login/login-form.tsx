'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { isApiError } from '@/lib/api';
import { api } from '@/lib/api/browser';

const FIELD =
  'w-full h-10 rounded-control border border-edge bg-field px-3 text-sm text-ink placeholder:text-muted outline-none focus:border-accent/55 focus:ring-[3px] focus:ring-accent/15 disabled:opacity-60';

const PRIMARY_BUTTON =
  'inline-flex items-center justify-center rounded-control bg-accent px-4 py-2.5 text-sm leading-none font-semibold text-accent-ink transition-colors duration-[140ms] ease-[ease] hover:bg-accent-strong motion-reduce:transition-none disabled:opacity-60';

export function LoginForm(): React.ReactElement {
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
      await api.auth.login({ email, password });
      router.replace('/');
      router.refresh();
      return;
    } catch (error) {
      if (isApiError(error) && error.status === 401) {
        setError(t('loginError.credentials'));
        return;
      }
      if (isApiError(error) && error.status === 400) {
        setError(t('loginError.input'));
        return;
      }
      setError(t('loginError.generic'));
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
          className="rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger"
        >
          {error}
        </p>
      )}
      <div className="space-y-1.5">
        <label htmlFor="login-email" className="block text-sm text-muted">
          {t('email')}
        </label>
        <input
          id="login-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          autoFocus
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
          }}
          className={FIELD}
        />
      </div>
      <div className="space-y-1.5">
        <label htmlFor="login-password" className="block text-sm text-muted">
          {t('password')}
        </label>
        <input
          id="login-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => {
            setPassword(e.target.value);
          }}
          className={FIELD}
        />
      </div>
      <button
        type="submit"
        disabled={submitting}
        className={`w-full ${PRIMARY_BUTTON}`}
      >
        {submitting ? t('signingIn') : t('signIn')}
      </button>
    </form>
  );
}
